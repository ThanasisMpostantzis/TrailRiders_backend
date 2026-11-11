'use strict';

// ROUTE LIBRARY ("best roads") — routes shared by riders, with ratings and favourites.
//   GET    /library                 list (?search, difficulty, style, surface, sort=top|new|near, lat, lng, maxKm, favorites=1, mine=1, userId, limit, offset)
//   GET    /library/favorites       my favourite routes
//   GET    /library/:id             one route with points + ratings
//   POST   /library                 publish (from a trackId I own, or from raw points)
//   PUT    /library/:id             edit my route (text fields + cover)
//   DELETE /library/:id             delete my route
//   POST   /library/:id/rate        { rating 1-5, review? }   DELETE /library/:id/rate removes mine
//   POST   /library/:id/favorite    DELETE /library/:id/favorite

const express = require('express');
const router = express.Router();

const { query, queryOne } = require('../config/databaseCon');
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const optionalAuth = require('../middlewares/optionalAuth.js');
const { notify } = require('../utils/notify');
const { blockedIds, isBlockedBetween } = require('../utils/social');
const { rateLimit } = require('../utils/rateLimit');
const { cleanRoutePoints, routeStats, parsePoints, thin } = require('../utils/trackMath');

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const STYLES = ['Twisties', 'Scenic', 'Mountain', 'Coastal', 'Offroad', 'City'];
const SURFACES = ['Paved', 'Mixed', 'Gravel', 'Dirt'];
const MAX_IMAGE = 8 * 1024 * 1024;

const toId = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
};
const fail = (res, status, message) => res.status(status).json({ message, type: "error" });
const cleanText = (v, max) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, max) : null;
};
const numOrNull = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

// Base SELECT with rating/favourite aggregates and the author card. Params: [viewerId]
const BASE_SELECT = `
    SELECT r.id, r.userId, r.name, r.description, r.region, r.difficulty, r.surface, r.style, r.distanceM, r.durationSec,
        r.elevationGainM, r.startLat, r.startLng, r.endLat, r.endLng, r.startName, r.endName, r.image, r.trackId, r.createdAt,
        COALESCE(rt.avgRating, 0) AS avgRating, COALESCE(rt.cnt, 0) AS ratingsCount, COALESCE(rt.total, 0) AS ratingsTotal,
        COALESCE(fv.cnt, 0) AS favoritesCount,
        EXISTS(SELECT 1 FROM route_favorites f2 WHERE f2.routeId = r.id AND f2.userId = ?) AS isFavorite,
        u.username AS authorUsername, u.fullName AS authorFullName, u.image AS authorImage, u.subscribed AS authorSubscribed
        __EXTRA__
    FROM route_library r
    JOIN user u ON u.id = r.userId
    LEFT JOIN (SELECT routeId, AVG(rating) AS avgRating, COUNT(*) AS cnt, SUM(rating) AS total FROM route_ratings GROUP BY routeId) rt ON rt.routeId = r.id
    LEFT JOIN (SELECT routeId, COUNT(*) AS cnt FROM route_favorites GROUP BY routeId) fv ON fv.routeId = r.id`;

function formatRoute(r) {
    const out = {
        id: r.id,
        userId: r.userId,
        name: r.name,
        description: r.description || '',
        region: r.region,
        difficulty: r.difficulty,
        surface: r.surface,
        style: r.style,
        distanceM: Number(r.distanceM) || 0,
        durationSec: r.durationSec === null ? null : Number(r.durationSec),
        elevationGainM: r.elevationGainM === null ? null : Number(r.elevationGainM),
        start: r.startLat === null ? null : { latitude: Number(r.startLat), longitude: Number(r.startLng) },
        end: r.endLat === null ? null : { latitude: Number(r.endLat), longitude: Number(r.endLng) },
        startName: r.startName,
        endName: r.endName,
        image: r.image || null,
        trackId: r.trackId,
        createdAt: r.createdAt,
        avgRating: Math.round(Number(r.avgRating) * 10) / 10,
        ratingsCount: Number(r.ratingsCount),
        favoritesCount: Number(r.favoritesCount),
        isFavorite: !!Number(r.isFavorite),
        author: {
            id: r.userId,
            username: r.authorUsername,
            fullName: r.authorFullName,
            image: r.authorImage,
            subscribed: !!r.authorSubscribed,
        },
    };
    if (r.distanceKm !== undefined && r.distanceKm !== null) out.distanceKm = Math.round(Number(r.distanceKm) * 10) / 10;
    // small [lat, lng] outline for list thumbnails
    if (r.points !== undefined) out.preview = thin(parsePoints(r.points), 48).map((p) => [p[0], p[1]]);
    return out;
}

