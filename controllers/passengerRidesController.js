'use strict';

// PASSENGER RIDES ("ride sharing"): a rider/driver offers free seats on a trip,
// other users request a seat and the owner accepts the passengers they want.
//  - requests:          JSON list of user ids that asked for a seat
//  - selectedPassenger: JSON list of user ids the owner accepted (max = seats)

const { query, queryOne } = require('../config/databaseCon.js');
const { notify } = require('../utils/notify');
const { checkHostingLimit, notifyFollowers } = require('../utils/social');
const { idList, toNumberOrNull, todayISO, isISODate, isTime, validateFields, USER_CARD_FIELDS } = require('../utils/helpers');

const RULES = {
    title: { max: 100, required: true, label: 'Title' },
    startLocation: { max: 100, required: true, label: 'Start' },
    finishLocation: { max: 100, required: true, label: 'Destination' },
    difficulty: { max: 100 },
    rideType: { max: 50 },
};

const formatPRide = (row) => {
    const requests = idList(row.requests);
    const selected = idList(row.selectedPassenger);
    const date = row.date ? String(row.date).slice(0, 10) : null;
    return {
        id: row.id,
        creatorId: row.creatorId,
        organizer: row.organizer,
        title: row.title,
        description: row.description || '',
        difficulty: row.difficulty,
        rideType: row.rideType,
        startLocation: row.startLocation,
        finishLocation: row.finishLocation,
        startLat: row.startLat,
        startLng: row.startLng,
        endLat: row.endLat,
        endLng: row.endLng,
        rideDistance: row.rideDistance,
        rideTime: row.rideTime,
        stops: idList(row.stops),
        image: row.image || null,
        status: row.status,
        date,
        seats: Number(row.seats) || 1,
        requests,
        selected,
        seatsLeft: Math.max((Number(row.seats) || 1) - selected.length, 0),
    };
};

const getRow = (id) => queryOne('SELECT * FROM passengerride WHERE id = ?', [id]);

function validate(body, partial) {
    const err = validateFields(body, RULES, partial);
    if (err) return err;
    if ((!partial || body.date !== undefined) && !isISODate(body.date)) return 'Date is required (YYYY-MM-DD)';
    if (body.rideTime && !isTime(body.rideTime)) return 'Time must be HH:MM';
    if (body.seats !== undefined && !(Number(body.seats) >= 1 && Number(body.seats) <= 8)) return 'Seats must be between 1 and 8';
    return null;
}


