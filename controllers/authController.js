'use strict';

const { runQuery } = require('../config/databaseCon');
const { transporter, forgotPasswordTemplate, createPasswordResetUrl, passwordResetConfirmationTemplate } = require('../utils/mailService');
const { createPasswordResetToken, createAccessToken, createRefreshToken } = require('../utils/tokens.js');

const { verify } = require('jsonwebtoken');
//const bcrypt = require('bcryptjs');

// LOGIN FUNCTION
const login = async (req, res) => {
    const { username, pwd } = req.body;

    if (!username || !pwd) {
        return res.status(400).json({
            message: "E-mail or password are empty",
            status: "error"
        });
    }

    const query = `SELECT id, username, password, email, image FROM user WHERE username = "${username}"`;

    runQuery(query, async (result) => {
        if (result) {
            const compare = (result.password == pwd)

            if (compare) {
                const userPayload = {
                    id: result.id,
                    username: result.username
                }
                const accessToken = createAccessToken(userPayload);
                const refreshToken = createRefreshToken(userPayload);
                
                let accessCookie = req.cookies.accToken; // CHECK IF ALREADY LOGGED IN
                if (!accessCookie) {
                    res.cookie('accToken', accessToken, {
                        httpOnly: true,
                        secure: true,
                        sameSite: "strict",
                        maxAge: 60 * 1000 // 1 min
                    });
                } else {
                    return res.status(401).json({
                        message: "User already logged in",
                        status: "error"
                    });
                }
                res.cookie('refToken', refreshToken, {
                    httpOnly: true,
                    secure: true,
                    sameSite: "strict",
                    maxAge: 10 * 60 * 1000 // 10 min
                });

                return res.status(200).json({
                    message: "Login successful",
                    type: "success",
                    accessToken: accessToken,
                    refreshToken: refreshToken,
                    user: {
                        id: result.id,
                        username: result.username
                    }
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
const signup = async (req, res) => {
    const { email, username, pwd } = req.body;

    if (!username || !pwd) {
        return res.status(400).json({
            message: "Username or password are empty",
            status: "error"
        });
    }

    //den douleuei
    if (pwd.length < 6) {
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

    runQuery(query, async (result) => {
        // Token verification (check if expired)
        let flag = false;
        try {
            verify(token, process.env.FORGOT_PASSWORD_TOKEN_SECRET);
            flag = true;
        } catch {
            return res.status(401).json({
                message: "Invalid or expired token",
                type: "error"
            });
        }

        if (flag) {
            const mailOptions = passwordResetConfirmationTemplate(result.username, result.email);
            const info = await transporter.sendMail(mailOptions);

            console.log("E-mail sent: %s", info.messageId);

            let updateQuery = `UPDATE user SET password = '${newPass}' WHERE id = ${id}`

            runQuery(updateQuery, async (result, err) => {
                console.log(result);
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


// DELETE USER FUNCTION
const deleteUser = (req, res) => {
    const { id, username, confirmUsername } = req.body;

    try {
        verify(req.cookies['accToken'], process.env.ACCESS_TOKEN_SECRET);
    } catch {
        return res.status(400).json({
            message: "Invalid or expired token",
            status: "400 Bad Request"
        });
    }

    // USER MUST CONFIRM USERNAME TO DELETE THEIR ACCOUNT. ALSO MAY WANT TO CHECK SANITY STATUS & WELLBEING. PERHAPS CALL THE OPPS
    // WILL ALSO IMPLEMENT GRACE PERIOD OF 30 DAYS. MAYBE JUST MAYBE EVEN MAYBE THEY CHANGE THEIR MIND. SANITY = 3%

    if (username != confirmUsername) {
        res.status(400).json({
            message: "Wrong username",
            error: "400 Bad Request"
        });
    } else {
        let query = `DELETE FROM user WHERE username = '${username}' AND id = ${id}`

        runQuery(query, async (result, err) => {
            if (err) {
                return res.status(400).json({
                    message: "An error has occurred",
                    type: "error"
                });
            } else {
                return res.status(200).json({
                    message: "Account deleted successfully",
                    type: "success"
                });
            }
        });
    }
}

// CHANGE PASSWORD FUNCTION
const changePassword = (req, res) => {
    const { id, oldPassword, newPassword, confirmNewPassword } = req.body;
    
    const selectQuery = `SELECT password FROM user WHERE id = ${id}`; 
    
    runQuery(selectQuery, (storedUser) => { 
        
        if (!storedUser) {
            return res.status(404).json({ message: "User ID not found in database" });
        }
        
        const storedPassword = storedUser.password;
        
        if (oldPassword !== storedPassword) { 
            return res.status(401).json({
                message: "Old password does not match",
                status: "401 Unauthorized"
            });
        }
        
        const updateQuery = `UPDATE user SET password = '${newPassword}' WHERE id = ${id}`;
        runQuery(updateQuery, (result, err) => { 
            if (err) {
                console.error("DB UPDATE ERROR:", err);
                return res.status(500).json({ message: "An internal database error occurred" });
            } else {
                return res.status(200).json({
                    message: "Password updated successfully",
                    type: "success"
                });
            }
        });
    });
};


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
    resetpwd,
    deleteUser,
    changePassword
};