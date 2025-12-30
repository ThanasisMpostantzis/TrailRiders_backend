const { runQuery, pool } = require('../config/databaseCon.js');


// 1. GET ALL RIDES
exports.getAllRides = (req, res) => {
    const query = "SELECT * FROM rides ORDER BY date ASC";

    runQuery(query, (result) => {
        /* Useless
        const rides = [result].map(ride => ({
            ...ride,
            stops: typeof ride.stops === 'string' ? JSON.parse(ride.stops) : ride.stops,
            joinedRiders: typeof ride.joinedRiders === 'string' ? JSON.parse(ride.joinedRiders) : ride.joinedRiders
        }));
        */

        if (result) res.status(200).json(result);
        else res.status(404).json({
            message: "No rides found in database",
            type: "error"
        });
    });
};

// 2. GET RIDE BY ID
exports.getRideById = (req, res) => {
    const { id } = req.params;
    const query = `SELECT * FROM rides WHERE id = ${id}`;

    runQuery(query, (result) => {
        /*
        if (result.length === 0) return res.status(404).json({ message: "Ride not found" });

        const ride = result[0];
        
        // Parsing JSON fields
        ride.stops = typeof ride.stops === 'string' ? JSON.parse(ride.stops) : ride.stops;
        ride.joinedRiders = typeof ride.joinedRiders === 'string' ? JSON.parse(ride.joinedRiders) : ride.joinedRiders;
        */

        if (result) res.status(200).json(result);
        else res.status(404).json({
            message: "Ride not found",
            type: "error"
        });
    });
};

// 3. CREATE RIDE
exports.createRide = (req, res) => {
    const {
        creatorId,
        organizer,
        title,
        image,
        rideDistance,
        startLocation,
        finishLocation,
        date,
        ride_time,
        // status, -> Το βγάζουμε από εδώ, θα το βάλουμε manually ΛΟΓΙΚΑ
        category,
        description,
        stops,
        difficulty,
        rideType,
        expectedTime,
        startLat, 
        startLng,
        endLat,
        endLng,
    } = req.body;

    const checkQuery = `SELECT creator_id, title FROM rides WHERE creator_id = ${creatorId} AND title = "${title}"`
    runQuery(checkQuery, (result) => {
        if (result) {
            return res.status(400).json({
                message: "Ride with the same title already exists under creator's name",
                type: "error"
            });
        } else {
            // Μετατροπή Stops σε JSON
            const stopsJSON = stops ? JSON.stringify(stops) : '[]';

            // Δημιουργία της λίστας συμμετεχόντων (ο Creator μπαίνει πρώτος)
            const usersIdJSON = JSON.stringify([creatorId]);

            // Default Status
            const rideStatus = 'upcoming';

            const query = `
                INSERT INTO rides 
                (
                    creator_id,
                    organizer,
                    title,
                    image,
                    rideDistance,
                    startLocation,
                    finishLocation,
                    date,
                    ride_time,
                    status,
                    category,
                    description,
                    stops,
                    difficulty,
                    rideType,
                    expectedTime,
                    startLat,
                    startLng,
                    endLat,
                    endLng,
                    usersId
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
                creatorId,
                organizer, 
                title, 
                image, 
                rideDistance, 
                startLocation, 
                finishLocation, 
                date, 
                ride_time, 
                rideStatus,
                category, 
                description, 
                stopsJSON, 
                difficulty, 
                rideType, 
                expectedTime, 
                startLat, 
                startLng, 
                endLat, 
                endLng,
                usersIdJSON
            ]

            pool.query(query, values, (err, result) => {
                if (err) {
                    console.error("Insert Error:", err);
                    return res.status(500).json({ error: err.message });
                }
                return res.status(200).json({ message: "Ride created successfully", rideId: result.insertId });
            });
        }
    });
};

// 4. JOIN RIDE (Προσθήκη User στο joinedRiders)
exports.joinRide = (req, res) => {
    const { rideId, userId } = req.body;

    if (!rideId || !userId) {
        return res.status(400).json({ message: "Missing rideId or userId" });
    }

    const query = `SELECT id, usersId FROM rides WHERE rides.id = ${rideId}`;

    runQuery(query, (result) => {
        if (!result) return res.status(404).json({ message: "Ride not found" });

        let currentUsers = result.usersId;

        if (typeof currentUsers === 'string') {
            try {
                currentUsers = JSON.parse(currentUsers);
            } catch {
                currentUsers = [];
            }
        }

        currentUsers = Array.isArray(currentUsers) ? currentUsers : [];

        //currentUsers = currentUsers.map(u => String(u));

        if (currentUsers.includes(userId)) {
            return res.status(400).json({ message: "User already joined" });
        }

        currentUsers.push(userId);

        const updateQuery = `UPDATE rides SET UsersId = "${JSON.stringify(currentUsers)}" WHERE id = ${rideId}`;
        runQuery(updateQuery, (result) => {
            return res.status(200).json({
                message: "Joined successfully",
                usersId: currentUsers
            });
        });
    });
};
