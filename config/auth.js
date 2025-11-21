'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();

const { forgotpwd, resetpwd, login, signup } = require('../controllers/authController');
const tokenRouter = require('../routes/token.js');

router.get('/', (req, res) => {
    res.send("<h4> Auth Root </h4>");
});

router.use('/token', tokenRouter)
router.post('/login', login);
router.post('/signup', signup)
router.post('/forgotPassword', forgotpwd);
router.route('/resetPassword/:id/:token').get( (req, res) => {
    res.sendFile(path.resolve(path.join(__dirname, '../pages/resetPassword.html')))
}).post(resetpwd);

module.exports = router;