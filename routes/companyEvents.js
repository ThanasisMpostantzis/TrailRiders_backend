const express = require('express');
const router = express.Router();
const { create, remove } = require('../controllers/companyEventsController');

// All routes are protected by the company token middleware (see app.js)
router.post('/create', create);
router.delete('/:id', remove);

module.exports = router;
