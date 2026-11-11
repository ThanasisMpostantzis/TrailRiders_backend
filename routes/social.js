'use strict';

// SOCIAL: direct messages, follows, blocks, reports and a feed from followed riders.

const express = require('express');
const router = express.Router();

const { query, queryOne } = require('../config/databaseCon');
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const { notify } = require('../utils/notify');
const { isBlockedBetween, blockedIds } = require('../utils/social');
const { rateLimit } = require('../utils/rateLimit');
const { formatRide } = require('../controllers/ridesController');

router.use(authenticateUserToken);

const USER_CARD = 'id, username, fullName, image, bike, subscribed';
const toId = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
};

// ---------------- MESSAGES ----------------

// Inbox: one row per person, with the last message and unread count
router.get('/conversations', async (req, res) => {
    try {
        const me = req.user.id;
        const rows = await query(
            `SELECT m.*, IF(m.senderId = ?, m.receiverId, m.senderId) AS otherId
             FROM messages m
             JOIN (
                SELECT IF(senderId = ?, receiverId, senderId) AS other, MAX(id) AS lastId
                FROM messages WHERE senderId = ? OR receiverId = ?
                GROUP BY other
             ) last ON last.lastId = m.id
             ORDER BY m.id DESC`,
            [me, me, me, me]
        );
        const hidden = new Set(await blockedIds(me));
        const others = rows.map((r) => r.otherId).filter((id) => !hidden.has(id));
        if (!others.length) return res.json([]);

        const users = await query(`SELECT ${USER_CARD} FROM user WHERE id IN (?)`, [others]);
        const unread = await query(
            'SELECT senderId, COUNT(*) AS n FROM messages WHERE receiverId = ? AND readAt IS NULL GROUP BY senderId',
            [me]
        );
        res.json(
            rows
                .filter((r) => !hidden.has(r.otherId))
                .map((r) => ({
                    user: users.find((u) => u.id === r.otherId) || { id: r.otherId, username: 'Deleted user' },
                    lastMessage: { id: r.id, text: r.text, senderId: r.senderId, createdAt: r.createdAt },
                    unread: Number((unread.find((u) => u.senderId === r.otherId) || {}).n || 0),
                }))
        );
    } catch (err) {
        console.error('[social/conversations]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

router.get('/messages/unreadCount', async (req, res) => {
    try {
        const hidden = await blockedIds(req.user.id);
        const row = await queryOne(
            `SELECT COUNT(*) AS n FROM messages WHERE receiverId = ? AND readAt IS NULL ${hidden.length ? 'AND senderId NOT IN (?)' : ''}`,
            hidden.length ? [req.user.id, hidden] : [req.user.id]
        );
        res.json({ count: Number(row.n) });
    } catch (err) {
        console.error('[social/unread]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

// Messages with one user (?after=<id> returns only newer ones, for polling). Marks them as read.
router.get('/messages/:userId', async (req, res) => {
    const other = toId(req.params.userId);
    if (!other) return res.status(400).json({ message: "Invalid user", type: "error" });
    try {
        const me = req.user.id;
        const after = toId(req.query.after) || 0;
        const rows = await query(
            `SELECT id, senderId, receiverId, text, readAt, createdAt FROM messages
             WHERE ((senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)) AND id > ?
             ORDER BY id DESC LIMIT 200`,
            [me, other, other, me, after]
        );
        await query('UPDATE messages SET readAt = NOW() WHERE senderId = ? AND receiverId = ? AND readAt IS NULL', [other, me]);

        const user = await queryOne(`SELECT ${USER_CARD} FROM user WHERE id = ?`, [other]);
        const blocked = await isBlockedBetween(me, other);
        res.json({ user, blocked, messages: rows.reverse() });
    } catch (err) {
        console.error('[social/messages]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

router.post('/messages/:userId', rateLimit({ windowMs: 60 * 1000, max: 30, message: 'You are sending messages too fast.' }), async (req, res) => {
    const other = toId(req.params.userId);
    const text = String((req.body || {}).text || '').trim();
    if (!other) return res.status(400).json({ message: "Invalid user", type: "error" });
    if (other === req.user.id) return res.status(400).json({ message: "You cannot message yourself", type: "error" });
    if (!text) return res.status(400).json({ message: "Message is empty", type: "error" });
    if (text.length > 2000) return res.status(400).json({ message: "Message is too long (max 2000)", type: "error" });

    try {
        const target = await queryOne('SELECT id FROM user WHERE id = ?', [other]);
        if (!target) return res.status(404).json({ message: "User not found", type: "error" });
        if (await isBlockedBetween(req.user.id, other)) {
            return res.status(403).json({ message: "You can't message this user", type: "error" });
        }

        const result = await query('INSERT INTO messages (senderId, receiverId, text) VALUES (?, ?, ?)', [req.user.id, other, text]);

        // One notification per conversation burst: only if the receiver has no other unread message from us
        const unread = await queryOne('SELECT COUNT(*) AS n FROM messages WHERE senderId = ? AND receiverId = ? AND readAt IS NULL', [req.user.id, other]);
        if (Number(unread.n) === 1) {
            await notify(other, {
                senderId: req.user.id,
                senderName: req.user.username,
                subject: 'New message',
                description: `${req.user.username}: ${text.slice(0, 120)}`,
                link: `/chat/${req.user.id}`,
            });
        }

        const message = await queryOne('SELECT id, senderId, receiverId, text, readAt, createdAt FROM messages WHERE id = ?', [result.insertId]);
        res.status(201).json(message);
    } catch (err) {
        console.error('[social/send]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

// ---------------- FOLLOWS ----------------

router.post('/follow/:userId', async (req, res) => {
    const other = toId(req.params.userId);
    if (!other || other === req.user.id) return res.status(400).json({ message: "Invalid user", type: "error" });
    try {
        const target = await queryOne('SELECT id FROM user WHERE id = ?', [other]);
        if (!target) return res.status(404).json({ message: "User not found", type: "error" });
        if (await isBlockedBetween(req.user.id, other)) return res.status(403).json({ message: "You can't follow this user", type: "error" });

        const result = await query('INSERT IGNORE INTO follows (followerId, followingId) VALUES (?, ?)', [req.user.id, other]);
        if (result.affectedRows) {
            await notify(other, {
                senderId: req.user.id,
                senderName: req.user.username,
                subject: 'New follower',
                description: `${req.user.username} started following you.`,
                link: `/user/${req.user.id}`,
            });
        }
        res.json({ type: "success", following: true });
    } catch (err) {
        console.error('[social/follow]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

router.delete('/follow/:userId', async (req, res) => {
    const other = toId(req.params.userId);
    if (!other) return res.status(400).json({ message: "Invalid user", type: "error" });
    try {
        await query('DELETE FROM follows WHERE followerId = ? AND followingId = ?', [req.user.id, other]);
        res.json({ type: "success", following: false });
    } catch (err) {
        console.error('[social/unfollow]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

// ?type=followers|following
router.get('/follows/:userId', async (req, res) => {
    const uid = toId(req.params.userId);
    const type = req.query.type === 'following' ? 'following' : 'followers';
    if (!uid) return res.status(400).json({ message: "Invalid user", type: "error" });
    try {
        const rows = type === 'followers'
            ? await query(`SELECT u.${USER_CARD.split(', ').join(', u.')} FROM follows f JOIN user u ON u.id = f.followerId WHERE f.followingId = ? ORDER BY f.createdAt DESC`, [uid])
            : await query(`SELECT u.${USER_CARD.split(', ').join(', u.')} FROM follows f JOIN user u ON u.id = f.followingId WHERE f.followerId = ? ORDER BY f.createdAt DESC`, [uid]);
        const mine = await query('SELECT followingId FROM follows WHERE followerId = ?', [req.user.id]);
        const set = new Set(mine.map((m) => m.followingId));
        res.json(rows.map((u) => ({ ...u, isFollowing: set.has(u.id) })));
    } catch (err) {
        console.error('[social/follows]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

// Feed: upcoming rides and events from people I follow
router.get('/feed', async (req, res) => {
    try {
        const rides = await query(
            `SELECT r.* FROM rides r JOIN follows f ON f.followingId = r.creator_id
             WHERE f.followerId = ? AND (r.date IS NULL OR r.date >= CURDATE()) ORDER BY r.date ASC LIMIT 20`,
            [req.user.id]
        );
        res.json({ rides: rides.map(formatRide) });
    } catch (err) {
        console.error('[social/feed]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

// ---------------- BLOCKS ----------------

router.get('/blocks', async (req, res) => {
    try {
        const rows = await query(
            `SELECT u.id, u.username, u.fullName, u.image FROM blocks b JOIN user u ON u.id = b.blockedId WHERE b.blockerId = ? ORDER BY b.createdAt DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error('[social/blocks]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

router.post('/block/:userId', async (req, res) => {
    const other = toId(req.params.userId);
    if (!other || other === req.user.id) return res.status(400).json({ message: "Invalid user", type: "error" });
    try {
        await query('INSERT IGNORE INTO blocks (blockerId, blockedId) VALUES (?, ?)', [req.user.id, other]);
        // Blocking also removes follows in both directions
        await query('DELETE FROM follows WHERE (followerId = ? AND followingId = ?) OR (followerId = ? AND followingId = ?)', [req.user.id, other, other, req.user.id]);
        res.json({ type: "success", blocked: true });
    } catch (err) {
        console.error('[social/block]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

router.delete('/block/:userId', async (req, res) => {
    const other = toId(req.params.userId);
    if (!other) return res.status(400).json({ message: "Invalid user", type: "error" });
    try {
        await query('DELETE FROM blocks WHERE blockerId = ? AND blockedId = ?', [req.user.id, other]);
        res.json({ type: "success", blocked: false });
    } catch (err) {
        console.error('[social/unblock]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

// ---------------- REPORTS ----------------

const REPORT_TYPES = ['user', 'ride', 'event', 'passengerRide', 'comment', 'message'];
const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'fake', 'dangerous', 'other'];

router.post('/report', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), async (req, res) => {
    const { targetType, targetId, reason, details } = req.body || {};
    if (!REPORT_TYPES.includes(targetType) || !toId(targetId)) return res.status(400).json({ message: "Invalid report target", type: "error" });
    if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ message: "Choose a reason", type: "error" });
    try {
        await query(
            'INSERT INTO reports (reporterId, targetType, targetId, reason, details) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, targetType, toId(targetId), reason, String(details || '').trim().slice(0, 1000) || null]
        );
        console.log(`[report] ${req.user.username} reported ${targetType} #${targetId} (${reason})`);
        res.status(201).json({ type: "success", message: "Thanks — our team will review this report." });
    } catch (err) {
        console.error('[social/report]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
});

module.exports = router;
