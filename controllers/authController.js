'use strict';

const dbConn = require('../config/databaseCon');
const { transporter, forgotPasswordTemplate, createPasswordResetUrl, passwordResetConfirmationTemplate } = require('../utils/mailService');
const { createPasswordResetToken, createAccessToken, createRefreshToken } = require('../utils/tokens.js');

const { verify } = require('jsonwebtoken');


// LOGIN FUNCTION
const login = async (req, res, next) => {
    const { username, pwd } = req.body;

    if (!username || !pwd) {
        return res.status(400).json({
            message: "E-mail or password are empty",
            status: "error"
        });
    }

    const query = `SELECT id, username, password, email FROM user WHERE username = "${username}"`;

    runQuery(query, (result) => {
        if (result) {
            const compare = (result.password == pwd)

            if (compare) {
                const user = {
                    id: result.id,
                    username: username,
                    email: result.email
                }
                const accessToken = createAccessToken(user);
                const refreshToken = createRefreshToken(user);
                let accessCookie = res.cookie.accToken;
                if (!accessCookie) {
                    res.cookie('accToken', accessToken, { maxAge: 60 * 1000 });
                } else {
                    return res.status(401).json({
                        message: "User already logged in",
                        status: "error"
                    });
                }
                res.cookie('refToken', refreshToken, { maxAge: 600 * 1000 });
                //addCookie('refToken', refreshToken, 7);

                return res.status(200).json({
                    message: "Login successful",
                    type: "success",
                    accessToken: accessToken,
                    refreshToken: refreshToken
                });
            } else {
                return res.status(401).json({
                    message: "Password is invalid",
                    type: "error"
                });
            }
        } else {
            return res.status(401).json({
                message: "User not found",
                type: "error"
            });
        }
    });
}

// SIGNUP FUNCTION
const signup = async (req, res, next) => {
    const { email, username, pwd } = req.body;

    if (!username || !pwd) {
        return res.status(400).json({
            message: "Username or password are empty",
            status: "error"
        });
    }

    if (pwd.len < 6) {
        return res.status(400).json({
            message: "Password must be at least 6 characters long",
            status: "error"
        });
    }

    const query = `INSERT INTO user (username, password, email) VALUES ('${username}', '${pwd}', '${email ? email : null}')`;

    runQuery(query, (result) => {
        return res.status(200).json({
            message: "Signup successful",
            status: "success"
        });
    });
}


// FORGOT PASSWORD FUNCTION
const forgotpwd = async (req, res) => {
    const { email } = req.body;

    if (!req.body) {
        return res.status(400).json({
            message: "E-mail field is empty",
            status: "error"
        });
    } 

    const query = `SELECT id, username FROM user WHERE email = '${email}'`;

    runQuery(query, async (result) => {
        if (result) {
            const user = {
                id: result.id,
                username: result.username
            };

            const token = createPasswordResetToken(user); // Create password reset token
            const url = createPasswordResetUrl(user.id, token); // Generate password reset URL
            const mailOptions = forgotPasswordTemplate(email, url);

            const info = await transporter.sendMail(mailOptions);

            console.log("E-mail sent. Transaction id: %s", info.messageId);

            return res.status(200).json({
                message: "Password reset link has been sent",
                type: "success"
            });
        } else {
            return res.status(404).json({
                message: "E-mail not found",
                type: "error"
            });
        }
    });
};

const resetpwd = (req, res) => {
    const { newPass, repeatNewPass } = req.body;
    const { id, token } = req.params;

    if (newPass !== repeatNewPass) {
        return res.status(401).json({
            message: "Passwords do not match",
            type: "error"
        });
    }

    let query = `SELECT username, password, email FROM user WHERE id = ${id}`;

    runQuery(query, async (err, result) => {
        if (err) throw err;

        // Token verification (check if expired)
        let flag = false;
        try {
            verify(token, process.env.FORGOT_PASSWORD_TOKEN_SECRET);
            flag = true;
        } catch {
            return res.status(401).json({
                message: "Invalid token",
                type: "error"
            });
        }

        if (flag) {
            const mailOptions = passwordResetConfirmationTemplate(result.username, result.email);
            const info = await transporter.sendMail(mailOptions);

            console.log("E-mail sent: %s", info.messageId);

            let updateQuery = `UPDATE user SET password = '${newPass}' WHERE id = ${id}`

            runQuery(updateQuery, async (err) => {
                if (err) {
                    return res.status(401).json({
                        message: "An error has occurred",
                        type: "error"
                    });
                } else {
                    return res.status(200).json({
                        message: "Password changed successfully",
                        type: "success"
                    });
                }
            });
        } else {
            return res.status(401).json({
                message: "User not found",
                type: "error"
            });
        }
    });
};

// FUNCTIONS
function runQuery(query, callback) {
    dbConn.query(query, (err, rows) => {
        if (err) throw err;

        return callback(rows[0]) // Returns actual data ONLY if query involves SELECTing data from database
    });
}

/*
function addRefreshToken(req, res, next) {
    console.log(req.user)
    const query = `INSERT INTO user (refresh_token) VALUES ('${req.user.refreshToken}')`

    runQuery(query, (err) => {
        if (err) throw err;

        return res.status(200).json({
            message: "Refresh token added to database",
            type: "success",
            refreshToken: user.refreshToken
        });
    });
    next();
}
*/

/*
function scanRefreshToken (req, res, next) {
    const refToken = getCookie('refToken');
    
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

        next();
    });
}
*/

module.exports = {
    login,
    signup,
    forgotpwd,
    resetpwd
};