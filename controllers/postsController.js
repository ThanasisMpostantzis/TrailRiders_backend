'use strict';

// FEED: social posts with photos, likes and comments.

const { query, queryOne } = require('../config/databaseCon');
const { notify } = require('../utils/notify');
const { isBlockedBetween, blockedIds } = require('../utils/social');

const CATEGORIES = ['Sport', 'Naked', 'Adventure', 'Touring', 'Cruiser', 'Supermoto', 'Scooter', 'Classic', 'Car', 'Other'];
const MAX_TEXT = 2000;
const MAX_COMMENT = 1000;
const MAX_LOCATION = 120;
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 3 * 1024 * 1024;       // ~2.2 MB binary per photo
const MAX_TOTAL_IMAGE_CHARS = 8 * 1024 * 1024; // all photos of one post together
const DATA_URI = /^data:image\/(png|jpe?g|webp|gif|heic|heif);base64,[A-Za-z0-9+/=\s]+$/;

const toId = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
};

const serverError = (tag, res, err) => {
    console.error(`[posts/${tag}]`, err);
    res.status(500).json({ message: "Server error", type: "error" });
};

const parseImages = (value) => {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
    } catch {
        return [];
    }
};

const premiumActive = (row) =>
    !!row.authorSubscribed && (!row.authorSubExpire || new Date(row.authorSubExpire) > new Date());

const AUTHOR_COLS = 'u.username AS authorUsername, u.fullName AS authorFullName, u.image AS authorImage, u.subscribed AS authorSubscribed, u.sub_expire AS authorSubExpire';

const formatPost = (row) => ({
    id: row.id,
    text: row.text || '',
    images: parseImages(row.images),
    category: row.category || null,
    location: row.location || null,
    rideId: row.rideId || null,
    trackId: row.trackId || null,
    createdAt: row.createdAt,
    author: {
        id: row.userId,
        username: row.authorUsername || 'Deleted user',
        fullName: row.authorFullName || null,
        image: row.authorImage || null,
        subscribed: premiumActive(row),
    },
    likesCount: Number(row.likesCount || 0),
    commentsCount: Number(row.commentsCount || 0),
    likedByMe: !!Number(row.likedByMe || 0),
});

const formatComment = (row) => ({
    id: row.id,
    postId: row.postId,
    text: row.text,
    createdAt: row.createdAt,
    author: {
        id: row.userId,
        username: row.authorUsername || 'Deleted user',
        fullName: row.authorFullName || null,
        image: row.authorImage || null,
        subscribed: premiumActive(row),
    },
});

/**
 * Loads posts with author, counters and "liked by me".
 * `where` is a list of SQL conditions on alias p; `params` their values.
 */
async function loadPosts(viewerId, where, params, limit) {
    const hidden = viewerId ? await blockedIds(viewerId) : [];
    const conds = [...where];
    const values = [...params];
    if (hidden.length) {
        conds.push('p.userId NOT IN (?)');
        values.push(hidden);
    }
    const sql = `
        SELECT p.*, ${AUTHOR_COLS},
            (SELECT COUNT(*) FROM post_likes l WHERE l.postId = p.id) AS likesCount,
            (SELECT COUNT(*) FROM post_comments c WHERE c.postId = p.id
                ${hidden.length ? 'AND c.userId NOT IN (?)' : ''}) AS commentsCount,
            ${viewerId ? 'EXISTS(SELECT 1 FROM post_likes ml WHERE ml.postId = p.id AND ml.userId = ?)' : '0'} AS likedByMe
        FROM posts p
        LEFT JOIN user u ON u.id = p.userId
        ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
        ORDER BY p.id DESC
        ${limit ? 'LIMIT ?' : ''}`;

    // Parameter order must follow the placeholders: comment filter, viewer, where-conditions, limit
    const ordered = [];
    if (hidden.length) ordered.push(hidden);
    if (viewerId) ordered.push(viewerId);
    ordered.push(...values);
    if (limit) ordered.push(limit);

    const rows = await query(sql, ordered);
    return rows.map(formatPost);
}

