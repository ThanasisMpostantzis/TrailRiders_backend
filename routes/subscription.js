'use strict';

const express = require('express');
const router = express.Router();
const { check, renew } = require('../controllers/subscriptionController');

router.post('/check', check);
router.post('/renew', renew);

module.exports = router;