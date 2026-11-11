'use strict';

const { query, queryOne } = require('../config/databaseCon.js');
const { notify } = require('../utils/notify');

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

// Shapes a DB row into what the app expects
const formatRide = (row) => {
    const participants = parseJSONList(row.usersId).map(String);
    const { usersId, ...rest } = row;
    return {
        ...rest,
        creatorId: row.creator_id,
        rideTime: row.ride_time,
        stops: parseJSONList(row.stops),
        participants,
        participantsCount: participants.length,
    };
};

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

        const sql = `SELECT * FROM rides ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date ASC, ride_time ASC`;
        const rows = await query(sql, params);
        res.status(200).json(rows.map(formatRide));
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

        const ride = formatRide(row);
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
        ride.ratings = ratings;
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
        const creatorId = req.user.id;
        const result = await query(
            `INSERT INTO rides
            (creator_id, organizer, title, image, rideDistance, startLocation, finishLocation, date, ride_time, status,
             category, description, stops, difficulty, rideType, expectedTime, startLat, startLng, endLat, endLng, usersId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                toNumberOrNull(body.startLat),
                toNumberOrNull(body.startLng),
                toNumberOrNull(body.endLat),
                toNumberOrNull(body.endLng),
                JSON.stringify([String(creatorId)]),
            ]
        );
        await query('UPDATE user SET rides = COALESCE(rides, 0) + 1 WHERE id = ?', [creatorId]);

        res.status(201).json({ message: "Ride created successfully", type: "success", rideId: result.insertId });
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
        const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
        if (!entries.length) return res.status(400).json({ message: "Nothing to update", type: "error" });

        await query(
            `UPDATE rides SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
            [...entries.map(([, v]) => v), row.id]
        );

        const others = parseJSONList(row.usersId).map(Number);
        await notify(others, {
            senderId: req.user.id,
            senderName: req.user.username,
            subject: 'Ride updated',
            description: `"${body.title || row.title}" was updated by the organizer. Check the latest details.`,
            rideId: row.id,
        });

        res.status(200).json({ message: "Ride updated successfully", type: "success" });
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
        const rides = rows.map(formatRide).filter((r) => r.creatorId === userId || r.participants.includes(String(userId)));

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

exports.formatRide = formatRide;
exports.parseJSONList = parseJSONList;
