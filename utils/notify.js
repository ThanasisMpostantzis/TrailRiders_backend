'use strict';

const { query } = require('../config/databaseCon');

/**
 * Create a notification for one or more users. Never throws (notifications must not break the main action).
 * @param {number|number[]} userIds recipients (the sender is skipped automatically)
 * @param {{subject: string, description?: string, senderId?: number, senderName?: string, rideId?: number, link?: string}} data
 *        `link` is an in-app path, e.g. "/event/3" or "/passengerRide/5"
 */
async function notify(userIds, data) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).map(Number))]
        .filter((id) => id && id !== Number(data.senderId));
    if (!ids.length) return;

    try {
        const values = ids.map((id) => [
            id,
            data.senderId || null,
            data.senderName || 'TrailRiders',
            data.subject,
            data.description || null,
            data.rideId || null,
            data.link || (data.rideId ? `/rideDetails/${data.rideId}` : null),
        ]);
        await query(
            'INSERT INTO notifications (userId, senderId, senderName, subject, description, rideId, link) VALUES ?',
            [values]
        );
    } catch (err) {
        console.error('[notify]', err.message);
    }
}

module.exports = { notify };
