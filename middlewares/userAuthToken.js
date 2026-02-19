const { verify } = require('jsonwebtoken');

async function authenticateUserToken(req, res, next) {
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

module.exports = authenticateUserToken