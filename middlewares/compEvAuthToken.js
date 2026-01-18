const { verify } = require('jsonwebtoken');

module.exports = async function authenticateCompEventToken(req, res, next) {
    const { token } = req.params;

    if (token) {
        verify(token, process.env.COMPANY_EVENT_TOKEN_SECRET, (err) => {
            if (err) return res.status(403).json({
                message: "Invalid Token",
                type: "403 Access Forbidden"
            });
            next();
        })
    } else {
        return res.status(401).json({
            message: "Token not found",
            type: "401 Unauthorized Access"
        });
    }

}