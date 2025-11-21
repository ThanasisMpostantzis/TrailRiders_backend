const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../utils/tokens');

router.get('/', authenticateToken, (req, res) => {
    res.status(200).json({
        message: "Logged in",
        type: "success"
    });
});

module.exports = router;