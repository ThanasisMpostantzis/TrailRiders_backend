'use strict';

const crypto = require('crypto');
const { query, queryOne } = require('../config/databaseCon.js');
const { notify } = require('../utils/notify');
const { checkHostingLimit, notifyFollowers, blockedIds } = require('../utils/social');
const { geocodeRideLater } = require('../utils/geocode');

// ---------- helpers ----------

const parseJSONList = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

// Shapes a DB row into what the app expects (full details, never the access code)
const formatRideRaw = (row) => {
    const participants = parseJSONList(row.usersId).map(String);
    const { usersId, accessCode, ...rest } = row;
    return {
        ...rest,
        visibility: row.visibility === 'private' ? 'private' : 'public',
        creatorId: row.creator_id,
        rideTime: row.ride_time,
        stops: parseJSONList(row.stops),
        participants,
        participantsCount: participants.length,
    };
};

/**
 * What a given viewer may see of a ride.
 * - the owner also gets `accessCode` (private rides)
 * - private rides are redacted (`locked: true`) for anyone who is not the owner or a participant:
 *   no stops, description, meeting time, participant list or reviews.
 * @param {object} row DB row
 * @param {number|string|null} viewerId logged-in user id (or null)
 */
const presentRide = (row, viewerId) => {
    const ride = formatRideRaw(row);
    const viewer = viewerId === undefined || viewerId === null ? '' : String(viewerId);
    const isOwner = !!viewer && String(row.creator_id) === viewer;
    const isMember = isOwner || (!!viewer && ride.participants.includes(viewer));

    if (ride.visibility === 'private' && isOwner) ride.accessCode = row.accessCode || null;
    ride.locked = ride.visibility === 'private' && !isMember;
    if (ride.locked) {
        ride.stops = [];
        ride.description = '';
        ride.ride_time = null;
        ride.rideTime = null;
        ride.participants = [];
    }
    return ride;
};

// Public formatter (used by other routes, e.g. the follow feed). A second argument that is not an
// object (e.g. Array.map's index) is ignored, so callers without a viewer get the redacted version.
const formatRide = (row, opts) => presentRide(row, opts && typeof opts === 'object' ? opts.viewerId : null);

const isRideMember = (row, userId) =>
    !!userId && (String(row.creator_id) === String(userId) || parseJSONList(row.usersId).map(String).includes(String(userId)));

// ---------- private rides: access codes ----------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid typos
const generateAccessCode = () =>
    Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
const normaliseCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function codesMatch(given, expected) {
    const a = Buffer.from(normaliseCode(given));
    const b = Buffer.from(normaliseCode(expected));
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

// Wrong code attempts: max 5 per user per ride and 20 per user overall, per 15 minutes.
const CODE_WINDOW_MS = 15 * 60 * 1000;
const codeFailures = new Map(); // key -> { count, resetAt }
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of codeFailures) if (v.resetAt <= now) codeFailures.delete(k);
}, CODE_WINDOW_MS).unref();

function failureCount(key) {
    const e = codeFailures.get(key);
    return e && e.resetAt > Date.now() ? e.count : 0;
}
function addFailure(key) {
    const now = Date.now();
    const e = codeFailures.get(key);
    if (!e || e.resetAt <= now) codeFailures.set(key, { count: 1, resetAt: now + CODE_WINDOW_MS });
    else e.count += 1;
}

const toNumberOrNull = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const RIDE_FIELDS = {
    title: { max: 100, required: true },
    startLocation: { max: 100, required: true },
    finishLocation: { max: 100, required: true },
    description: { max: 1000 },
    category: { max: 100 },
    difficulty: { max: 100 },
    rideType: { max: 100 },
    expectedTime: { max: 50 },
};

