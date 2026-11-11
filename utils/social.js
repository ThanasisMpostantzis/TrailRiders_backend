'use strict';

// Shared helpers for social features and premium limits.

const { query, queryOne } = require('../config/databaseCon');
const { notify } = require('./notify');

/** true if either user blocked the other */
async function isBlockedBetween(a, b) {
    const row = await queryOne(
        'SELECT 1 AS x FROM blocks WHERE (blockerId = ? AND blockedId = ?) OR (blockerId = ? AND blockedId = ?) LIMIT 1',
        [a, b, b, a]
    );
    return !!row;
}

/** Ids of users this user blocked or was blocked by (hidden from each other) */
async function blockedIds(userId) {
    const rows = await query('SELECT blockedId AS id FROM blocks WHERE blockerId = ? UNION SELECT blockerId AS id FROM blocks WHERE blockedId = ?', [userId, userId]);
    return rows.map((r) => r.id);
}

async function isPremium(userId) {
    const row = await queryOne('SELECT subscribed, sub_expire FROM user WHERE id = ?', [userId]);
    return !!row && !!row.subscribed && (!row.sub_expire || new Date(row.sub_expire) > new Date());
}

// Free plan: how many upcoming rides + ride shares + events a user can host at the same time.
const FREE_ACTIVE_LIMIT = 3;

async function activeHostedCount(userId) {
    const row = await queryOne(
        `SELECT
            (SELECT COUNT(*) FROM rides WHERE creator_id = ? AND (date IS NULL OR date >= CURDATE())) +
            (SELECT COUNT(*) FROM passengerride WHERE creatorId = ? AND (date IS NULL OR DATE(date) >= CURDATE())) +
            (SELECT COUNT(*) FROM event WHERE ownerId = ? AND (eventDate IS NULL OR eventDate >= CURDATE())) AS n`,
        [userId, userId, userId]
    );
    return row ? Number(row.n) : 0;
}

/**
 * Returns null if the user may create another ride/event, otherwise an error payload.
 * Premium users have no limit.
 */
async function checkHostingLimit(userId) {
    if (await isPremium(userId)) return null;
    const count = await activeHostedCount(userId);
    if (count < FREE_ACTIVE_LIMIT) return null;
    return {
        message: `Free accounts can host up to ${FREE_ACTIVE_LIMIT} upcoming rides/events at a time. Upgrade to Premium for unlimited hosting.`,
        type: "error",
        code: "PREMIUM_LIMIT",
    };
}

/** Tell followers that someone they follow created something */
async function notifyFollowers(user, { subject, description, link, rideId }) {
    try {
        const rows = await query('SELECT followerId FROM follows WHERE followingId = ?', [user.id]);
        if (!rows.length) return;
        await notify(rows.map((r) => r.followerId), { senderId: user.id, senderName: user.username, subject, description, link, rideId });
    } catch (err) {
        console.error('[notifyFollowers]', err.message);
    }
}

module.exports = { isBlockedBetween, blockedIds, isPremium, checkHostingLimit, notifyFollowers, FREE_ACTIVE_LIMIT };
