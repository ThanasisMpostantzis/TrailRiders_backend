'use strict';

// EVENTS: meetups, shows, track days... Users create events and others RSVP ("attend").
// Company (sponsored) events are created through /companyEvents with a company token.

const { query, queryOne } = require('../config/databaseCon');
const { notify } = require('../utils/notify');
const { idList, isISODate, isTime, todayISO, validateFields, USER_CARD_FIELDS } = require('../utils/helpers');

const RULES = {
    name: { max: 150, required: true, label: 'Name' },
    location: { max: 150, required: true, label: 'Location' },
    category: { max: 50 },
};

const formatEvent = (row) => {
    const attendees = idList(row.attendees);
    return {
        id: row.id,
        name: row.name,
        ownerId: row.ownerId,
        description: row.description || '',
        eventDate: row.eventDate ? String(row.eventDate).slice(0, 10) : null,
        eventTime: row.eventTime,
        location: row.location,
        category: row.category,
        image: row.image || null,
        maxAttendees: row.maxAttendees,
        isCompany: !!row.isCompany,
        companyName: row.companyName,
        attendees,
        attendeesCount: attendees.length,
        createdAt: row.createdAt,
    };
};

function validate(body, partial) {
    const err = validateFields(body, RULES, partial);
    if (err) return err;
    if ((!partial || body.eventDate !== undefined) && !isISODate(body.eventDate)) return 'Date is required (YYYY-MM-DD)';
    if (body.eventTime && !isTime(body.eventTime)) return 'Time must be HH:MM';
    if (body.maxAttendees !== undefined && body.maxAttendees !== null && body.maxAttendees !== '' && !(Number(body.maxAttendees) >= 1)) {
        return 'Max attendees must be a positive number';
    }
    return null;
}

const getRow = (id) => queryOne('SELECT * FROM event WHERE id = ?', [id]);

