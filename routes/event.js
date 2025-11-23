const express = require('express');
const router = express.Router();

const { createEvent } = require('../controllers/eventController');

router.get('/', (req, res) => {
    res.send('<h1> Event route </h1>');
});

router.route('/create').get(createEvent);

module.exports = router;