const pageParams = (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const before = toId(req.query.before);
    return { limit, before };
};

// GET /posts?scope=all|following&category=&before=&limit=
exports.listPosts = async (req, res) => {
    try {
        const viewerId = req.user ? req.user.id : null;
        const scope = req.query.scope === 'following' ? 'following' : 'all';
        if (scope === 'following' && !viewerId) {
            return res.status(401).json({ message: "Log in to see posts from riders you follow", type: "error" });
        }
        const { limit, before } = pageParams(req);
        const where = [];
        const params = [];
        if (scope === 'following') {
            where.push('(p.userId = ? OR p.userId IN (SELECT followingId FROM follows WHERE followerId = ?))');
            params.push(viewerId, viewerId);
        }
        if (req.query.category) {
            if (!CATEGORIES.includes(req.query.category)) return res.status(400).json({ message: "Invalid category", type: "error" });
            where.push('p.category = ?');
            params.push(req.query.category);
        }
        if (before) {
            where.push('p.id < ?');
            params.push(before);
        }
        res.json(await loadPosts(viewerId, where, params, limit));
    } catch (err) {
        serverError('list', res, err);
    }
};

// GET /posts/user/:userId
exports.userPosts = async (req, res) => {
    const userId = toId(req.params.userId);
    if (!userId) return res.status(400).json({ message: "Invalid user", type: "error" });
    try {
        const viewerId = req.user ? req.user.id : null;
        if (viewerId && viewerId !== userId && (await isBlockedBetween(viewerId, userId))) return res.json([]);
        const { limit, before } = pageParams(req);
        const where = ['p.userId = ?'];
        const params = [userId];
        if (before) {
            where.push('p.id < ?');
            params.push(before);
        }
        res.json(await loadPosts(viewerId, where, params, limit));
    } catch (err) {
        serverError('user', res, err);
    }
};

// GET /posts/:id
exports.getPost = async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid post", type: "error" });
    try {
        const viewerId = req.user ? req.user.id : null;
        const [post] = await loadPosts(viewerId, ['p.id = ?'], [id], 1);
        if (!post) return res.status(404).json({ message: "Post not found", type: "error" });
        res.json(post);
    } catch (err) {
        serverError('get', res, err);
    }
};

// GET /posts/:id/comments (oldest first)
exports.getComments = async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid post", type: "error" });
    try {
        const viewerId = req.user ? req.user.id : null;
        const post = await queryOne('SELECT id, userId FROM posts WHERE id = ?', [id]);
        if (!post) return res.status(404).json({ message: "Post not found", type: "error" });
        const hidden = viewerId ? await blockedIds(viewerId) : [];
        if (hidden.includes(post.userId)) return res.status(404).json({ message: "Post not found", type: "error" });

        const rows = await query(
            `SELECT c.*, ${AUTHOR_COLS} FROM post_comments c LEFT JOIN user u ON u.id = c.userId
             WHERE c.postId = ? ${hidden.length ? 'AND c.userId NOT IN (?)' : ''}
             ORDER BY c.id ASC LIMIT 500`,
            hidden.length ? [id, hidden] : [id]
        );
        res.json(rows.map(formatComment));
    } catch (err) {
        serverError('comments', res, err);
    }
};