function validateRide(body, partial = false) {
    for (const [field, rule] of Object.entries(RIDE_FIELDS)) {
        const value = body[field];
        if (rule.required && !partial && (!value || !String(value).trim())) return `${field} is required`;
        if (value && String(value).length > rule.max) return `${field} is too long (max ${rule.max})`;
    }
    if (body.date !== undefined && body.date !== null && body.date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        return 'date must be in YYYY-MM-DD format';
    }
    if (!partial && !body.date) return 'date is required';
    if (body.rideTime && !/^\d{1,2}:\d{2}$/.test(body.rideTime)) return 'time must be in HH:MM format';
    if (body.visibility !== undefined && body.visibility !== null && !['public', 'private'].includes(body.visibility)) {
        return "visibility must be 'public' or 'private'";
    }
    for (const [lat, lng] of [['startLat', 'startLng'], ['endLat', 'endLng']]) {
        const la = toNumberOrNull(body[lat]);
        const ln = toNumberOrNull(body[lng]);
        if ((la !== null && (la < -90 || la > 90)) || (ln !== null && (ln < -180 || ln > 180))) return `${lat}/${lng} are not valid coordinates`;
    }
    return null;
}

async function getRideRow(id) {
    return queryOne('SELECT * FROM rides WHERE id = ?', [id]);
}


