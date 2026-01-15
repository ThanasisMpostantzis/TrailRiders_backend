'use strict';

const express = require('express');
const router = express.Router();
const { check, start, update, cancel } = require('../controllers/subscriptionController');

router.post('/check', check);
router.post('/start', start);
router.post('/update', update);
router.post('/cancel', cancel);

module.exports = router;