function validatePost(body) {
    const text = String(body.text || '').trim();
    const images = body.images === undefined || body.images === null ? [] : body.images;
    const category = body.category ? String(body.category) : null;
    const location = String(body.location || '').trim();

    if (!Array.isArray(images)) return { error: 'images must be an array' };
    if (!text && !images.length) return { error: 'Write something or add a photo' };
    if (text.length > MAX_TEXT) return { error: `Text is too long (max ${MAX_TEXT})` };
    if (images.length > MAX_IMAGES) return { error: `You can add up to ${MAX_IMAGES} photos` };
    let total = 0;
    for (const img of images) {
        if (typeof img !== 'string' || !DATA_URI.test(img)) return { error: 'Invalid photo format' };
        if (img.length > MAX_IMAGE_CHARS) return { error: 'One of the photos is too large' };
        total += img.length;
    }
    if (total > MAX_TOTAL_IMAGE_CHARS) return { error: 'Photos are too large in total' };
    if (category && !CATEGORIES.includes(category)) return { error: 'Invalid category' };
    if (location.length > MAX_LOCATION) return { error: `Location is too long (max ${MAX_LOCATION})` };

    let rideId = null;
    let trackId = null;
    if (body.rideId !== undefined && body.rideId !== null && body.rideId !== '') {
        rideId = toId(body.rideId);
        if (!rideId) return { error: 'Invalid ride' };
    }
    if (body.trackId !== undefined && body.trackId !== null && body.trackId !== '') {
        trackId = toId(body.trackId);
        if (!trackId) return { error: 'Invalid track' };
    }
    return { value: { text: text || null, images, category, location: location || null, rideId, trackId } };
}

// POST /posts
exports.createPost = async (req, res) => {
    const { error, value } = validatePost(req.body || {});
    if (error) return res.status(400).json({ message: error, type: "error" });
    try {
        if (value.rideId && !(await queryOne('SELECT id FROM rides WHERE id = ?', [value.rideId]))) {
            return res.status(400).json({ message: "Ride not found", type: "error" });
        }
        if (value.trackId && !(await queryOne('SELECT id FROM tracks WHERE id = ? AND userId = ?', [value.trackId, req.user.id]))) {
            return res.status(400).json({ message: "Track not found", type: "error" });
        }
        const result = await query(
            'INSERT INTO posts (userId, text, images, category, location, rideId, trackId) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, value.text, JSON.stringify(value.images), value.category, value.location, value.rideId, value.trackId]
        );
        const [post] = await loadPosts(req.user.id, ['p.id = ?'], [result.insertId], 1);
        res.status(201).json(post);
    } catch (err) {
        if (err && err.code === 'ER_NET_PACKET_TOO_LARGE') {
            return res.status(413).json({ message: "Photos are too large. Try fewer or smaller photos.", type: "error" });
        }
        serverError('create', res, err);
    }
};

// DELETE /posts/:id (owner only)
exports.deletePost = async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid post", type: "error" });
    try {
        const post = await queryOne('SELECT id, userId FROM posts WHERE id = ?', [id]);
        if (!post) return res.status(404).json({ message: "Post not found", type: "error" });
        if (post.userId !== req.user.id) return res.status(403).json({ message: "You can only delete your own posts", type: "error" });

        await query('DELETE FROM post_likes WHERE postId = ?', [id]);
        await query('DELETE FROM post_comments WHERE postId = ?', [id]);
        await query('DELETE FROM posts WHERE id = ?', [id]);
        res.json({ message: "Post deleted", type: "success" });
    } catch (err) {
        serverError('delete', res, err);
    }
};

// Shared guard for like/comment: post exists and nobody blocked anybody
async function interactablePost(req, res) {
    const id = toId(req.params.id);
    if (!id) {
        res.status(400).json({ message: "Invalid post", type: "error" });
        return null;
    }
    const post = await queryOne('SELECT id, userId, text FROM posts WHERE id = ?', [id]);
    if (!post) {
        res.status(404).json({ message: "Post not found", type: "error" });
        return null;
    }
    if (post.userId !== req.user.id && (await isBlockedBetween(req.user.id, post.userId))) {
        res.status(403).json({ message: "You can't interact with this post", type: "error" });
        return null;
    }
    return post;
}

