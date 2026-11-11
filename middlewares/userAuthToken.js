const { verify } = require('jsonwebtoken');

// Accepts the access token from the `Authorization: Bearer <token>` header (mobile app)
// or from the `accToken` cookie (browser).
function getAccessToken(req) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) return header.slice(7);
    return req.cookies ? req.cookies.accToken : undefined;
}

async function authenticateUserToken(req, res, next) {
    const accToken = getAccessToken(req);

    if (!accToken) {
        return res.status(401).json({
            message: "Token not found",
            type: "401 Unauthorized Access"
        });
    }

    verify(accToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) return res.status(401).json({
            message: "Invalid or expired token",
            type: "401 Unauthorized Access"
        });

        req.user = user;
        next();
    });
}

module.exports = authenticateUserToken;
module.exports.getAccessToken = getAccessToken;