// ---------- LIST ----------
async function listRoutes(req, res, { favoritesOnly = false } = {}) {
    try {
        const me = req.user ? req.user.id : 0;
        const where = [];
        const params = [];
        let extra = ', r.points';
        const extraParams = [];

        if (me) {
            const hidden = await blockedIds(me);
            if (hidden.length) {
                where.push('r.userId NOT IN (?)');
                params.push(hidden);
            }
        }

        const search = cleanText(req.query.search, 80);
        if (search) {
            const like = `%${search.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
            where.push('(r.name LIKE ? OR r.region LIKE ? OR r.startName LIKE ? OR r.endName LIKE ?)');
            params.push(like, like, like, like);
        }
        if (DIFFICULTIES.includes(req.query.difficulty)) {
            where.push('r.difficulty = ?');
            params.push(req.query.difficulty);
        }
        if (STYLES.includes(req.query.style)) {
            where.push('r.style = ?');
            params.push(req.query.style);
        }
        if (SURFACES.includes(req.query.surface)) {
            where.push('r.surface = ?');
            params.push(req.query.surface);
        }
        if (favoritesOnly || req.query.favorites === '1') {
            if (!me) return fail(res, 401, 'Log in to see your favourites');
            where.push('EXISTS(SELECT 1 FROM route_favorites f WHERE f.routeId = r.id AND f.userId = ?)');
            params.push(me);
        }
        if (req.query.mine === '1') {
            if (!me) return fail(res, 401, 'Log in to see your routes');
            where.push('r.userId = ?');
            params.push(me);
        } else if (toId(req.query.userId)) {
            where.push('r.userId = ?');
            params.push(toId(req.query.userId));
        }

        // sorting
        const lat = numOrNull(req.query.lat);
        const lng = numOrNull(req.query.lng);
        let sort = ['top', 'new', 'near'].includes(req.query.sort) ? req.query.sort : 'top';
        const hasPos = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        if (sort === 'near' && !hasPos) sort = 'top';
        if (hasPos) {
            extra += `, (6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(r.startLat - ?) / 2), 2) +
                COS(RADIANS(?)) * COS(RADIANS(r.startLat)) * POWER(SIN(RADIANS(r.startLng - ?) / 2), 2)))) AS distanceKm`;
            extraParams.push(lat, lat, lng);
        }
        // Bayesian average: a single 5★ doesn't beat fifty 4.8★ ratings
        const orderBy = {
            top: '((COALESCE(rt.total, 0) + 3.5 * 3) / (COALESCE(rt.cnt, 0) + 3)) DESC, COALESCE(fv.cnt, 0) DESC, r.id DESC',
            new: 'r.createdAt DESC, r.id DESC',
            near: 'distanceKm IS NULL, distanceKm ASC, r.id DESC',
        }[sort];

        const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 60);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const maxKm = numOrNull(req.query.maxKm);
        const having = hasPos && maxKm && maxKm > 0 ? 'HAVING distanceKm <= ?' : '';

        const sql = `${BASE_SELECT.replace('__EXTRA__', extra)}
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ${having}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?`;
        const rows = await query(sql, [me, ...extraParams, ...params, ...(having ? [maxKm] : []), limit, offset]);
        res.json(rows.map(formatRoute));
    } catch (err) {
        console.error('[library/list]', err);
        fail(res, 500, 'Server error');
    }
}

router.get('/', optionalAuth, (req, res) => listRoutes(req, res));
router.get('/favorites', authenticateUserToken, (req, res) => listRoutes(req, res, { favoritesOnly: true }));

/** Loads a route visible to this viewer (null if missing or blocked) */
async function loadRoute(id, viewerId, withPoints = false) {
    const sql = `${BASE_SELECT.replace('__EXTRA__', withPoints ? ', r.points' : '')} WHERE r.id = ?`;
    const row = await queryOne(sql, [viewerId || 0, id]);
    if (!row) return null;
    if (viewerId && row.userId !== viewerId && (await isBlockedBetween(viewerId, row.userId))) return null;
    return row;
}

// ---------- ONE ----------
router.get('/:id', optionalAuth, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid route');
    try {
        const me = req.user ? req.user.id : 0;
        const row = await loadRoute(id, me, true);
        if (!row) return fail(res, 404, 'Route not found');

        const hidden = me ? await blockedIds(me) : [];
        const ratings = await query(
            `SELECT rr.userId, rr.rating, rr.review, rr.createdAt, u.username, u.fullName, u.image, u.subscribed
             FROM route_ratings rr JOIN user u ON u.id = rr.userId
             WHERE rr.routeId = ? ${hidden.length ? 'AND rr.userId NOT IN (?)' : ''}
             ORDER BY (rr.userId = ?) DESC, rr.createdAt DESC LIMIT 200`,
            hidden.length ? [id, hidden, me] : [id, me]
        );
        const mine = me ? ratings.find((r) => r.userId === me) : null;
        res.json({
            ...formatRoute(row),
            points: parsePoints(row.points),
            isOwner: !!me && row.userId === me,
            myRating: mine ? { rating: mine.rating, review: mine.review } : null,
            ratings: ratings.map((r) => ({
                userId: r.userId,
                rating: r.rating,
                review: r.review,
                createdAt: r.createdAt,
                user: { id: r.userId, username: r.username, fullName: r.fullName, image: r.image, subscribed: !!r.subscribed },
            })),
        });
    } catch (err) {
        console.error('[library/get]', err);
        fail(res, 500, 'Server error');
    }
});

/** Validates the editable text fields. Returns { values } or { error } */
function validateFields(body, partial) {
    const values = {};
    if (!partial || body.name !== undefined) {
        const name = cleanText(body.name, 500);
        if (!name || name.length < 3) return { error: 'Give the route a name (at least 3 characters)' };
        if (name.length > 120) return { error: 'Name is too long (max 120)' };
        values.name = name;
    }
    if (!partial || body.description !== undefined) {
        const d = cleanText(body.description, 5000);
        if (d && d.length > 2000) return { error: 'Description is too long (max 2000)' };
        values.description = d;
    }
    if (!partial || body.region !== undefined) {
        const r = cleanText(body.region, 500);
        if (r && r.length > 80) return { error: 'Region is too long (max 80)' };
        values.region = r;
    }
    const pick = (field, list, label) => {
        if (partial && body[field] === undefined) return null;
        const v = body[field];
        if (v === null || v === '' || v === undefined) {
            values[field] = null;
            return null;
        }
        if (!list.includes(v)) return `Choose a valid ${label}`;
        values[field] = v;
        return null;
    };
    const e = pick('difficulty', DIFFICULTIES, 'difficulty') || pick('style', STYLES, 'riding style') || pick('surface', SURFACES, 'surface');
    if (e) return { error: e };
    if (!partial || body.image !== undefined) {
        const img = body.image;
        if (img === null || img === '' || img === undefined) values.image = null;
        else if (typeof img !== 'string' || !/^(data:image\/|https?:\/\/)/.test(img)) return { error: 'Invalid cover image' };
        else if (img.length > MAX_IMAGE) return { error: 'Cover image is too large' };
        else values.image = img;
    }
    if (!partial || body.startName !== undefined) values.startName = cleanText(body.startName, 120);
    if (!partial || body.endName !== undefined) values.endName = cleanText(body.endName, 120);
    return { values };
}

// ---------- CREATE ----------
router.post('/', authenticateUserToken, rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'You are publishing routes too fast. Try again later.' }), async (req, res) => {
    const body = req.body || {};
    const { values, error } = validateFields(body, false);
    if (error) return fail(res, 400, error);

    try {
        let points;
        let stats;
        let durationSec = null;
        let trackId = null;

        if (body.trackId !== undefined && body.trackId !== null && body.trackId !== '') {
            trackId = toId(body.trackId);
            if (!trackId) return fail(res, 400, 'Invalid recording');
            const track = await queryOne('SELECT * FROM tracks WHERE id = ?', [trackId]);
            if (!track || track.userId !== req.user.id) return fail(res, 404, 'Recording not found');
            const existing = await queryOne('SELECT id FROM route_library WHERE trackId = ? AND userId = ?', [trackId, req.user.id]);
            if (existing) return res.status(409).json({ message: 'This recording is already published', type: "error", routeId: existing.id });

            const cleaned = cleanRoutePoints(parsePoints(track.points));
            if (cleaned.error) return fail(res, 400, cleaned.error);
            points = cleaned.points;
            stats = { distanceM: Number(track.distanceM) || routeStats(points).distanceM, elevationGainM: track.elevationGainM };
            durationSec = track.movingSec || track.durationSec || null;
            if (!values.startName) values.startName = track.startName;
            if (!values.endName) values.endName = track.endName;
        } else {
            const cleaned = cleanRoutePoints(body.points);
            if (cleaned.error) return fail(res, 400, body.points ? cleaned.error : 'Choose one of your recordings to publish');
            points = cleaned.points;
            stats = routeStats(points);
            const d = Number(body.durationSec);
            // otherwise estimate at an easy 50 km/h touring pace
            durationSec = Number.isFinite(d) && d > 0 && d < 7 * 86400 ? Math.round(d) : Math.round(stats.distanceM / (50 / 3.6));
        }
        if (stats.distanceM < 500) return fail(res, 400, 'A route must be at least 500 m long');

        const first = points[0];
        const last = points[points.length - 1];
        const result = await query(
            `INSERT INTO route_library (userId, name, description, region, difficulty, surface, style, distanceM, durationSec, elevationGainM,
                startLat, startLng, endLat, endLng, startName, endName, points, image, trackId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id, values.name, values.description, values.region, values.difficulty, values.surface, values.style,
                stats.distanceM, durationSec, stats.elevationGainM,
                first[0], first[1], last[0], last[1], values.startName, values.endName,
                JSON.stringify(points), values.image, trackId,
            ]
        );
        const row = await loadRoute(result.insertId, req.user.id, true);
        res.status(201).json(formatRoute(row));
    } catch (err) {
        console.error('[library/create]', err);
        fail(res, 500, 'Server error');
    }
});

