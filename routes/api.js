'use strict';

const express = require('express');
const router = express.Router();

const { query, queryOne } = require('../config/databaseCon.js');
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const { PUBLIC_USER_FIELDS } = require('../controllers/authController');
const { formatRide } = require('../controllers/ridesController');

router.get('/', (req, res) => {
    res.send("<h1>API works</h1>");
});

async function loadProfile(userId) {
    const user = await queryOne(`SELECT ${PUBLIC_USER_FIELDS} FROM user WHERE id = ?`, [userId]);
    if (!user) return null;

    const rides = (await query(
        'SELECT * FROM rides WHERE creator_id = ? OR usersId LIKE ?',
        [userId, `%"${userId}"%`]
    )).map(formatRide).filter((r) => r.creatorId === Number(userId) || r.participants.includes(String(userId)));

    const today = new Date().toISOString().slice(0, 10);
    const done = rides.filter((r) => r.date && r.date < today);

    user.tags = user.tags ? String(user.tags).split(',').map((t) => t.trim()).filter(Boolean) : [];
    user.isPremium = !!user.subscribed && (!user.sub_expire || new Date(user.sub_expire) > new Date());
    delete user.subscribed;
    delete user.sub_expire;

    const rating = await queryOne(
        `SELECT AVG(rr.rating) AS avg, COUNT(*) AS n FROM ride_ratings rr
         JOIN rides r ON r.id = rr.rideId WHERE r.creator_id = ?`,
        [userId]
    );
    user.rating = rating && Number(rating.n) > 0 ? { avg: Math.round(Number(rating.avg) * 10) / 10, count: Number(rating.n) } : null;
    user.stats = {
        created: rides.filter((r) => r.creatorId === Number(userId)).length,
        joined: rides.filter((r) => r.creatorId !== Number(userId)).length,
        completed: done.length,
        km: Math.round(done.reduce((sum, r) => sum + (Number(r.rideDistance) || 0), 0)),
    };
    return user;
}

// --- CURRENT USER ---
router.get('/me', authenticateUserToken, async (req, res) => {
    try {
        const user = await loadProfile(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found", type: "error" });
        res.status(200).json(user);
    } catch (err) {
        console.error('[API] me', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

// --- GET USER PROFILE (public, no password) ---
router.get('/user/:userId', async (req, res) => {
    try {
        const user = await loadProfile(req.params.userId);
        if (!user) return res.status(404).json({ message: "User not found", type: "error" });
        delete user.email;
        delete user.phone;
        res.status(200).json(user);
    } catch (err) {
        console.error('[API] user', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

// --- UPDATE OWN PROFILE ---
const PROFILE_LIMITS = {
    fullName: 100, email: 30, phone: 20, bike: 120, location: 120,
    instagram: 120, facebook: 120, tiktok: 120,
};

router.post('/user/updateProfile', authenticateUserToken, async (req, res) => {
    try {
        const body = req.body || {};
        const updates = {};

        for (const [field, max] of Object.entries(PROFILE_LIMITS)) {
            if (body[field] === undefined) continue;
            const value = String(body[field] || '').trim();
            if (value.length > max) return res.status(400).json({ message: `${field} is too long (max ${max})`, type: "error" });
            updates[field] = value || null;
        }
        if (updates.email && !/^\S+@\S+\.\S+$/.test(updates.email)) {
            return res.status(400).json({ message: "Please enter a valid e-mail", type: "error" });
        }
        if (updates.email) {
            const taken = await queryOne('SELECT id FROM user WHERE email = ? AND id <> ?', [updates.email, req.user.id]);
            if (taken) return res.status(409).json({ message: "E-mail is already in use", type: "error" });
        }
        if (body.bio !== undefined) updates.bio = String(body.bio || '').trim() || null;
        if (body.tags !== undefined) updates.tags = (Array.isArray(body.tags) ? body.tags.join(',') : String(body.tags || '')) || null;
        if (body.image !== undefined) updates.image = body.image || null;
        if (body.cover !== undefined) updates.cover = body.cover || null;

        const entries = Object.entries(updates);
        if (entries.length) {
            await query(
                `UPDATE user SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
                [...entries.map(([, v]) => v), req.user.id]
            );
            // Keep the organizer name on rides in sync is not needed: rides store the username, which cannot change.
        }

        const user = await loadProfile(req.user.id);
        res.json({ type: "success", message: "Profile updated", user });
    } catch (err) {
        console.error("[API] Update Error:", err);
        res.status(500).json({ type: "error", message: "Update failed" });
    }
});

// --- NOTIFICATIONS ---
router.get('/notifications', authenticateUserToken, async (req, res) => {
    try {
        const rows = await query(
            'SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC, id DESC LIMIT 200',
            [req.user.id]
        );
        res.status(200).json(rows.map((n) => ({ ...n, isRead: !!n.isRead })));
    } catch (err) {
        console.error('[API] notifications', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

router.get('/notifications/unreadCount', authenticateUserToken, async (req, res) => {
    try {
        const row = await queryOne('SELECT COUNT(*) AS count FROM notifications WHERE userId = ? AND isRead = 0', [req.user.id]);
        res.status(200).json({ count: row ? Number(row.count) : 0 });
    } catch (err) {
        console.error('[API] notifications/unreadCount', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

const idList = (ids) => (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);

router.post('/notifications/markRead', authenticateUserToken, async (req, res) => {
    try {
        const { ids, isRead = true, all } = req.body || {};
        if (all) {
            await query('UPDATE notifications SET isRead = ? WHERE userId = ?', [isRead ? 1 : 0, req.user.id]);
        } else {
            const list = idList(ids);
            if (!list.length) return res.status(400).json({ message: "No notifications selected", type: "error" });
            await query('UPDATE notifications SET isRead = ? WHERE userId = ? AND id IN (?)', [isRead ? 1 : 0, req.user.id, list]);
        }
        res.status(200).json({ type: "success" });
    } catch (err) {
        console.error('[API] notifications/markRead', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

router.post('/notifications/delete', authenticateUserToken, async (req, res) => {
    try {
        const list = idList((req.body || {}).ids);
        if (!list.length) return res.status(400).json({ message: "No notifications selected", type: "error" });
        await query('DELETE FROM notifications WHERE userId = ? AND id IN (?)', [req.user.id, list]);
        res.status(200).json({ type: "success" });
    } catch (err) {
        console.error('[API] notifications/delete', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

module.exports = router;
