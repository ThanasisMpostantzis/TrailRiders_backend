const express = require('express');
const router = express.Router();
const path = require('path');

router.get('/', (req, res) => {
    res.sendFile(path.resolve(path.join(__dirname, '../pages/forgotPassword.html')));
});

module.exports = router;