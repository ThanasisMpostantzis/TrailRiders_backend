'use strict';

const express = require('express');
const router = express.Router();

const { forgotpwd, resetPasswordPage, resetpwd, login, googleLogin, googleConfig, signup, refresh, logout, deleteUser, changePassword } = require('../controllers/authController');
const { tokenCheck } = require('../controllers/tokenController.js');
const authenticateUserToken = require('../middlewares/userAuthToken.js');

router.get('/', (req, res) => {
    res.send("<h4> Auth Root </h4>");
});

router.post('/token', tokenCheck);
router.post('/refresh', refresh);
router.post('/login', login);
router.post('/google', googleLogin);
router.get('/google/config', googleConfig);
router.post('/logout', logout);
router.post('/signup', signup);
router.post('/forgotPassword', forgotpwd);
router.get('/resetPassword', resetPasswordPage); // Page opened from the e-mail link
router.post('/resetPassword', resetpwd);
router.post('/deleteUser', authenticateUserToken, deleteUser);
router.post('/changePassword', authenticateUserToken, changePassword);

module.exports = router;
