'use strict';

// COMPANY (SPONSORED) EVENTS
// Partner companies get a token (see scripts/createCompanyToken.js) and post events with it.
// They appear in the app with a "Sponsored" badge. The token payload must contain { companyName }.

const { query, queryOne } = require('../config/databaseCon');
const { insertEvent, validateEvent } = require('./eventController');

const create = async (req, res) => {
    const body = req.body || {};
    const error = validateEvent(body, false);
    if (error) return res.status(400).json({ message: error, type: "error" });

    try {
        const companyName = (req.company && req.company.companyName) || body.companyName || 'Partner';
        const id = await insertEvent(body, { ownerId: null, isCompany: true, companyName });
        return res.status(201).json({ message: "Company event created", type: "success", eventId: id });
    } catch (err) {
        console.error('[companyEvents/create]', err);
        return res.status(500).json({ message: "Server error", type: "error" });
    }
};

// DELETE a company's own event
const remove = async (req, res) => {
    try {
        const companyName = req.company && req.company.companyName;
        const row = await queryOne('SELECT id, companyName FROM event WHERE id = ? AND isCompany = 1', [req.params.id]);
        if (!row) return res.status(404).json({ message: "Event not found", type: "error" });
        if (row.companyName !== companyName) return res.status(403).json({ message: "This event belongs to another company", type: "error" });
        await query('DELETE FROM event WHERE id = ?', [row.id]);
        return res.status(200).json({ message: "Company event deleted", type: "success" });
    } catch (err) {
        console.error('[companyEvents/delete]', err);
        return res.status(500).json({ message: "Server error", type: "error" });
    }
};

module.exports = { create, remove };
