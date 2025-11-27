const { pool } = require('../config/databaseCon.js');


// ---------------------------------------------------
// 1. GET ALL RIDES
// ---------------------------------------------------
exports.getAllRides = (req, res) => {
    const query = "SELECT * FROM rides ORDER BY date ASC";

    pool.query(query, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        const rides = results.map(ride => ({
            ...ride,
            stops: typeof ride.stops === 'string' ? JSON.parse(ride.stops) : ride.stops,
            joinedRiders: typeof ride.joinedRiders === 'string' ? JSON.parse(ride.joinedRiders) : ride.joinedRiders
        }));

        res.status(200).json(rides);
    });
};

// ---------------------------------------------------
// 2. GET RIDE BY ID
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
// 3. CREATE RIDE
// ---------------------------------------------------
exports.createRide = (req, res) => {
    const {
        organizer, title, usersId, image, rideDistance,
        startLocation, finishLocation, date, status, category,
        description, stops, difficulty, rideType, expectedTime,
        startLat, startLng, endLat, endLng
    } = req.body;
    const stopsJSON = stops ? JSON.stringify(stops) : '[]';
    const usersIdJSON = usersId || '[]';

    const query = `
        INSERT INTO rides 
        (organizer, title, usersId, image, rideDistance, startLocation, 
        finishLocation, date, status, category, description, stops, 
        difficulty, rideType, expectedTime, startLat, startLng, endLat, endLng)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        organizer, title, usersIdJSON, image, rideDistance, 
        startLocation, finishLocation, date, status, category, description, 
        stopsJSON, difficulty, rideType, expectedTime, startLat, startLng, 
        endLat, endLng
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
    const { rideId } = req.body;
    let userId = String(req.body.userId);

    if (!rideId || !userId) {
        return res.status(400).json({ message: "Missing rideId or userId" });
    }

    const getQuery = "SELECT UsersId FROM rides WHERE id = ?";

    pool.query(getQuery, [rideId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: "Ride not found" });

        let currentUsers = results[0].UsersId;

        if (typeof currentUsers === 'string') {
            try {
                currentUsers = JSON.parse(currentUsers);
            } catch {
                currentUsers = [];
            }
        }

        if (!Array.isArray(currentUsers)) currentUsers = [];

        currentUsers = currentUsers.map(u => String(u));

        if (currentUsers.includes(userId)) {
            return res.status(400).json({ message: "User already joined" });
        }

        currentUsers.push(userId);

        const updateQuery = "UPDATE rides SET UsersId = ? WHERE id = ?";
        pool.query(updateQuery, [JSON.stringify(currentUsers), rideId], (updateErr) => {
            if (updateErr) return res.status(500).json({ error: updateErr.message });

            return res.status(200).json({
                message: "Joined successfully",
                UsersId: currentUsers
            });
        });
    });
};
