const WebhookEvent = require('../models/WebhookEvent');
const Order = require('../models/Order');
const paypalService = require('../services/paypalService');
const orderService = require('../services/orderService');
const { asyncHandler } = require('../middlewares/errorHandler');
const {
  PAYPAL_EVENTS,
  WEBHOOK_STATUS,
  ORDER_STATUS,
  SUBSCRIPTION_STATUS,
} = require('../config/constants');

/**
 * Find the order a webhook refers to.
 *
 * `custom_id` is set at order creation precisely so this lookup is direct;
 * the other paths are fallbacks for events shaped differently.
 */
const findOrder = async (resource) => {
  if (!resource) return null;
  if (resource.custom_id) {
    const byCustom = await Order.findById(resource.custom_id).catch(() => null);
    if (byCustom) return byCustom;
  }
  if (resource.id) {
    const byCapture = await Order.findOne({ paypalCaptureId: resource.id });
    if (byCapture) return byCapture;
    const byOrder = await Order.findOne({ paypalOrderId: resource.id });
    if (byOrder) return byOrder;
  }
  const links = resource.links || [];
  const up = links.find((link) => link.rel === 'up');
  if (up) {
    const match = up.href.match(/checkout\/orders\/([^/]+)/);
    if (match) return Order.findOne({ paypalOrderId: match[1] });
  }
  return null;
};

const handlers = {
  [PAYPAL_EVENTS.ORDER_APPROVED]: async (order) => {
    if (order.status === ORDER_STATUS.CREATED) {
      order.status = ORDER_STATUS.APPROVED;
      order.log('approved', 'webhook');
      await order.save();
    }
    return 'approved';
  },

  // The safety net: if the buyer closed the tab before the client capture call
  // landed, this is what actually delivers their credits.
  [PAYPAL_EVENTS.CAPTURE_COMPLETED]: async (order, resource) => {
    if (!order.paypalCaptureId && resource.id) {
      order.paypalCaptureId = resource.id;
      const breakdown = resource.seller_receivable_breakdown || {};
      if (breakdown.paypal_fee) {
        order.paypalFeeUsdCents = Math.round(parseFloat(breakdown.paypal_fee.value) * 100);
      }
      if (breakdown.net_amount) {
        order.netAfterFeeUsdCents = Math.round(parseFloat(breakdown.net_amount.value) * 100);
      }
      await order.save();
    }
    const result = await orderService.creditOrder(order, { source: 'webhook' });
    return result.alreadyCredited ? 'already_credited' : 'credited';
  },

  [PAYPAL_EVENTS.CAPTURE_DENIED]: async (order, resource) => {
    order.status = ORDER_STATUS.FAILED;
    order.failureReason = resource.status_details ? JSON.stringify(resource.status_details) : 'denied';
    order.log('denied', 'webhook');
    await order.save();
    return 'failed';
  },

  [PAYPAL_EVENTS.CAPTURE_REFUNDED]: async (order, resource) => {
    const amount = resource.amount ? Math.round(parseFloat(resource.amount.value) * 100) : null;
    await orderService.clawbackOrder(order, { refundedUsdCents: amount, source: 'webhook' });
    return 'refunded';
  },

  [PAYPAL_EVENTS.CAPTURE_REVERSED]: async (order) => {
    await orderService.clawbackOrder(order, { source: 'webhook' });
    order.log('reversed', 'webhook');
    await order.save();
    return 'reversed';
  },

  [PAYPAL_EVENTS.DISPUTE_CREATED]: async (order) => {
    order.status = ORDER_STATUS.DISPUTED;
    order.log('disputed', 'webhook');
    await order.save();
    return 'disputed';
  },
};

// Subscription events resolve to a Subscription rather than an Order, so they
// are routed separately rather than forced through findOrder.
const findSubscription = async (resource) => {
  const Subscription = require('../models/Subscription');
  if (!resource) return null;
  if (resource.custom_id) {
    const byCustom = await Subscription.findById(resource.custom_id).catch(() => null);
    if (byCustom) return byCustom;
  }
  // A renewal sale carries the subscription id in billing_agreement_id.
  const id = resource.id || resource.billing_agreement_id;
  if (id) return Subscription.findOne({ paypalSubscriptionId: id });
  return null;
};

const toCents = (money) => (money && money.value ? Math.round(parseFloat(money.value) * 100) : 0);

const subscriptionHandlers = {
  [PAYPAL_EVENTS.SUBSCRIPTION_ACTIVATED]: async (subscription, resource) => {
    const service = require('../services/subscriptionService');
    const result = await service.activate(subscription, {
      netUsdCents: toCents(resource.billing_info?.last_payment?.amount),
      periodStart: new Date(),
      periodEnd: resource.billing_info?.next_billing_time
        ? new Date(resource.billing_info.next_billing_time)
        : null,
    });
    if (result.duplicate) return 'cancelled as a duplicate';
    return result.granted ? `activated, granted ${result.credits} credits` : 'activated';
  },

  // Every renewal arrives here — this is what grants the cycle's credits.
  [PAYPAL_EVENTS.SALE_COMPLETED]: async (subscription, resource) => {
    const service = require('../services/subscriptionService');
    const result = await service.activate(subscription, {
      netUsdCents: toCents(resource.amount) || toCents(resource.amount?.total),
      periodStart: new Date(),
      periodEnd: null,
    });
    if (result.duplicate) return 'cancelled as a duplicate';
    return result.granted ? `granted ${result.credits} credits` : 'already granted';
  },

  [PAYPAL_EVENTS.SUBSCRIPTION_PAYMENT_FAILED]: async (subscription) => {
    await require('../services/subscriptionService').recordPaymentFailure(subscription);
    return 'past due';
  },

  [PAYPAL_EVENTS.SUBSCRIPTION_CANCELLED]: async (subscription) => {
    subscription.status = SUBSCRIPTION_STATUS.CANCELLED;
    subscription.cancelledAt = subscription.cancelledAt || new Date();
    await subscription.save();
    return 'cancelled';
  },

  [PAYPAL_EVENTS.SUBSCRIPTION_SUSPENDED]: async (subscription) => {
    subscription.status = SUBSCRIPTION_STATUS.SUSPENDED;
    await subscription.save();
    return 'suspended';
  },

  [PAYPAL_EVENTS.SUBSCRIPTION_EXPIRED]: async (subscription) => {
    subscription.status = SUBSCRIPTION_STATUS.EXPIRED;
    await subscription.save();
    return 'expired';
  },
};

