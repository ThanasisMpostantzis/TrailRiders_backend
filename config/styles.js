const express = require('express');
const path = require('path');
const router = express.Router();

router.get('/loginstyle', (req, res) => {
    res.sendFile(path.resolve(path.join(__dirname, '../styles/loginstyle.css')));
});

router.get('/forgotpwdstyle', (req, res) => {
    res.sendFile(path.resolve(path.join(__dirname, '../styles/forgotPasswordStyle.css')));
});

router.get('/indexstyle', (req, res) => {
    res.sendFile(path.resolve(path.join(__dirname, '../styles/indexStyle.css')));
});

router.get('/resetpwdstyle', (req, res) => {
    res.sendFile(path.resolve(path.join(__dirname, '../styles/resetPasswordStyle.css')));
});

module.exports = router;