const { verify, decode } = require('jsonwebtoken');

const { createAccessToken } = require('../utils/tokens');

const tokenCheck = async (req, res) => {
    // Check for access token
    const accToken = req.cookies.accToken;
    if (accToken) {
        const user = decode(accToken);
        return res.status(401).json({
            message: "User already logged in",
            user: {
                id: user.id,
                username: user.username
            }
        });
    }
    
    // Check for refresh token
    const refToken = req.cookies.refToken;
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
            maxAge: 60 * 1000 // 1 min
        });

        return res.status(200).json({
            accessToken: accessToken
        });
    });
};


const fetch = async (req, res) => {
    let accToken;

    try {
        accToken = req.cookies.accToken;
    } catch {
        return null
    }

    let ver = verify(accToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (!err) return user
    });
    
    return ver;
}

module.exports = { tokenCheck, fetch };