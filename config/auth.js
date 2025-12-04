'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();

const { forgotpwd, resetpwd, login, signup, deleteUser, changePassword } = require('../controllers/authController');
const tokenRouter = require('../routes/token.js');

router.get('/', (req, res) => {
    res.send("<h4> Auth Root </h4>");
});

router.use('/token', tokenRouter)
router.post('/login', login);
router.post('/signup', signup)
router.post('/forgotPassword', forgotpwd);
router.route('/resetPassword/:id/:token').post(resetpwd); // LINK IS ACCESSED ONLY FROM EMAIL; IT'S NOT EYE CANDY
router.post('/deleteUser', deleteUser);
router.post('/changePassword', changePassword);

module.exports = router;