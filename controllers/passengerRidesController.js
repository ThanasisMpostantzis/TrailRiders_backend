const { runQuery } = require('../config/databaseCon.js');


// GET ALL RIDES
exports.getAllPRides = (req, res) => {
    const query = "SELECT * FROM passengerRide ORDER BY date ASC";

    runQuery(query, (result) => {
        /*
        const rides = [results].map(ride => ({
            ...ride,
            stops: typeof ride.stops === 'string' ? JSON.parse(ride.stops) : ride.stops,
            joinedRiders: typeof ride.joinedRiders === 'string' ? JSON.parse(ride.joinedRiders) : ride.joinedRiders
        }));
        */

        res.status(200).json(result);
    });
};


// GET RIDE BY ID
exports.getPRideById = (req, res) => {
    const { id } = req.params;
    const query = `SELECT * FROM passengerRide WHERE id = ${id}`;

    runQuery(query, (result) => {
        if (!result) return res.status(404).json({ message: "Ride not found", type: "error" });
        
        /*
        // Parsing JSON fields
        ride.stops = typeof ride.stops === 'string' ? JSON.parse(ride.stops) : ride.stops;
        ride.joinedRiders = typeof ride.joinedRiders === 'string' ? JSON.parse(ride.joinedRiders) : ride.joinedRiders;
        */

        res.status(200).json(result);
    });
};


// CREATE RIDE
exports.createPRide = (req, res) => {
    const {
        creatorId,
        date,
        description,
        difficulty,
        startLocation,
        finishLocation,
        startLat,
        startLng,
        endLat,
        endLng,
        rideDistance,
        rideType,
        rideTime,
        stops,
        title,
        organizer,
    } = req.body;

    const checkQuery = `SELECT creatorId, title FROM passengerride WHERE creatorId = ${creatorId} AND title = "${title}"`
    runQuery(checkQuery, (result) => {
        if (result) {
            return res.status(400).json({
                message: "Passenger ride with the same title already exists under creator's name",
                type: "error"
            });
        } else {
            const stopsJSON = stops ? JSON.stringify(stops) : '[]';

            const requestsJSON = JSON.stringify([creatorId]);

            const rideStatus = 'upcoming';

            let query = `
                INSERT INTO passengerride
                (
                    creatorId,
                    date,
                    description,
                    difficulty,
                    startLocation,
                    finishLocation,
                    startLat,
                    startLng,
                    endLat,
                    endLng,
                    rideDistance,
                    rideType,
                    rideTime,
                    stops,
                    title,
                    organizer,
                    status,
                    requests
                ) VALUES (
                ${creatorId},
                '${date}',
                '${description}',
                '${difficulty}',
                '${startLocation}',
                '${finishLocation}',
                '${startLat}',
                '${startLng}',
                '${endLat}',
                '${endLng}',
                '${rideDistance}',
                '${rideType}',
                '${rideTime}',
                '${stopsJSON}',
                '${title}',
                '${organizer}',
                '${rideStatus}',
                '${requestsJSON}'
                )`;

            runQuery(query, (result) => {
                res.status(200).json({ message: "Ride created successfully", status: "200 OK" });
            });
        }
    });
}


// JOIN RIDE
exports.joinPRide = (req, res) => {
    const { rideId, userId } = req.body;

    if (!rideId || !userId) {
        return res.status(400).json({ message: "Missing rideId or userId" });
    }

    let query = `SELECT id, requests FROM passengerride WHERE id = ${rideId}`;

    runQuery(query, (result) => {
        if (!result) return res.status(404).json({ message: "Ride not found" });
        let requests = result.requests ? result.requests : [];

        if (typeof requests === 'string') {
            try {
                requests = JSON.parse(requests);
            } catch {
                requests = []
            }
        }

        requests = Array.isArray(requests) ? JSON.parse(requests) : [];
        console.log(requests)

        //requests = requests.map(u => String(u));

        if (userId in requests) {
            return res.status(400).json({ message: "User already joined" });
        }

        requests.push(userId);

        let query = `UPDATE passengerRide SET requests = "${JSON.stringify(requests)}" WHERE passengerRide.id = ${rideId}`;
        runQuery(query, (result) => {
            return res.status(200).json({
                message: "Joined successfully",
                requests: requests
            });
        });
    });
};


// OWNER SELECTS PASSENGER
exports.selectPassenger = (req, res) => {
    const { userId } = req.body;
    let query = `SELECT selectedPassenger FROM passenger_ride`

    runQuery(query, (result) => {
        if (result != undefined || null) {
            return res.status(400).json({
                message: "Ride owner has already selected user",
                status: "400 Bad Request"
            });
        } else {
            query = `INSERT INTO passenger_ride (selectedPassenger) VALUES (${JSON.stringify(userId)})` // FETCH SELECTED USER INFO FROM FRONTEND

            runQuery(query, (result) => {
                return res.status(200).json({
                    message: "User inserted successfully",
                    status: "200 OK"
                });
            })
        }
    })   
}
