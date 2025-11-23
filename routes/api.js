const express = require('express');
const connection = require('../config/databaseCon.js');
const router = express.Router();

router.get('/', (req, res) => {
    res.send("<h1>API documentation tbi</h1>");
})

// Get user ID, return user stats
router.get('/user/:userId', async (req, res) => {
    try {
        const query = `SELECT id, username FROM user u WHERE u.id = ${req.params.farmerId}`

        connection.query(query, (err, rows) => {
            if (err) {
                throw err;
            }

            res.json(rows);
        });

    } catch (err) {
        console.error(err);
    }
});

// Get event ID, return event info
router.get('/event/:eventId/', async (req, res) => {
    try {
        let query = `SELECT * FROM event e WHERE e.id = ${req.params.fieldId}`
        
        connection.query(query, async (err, rows, fields) => {
            if (err) {
                console.error(err);
            }

           res.json(rows);
        });

    } catch (err) {
        console.error(err);
    }
});

module.exports = router;