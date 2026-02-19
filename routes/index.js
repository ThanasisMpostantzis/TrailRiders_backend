const express = require('express');
const router = express.Router();

const authenticateUserToken = require('../middlewares/userAuthToken.js');

router.get('/', authenticateUserToken, (req, res) => {
    res.status(200).json({
        message: "Logged in",
        type: "success",
        user: {
            id: req.user.id,
            username: req.user.username
        }
    });
});

module.exports = router;