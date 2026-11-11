const { verify } = require('jsonwebtoken');

const { createSubscriptionToken } = require('../utils/tokens');
const { getAccessToken } = require('../middlewares/userAuthToken');

// Checks whether the current access token is valid.
// With ?subGen=<0|1|2> it also returns a subscription token (used by the subscription routes).
const tokenCheck = async (req, res) => {
    const accToken = getAccessToken(req);
    const { subGen } = req.query;

    if (!accToken) {
        return res.status(401).json({ message: "User logged out. Refresh access token", type: "401" });
    }

    let user;
    try {
        user = verify(accToken, process.env.ACCESS_TOKEN_SECRET);
    } catch {
        return res.status(401).json({ message: "Invalid or expired token. Refresh access token", type: "401" });
    }

    if (subGen !== undefined && subGen !== null) {
        const subToken = createSubscriptionToken({ id: user.id, username: user.username, subGen });
        return res.status(200).json({ subToken });
    }

    return res.status(200).json({
        message: "User logged in",
        type: "success",
        user: { id: user.id, username: user.username }
    });
};

module.exports = { tokenCheck };
