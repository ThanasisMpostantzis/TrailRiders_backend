const express = require('express');
const { runQuery } = require('../config/databaseCon.js');
const router = express.Router();

router.get('/', (req, res) => {
    res.send("<h1>API works</h1>");
});

// --- GET USER PROFILE ---
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        console.log(`[API] Searching for User ID: ${userId}`);

        const query = `SELECT * FROM user WHERE id = ${userId}`;

        runQuery(query, (result) => {
            if (result) {
                // Αν γυρίσει array ή object το φτιάχνουμε
                //const finalResult = Array.isArray(result) ? result : [result];
                console.log("[API] User Found!");
                res.status(200).json(result);
            } else {
                console.log("[API] DB returned nothing/null");
                res.status(404).json({ message: "User not found" });
            }
        });

    } catch (err) {
        console.error("[API] Error:", err);
        res.status(500).send("Server Error");
    }
});


// --- UPDATE PROFILE ---
router.post('/user/updateProfile', async (req, res) => {
    try {
        const { id, fullName, bike, location, bio, tags, image, cover } = req.body;
        console.log(`[API] Updating profile for ID: ${id}`);

        // Μετατροπή tags array σε string αν χρειάζεται αλλιώς JSON
        const tagsString = Array.isArray(tags) ? tags.join(',') : tags;

        // Χρησιμοποιούμε '?' ή checkaroume an ta pedia einai null gia na mhn skasei
        const query = `
            UPDATE user 
            SET 
                fullName = '${fullName || ""}', 
                bike = '${bike || ""}',
                location = '${location || ""}',
                bio = '${bio || ""}',
                tags = '${tagsString || ""}',
                image = '${image || ""}',
                cover = '${cover || ""}'
            WHERE id = ${id}
        `;
        
        runQuery(query, (result) => {
             console.log("[API] Update Success");
             res.json({ type: "success", user: req.body });
        });

    } catch (err) {
        console.error("[API] Update Error:", err);
        res.status(500).json({ type: "error", message: "Update failed" });
    }
});

module.exports = router;