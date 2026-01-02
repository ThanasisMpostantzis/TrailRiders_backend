const { verify } = require('jsonwebtoken');

const { createAccessToken, createSubscriptionToken } = require('../utils/tokens');

const tokenCheck = async (req, res) => {
    const { accToken } = req.cookies;
    const { subGen } = req.query;
    let user;
    if (subGen) {
        if (!accToken) {
            return res.status(401).json({
            message: "User logged out. Refresh access token",
            type: "401"
            });
        } else {
            user = verify(accToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
                return {
                    id: user.id,
                    username: user.username
                };
            });
        }

        const subToken = createSubscriptionToken(user);
        return res.status(200).json({
            subToken: subToken
        });
    }

    // Check for access token
    if (accToken) {
        const user = verify(accToken, process.env.ACCESS_TOKEN_SECRET);
        return res.status(401).json({
            message: "User already logged in",
            user: {
                id: user.id,
                username: user.username
            }
        });
    }
    
    // Check for refresh token
    const { refToken } = req.cookies;
    if (!refToken) return res.status(404).json({
        message: "User hasn't logged in in a looooong time (death row)",
        type: "error"
    });

    verify(refToken, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
        if (err) return res.status(400).json({
            message: "Invalid Token",
            type: "error"
        });

        const userPayload = {
            id: user.id,
            username: user.username
        }

        const accessToken = createAccessToken(userPayload);
        res.cookie('accToken', accessToken, {
            httpOnly: true,
            secure: true,
            sameSite: "strict",
            maxAge: 10 * 60 * 1000 // 10 min
        });

        return res.status(200).json({
            accessToken: accessToken
        });
    });
};

module.exports = { tokenCheck };