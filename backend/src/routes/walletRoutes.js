const express = require('express');
const { getWallet, getTransactions, updateAutoUnlock } = require('../controllers/walletController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.use(protect);

router.get('/', getWallet);
router.get('/transactions', getTransactions);
router.put('/auto-unlock', updateAutoUnlock);

module.exports = router;