/** Shared insert used by user events and company events */
async function insertEvent(body, { ownerId = null, isCompany = false, companyName = null } = {}) {
    const result = await query(
        `INSERT INTO event (name, ownerId, description, eventDate, eventTime, location, category, image, attendees, maxAttendees, isCompany, companyName)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            body.name.trim(),
            ownerId,
            (body.description || '').trim(),
            body.eventDate,
            body.eventTime || null,
            body.location.trim(),
            body.category || 'Meetup',
            body.image || null,
            JSON.stringify(ownerId ? [String(ownerId)] : []),
            body.maxAttendees ? Number(body.maxAttendees) : null,
            isCompany ? 1 : 0,
            companyName,
        ]
    );
    return result.insertId;
}


// LIST (?upcoming=1, ?search=, ?category=)
const listEvents = async (req, res) => {
    try {
        const where = [];
        const params = [];
        const { upcoming, search, category } = req.query;
        if (upcoming === '1' || upcoming === 'true') where.push('(eventDate IS NULL OR eventDate >= CURDATE())');
        if (category) { where.push('category = ?'); params.push(category); }
        if (search) {
            where.push('(name LIKE ? OR location LIKE ? OR companyName LIKE ?)');
            const like = `%${search}%`;
            params.push(like, like, like);
        }
        const rows = await query(
            `SELECT * FROM event ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY isCompany DESC, eventDate ASC, eventTime ASC`,
            params
        );
        res.status(200).json(rows.map(formatEvent));
    } catch (err) {
        console.error('[event/list]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// GET ONE (with organizer & attendees)
const getEvent = async (req, res) => {
    try {
        const row = await getRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Event not found", type: "error" });

        const ev = formatEvent(row);
        const ids = [...new Set([row.ownerId, ...ev.attendees.map(Number)])].filter(Boolean);
        const users = ids.length ? await query(`SELECT ${USER_CARD_FIELDS} FROM user WHERE id IN (?)`, [ids]) : [];
        ev.owner = users.find((u) => u.id === row.ownerId) || null;
        ev.attendeesInfo = ev.attendees.map((id) => users.find((u) => u.id === Number(id))).filter(Boolean);
        res.status(200).json(ev);
    } catch (err) {
        console.error('[event/get]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// CREATE (requires login)
const createEvent = async (req, res) => {
    const body = req.body || {};
    // Backwards compatibility with the first version that sent { eventName }
    if (!body.name && body.eventName) body.name = body.eventName;

    const error = validate(body, false);
    if (error) return res.status(400).json({ message: error, type: "error" });

    try {
        const dup = await queryOne('SELECT id FROM event WHERE name = ? AND ownerId = ? AND eventDate = ?', [body.name.trim(), req.user.id, body.eventDate]);
        if (dup) return res.status(400).json({ message: "Event already exists", type: "error" });

        const id = await insertEvent(body, { ownerId: req.user.id });
        res.status(201).json({ message: "Event created successfully", type: "success", eventId: id });
    } catch (err) {
        console.error('[event/create]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// UPDATE (owner)
const updateEvent = async (req, res) => {
    const body = req.body || {};
    const error = validate(body, true);
    if (error) return res.status(400).json({ message: error, type: "error" });

    try {
        const row = await getRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Event not found", type: "error" });
        if (row.ownerId !== req.user.id) return res.status(403).json({ message: "Only the organizer can edit this event", type: "error" });

        const columns = {
            name: body.name, description: body.description, eventDate: body.eventDate, eventTime: body.eventTime,
            location: body.location, category: body.category, image: body.image,
            maxAttendees: body.maxAttendees !== undefined ? (body.maxAttendees ? Number(body.maxAttendees) : null) : undefined,
        };
        const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
        if (!entries.length) return res.status(400).json({ message: "Nothing to update", type: "error" });

        await query(`UPDATE event SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, [...entries.map(([, v]) => v), row.id]);
        await notify(idList(row.attendees).map(Number), {
            senderId: req.user.id, senderName: req.user.username,
            subject: 'Event updated',
            description: `"${body.name || row.name}" was updated. Check the latest details.`,
            link: `/event/${row.id}`,
        });
        res.status(200).json({ message: "Event updated", type: "success" });
    } catch (err) {
        console.error('[event/update]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// DELETE (owner)
const deleteEvent = async (req, res) => {
    try {
        const row = await getRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Event not found", type: "error" });
        if (row.ownerId !== req.user.id) return res.status(403).json({ message: "Only the organizer can delete this event", type: "error" });

        await query('DELETE FROM event WHERE id = ?', [row.id]);
        await notify(idList(row.attendees).map(Number), {
            senderId: req.user.id, senderName: req.user.username,
            subject: 'Event cancelled',
            description: `"${row.name}" on ${String(row.eventDate || '').slice(0, 10) || 'TBA'} was cancelled.`,
        });
        res.status(200).json({ message: "Event deleted", type: "success" });
    } catch (err) {
        console.error('[event/delete]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// RSVP toggle (requires login) { attend: true|false }
const rsvpEvent = async (req, res) => {
    const attend = (req.body || {}).attend !== false;
    const uid = String(req.user.id);
    try {
        const row = await getRow(req.params.id);
        if (!row) return res.status(404).json({ message: "Event not found", type: "error" });

        let attendees = idList(row.attendees);
        if (attend) {
            if (attendees.includes(uid)) return res.status(400).json({ message: "You are already attending", type: "error" });
            if (row.eventDate && String(row.eventDate).slice(0, 10) < todayISO()) return res.status(400).json({ message: "This event is over", type: "error" });
            if (row.maxAttendees && attendees.length >= row.maxAttendees) return res.status(400).json({ message: "This event is full", type: "error" });
            attendees.push(uid);
        } else {
            if (String(row.ownerId) === uid) return res.status(400).json({ message: "The organizer cannot leave their own event", type: "error" });
            attendees = attendees.filter((a) => a !== uid);
        }

        await query('UPDATE event SET attendees = ? WHERE id = ?', [JSON.stringify(attendees), row.id]);
        if (row.ownerId) {
            await notify(row.ownerId, {
                senderId: req.user.id, senderName: req.user.username,
                subject: attend ? 'New attendee' : 'Attendee left',
                description: `${req.user.username} ${attend ? 'is going to' : 'is no longer going to'} "${row.name}".`,
                link: `/event/${row.id}`,
            });
        }
        res.status(200).json({ message: attend ? "You're going!" : "RSVP removed", type: "success", attendees });
    } catch (err) {
        console.error('[event/rsvp]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};


// MY EVENTS (organizing + attending)
const myEvents = async (req, res) => {
    try {
        const uid = req.user.id;
        const rows = await query('SELECT * FROM event WHERE ownerId = ? OR attendees LIKE ? ORDER BY eventDate ASC', [uid, `%"${uid}"%`]);
        const events = rows.map(formatEvent);
        res.status(200).json({
            organizing: events.filter((e) => e.ownerId === uid),
            attending: events.filter((e) => e.ownerId !== uid && e.attendees.includes(String(uid))),
        });
    } catch (err) {
        console.error('[event/my]', err);
        res.status(500).json({ message: "Server error", type: "error" });
    }
};

module.exports = {
    listEvents,
    getEvent,
    createEvent,
    updateEvent,
    deleteEvent,
    rsvpEvent,
    myEvents,
    insertEvent,
    validateEvent: validate,
};
