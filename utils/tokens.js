const { sign, verify } = require('jsonwebtoken');


const createRefreshToken = (user) => {
    return sign(user, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: "10m" // Make sure the cookie expiration time & this are the same duration (authController.js, line 44)
    });
}

const createAccessToken = (user) => {
    return sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10m"
    });
}

const createPasswordResetToken = (user) => {
    return sign({username: user.username}, process.env.FORGOT_PASSWORD_TOKEN_SECRET, {
        expiresIn: "5m"
    });
};


// NO TOUCHY
function authenticateToken(req, res, next) {
    const accToken = req.cookies['accToken'];

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