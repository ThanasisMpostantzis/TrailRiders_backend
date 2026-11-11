'use strict';

// TRAILRIDERS PREMIUM (no real payments yet — "w/o bank & money transactions")
//
// Flow (kept from the original design):
//   1. POST /auth/token?subGen=<0|1|2>  -> { subToken }     0: start, 1: update plan, 2: cancel
//   2. POST /subscription/start|update|cancel?subToken=...   (user must be logged in)
// The subToken is signed with SUBSCRIPTION_TOKEN_SECRET and must belong to the same user and action.

const date = require('date-and-time');
const { verify } = require('jsonwebtoken');

const { query, queryOne } = require('../config/databaseCon');
const { notify } = require('../utils/notify');

const PLANS = {
    1: { months: 1, price: 4.99, label: 'Monthly' },
    3: { months: 3, price: 12.99, label: 'Quarterly' },
    12: { months: 12, price: 39.99, label: 'Yearly' },
};

function checkSubToken(req, expectedGen) {
    const { subToken } = req.query;
    if (!subToken) return 'Token missing from parameters';
    try {
        const payload = verify(subToken, process.env.SUBSCRIPTION_TOKEN_SECRET);
        if (String(payload.subGen) !== String(expectedGen)) return 'Invalid token for this action';
        if (Number(payload.id) !== Number(req.user.id)) return 'Token belongs to another user';
        return null;
    } catch {
        return 'Invalid or expired token';
    }
}

/** Returns the subscription status and switches off expired subscriptions */
async function getStatus(userId) {
    const row = await queryOne('SELECT id, subscribed, sub_start, sub_expire, sub_renew FROM user WHERE id = ?', [userId]);
    if (!row) return null;

    let renew = null;
    try { renew = row.sub_renew ? JSON.parse(row.sub_renew) : null; } catch { renew = null; }

    let active = !!row.subscribed;
    if (active && row.sub_expire && new Date(row.sub_expire) < new Date()) {
        await query('UPDATE user SET subscribed = 0 WHERE id = ?', [userId]);
        active = false;
    }

    return {
        active,
        startDate: row.sub_start || null,
        expireDate: row.sub_expire || null,
        plan: renew && renew.plan ? Number(renew.plan) : null,
        nextPlan: renew && renew.nextPlan ? Number(renew.nextPlan) : null,
        autoRenew: !!(renew && renew.autoRenew !== false && active),
    };
}


// GET PLANS (public)
const plans = (req, res) => {
    res.status(200).json(Object.entries(PLANS).map(([id, p]) => ({ id: Number(id), ...p })));
};


// CHECK IF USER IS SUBSCRIBED
const check = async (req, res) => {
    try {
        const status = await getStatus(req.user.id);
        if (!status) return res.status(404).json({ message: "User not found", type: "404 Not Found" });
        return res.status(200).json({
            message: status.active ? "User is subscribed" : "User is not subscribed/subscription expired",
            type: "200 OK",
            subStatus: status,
        });
    } catch (err) {
        console.error('[subscription/check]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// START SUBSCRIPTION (only when not subscribed)
const start = async (req, res) => {
    const tokenError = checkSubToken(req, 0);
    if (tokenError) return res.status(400).json({ message: tokenError, type: "400 Bad Request" });

    const plan = Number((req.body || {}).plan);
    if (!PLANS[plan]) return res.status(400).json({ message: "Choose a plan: 1, 3 or 12 months", type: "400 Bad Request" });

    try {
        const status = await getStatus(req.user.id);
        if (!status) return res.status(404).json({ message: "User not found", type: "404 Not Found" });
        if (status.active) return res.status(400).json({ message: "You are already subscribed. Use update instead", type: "400 Bad Request" });

        const now = new Date();
        const expire = date.addMonths(now, PLANS[plan].months);
        await query(
            'UPDATE user SET subscribed = 1, sub_start = ?, sub_expire = ?, sub_renew = ? WHERE id = ?',
            [now.toISOString(), expire.toISOString(), JSON.stringify({ plan, autoRenew: true }), req.user.id]
        );
        await notify(req.user.id, {
            subject: 'Welcome to Premium ⭐',
            description: `Your ${PLANS[plan].label.toLowerCase()} plan is active until ${expire.toISOString().slice(0, 10)}.`,
            link: '/premium',
        });
        return res.status(200).json({ message: "Subscription successful", type: "200 OK", subStatus: await getStatus(req.user.id) });
    } catch (err) {
        console.error('[subscription/start]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// CHANGE PLAN (applies at the next renewal)
const update = async (req, res) => {
    const tokenError = checkSubToken(req, 1);
    if (tokenError) return res.status(400).json({ message: tokenError, type: "400 Bad Request" });

    const plan = Number((req.body || {}).plan);
    if (!PLANS[plan]) return res.status(400).json({ message: "Choose a plan: 1, 3 or 12 months", type: "400 Bad Request" });

    try {
        const status = await getStatus(req.user.id);
        if (!status || !status.active) return res.status(400).json({ message: "You don't have an active subscription", type: "400 Bad Request" });

        await query('UPDATE user SET sub_renew = ? WHERE id = ?', [
            JSON.stringify({ plan: status.plan, nextPlan: plan, autoRenew: true, renew: status.expireDate }),
            req.user.id,
        ]);
        return res.status(200).json({ message: "Plan updated. It applies from your next renewal.", type: "200 OK", subStatus: await getStatus(req.user.id) });
    } catch (err) {
        console.error('[subscription/update]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// CANCEL
const cancel = async (req, res) => {
    const tokenError = checkSubToken(req, 2);
    if (tokenError) return res.status(400).json({ message: tokenError, type: "400 Bad Request" });

    try {
        const status = await getStatus(req.user.id);
        if (!status || !status.active) return res.status(400).json({ message: "You don't have an active subscription", type: "400 Bad Request" });

        await query('UPDATE user SET subscribed = 0, sub_start = NULL, sub_expire = NULL, sub_renew = NULL WHERE id = ?', [req.user.id]);
        return res.status(200).json({ message: "Subscription cancelled successfully", type: "200 OK" });
    } catch (err) {
        console.error('[subscription/cancel]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};

module.exports = { plans, check, start, update, cancel, getStatus };
