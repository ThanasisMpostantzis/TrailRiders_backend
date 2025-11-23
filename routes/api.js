const express = require('express');
const { runQuery } = require('../config/databaseCon.js');
const router = express.Router();

router.get('/', (req, res) => {
    res.send("<h1>API documentation tbi</h1>");
})

// Get user ID, return user stats
router.get('/user/:userId', async (req, res) => {
    try {
        const query = `SELECT id, username FROM user u WHERE u.id = ${req.params.userId}`

        runQuery(query, (result) => {
            if (result) res.json(result);
            else res.status(404).json({
                message: "User not found",
                status: "user not found"
            });
        });

    } catch (err) {
        console.error(err);
    }
});

// Get event ID, return event info
router.get('/event/:eventId/', async (req, res) => {
    try {
        let query = `SELECT * FROM event e WHERE e.id = ${req.params.eventId}`
        
        runQuery(query, (result) => {
            if (result) res.json(result);
            else res.status(404).json({
                message: "Event not found",
                status: "event not found"
            });
        });

    } catch (err) {
        console.error(err);
    }
});

module.exports = router;