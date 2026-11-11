'use strict';

// GPS RIDE RECORDINGS ("tracks") — private to their owner.
//   POST   /tracks          save a finished recording
//   GET    /tracks          my recordings (summary, newest first) + totals
//   GET    /tracks/:id      one recording with all points
//   PATCH  /tracks/:id      rename
//   DELETE /tracks/:id      delete

const express = require('express');
const router = express.Router();

const { query, queryOne } = require('../config/databaseCon');
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const { rateLimit } = require('../utils/rateLimit');
const { cleanTrackPoints, computeStats, parsePoints } = require('../utils/trackMath');

router.use(authenticateUserToken);

const SUMMARY_FIELDS = `id, userId, title, startedAt, endedAt, durationSec, movingSec, distanceM, maxSpeedKmh, avgSpeedKmh,
    maxLeanLeft, maxLeanRight, maxGForce, avgGForce, elevationGainM, maxAltitudeM, minAltitudeM, startName, endName, rideId, createdAt`;

const toId = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
};
const fail = (res, status, message) => res.status(status).json({ message, type: "error" });

/** ISO string / epoch ms -> 'YYYY-MM-DD HH:MM:SS' (UTC) or null */
function toSqlDate(v) {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : String(v));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Optional sensor value clamped to [0, max]; null when missing */
function sensor(v, max) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(Math.min(n, max) * 100) / 100;
}

const cleanText = (v, max) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, max) : null;
};

const formatSummary = (t) => ({
    ...t,
    distanceM: Number(t.distanceM) || 0,
    maxSpeedKmh: Number(t.maxSpeedKmh) || 0,
    avgSpeedKmh: Number(t.avgSpeedKmh) || 0,
});

