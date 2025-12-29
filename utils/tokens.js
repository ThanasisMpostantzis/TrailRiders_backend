const { sign, verify } = require('jsonwebtoken');


// Make sure the cookie & token expiration time are the same duration (authController.js > login())

const createRefreshToken = (user) => {
    return sign(user, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: "10m"
    });
}

const createAccessToken = (user) => {
    return sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1m"
    });
}

const createPasswordResetToken = (user) => {
    return sign(user, process.env.FORGOT_PASSWORD_TOKEN_SECRET, {
        expiresIn: "5m"
    });
};


// NO TOUCHY
function authenticateToken(req, res, next) {
    const accToken = req.cookies.accToken;

    if (accToken) {
        verify(accToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
            if (err) return res.status(403).json({
                message: "Invalid Token",
                type: "forbidden"
            });

            req.user = user;
            next();
        });
    } else {
        return res.status(401).json({
            message: "Token not found",
            type: "unauthorized access"
        });
    }
}

module.exports = {
    createPasswordResetToken,
    createAccessToken,
    authenticateToken,
    createRefreshToken
};