const { sign, verify } = require('jsonwebtoken');


const createRefreshToken = (user) => {
    return sign(user, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: "10m" // Make sure the cookie expiration time & this are the same duration (authController.js, line 44)
    });
}

const createAccessToken = (user) => {
    return sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1m"
    });
}

const createPasswordResetToken = (user) => {
    return sign({username: user.username}, process.env.FORGOT_PASSWORD_TOKEN_SECRET, {
        expiresIn: "5m"
    });
};


// NO TOUCHY
function authenticateToken(req, res, next) {
    const token = req.cookies['accToken'];

    if (token == null) return res.status(401).json({
        message: "Token not found",
        type: "unauthorized access"
    });

    verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) return res.status(403).json({
            message: "Invalid Token",
            type: "forbidden"
        });
        //console.log(user);

        req.user = user;
        next();
    });
}

module.exports = {
    createPasswordResetToken,
    createAccessToken,
    authenticateToken,
    createRefreshToken
};