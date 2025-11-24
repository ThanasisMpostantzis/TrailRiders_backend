const { pool } = require('../config/databaseCon.js');


// ---------------------------------------------------
// 1. GET ALL RIDES (Για το Home Screen)
// ---------------------------------------------------
exports.getAllRides = (req, res) => {
    const query = "SELECT * FROM rides ORDER BY date ASC";

    pool.query(query, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }

        // Τα πεδία JSON (stops, joinedRiders) ίσως έρθουν ως String από τη βάση.
        // Κάνουμε έναν έλεγχο και τα μετατρέπουμε σε κανονικά Arrays αν χρειαστεί.
        const rides = results.map(ride => ({
            ...ride,
            stops: typeof ride.stops === 'string' ? JSON.parse(ride.stops) : ride.stops,
            joinedRiders: typeof ride.joinedRiders === 'string' ? JSON.parse(ride.joinedRiders) : ride.joinedRiders
        }));

        res.status(200).json(rides);
    });
};

// ---------------------------------------------------
// 2. GET RIDE BY ID (Για όταν πατάς πάνω σε ένα Ride)
// ---------------------------------------------------
exports.getRideById = (req, res) => {
    const { id } = req.params;
    const query = "SELECT * FROM rides WHERE id = ?";

    pool.query(query, [id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: "Ride not found" });

        const ride = results[0];
        
        // Parsing JSON fields
        ride.stops = typeof ride.stops === 'string' ? JSON.parse(ride.stops) : ride.stops;
        ride.joinedRiders = typeof ride.joinedRiders === 'string' ? JSON.parse(ride.joinedRiders) : ride.joinedRiders;

        res.status(200).json(ride);
    });
};

// ---------------------------------------------------
// 3. CREATE RIDE (Δημιουργία νέας διαδρομής)
// ---------------------------------------------------
exports.createRide = (req, res) => {
    const {
        organizer, title, joinedRiders, image, rideDistance,
        startLocation, finishLocation, date, status, category,
        description, stops, difficulty, rideType, expectedTime
    } = req.body;

    // Μετατροπή των Arrays σε JSON Strings για να αποθηκευτούν στη βάση
    // Αν το stops είναι ήδη array, το κάνουμε stringify. Αν δεν υπάρχει, βάζουμε '[]'
    const stopsJSON = stops ? JSON.stringify(stops) : '[]';
    const joinedRidersJSON = '[]'; // Στην αρχή δεν έχει join κανείς (ή βάζεις τον organizer)

    const query = `
        INSERT INTO rides 
        (organizer, title, joinedRiders, image, rideDistance, startLocation, finishLocation, date, status, category, description, stops, difficulty, rideType, expectedTime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        organizer, title, joinedRidersJSON, image, rideDistance, 
        startLocation, finishLocation, date, status, category, description, 
        stopsJSON, difficulty, rideType, expectedTime
    ];

    pool.query(query, values, (err, result) => {
        if (err) {
            console.error("Insert Error:", err);
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: "Ride created successfully", rideId: result.insertId });
    });
};

// ---------------------------------------------------
// 4. JOIN RIDE (Προσθήκη User στο joinedRiders)
// ---------------------------------------------------
exports.joinRide = (req, res) => {
    const { rideId, username } = req.body; // Περιμένουμε το ID και το όνομα χρήστη

    // Βήμα 1: Παίρνουμε το τρέχον array
    const getQuery = "SELECT joinedRiders FROM rides WHERE id = ?";

    pool.query(getQuery, [rideId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: "Ride not found" });

        let currentRiders = results[0].joinedRiders;

        // Parse αν είναι string
        if (typeof currentRiders === 'string') {
            try {
                currentRiders = JSON.parse(currentRiders);
            } catch (e) {
                currentRiders = [];
            }
        }
        // Αν είναι null (σπάνιο αν έχει default), το κάνουμε array
        if (!currentRiders) currentRiders = [];

        // Έλεγχος αν είναι ήδη μέσα
        if (currentRiders.includes(username)) {
            return res.status(400).json({ message: "User already joined" });
        }

        // Προσθήκη χρήστη
        currentRiders.push(username);

        // Βήμα 2: Ενημέρωση της βάσης
        const updateQuery = "UPDATE rides SET joinedRiders = ? WHERE id = ?";
        pool.query(updateQuery, [JSON.stringify(currentRiders), rideId], (updateErr, updateRes) => {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            
            res.status(200).json({ message: "Joined successfully", joinedRiders: currentRiders });
        });
    });
};