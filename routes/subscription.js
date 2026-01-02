'use strict';

const express = require('express');
const router = express.Router();
const { check, start, update } = require('../controllers/subscriptionController');

router.post('/check', check);
router.post('/start', start);
router.post('/update', update);

module.exports = router;