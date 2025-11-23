const express = require('express');
const router = express.Router();
const { verify } = require('jsonwebtoken');

const { createAccessToken } = require('../utils/tokens');

router.post('/', (req, res, next) => {
    let accToken = req.cookies['accToken'];
    let flag = false;
    if (accToken) {
        verify(accToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
            if (!err) {
                flag = true;
                return res.status(401).json({
                    message: "User already logged in",
                    status: "error"
                });
            }
        });
    }
    if (flag) return;
    
    const refToken = req.cookies['refToken'];

    if (!refToken) return res.status(404).json({
        message: "cookie not found",
        type: "error"
    });

    verify(refToken, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
        if (err) return res.status(403).json({
            message: "Invalid Token",
            type: "error"
        });

        const accessToken = createAccessToken({ username: user.username });
        res.cookie('accToken', accessToken, { maxAge: 60 * 1000 });
        return res.status(200).json({
            accessToken: accessToken
        });
    });
})

module.exports = router;