// 1. GET ALL RIDES (optional ?search=, ?difficulty=, ?rideType=, ?upcoming=1)
exports.getAllRides = async (req, res) => {
    try {
        const where = [];
        const params = [];
        const { search, difficulty, rideType, category, upcoming } = req.query;

        if (search) {
            where.push('(title LIKE ? OR startLocation LIKE ? OR finishLocation LIKE ? OR organizer LIKE ?)');
            const like = `%${search}%`;
            params.push(like, like, like, like);
        }
        if (difficulty) { where.push('difficulty = ?'); params.push(difficulty); }
        if (rideType) { where.push('rideType = ?'); params.push(rideType); }
        if (category) { where.push('category = ?'); params.push(category); }
        if (upcoming === '1' || upcoming === 'true') { where.push('(date IS NULL OR date >= CURDATE())'); }

        if (req.user) {
            const hidden = await blockedIds(req.user.id);
            if (hidden.length) { where.push('creator_id NOT IN (?)'); params.push(hidden); }
        }
        const sql = `SELECT r.*, (u.subscribed = 1) AS creatorPremium
                     FROM rides r LEFT JOIN user u ON u.id = r.creator_id
                     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date ASC, ride_time ASC`;
        const rows = await query(sql, params);
        const viewerId = req.user ? req.user.id : null;
        res.status(200).json(rows.map((row) => ({ ...presentRide(row, viewerId), creatorPremium: !!row.creatorPremium })));
    } catch (err) {
        console.error('[rides/getAll]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// 2. GET RIDE BY ID (with participant & creator profiles)
exports.getRideById = async (req, res) => {
    try {
        const row = await getRideRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });

        const ride = presentRide(row, req.user ? req.user.id : null);
        const ids = ride.participants.map(Number).filter(Boolean);
        const users = ids.length
            ? await query('SELECT id, username, fullName, image, bike, subscribed FROM user WHERE id IN (?)', [ids])
            : [];

        ride.participantsInfo = ids
            .map((id) => users.find((u) => u.id === id))
            .filter(Boolean);
        ride.creator = await queryOne('SELECT id, username, fullName, image, bike, subscribed FROM user WHERE id = ?', [row.creator_id]);

        const ratings = await query(
            `SELECT rr.id, rr.userId, rr.rating, rr.review, rr.createdAt, u.username, u.fullName, u.image
             FROM ride_ratings rr LEFT JOIN user u ON u.id = rr.userId WHERE rr.rideId = ? ORDER BY rr.createdAt DESC`,
            [row.id]
        );
        // locked private ride: keep the average, hide who reviewed and what they wrote
        ride.ratings = ride.locked ? [] : ratings;
        ride.ratingsCount = ratings.length;
        ride.avgRating = ratings.length ? Math.round((ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length) * 10) / 10 : null;

        res.status(200).json(ride);
    } catch (err) {
        console.error('[rides/get]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// 3. CREATE RIDE (requires login; the creator is taken from the token)
exports.createRide = async (req, res) => {
    const body = req.body || {};
    const error = validateRide(body);
    if (error) return res.status(400).json({ message: error, type: "error" });

    try {
        const limit = await checkHostingLimit(req.user.id);
        if (limit) return res.status(403).json(limit);

        const creatorId = req.user.id;
        const visibility = body.visibility === 'private' ? 'private' : 'public';
        const accessCode = visibility === 'private' ? generateAccessCode() : null;
        const startLat = toNumberOrNull(body.startLat);
        const startLng = toNumberOrNull(body.startLng);
        const endLat = toNumberOrNull(body.endLat);
        const endLng = toNumberOrNull(body.endLng);
        const hasStart = startLat !== null && startLng !== null;
        const hasEnd = endLat !== null && endLng !== null;
        const result = await query(
            `INSERT INTO rides
            (creator_id, organizer, title, image, rideDistance, startLocation, finishLocation, date, ride_time, status,
             category, description, stops, difficulty, rideType, expectedTime, startLat, startLng, endLat, endLng, usersId,
             visibility, accessCode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                creatorId,
                req.user.username,
                body.title.trim(),
                body.image || null,
                toNumberOrNull(body.rideDistance),
                body.startLocation.trim(),
                body.finishLocation.trim(),
                body.date,
                body.rideTime || body.ride_time || null,
                body.category || 'Ride',
                (body.description || '').trim(),
                JSON.stringify(Array.isArray(body.stops) ? body.stops.filter(Boolean) : []),
                body.difficulty || 'Medium',
                body.rideType || 'Motorcycle',
                body.expectedTime || null,
                hasStart ? startLat : null,
                hasStart ? startLng : null,
                hasEnd ? endLat : null,
                hasEnd ? endLng : null,
                JSON.stringify([String(creatorId)]),
                visibility,
                accessCode,
            ]
        );
        await query('UPDATE user SET rides = COALESCE(rides, 0) + 1 WHERE id = ?', [creatorId]);
        // Private rides are not advertised to followers
        if (visibility === 'public') {
            await notifyFollowers(req.user, {
                subject: 'New ride from someone you follow',
                description: `${req.user.username} is organizing "${body.title.trim()}" on ${body.date}.`,
                rideId: result.insertId,
            });
        }

        // Fill missing coordinates in the background (does not delay the response)
        geocodeRideLater(result.insertId, {
            start: hasStart ? null : body.startLocation.trim(),
            finish: hasEnd ? null : body.finishLocation.trim(),
        });

        res.status(201).json({
            message: "Ride created successfully",
            type: "success",
            rideId: result.insertId,
            visibility,
            ...(accessCode ? { accessCode } : {}),
        });
    } catch (err) {
        console.error('[rides/create]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// 4. UPDATE RIDE (only the creator)
exports.updateRide = async (req, res) => {
    const body = req.body || {};
    const error = validateRide(body, true);
    if (error) return res.status(400).json({ message: error, type: "error" });

    try {
        const row = await getRideRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (row.creator_id !== req.user.id) return res.status(403).json({ message: "Only the organizer can edit this ride", type: "error" });

        const columns = {
            title: body.title,
            image: body.image,
            rideDistance: body.rideDistance !== undefined ? toNumberOrNull(body.rideDistance) : undefined,
            startLocation: body.startLocation,
            finishLocation: body.finishLocation,
            date: body.date,
            ride_time: body.rideTime,
            status: body.status,
            category: body.category,
            description: body.description,
            stops: Array.isArray(body.stops) ? JSON.stringify(body.stops.filter(Boolean)) : undefined,
            difficulty: body.difficulty,
            rideType: body.rideType,
            expectedTime: body.expectedTime,
        };

        // Visibility: switching to private creates a code (keeps an existing one); public removes it
        if (body.visibility === 'private' && (row.visibility !== 'private' || !row.accessCode)) {
            columns.visibility = 'private';
            columns.accessCode = generateAccessCode();
        } else if (body.visibility === 'public' && row.visibility !== 'public') {
            columns.visibility = 'public';
            columns.accessCode = null;
        }

        // Coordinates: use the client's (e.g. "Use my location"), otherwise re-geocode when the place changed
        const toGeocode = {};
        const ends = [
            ['start', 'startLocation', 'startLat', 'startLng'],
            ['finish', 'finishLocation', 'endLat', 'endLng'],
        ];
        for (const [key, placeField, latField, lngField] of ends) {
            const lat = toNumberOrNull(body[latField]);
            const lng = toNumberOrNull(body[lngField]);
            const place = body[placeField] !== undefined ? String(body[placeField]).trim() : row[placeField];
            if (body[placeField] !== undefined) columns[placeField] = place;
            if (lat !== null && lng !== null) {
                columns[latField] = lat;
                columns[lngField] = lng;
                continue;
            }
            const placeChanged = body[placeField] !== undefined && place !== row[placeField];
            const clearedByClient = body[latField] === null; // client dropped its coordinates
            if (placeChanged || clearedByClient || (row[latField] === null && place)) {
                if (placeChanged || clearedByClient) {
                    columns[latField] = null;
                    columns[lngField] = null;
                }
                if (place) toGeocode[key] = place;
            }
        }

        const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
        if (!entries.length) return res.status(400).json({ message: "Nothing to update", type: "error" });

        await query(
            `UPDATE rides SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
            [...entries.map(([, v]) => v), row.id]
        );
        if (toGeocode.start || toGeocode.finish) geocodeRideLater(row.id, toGeocode);

        const others = parseJSONList(row.usersId).map(Number);
        await notify(others, {
            senderId: req.user.id,
            senderName: req.user.username,
            subject: 'Ride updated',
            description: `"${body.title || row.title}" was updated by the organizer. Check the latest details.`,
            rideId: row.id,
        });

        const visibility = columns.visibility || (row.visibility === 'private' ? 'private' : 'public');
        const accessCode = columns.accessCode !== undefined ? columns.accessCode : row.accessCode;
        res.status(200).json({
            message: "Ride updated successfully",
            type: "success",
            visibility,
            ...(visibility === 'private' ? { accessCode } : {}),
        });
    } catch (err) {
        console.error('[rides/update]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// 5. DELETE RIDE (only the creator)
exports.deleteRide = async (req, res) => {
    try {
        const row = await getRideRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (row.creator_id !== req.user.id) return res.status(403).json({ message: "Only the organizer can delete this ride", type: "error" });

        await query('DELETE FROM rides WHERE id = ?', [row.id]);
        await query('DELETE FROM ride_comments WHERE rideId = ?', [row.id]);
        await query('DELETE FROM ride_ratings WHERE rideId = ?', [row.id]);
        await query('UPDATE user SET rides = GREATEST(COALESCE(rides, 0) - 1, 0) WHERE id = ?', [req.user.id]);

        await notify(parseJSONList(row.usersId).map(Number), {
            senderId: req.user.id,
            senderName: req.user.username,
            subject: 'Ride cancelled',
            description: `"${row.title}" on ${row.date || 'TBA'} was cancelled by the organizer.`,
        });

        res.status(200).json({ message: "Ride deleted", type: "success" });
    } catch (err) {
        console.error('[rides/delete]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// 6. JOIN RIDE (requires login)
exports.joinRide = async (req, res) => {
    const { rideId } = req.body || {};
    const userId = String(req.user.id);
    if (!rideId) return res.status(400).json({ message: "Missing rideId", type: "error" });

    try {
        const row = await getRideRow(rideId);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });

        const participants = parseJSONList(row.usersId).map(String);
        if (participants.includes(userId)) {
            return res.status(400).json({ message: "You have already joined this ride", type: "error" });
        }
        if (row.date && row.date < new Date().toISOString().slice(0, 10)) {
            return res.status(400).json({ message: "This ride has already taken place", type: "error" });
        }

        // Private ride: the organizer's access code is required
        if (row.visibility === 'private' && String(row.creator_id) !== userId) {
            const rideKey = `${userId}:${row.id}`;
            const userKey = `${userId}:*`;
            if (failureCount(rideKey) >= 5 || failureCount(userKey) >= 20) {
                return res.status(429).json({ message: "Too many wrong codes. Please try again in 15 minutes.", type: "error", code: "TOO_MANY_ATTEMPTS" });
            }
            const code = (req.body || {}).code;
            if (!normaliseCode(code)) {
                return res.status(403).json({ message: "This is a private ride. Enter the access code from the organizer to join.", type: "error", code: "CODE_REQUIRED" });
            }
            if (!row.accessCode || !codesMatch(code, row.accessCode)) {
                addFailure(rideKey);
                addFailure(userKey);
                const left = Math.max(0, 5 - failureCount(rideKey));
                return res.status(403).json({
                    message: left ? `Wrong access code. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.` : "Wrong access code. Please try again in 15 minutes.",
                    type: "error",
                    code: "WRONG_CODE",
                });
            }
            codeFailures.delete(rideKey);
        }

        participants.push(userId);
        await query('UPDATE rides SET usersId = ? WHERE id = ?', [JSON.stringify(participants), row.id]);

        await notify(row.creator_id, {
            senderId: req.user.id,
            senderName: req.user.username,
            subject: 'New rider joined',
            description: `${req.user.username} joined your ride "${row.title}".`,
            rideId: row.id,
        });

        res.status(200).json({ message: "Joined successfully", type: "success", participants });
    } catch (err) {
        console.error('[rides/join]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// 7. LEAVE RIDE (requires login; the organizer cannot leave their own ride)
exports.leaveRide = async (req, res) => {
    const { rideId } = req.body || {};
    const userId = String(req.user.id);
    if (!rideId) return res.status(400).json({ message: "Missing rideId", type: "error" });

    try {
        const row = await getRideRow(rideId);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (String(row.creator_id) === userId) {
            return res.status(400).json({ message: "The organizer cannot leave their own ride. Delete it instead.", type: "error" });
        }

        const participants = parseJSONList(row.usersId).map(String);
        if (!participants.includes(userId)) {
            return res.status(400).json({ message: "You are not part of this ride", type: "error" });
        }

        const updated = participants.filter((u) => u !== userId);
        await query('UPDATE rides SET usersId = ? WHERE id = ?', [JSON.stringify(updated), row.id]);

        await notify(row.creator_id, {
            senderId: req.user.id,
            senderName: req.user.username,
            subject: 'Rider left',
            description: `${req.user.username} left your ride "${row.title}".`,
            rideId: row.id,
        });

        res.status(200).json({ message: "You left the ride", type: "success", participants: updated });
    } catch (err) {
        console.error('[rides/leave]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// 8. MY RIDES (created + joined)
exports.getMyRides = async (req, res) => {
    try {
        const userId = req.user.id;
        const rows = await query(
            'SELECT * FROM rides WHERE creator_id = ? OR usersId LIKE ? ORDER BY date ASC, ride_time ASC',
            [userId, `%"${userId}"%`]
        );
        // Owner and participants always see full details; the owner also gets the access code
        const rides = rows
            .filter((row) => isRideMember(row, userId))
            .map((row) => presentRide(row, userId));

        res.status(200).json({
            created: rides.filter((r) => r.creatorId === userId),
            joined: rides.filter((r) => r.creatorId !== userId),
        });
    } catch (err) {
        console.error('[rides/myRides]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// 9. COMMENTS
exports.getComments = async (req, res) => {
    try {
        const ride = await getRideRow(req.params.id);
        if (ride && ride.visibility === 'private' && !isRideMember(ride, req.user && req.user.id)) {
            return res.status(403).json({ message: "Join this private ride to see the discussion", type: "error", locked: true });
        }
        const rows = await query(
            `SELECT c.id, c.rideId, c.userId, c.text, c.createdAt, u.username, u.fullName, u.image
             FROM ride_comments c LEFT JOIN user u ON u.id = c.userId
             WHERE c.rideId = ? ORDER BY c.createdAt ASC, c.id ASC`,
            [req.params.id]
        );
        res.status(200).json(rows);
    } catch (err) {
        console.error('[rides/comments]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};

exports.addComment = async (req, res) => {
    const text = ((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ message: "Comment is empty", type: "error" });
    if (text.length > 1000) return res.status(400).json({ message: "Comment is too long", type: "error" });

    try {
        const row = await getRideRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (row.visibility === 'private' && !isRideMember(row, req.user.id)) {
            return res.status(403).json({ message: "Join this private ride to take part in the discussion", type: "error", locked: true });
        }

        const result = await query('INSERT INTO ride_comments (rideId, userId, text) VALUES (?, ?, ?)', [row.id, req.user.id, text]);

        const recipients = [row.creator_id, ...parseJSONList(row.usersId).map(Number)];
        await notify(recipients, {
            senderId: req.user.id,
            senderName: req.user.username,
            subject: 'New comment',
            description: `${req.user.username} on "${row.title}": ${text.slice(0, 120)}`,
            rideId: row.id,
        });

        const comment = await queryOne(
            `SELECT c.id, c.rideId, c.userId, c.text, c.createdAt, u.username, u.fullName, u.image
             FROM ride_comments c LEFT JOIN user u ON u.id = c.userId WHERE c.id = ?`,
            [result.insertId]
        );
        res.status(201).json(comment);
    } catch (err) {
        console.error('[rides/addComment]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};

exports.deleteComment = async (req, res) => {
    try {
        const comment = await queryOne(
            'SELECT c.id, c.userId, r.creator_id FROM ride_comments c LEFT JOIN rides r ON r.id = c.rideId WHERE c.id = ?',
            [req.params.commentId]
        );
        if (!comment) return res.status(404).json({ message: "Comment not found", type: "error" });
        if (comment.userId !== req.user.id && comment.creator_id !== req.user.id) {
            return res.status(403).json({ message: "You cannot delete this comment", type: "error" });
        }
        await query('DELETE FROM ride_comments WHERE id = ?', [comment.id]);
        res.status(200).json({ message: "Comment deleted", type: "success" });
    } catch (err) {
        console.error('[rides/deleteComment]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};

// 10. RATE A RIDE (participants only, after the ride date)  { rating: 1-5, review? }
exports.rateRide = async (req, res) => {
    const rating = Number((req.body || {}).rating);
    const review = String((req.body || {}).review || '').trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: "Rating must be 1-5 stars", type: "error" });
    if (review.length > 500) return res.status(400).json({ message: "Review is too long (max 500)", type: "error" });

    try {
        const row = await getRideRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (row.creator_id === req.user.id) return res.status(400).json({ message: "You cannot rate your own ride", type: "error" });
        if (!parseJSONList(row.usersId).map(String).includes(String(req.user.id))) {
            return res.status(403).json({ message: "Only riders who took part can rate this ride", type: "error" });
        }
        if (row.date && row.date > new Date().toISOString().slice(0, 10)) {
            return res.status(400).json({ message: "You can rate the ride after it takes place", type: "error" });
        }

        await query(
            `INSERT INTO ride_ratings (rideId, userId, rating, review) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), createdAt = CURRENT_TIMESTAMP`,
            [row.id, req.user.id, rating, review || null]
        );
        await notify(row.creator_id, {
            senderId: req.user.id,
            senderName: req.user.username,
            subject: 'New rating ⭐',
            description: `${req.user.username} rated "${row.title}" ${rating}/5${review ? ': ' + review.slice(0, 100) : ''}`,
            rideId: row.id,
        });
        res.status(200).json({ message: "Thanks for your rating!", type: "success" });
    } catch (err) {
        console.error('[rides/rate]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};

// 11. NEW ACCESS CODE for a private ride (owner only). Old code stops working; current riders stay.
exports.regenerateCode = async (req, res) => {
    try {
        const row = await getRideRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (row.creator_id !== req.user.id) return res.status(403).json({ message: "Only the organizer can change the code", type: "error" });
        if (row.visibility !== 'private') return res.status(400).json({ message: "This ride is public — no code needed", type: "error" });

        let accessCode = generateAccessCode();
        while (accessCode === row.accessCode) accessCode = generateAccessCode();
        await query('UPDATE rides SET accessCode = ? WHERE id = ?', [accessCode, row.id]);
        res.status(200).json({ message: "New access code created", type: "success", accessCode });
    } catch (err) {
        console.error('[rides/regenerateCode]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};

exports.formatRide = formatRide;
exports.formatRideRaw = formatRideRaw;
exports.presentRide = presentRide;
exports.parseJSONList = parseJSONList;