const likeState = async (postId, userId) => {
    const row = await queryOne(
        'SELECT COUNT(*) AS n, SUM(userId = ?) AS mine FROM post_likes WHERE postId = ?',
        [userId, postId]
    );
    return { liked: !!Number(row.mine || 0), likesCount: Number(row.n || 0) };
};

// POST /posts/:id/like
exports.likePost = async (req, res) => {
    try {
        const post = await interactablePost(req, res);
        if (!post) return;
        const result = await query('INSERT IGNORE INTO post_likes (postId, userId) VALUES (?, ?)', [post.id, req.user.id]);

        if (result.affectedRows && post.userId !== req.user.id) {
            // Notify only the first time this user likes this post (unlike/like again stays quiet)
            const link = `/post/${post.id}`;
            const already = await queryOne(
                'SELECT id FROM notifications WHERE userId = ? AND senderId = ? AND link = ? AND subject = ? LIMIT 1',
                [post.userId, req.user.id, link, 'New like']
            );
            if (!already) {
                await notify(post.userId, {
                    senderId: req.user.id,
                    senderName: req.user.username,
                    subject: 'New like',
                    description: `${req.user.username} liked your post`,
                    link,
                });
            }
        }
        res.json(await likeState(post.id, req.user.id));
    } catch (err) {
        serverError('like', res, err);
    }
};

// DELETE /posts/:id/like
exports.unlikePost = async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid post", type: "error" });
    try {
        const post = await queryOne('SELECT id FROM posts WHERE id = ?', [id]);
        if (!post) return res.status(404).json({ message: "Post not found", type: "error" });
        await query('DELETE FROM post_likes WHERE postId = ? AND userId = ?', [id, req.user.id]);
        res.json(await likeState(id, req.user.id));
    } catch (err) {
        serverError('unlike', res, err);
    }
};

// POST /posts/:id/comments
exports.addComment = async (req, res) => {
    const text = String((req.body || {}).text || '').trim();
    if (!text) return res.status(400).json({ message: "Comment is empty", type: "error" });
    if (text.length > MAX_COMMENT) return res.status(400).json({ message: `Comment is too long (max ${MAX_COMMENT})`, type: "error" });
    try {
        const post = await interactablePost(req, res);
        if (!post) return;
        const result = await query('INSERT INTO post_comments (postId, userId, text) VALUES (?, ?, ?)', [post.id, req.user.id, text]);

        if (post.userId !== req.user.id) {
            await notify(post.userId, {
                senderId: req.user.id,
                senderName: req.user.username,
                subject: 'New comment',
                description: `${req.user.username} commented on your post: ${text.slice(0, 100)}`,
                link: `/post/${post.id}`,
            });
        }

        const row = await queryOne(
            `SELECT c.*, ${AUTHOR_COLS} FROM post_comments c LEFT JOIN user u ON u.id = c.userId WHERE c.id = ?`,
            [result.insertId]
        );
        res.status(201).json(formatComment(row));
    } catch (err) {
        serverError('addComment', res, err);
    }
};

// DELETE /posts/comments/:commentId (comment author or post owner)
exports.deleteComment = async (req, res) => {
    const id = toId(req.params.commentId);
    if (!id) return res.status(400).json({ message: "Invalid comment", type: "error" });
    try {
        const row = await queryOne(
            'SELECT c.id, c.userId, p.userId AS postOwner FROM post_comments c LEFT JOIN posts p ON p.id = c.postId WHERE c.id = ?',
            [id]
        );
        if (!row) return res.status(404).json({ message: "Comment not found", type: "error" });
        if (row.userId !== req.user.id && row.postOwner !== req.user.id) {
            return res.status(403).json({ message: "You can't delete this comment", type: "error" });
        }
        await query('DELETE FROM post_comments WHERE id = ?', [id]);
        res.json({ message: "Comment deleted", type: "success" });
    } catch (err) {
        serverError('deleteComment', res, err);
    }
};

exports.CATEGORIES = CATEGORIES;
