const date = require('date-and-time');

const { runQuery } = require('../config/databaseCon');
const { verify } = require('jsonwebtoken');

// CHECK IF USER IS SUBSCRIBED
const check = async (req, res) => {
    let accToken;

    try {
        accToken = req.cookies.accToken;
    } catch {
        return res.status(400).json({
            message: "User logged out. Renew access token",
            type: "400 Bad Request"
        });
    }

    const user = verify(accToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) console.log(err);
        else return user;
    });
    
    let query = `SELECT id, subscribed, sub_start, sub_expire FROM user WHERE id = ${user.id}`

    runQuery(query, (result) => {
        if (!result) return res.status(404).json({
            message: "User not found",
            type: "404 Not Found"
        });

        const subBool = result.subscribed;
        if (subBool) {
            return res.status(200).json({
                message: "User is subscribed",
                type: "200 OK",
                subStatus: {
                    renewDate: result.sub_start,
                    expireDate: result.sub_expire
                }
            })
        } else {
            return res.status(200).json({
                message: "User is not subscribed/subscription expired",
                type: "200 OK"
            });
        }
    });
};


// START USER SUBSCRIPTION. USE ONLY FOR SUBSCRIPTION START, NOT UPDATE!!
const start = async (req, res) => {
    const { plan } = req.body; // SUBSCRIPTION PLAN (1 MONTH, 3 MONTHS ETC.)
    const { subToken } = req.query;

    if (!subToken) return res.status(400).json({
        message: "Token missing from parameters",
        type: "400 Bad Request"
    });

    const flag = verify(subToken, process.env.SUBSCRIPTION_TOKEN_SECRET, (err, result) => {
        if (err) return false;
        else return true;
    });

    if (!flag) {
        return res.status(400).json({
            message: "Invalid token",
            type: "400 Bad Request"
        });
    }

    const user = verify(req.cookies.accToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) return null;
        else return user;
    });

    if (!user) {
        return res.status(400).json({
            message: "User logged out. Renew access token",
            type: "400 Bad Request"
        });
    }

    let query = `SELECT id, sub_start, sub_expire FROM user WHERE id = ${user.id}`

    runQuery(query, (result) => {
        if (!result) return res.status(404).json({
            message: "User not found",
            type: "404 Not Found"
        });

        if (result.sub_start) {
            return res.status(400).json({
                message: "User is already subscribed. Use update route instead",
                type: "400 Bad Request"
            });
        }

        const now = new Date();
        const expireDate = date.addMonths(now, plan);
        //console.log(result.sub_start, '\n', now);

        if (!expireDate) {
            return res.status(400).json({
                message: "An error has occurred with expireDate integer parse",
                type: "400 Bad Request"
            });
        }

        let updateQuery = `UPDATE user SET sub_start = "${now}", sub_expire = "${expireDate}", subscribed = 1 WHERE user.id = ${user.id}`;
        runQuery(updateQuery, (result) => {
            return res.status(200).json({
                message: "Subscription successful",
                type: "200 OK"
            });
        });
    });
}

// UPDATE USER SUBSCRIPTION
// Note: A user with IQ over 1000 may copy the authentication token from start() and paste it into the URL/path of update(),
// granting themselves free extra subscription plans. For this, we will implement a delay between starting the subscription,
// and setting the 'subscribed' column to 1 for the user. Delay will be slightly longer than the expiration time of the token.
const update = (req, res) => {
    const { plan } = req.body; // SUBSCRIPTION PLAN (1 MONTH, 3 MONTHS ETC.)
    const { subToken } = req.query;

    if (!subToken) return res.status(400).json({
        message: "Token missing from parameters",
        type: "400 Bad Request"
    });

    const flag = verify(subToken, process.env.SUBSCRIPTION_TOKEN_SECRET, (err, result) => {
        if (err) return false;
        else return true;
    });

    if (!flag) {
        return res.status(400).json({
            message: "Invalid token",
            type: "400 Bad Request"
        });
    }

    const user = verify(req.cookies.accToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) return null;
        else return user;
    });

    if (!user) {
        return res.status(400).json({
            message: "User logged out. Renew access token",
            type: "400 Bad Request"
        });
    }

    let query = `SELECT id, sub_start, sub_expire FROM user WHERE id = ${user.id}`;

    runQuery(query, (result) => {
        if (!result) return res.status(404).json({
            message: "User not found",
            type: "404 Not Found"
        });

        if (!result.sub_start) return res.status(400).json({
            message: "Invalid path: User doesn't have a subscription",
            type: "400 Bad Request"
        });

        const subExpire = result.sub_expire;
        const now = new Date();
        if (subExpire <= now.toString()) {
            const expireDate = date.addMonths(now, plan);
            
            if (!expireDate) {
            return res.status(400).json({
                message: "An error has occurred with expireDate integer parse",
                type: "400 Bad Request"
                });
            }

            let updateQuery = `UPDATE user SET sub_start = "${now}", sub_expire = "${expireDate}", subscribed = 1 WHERE user.id = ${user.id}`;
            runQuery(updateQuery, (result) => {
                return res.status(200).json({
                    message: "Subscription updated successfully",
                    type: "200 OK"
                });
            });
        }
    });
}

module.exports = { check, start, update }