/**
 * POST /webhooks/paypal
 *
 * Mounted outside /api on purpose: the maintenance guard sits on /api and would
 * otherwise 503 every webhook while maintenance mode is on. PayPal would retry
 * for days and then give up, and buyers who paid would never get their credits.
 *
 * Always answers 200 once the event is persisted. A 500 makes PayPal redeliver
 * for days, so processing failures are recorded and replayed from the admin
 * portal instead of being pushed back onto PayPal.
 */
const handlePaypalWebhook = asyncHandler(async (req, res) => {
  const event = req.body || {};
  if (!event.id || !event.event_type) {
    return res.status(400).json({ message: 'Malformed webhook payload' });
  }

  // Replays die here — the unique index means a redelivery is a no-op.
  let record;
  try {
    record = await WebhookEvent.create({
      eventId: event.id,
      eventType: event.event_type,
      resourceId: (event.resource || {}).id || '',
      payload: event,
    });
  } catch (error) {
    if (error.code === 11000) return res.status(200).json({ received: true, duplicate: true });
    throw error;
  }

  const { verified, reason } = await paypalService.verifyWebhookSignature(req.headers, event);
  record.signatureVerified = verified;
  if (!verified) {
    record.status = WEBHOOK_STATUS.FAILED;
    record.lastError = `signature not verified: ${reason}`;
    await record.save();
    console.error('[paypal-webhook] rejected unverified event', event.id, reason);
    // 200 so PayPal stops retrying something we will never accept.
    return res.status(200).json({ received: true, verified: false });
  }

  res.status(200).json({ received: true });

  // Processing continues after the response so a slow handler never causes a
  // PayPal timeout and redelivery.
  try {
    // Subscription events resolve to a different entity, so they are routed
    // before the order handlers rather than through them.
    const subscriptionHandler = subscriptionHandlers[event.event_type];
    if (subscriptionHandler) {
      const subscription = await findSubscription(event.resource);
      if (!subscription) {
        record.status = WEBHOOK_STATUS.FAILED;
        record.lastError = 'no matching subscription';
        record.attempts += 1;
        await record.save();
        return;
      }
      const outcome = await subscriptionHandler(subscription, event.resource || {});
      record.status = WEBHOOK_STATUS.PROCESSED;
      record.processedAt = new Date();
      record.attempts += 1;
      await record.save();
      console.info('[paypal-webhook]', event.event_type, outcome);
      return;
    }

    const handler = handlers[event.event_type];
    if (!handler) {
      record.status = WEBHOOK_STATUS.IGNORED;
      await record.save();
      return;
    }
    const order = await findOrder(event.resource);
    if (!order) {
      record.status = WEBHOOK_STATUS.FAILED;
      record.lastError = 'no matching order';
      record.attempts += 1;
      await record.save();
      return;
    }
    const outcome = await handler(order, event.resource || {});
    record.status = WEBHOOK_STATUS.PROCESSED;
    record.processedAt = new Date();
    record.order = order._id;
    record.lastError = '';
    record.attempts += 1;
    await record.save();
    console.info('[paypal-webhook]', event.event_type, order.orderNumber, outcome);
  } catch (error) {
    record.status = WEBHOOK_STATUS.FAILED;
    record.lastError = error.message;
    record.attempts += 1;
    await record.save().catch(() => {});
    console.error('[paypal-webhook] processing failed', event.id, error.message);
  }
});

/** POST /api/admin/monetization/webhooks/:id/replay */
const replayWebhook = asyncHandler(async (req, res) => {
  const record = await WebhookEvent.findById(req.params.id);
  if (!record) return res.status(404).json({ message: 'Webhook event not found' });

  const resource = (record.payload || {}).resource || {};

  // Subscription events resolve to a different entity, so replay branches the
  // same way live delivery does — otherwise a failed renewal could never be
  // retried from the admin portal.
  const subscriptionHandler = subscriptionHandlers[record.eventType];
  const handler = subscriptionHandler || handlers[record.eventType];
  if (!handler) return res.status(400).json({ message: `No handler for ${record.eventType}` });

  const target = subscriptionHandler ? await findSubscription(resource) : await findOrder(resource);
  if (!target) {
    return res
      .status(404)
      .json({ message: `No matching ${subscriptionHandler ? 'subscription' : 'order'} for this event` });
  }

  try {
    const outcome = await handler(target, resource);
    record.status = WEBHOOK_STATUS.PROCESSED;
    record.processedAt = new Date();
    record.attempts += 1;
    record.lastError = '';
    if (!subscriptionHandler) record.order = target._id;
    await record.save();
    res.json({ replayed: true, outcome, orderNumber: target.orderNumber });
  } catch (error) {
    record.status = WEBHOOK_STATUS.FAILED;
    record.lastError = error.message;
    record.attempts += 1;
    await record.save();
    res.status(500).json({ message: error.message });
  }
});

module.exports = { handlePaypalWebhook, replayWebhook, findOrder };
