const { verify } = require('jsonwebtoken');

// Company token from the `x-company-token` header, `?token=` query or `Authorization: Bearer`.
module.exports = async function authenticateCompEventToken(req, res, next) {
    const header = req.headers.authorization || '';
    const token = req.headers['x-company-token'] || req.query.token || (header.startsWith('Bearer ') ? header.slice(7) : null);

    if (!token) {
        return res.status(401).json({
            message: "Token not found",
            type: "401 Unauthorized Access"
        });
    }

    verify(token, process.env.COMPANY_EVENT_TOKEN_SECRET, (err, payload) => {
        if (err) return res.status(403).json({
            message: "Invalid Token",
            type: "403 Access Forbidden"
        });
        req.company = payload;
        next();
    });
}
