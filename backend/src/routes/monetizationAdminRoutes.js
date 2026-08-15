const express = require('express');
const m = require('../controllers/monetizationAdminController');
const g = require('../controllers/grantsController');
const s = require('../controllers/subscriptionController');
const { requireModule } = require('../middlewares/auth');

// Mounted under /api/admin/monetization by adminRoutes, which already applies
// protect + adminOnly. Module guards are per-section: the monetization surface
// spans several portal modules, and "can see credit packs" is a very different
// grant from "can adjust a user's wallet".
const router = express.Router();

// Packs — pricing rules live with them, being the same catalogue decision.
router.use('/packs', requireModule('packs'));
router.use('/pricing-rules', requireModule('packs'));
router.get('/packs', m.listPacks);
router.post('/packs', m.createPack);
router.put('/packs/reorder', m.reorderPacks);
router.put('/packs/:id', m.updatePack);
router.delete('/packs/:id', m.deletePack);

// Currencies — static paths before :code so they are not read as one.
router.use('/currencies', requireModule('currencies'));
router.get('/currencies', m.listCurrencies);
router.post('/currencies/seed', m.seedCurrencies);
router.post('/currencies/refresh-rates', m.refreshRates);
router.put('/currencies/:code', m.upsertCurrency);
router.post('/currencies', m.upsertCurrency);

// Pricing rules
router.get('/pricing-rules', m.listPricingRules);
router.post('/pricing-rules', m.createPricingRule);
router.put('/pricing-rules/:id', m.updatePricingRule);
router.delete('/pricing-rules/:id', m.deletePricingRule);

// Wallets and orders — user balances and money movement, one module.
router.use('/wallets', requireModule('wallets'));
router.use('/orders', requireModule('wallets'));
router.get('/wallets', m.listWallets);
router.get('/wallets/:userId', m.getWalletDetail);
router.post('/wallets/:userId/adjust', m.adjustWallet);

// Orders
router.get('/orders', m.listOrders);
router.post('/orders/:id/refund', m.refundOrder);

// Subscription plans and subscribers — /summary before the paginated list so it
// is not read as a filter value.
router.use('/plans', requireModule('plans'));
router.use('/subscriptions', requireModule('plans'));
router.get('/plans', s.adminListPlans);
router.post('/plans', s.createPlan);
router.put('/plans/:id', s.updatePlan);
router.post('/plans/:id/sync', s.syncPlan);
router.delete('/plans/:id', s.deletePlan);
router.get('/subscriptions/summary', s.subscriptionSummary);
router.get('/subscriptions', s.adminListSubscriptions);

// PayPal connectivity check and the "can anyone actually buy?" summary. Both
// report on payment configuration, so they follow the monetization config.
router.get('/paypal/test', requireModule('monetization_config'), m.testPaypal);
router.get('/readiness', requireModule('monetization_config'), m.readiness);

// Notification templates
router.use('/templates', requireModule('notifications'));
router.get('/templates', m.listTemplates);
router.put('/templates/:key/:channel', m.updateTemplate);

// Grant campaigns — preview must precede /:id.
router.use('/grants', requireModule('grants'));
router.get('/grants', g.listCampaigns);
router.post('/grants', g.createCampaign);
router.post('/grants/preview', g.previewAudience);
router.get('/grants/user-search', g.searchUsers);
router.post('/grants/quick-send', g.quickSend);
router.get('/grants/:id', g.getCampaign);
router.put('/grants/:id', g.updateCampaign);
router.delete('/grants/:id', g.deleteCampaign);
router.post('/grants/:id/dry-run', g.dryRun);
router.post('/grants/:id/execute', g.execute);
router.post('/grants/:id/approve', g.approve);
router.post('/grants/:id/cancel', g.cancel);
router.post('/grants/:id/reverse', g.reverse);

module.exports = router;
