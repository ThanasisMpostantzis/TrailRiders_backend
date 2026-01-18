const { sign } = require('jsonwebtoken');


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

const createCompanyEventToken = (payload) => {
    return sign(payload, process.env.COMPANY_EVENT_TOKEN_SECRET, {
        expiresIn: "10m"
    });
}


// MIDDLEWARE FOR VERIFYING USER ACCESS TOKENS


module.exports = {
    createPasswordResetToken,
    createAccessToken,
    createRefreshToken,
    createSubscriptionToken,
    createCompanyEventToken
};