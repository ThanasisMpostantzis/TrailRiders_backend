const { runQuery } = require('../config/databaseCon');
const { fetch } = require('../routes/token');
const date = require('date-and-time');

// CHECK IF USER IS SUBSCRIBED
const check = async (req, res) => {
    const user = await fetch(req, res);
    
    if (!user) {
        return res.status(400).json({
            message: "User logged out. Renew access token",
            type: "400 Bad Request"
        });
    }
    
    let query = `SELECT id, subscribed, sub_renew, sub_expire FROM user WHERE id = ${user.id}`

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
                    renewDate: result.sub_renew,
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

// RENEW OR INITIATE USER'S SUBSCRIPTION
const renew = async (req, res) => {
    const { plan } = req.body; // SUBSCRIPTION PLAN (1 MONTH, 3 MONTH ETC.)
    const { subToken } = req.params;

    // WIP, COMMENT OUT IF NEED BE
    verify(subToken, process.env.SUBCRIPTION_TOKEN_SECRET, (err, results) => {
        if (err) return res.status(400).json({
            message: "Invalid token",
            type: "400 Bad Request"
        });
    });

    const user = await fetch(req, res);
    if (!user) {
        return res.status(400).json({
            message: "User logged out. Renew access token",
            type: "400 Bad Request"
        });
    }

    let query = `SELECT id, sub_renew, sub_expire FROM user WHERE id = ${user.id}`

    runQuery(query, (result) => {
        if (!result) return res.status(404).json({
            message: "User not found",
            type: "404 Not Found"
        });

        let now = new Date();

        if (result.subRenew <= date) {
            return res.status(400).json({
                message: `Subscription is set to renew at ${result.subRenew}`,
                type: "400 Bad Request"
            });
        } else {
            let expireDate = date.addMonths(result.sub_expire == null ? now : result.sub_expire, plan === "1m" ? 1 : plan === "3m" ? 3 : plan === "6m" ? 6 : null);
            if (!expireDate) return res.status(400).json({
                message: "An error has occurred with expirationDate integer parse",
                type: "400 Bad Request"
            });

            let updateQuery = `UPDATE user SET sub_renew = "${now}", sub_expire = "${expireDate}", subscribed = 1 WHERE user.id = ${user.id}`
            runQuery(updateQuery, (result) => {
                return res.status(200).json({
                    message: "Subscription renewal successful",
                    type: "200 OK"
                });
            });
        }
    });
}

module.exports = { check, renew }