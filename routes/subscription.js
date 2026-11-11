'use strict';

const express = require('express');
const router = express.Router();
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const { plans, check, start, update, cancel } = require('../controllers/subscriptionController');

router.get('/plans', plans);
router.get('/check', authenticateUserToken, check);
router.post('/check', authenticateUserToken, check);
router.post('/start', authenticateUserToken, start);
router.post('/update', authenticateUserToken, update);
router.post('/cancel', authenticateUserToken, cancel);

module.exports = router;
