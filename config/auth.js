'use strict';

const express = require('express');
const router = express.Router();

const { forgotpwd, resetPasswordPage, resetpwd, login, googleLogin, googleConfig, signup, refresh, logout, deleteUser, changePassword } = require('../controllers/authController');
const { tokenCheck } = require('../controllers/tokenController.js');
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const { rateLimit } = require('../utils/rateLimit');

// Brute-force protection
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const signupLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
const mailLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });

router.get('/', (req, res) => {
    res.send("<h4> Auth Root </h4>");
});

router.post('/token', tokenCheck);
router.post('/refresh', refresh);
router.post('/login', loginLimit, login);
router.post('/google', loginLimit, googleLogin);
router.get('/google/config', googleConfig);
router.post('/logout', logout);
router.post('/signup', signupLimit, signup);
router.post('/forgotPassword', mailLimit, forgotpwd);
router.get('/resetPassword', resetPasswordPage); // Page opened from the e-mail link
router.post('/resetPassword', loginLimit, resetpwd);
router.post('/deleteUser', authenticateUserToken, deleteUser);
router.post('/changePassword', authenticateUserToken, loginLimit, changePassword);

module.exports = router;