// ---------- CREATE ----------
router.post('/', rateLimit({ windowMs: 60 * 60 * 1000, max: 60, message: 'Too many recordings saved. Try again later.' }), async (req, res) => {
    const body = req.body || {};
    const cleaned = cleanTrackPoints(body.points);
    if (cleaned.error) return fail(res, 400, cleaned.error);
    const points = cleaned.points;

    const title = cleanText(body.title, 120);
    const startedAt = toSqlDate(body.startedAt);
    let endedAt = toSqlDate(body.endedAt);
    if (!startedAt) return fail(res, 400, 'Start time is required');
    const startMs = new Date(startedAt.replace(' ', 'T') + 'Z').getTime();
    if (startMs > Date.now() + 86400000) return fail(res, 400, 'Start time is in the future');
    const lastT = points[points.length - 1][2];
    if (!endedAt) endedAt = toSqlDate(startMs + lastT);
    const endMs = new Date(endedAt.replace(' ', 'T') + 'Z').getTime();
    if (endMs < startMs) return fail(res, 400, 'End time is before the start time');
    if (endMs - startMs > 7 * 86400000) return fail(res, 400, 'A recording cannot be longer than 7 days');

    const stats = computeStats(points);
    if (stats.distanceM < 20) return fail(res, 400, 'The recording is too short to save (under 20 m)');

    // Duration (excluding pauses) comes from the app's stopwatch; it must sit between the GPS time span
    // and the wall-clock time, otherwise fall back to what the points prove.
    const wallSec = Math.round((endMs - startMs) / 1000);
    let durationSec = Number(body.durationSec);
    if (!Number.isFinite(durationSec) || durationSec < stats.activeSec - 5 || durationSec > wallSec + 60) {
        durationSec = stats.activeSec;
    }
    durationSec = Math.round(Math.max(durationSec, stats.activeSec));
    const movingSec = Math.min(stats.movingSec, durationSec);

    let rideId = null;
    if (body.rideId !== undefined && body.rideId !== null && body.rideId !== '') {
        rideId = toId(body.rideId);
        if (!rideId) return fail(res, 400, 'Invalid ride');
        const ride = await queryOne('SELECT id FROM rides WHERE id = ?', [rideId]).catch(() => null);
        if (!ride) rideId = null;
    }

    try {
        const result = await query(
            `INSERT INTO tracks (userId, title, startedAt, endedAt, durationSec, movingSec, distanceM, maxSpeedKmh, avgSpeedKmh,
                maxLeanLeft, maxLeanRight, maxGForce, avgGForce, elevationGainM, maxAltitudeM, minAltitudeM, startName, endName, points, rideId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                title || 'My ride',
                startedAt,
                endedAt,
                durationSec,
                movingSec,
                stats.distanceM,
                stats.maxSpeedKmh,
                stats.avgSpeedKmh,
                sensor(body.maxLeanLeft, 70),
                sensor(body.maxLeanRight, 70),
                sensor(body.maxGForce, 3),
                sensor(body.avgGForce, 3),
                stats.elevationGainM,
                stats.maxAltitudeM,
                stats.minAltitudeM,
                cleanText(body.startName, 120),
                cleanText(body.endName, 120),
                JSON.stringify(points),
                rideId,
            ]
        );
        const track = await queryOne(`SELECT ${SUMMARY_FIELDS} FROM tracks WHERE id = ?`, [result.insertId]);
        res.status(201).json(formatSummary(track));
    } catch (err) {
        console.error('[tracks/create]', err);
        fail(res, 500, 'Server error');
    }
});

// ---------- LIST (mine) ----------
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const [tracks, totals] = await Promise.all([
            query(`SELECT ${SUMMARY_FIELDS} FROM tracks WHERE userId = ? ORDER BY startedAt DESC, id DESC LIMIT ? OFFSET ?`, [req.user.id, limit, offset]),
            queryOne(
                `SELECT COUNT(*) AS count, COALESCE(SUM(distanceM), 0) AS distanceM, COALESCE(SUM(durationSec), 0) AS durationSec,
                    COALESCE(SUM(movingSec), 0) AS movingSec, COALESCE(MAX(maxSpeedKmh), 0) AS maxSpeedKmh
                 FROM tracks WHERE userId = ?`,
                [req.user.id]
            ),
        ]);
        res.json({
            tracks: tracks.map(formatSummary),
            totals: {
                count: Number(totals.count),
                distanceM: Number(totals.distanceM),
                durationSec: Number(totals.durationSec),
                movingSec: Number(totals.movingSec),
                maxSpeedKmh: Number(totals.maxSpeedKmh),
            },
        });
    } catch (err) {
        console.error('[tracks/list]', err);
        fail(res, 500, 'Server error');
    }
});

// ---------- ONE (with points) ----------
router.get('/:id', async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid recording');
    try {
        const row = await queryOne(`SELECT ${SUMMARY_FIELDS}, points FROM tracks WHERE id = ? AND userId = ?`, [id, req.user.id]);
        if (!row) return fail(res, 404, 'Recording not found');
        const route = await queryOne('SELECT id FROM route_library WHERE trackId = ? AND userId = ? LIMIT 1', [id, req.user.id]);
        res.json({ ...formatSummary(row), points: parsePoints(row.points), routeId: route ? route.id : null });
    } catch (err) {
        console.error('[tracks/get]', err);
        fail(res, 500, 'Server error');
    }
});

// ---------- RENAME ----------
router.patch('/:id', async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid recording');
    const title = cleanText((req.body || {}).title, 500);
    if (!title) return fail(res, 400, 'Title is required');
    if (title.length > 120) return fail(res, 400, 'Title is too long (max 120)');
    try {
        const result = await query('UPDATE tracks SET title = ? WHERE id = ? AND userId = ?', [title, id, req.user.id]);
        if (!result.affectedRows) return fail(res, 404, 'Recording not found');
        res.json({ type: "success", message: "Recording renamed", title });
    } catch (err) {
        console.error('[tracks/rename]', err);
        fail(res, 500, 'Server error');
    }
});

// ---------- DELETE ----------
router.delete('/:id', async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid recording');
    try {
        const result = await query('DELETE FROM tracks WHERE id = ? AND userId = ?', [id, req.user.id]);
        if (!result.affectedRows) return fail(res, 404, 'Recording not found');
        // published routes keep their own copy of the path; just unlink them
        await query('UPDATE route_library SET trackId = NULL WHERE trackId = ? AND userId = ?', [id, req.user.id]);
        res.json({ type: "success", message: "Recording deleted" });
    } catch (err) {
        console.error('[tracks/delete]', err);
        fail(res, 500, 'Server error');
    }
});

module.exports = router;
