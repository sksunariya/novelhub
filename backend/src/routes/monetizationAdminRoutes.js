const express = require('express');
const m = require('../controllers/monetizationAdminController');
const g = require('../controllers/grantsController');
const s = require('../controllers/subscriptionController');

// Mounted under /api/admin/monetization by adminRoutes, which already applies
// protect + adminOnly.
const router = express.Router();

// Packs
router.get('/packs', m.listPacks);
router.post('/packs', m.createPack);
router.put('/packs/reorder', m.reorderPacks);
router.put('/packs/:id', m.updatePack);
router.delete('/packs/:id', m.deletePack);

// Currencies — static paths before :code so they are not read as one.
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

// Wallets
router.get('/wallets', m.listWallets);
router.get('/wallets/:userId', m.getWalletDetail);
router.post('/wallets/:userId/adjust', m.adjustWallet);

// Orders
router.get('/orders', m.listOrders);
router.post('/orders/:id/refund', m.refundOrder);

// Subscription plans and subscribers — /summary before the paginated list so it
// is not read as a filter value.
router.get('/plans', s.adminListPlans);
router.post('/plans', s.createPlan);
router.put('/plans/:id', s.updatePlan);
router.post('/plans/:id/sync', s.syncPlan);
router.delete('/plans/:id', s.deletePlan);
router.get('/subscriptions/summary', s.subscriptionSummary);
router.get('/subscriptions', s.adminListSubscriptions);

// PayPal connectivity check and the "can anyone actually buy?" summary
router.get('/paypal/test', m.testPaypal);
router.get('/readiness', m.readiness);

// Notification templates
router.get('/templates', m.listTemplates);
router.put('/templates/:key/:channel', m.updateTemplate);

// Grant campaigns — preview must precede /:id.
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