// ---------- EDIT ----------
router.put('/:id', authenticateUserToken, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid route');
    const { values, error } = validateFields(req.body || {}, true);
    if (error) return fail(res, 400, error);
    try {
        const route = await queryOne('SELECT userId FROM route_library WHERE id = ?', [id]);
        if (!route) return fail(res, 404, 'Route not found');
        if (route.userId !== req.user.id) return fail(res, 403, 'You can only edit your own routes');
        const fields = Object.keys(values);
        if (fields.length) {
            await query(`UPDATE route_library SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [...fields.map((f) => values[f]), id]);
        }
        res.json(formatRoute(await loadRoute(id, req.user.id, true)));
    } catch (err) {
        console.error('[library/edit]', err);
        fail(res, 500, 'Server error');
    }
});

// ---------- DELETE ----------
router.delete('/:id', authenticateUserToken, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid route');
    try {
        const route = await queryOne('SELECT userId FROM route_library WHERE id = ?', [id]);
        if (!route) return fail(res, 404, 'Route not found');
        if (route.userId !== req.user.id) return fail(res, 403, 'You can only delete your own routes');
        await query('DELETE FROM route_ratings WHERE routeId = ?', [id]);
        await query('DELETE FROM route_favorites WHERE routeId = ?', [id]);
        await query('DELETE FROM route_library WHERE id = ?', [id]);
        res.json({ type: "success", message: "Route deleted" });
    } catch (err) {
        console.error('[library/delete]', err);
        fail(res, 500, 'Server error');
    }
});

// ---------- RATE ----------
router.post('/:id/rate', authenticateUserToken, rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }), async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid route');
    const rating = Number((req.body || {}).rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, 400, 'Rating must be 1 to 5 stars');
    const review = cleanText((req.body || {}).review, 1000);
    if (review && review.length > 500) return fail(res, 400, 'Review is too long (max 500)');
    try {
        const route = await loadRoute(id, req.user.id, false);
        if (!route) return fail(res, 404, 'Route not found');
        if (route.userId === req.user.id) return fail(res, 400, "You can't rate your own route");

        const before = await queryOne('SELECT rating FROM route_ratings WHERE routeId = ? AND userId = ?', [id, req.user.id]);
        await query(
            `INSERT INTO route_ratings (routeId, userId, rating, review) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), createdAt = NOW()`,
            [id, req.user.id, rating, review]
        );
        if (!before || before.rating !== rating) {
            await notify(route.userId, {
                senderId: req.user.id,
                senderName: req.user.username,
                subject: 'New route rating',
                description: `${req.user.username} rated your route "${route.name}" ${'★'.repeat(rating)}${review ? `: ${review.slice(0, 100)}` : ''}`,
                link: `/routes/${id}`,
            });
        }
        const agg = await queryOne('SELECT AVG(rating) AS avg, COUNT(*) AS n FROM route_ratings WHERE routeId = ?', [id]);
        res.json({ type: "success", message: "Thanks for rating!", avgRating: Math.round(Number(agg.avg) * 10) / 10, ratingsCount: Number(agg.n) });
    } catch (err) {
        console.error('[library/rate]', err);
        fail(res, 500, 'Server error');
    }
});

router.delete('/:id/rate', authenticateUserToken, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid route');
    try {
        await query('DELETE FROM route_ratings WHERE routeId = ? AND userId = ?', [id, req.user.id]);
        res.json({ type: "success", message: "Rating removed" });
    } catch (err) {
        console.error('[library/unrate]', err);
        fail(res, 500, 'Server error');
    }
});

// ---------- FAVOURITES ----------
router.post('/:id/favorite', authenticateUserToken, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid route');
    try {
        const route = await loadRoute(id, req.user.id, false);
        if (!route) return fail(res, 404, 'Route not found');
        await query('INSERT IGNORE INTO route_favorites (routeId, userId) VALUES (?, ?)', [id, req.user.id]);
        const n = await queryOne('SELECT COUNT(*) AS n FROM route_favorites WHERE routeId = ?', [id]);
        res.json({ type: "success", isFavorite: true, favoritesCount: Number(n.n) });
    } catch (err) {
        console.error('[library/favorite]', err);
        fail(res, 500, 'Server error');
    }
});

router.delete('/:id/favorite', authenticateUserToken, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid route');
    try {
        await query('DELETE FROM route_favorites WHERE routeId = ? AND userId = ?', [id, req.user.id]);
        const n = await queryOne('SELECT COUNT(*) AS n FROM route_favorites WHERE routeId = ?', [id]);
        res.json({ type: "success", isFavorite: false, favoritesCount: Number(n.n) });
    } catch (err) {
        console.error('[library/unfavorite]', err);
        fail(res, 500, 'Server error');
    }
});

module.exports = router;
