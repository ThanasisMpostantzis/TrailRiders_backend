const { verify } = require('jsonwebtoken');
const { getAccessToken } = require('./userAuthToken');

// Sets req.user when a valid token is sent, but never blocks the request (for public routes
// that show extra info to logged-in users, e.g. "you follow this rider").
module.exports = function optionalAuth(req, res, next) {
    const token = getAccessToken(req);
    if (!token) return next();
    try {
        req.user = verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch {
        // ignore invalid/expired tokens on public routes
    }
    next();
};