// GET ALL (?upcoming=1, ?search=)
exports.getAllPRides = async (req, res) => {
    try {
        const where = [];
        const params = [];
        const { upcoming, search } = req.query;
        if (upcoming === '1' || upcoming === 'true') where.push('(date IS NULL OR DATE(date) >= CURDATE())');
        if (search) {
            where.push('(title LIKE ? OR startLocation LIKE ? OR finishLocation LIKE ? OR organizer LIKE ?)');
            const like = `%${search}%`;
            params.push(like, like, like, like);
        }
        const rows = await query(
            `SELECT * FROM passengerride ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date ASC, rideTime ASC`,
            params
        );
        res.status(200).json(rows.map(formatPRide));
    } catch (err) {
        console.error('[pRides/getAll]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// GET BY ID (with creator, requesters and accepted passengers)
exports.getPRideById = async (req, res) => {
    try {
        const row = await getRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });

        const ride = formatPRide(row);
        const ids = [...new Set([row.creatorId, ...ride.requests.map(Number)])].filter(Boolean);
        const users = ids.length ? await query(`SELECT ${USER_CARD_FIELDS} FROM user WHERE id IN (?)`, [ids]) : [];
        const byId = (id) => users.find((u) => u.id === Number(id));

        ride.creator = byId(row.creatorId) || null;
        ride.requestsInfo = ride.requests.map(byId).filter(Boolean)
            .map((u) => ({ ...u, accepted: ride.selected.includes(String(u.id)) }));

        res.status(200).json(ride);
    } catch (err) {
        console.error('[pRides/get]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// CREATE (requires login)
exports.createPRide = async (req, res) => {
    const body = req.body || {};
    const error = validate(body, false);
    if (error) return res.status(400).json({ message: error, type: "error" });

    try {
        const limit = await checkHostingLimit(req.user.id);
        if (limit) return res.status(403).json(limit);

        const dup = await queryOne(
            'SELECT id FROM passengerride WHERE creatorId = ? AND title = ? AND DATE(date) = ?',
            [req.user.id, body.title.trim(), body.date]
        );
        if (dup) return res.status(400).json({ message: "You already offered a ride with the same title on that date", type: "error" });

        const result = await query(
            `INSERT INTO passengerride
            (creatorId, date, description, difficulty, startLocation, finishLocation, startLat, startLng, endLat, endLng,
             rideDistance, rideType, rideTime, stops, title, organizer, image, status, requests, selectedPassenger, seats)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', '[]', '[]', ?)`,
            [
                req.user.id,
                body.date,
                (body.description || '').trim(),
                body.difficulty || 'Medium',
                body.startLocation.trim(),
                body.finishLocation.trim(),
                toNumberOrNull(body.startLat),
                toNumberOrNull(body.startLng),
                toNumberOrNull(body.endLat),
                toNumberOrNull(body.endLng),
                toNumberOrNull(body.rideDistance),
                body.rideType || 'Motorcycle',
                body.rideTime || null,
                JSON.stringify(Array.isArray(body.stops) ? body.stops.filter(Boolean) : []),
                body.title.trim(),
                req.user.username,
                body.image || null,
                Number(body.seats) || 1,
            ]
        );
        await notifyFollowers(req.user, {
            subject: 'Free seat offered',
            description: `${req.user.username} offers a seat: ${body.startLocation.trim()} → ${body.finishLocation.trim()} on ${body.date}.`,
            link: `/passengerRide/${result.insertId}`,
        });
        res.status(201).json({ message: "Ride offer created", type: "success", rideId: result.insertId });
    } catch (err) {
        console.error('[pRides/create]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// UPDATE (owner)
exports.updatePRide = async (req, res) => {
    const body = req.body || {};
    const error = validate(body, true);
    if (error) return res.status(400).json({ message: error, type: "error" });

    try {
        const row = await getRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (row.creatorId !== req.user.id) return res.status(403).json({ message: "Only the owner can edit this ride", type: "error" });

        const selected = idList(row.selectedPassenger);
        if (body.seats !== undefined && Number(body.seats) < selected.length) {
            return res.status(400).json({ message: `You already accepted ${selected.length} passenger(s)`, type: "error" });
        }

        const columns = {
            title: body.title, date: body.date, rideTime: body.rideTime, description: body.description,
            difficulty: body.difficulty, rideType: body.rideType, startLocation: body.startLocation,
            finishLocation: body.finishLocation, image: body.image,
            rideDistance: body.rideDistance !== undefined ? toNumberOrNull(body.rideDistance) : undefined,
            stops: Array.isArray(body.stops) ? JSON.stringify(body.stops.filter(Boolean)) : undefined,
            seats: body.seats !== undefined ? Number(body.seats) : undefined,
        };
        const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
        if (!entries.length) return res.status(400).json({ message: "Nothing to update", type: "error" });

        await query(`UPDATE passengerride SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
            [...entries.map(([, v]) => v), row.id]);

        await notify(idList(row.requests).map(Number), {
            senderId: req.user.id, senderName: req.user.username,
            subject: 'Ride share updated',
            description: `"${body.title || row.title}" was updated by the driver.`,
            link: `/passengerRide/${row.id}`,
        });
        res.status(200).json({ message: "Ride updated", type: "success" });
    } catch (err) {
        console.error('[pRides/update]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// DELETE (owner)
exports.deletePRide = async (req, res) => {
    try {
        const row = await getRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (row.creatorId !== req.user.id) return res.status(403).json({ message: "Only the owner can delete this ride", type: "error" });

        await query('DELETE FROM passengerride WHERE id = ?', [row.id]);
        await notify(idList(row.requests).map(Number), {
            senderId: req.user.id, senderName: req.user.username,
            subject: 'Ride share cancelled',
            description: `"${row.title}" was cancelled by the driver.`,
        });
        res.status(200).json({ message: "Ride deleted", type: "success" });
    } catch (err) {
        console.error('[pRides/delete]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// REQUEST A SEAT (requires login)
exports.joinPRide = async (req, res) => {
    const { rideId } = req.body || {};
    const userId = String(req.user.id);
    if (!rideId) return res.status(400).json({ message: "Missing rideId", type: "error" });

    try {
        const row = await getRow(rideId);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (String(row.creatorId) === userId) return res.status(400).json({ message: "This is your own ride", type: "error" });
        if (row.date && String(row.date).slice(0, 10) < todayISO()) return res.status(400).json({ message: "This ride has already taken place", type: "error" });

        const requests = idList(row.requests);
        if (requests.includes(userId)) return res.status(400).json({ message: "You already requested a seat", type: "error" });

        requests.push(userId);
        await query('UPDATE passengerride SET requests = ? WHERE id = ?', [JSON.stringify(requests), row.id]);

        await notify(row.creatorId, {
            senderId: req.user.id, senderName: req.user.username,
            subject: 'Seat request',
            description: `${req.user.username} asked for a seat on "${row.title}". Open the ride to accept.`,
            link: `/passengerRide/${row.id}`,
        });
        res.status(200).json({ message: "Seat requested", type: "success", requests });
    } catch (err) {
        console.error('[pRides/join]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// WITHDRAW REQUEST (requires login)
exports.cancelRequest = async (req, res) => {
    const { rideId } = req.body || {};
    const userId = String(req.user.id);
    try {
        const row = await getRow(rideId);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });

        const requests = idList(row.requests);
        if (!requests.includes(userId)) return res.status(400).json({ message: "You have not requested a seat", type: "error" });
        const wasAccepted = idList(row.selectedPassenger).includes(userId);

        await query('UPDATE passengerride SET requests = ?, selectedPassenger = ? WHERE id = ?', [
            JSON.stringify(requests.filter((u) => u !== userId)),
            JSON.stringify(idList(row.selectedPassenger).filter((u) => u !== userId)),
            row.id,
        ]);

        await notify(row.creatorId, {
            senderId: req.user.id, senderName: req.user.username,
            subject: wasAccepted ? 'Passenger cancelled' : 'Seat request withdrawn',
            description: `${req.user.username} withdrew from "${row.title}".`,
            link: `/passengerRide/${row.id}`,
        });
        res.status(200).json({ message: "Request withdrawn", type: "success" });
    } catch (err) {
        console.error('[pRides/cancel]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// OWNER ACCEPTS / REMOVES A PASSENGER  { rideId, userId, accept = true }
exports.selectPassenger = async (req, res) => {
    const { rideId, userId, accept = true } = req.body || {};
    if (!rideId || !userId) return res.status(400).json({ message: "Missing rideId or userId", type: "error" });

    try {
        const row = await getRow(rideId);
        if (!row) return res.status(404).json({ message: "Ride not found", type: "error" });
        if (row.creatorId !== req.user.id) return res.status(403).json({ message: "Only the owner can choose passengers", type: "error" });

        const requests = idList(row.requests);
        let selected = idList(row.selectedPassenger);
        const uid = String(userId);

        if (!requests.includes(uid)) return res.status(400).json({ message: "This user has not requested a seat", type: "error" });

        if (accept) {
            if (selected.includes(uid)) return res.status(400).json({ message: "Passenger already accepted", type: "error" });
            if (selected.length >= (Number(row.seats) || 1)) return res.status(400).json({ message: "No seats left", type: "error" });
            selected.push(uid);
        } else {
            selected = selected.filter((u) => u !== uid);
        }

        await query('UPDATE passengerride SET selectedPassenger = ? WHERE id = ?', [JSON.stringify(selected), row.id]);

        await notify(Number(uid), {
            senderId: req.user.id, senderName: req.user.username,
            subject: accept ? 'Seat confirmed 🎉' : 'Seat no longer available',
            description: accept
                ? `${req.user.username} accepted you as a passenger on "${row.title}" (${String(row.date).slice(0, 10)}).`
                : `${req.user.username} removed you from "${row.title}".`,
            link: `/passengerRide/${row.id}`,
        });
        res.status(200).json({ message: accept ? "Passenger accepted" : "Passenger removed", type: "success", selected });
    } catch (err) {
        console.error('[pRides/select]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// MY RIDE SHARES (offered + requested)
exports.getMyPRides = async (req, res) => {
    try {
        const uid = req.user.id;
        const rows = await query(
            'SELECT * FROM passengerride WHERE creatorId = ? OR requests LIKE ? ORDER BY date ASC',
            [uid, `%"${uid}"%`]
        );
        const rides = rows.map(formatPRide);
        res.status(200).json({
            offered: rides.filter((r) => r.creatorId === uid),
            requested: rides.filter((r) => r.creatorId !== uid && r.requests.includes(String(uid))),
        });
    } catch (err) {
        console.error('[pRides/my]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};
