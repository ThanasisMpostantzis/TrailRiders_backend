const { sign, verify } = require('jsonwebtoken');


// Make sure the cookie & token expiration time are the same duration (authController.js > login())

const createRefreshToken = (payload) => {
    return sign(payload, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: "20m"
    });
}

const createAccessToken = (payload) => {
    return sign(payload, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10m"
    });
}

const createPasswordResetToken = (payload) => {
    return sign(payload, process.env.FORGOT_PASSWORD_TOKEN_SECRET, {
        expiresIn: "5m"
    });
};

const createSubscriptionToken = (payload) => {
    return sign(payload, process.env.SUBSCRIPTION_TOKEN_SECRET, {
        expiresIn: "10m" // DEV. WILL OBVIOUSLY CHANGE
    });
};


// MIDDLEWARE FOR VERIFYING USER ACCESS TOKENS
function authenticateToken(req, res, next) {
    const accToken = req.cookies.accToken;

    if (accToken) {
        verify(accToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
            if (err) return res.status(403).json({
                message: "Invalid Token",
                type: "403 Access Forbidden"
            });

            req.user = user;
            next();
        });
    } else {
        return res.status(401).json({
            message: "Token not found",
            type: "401 Unauthorized Access"
        });
    }
}

module.exports = {
    createPasswordResetToken,
    createAccessToken,
    authenticateToken,
    createRefreshToken,
    createSubscriptionToken
};