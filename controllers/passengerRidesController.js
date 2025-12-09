const { runQuery } = require('../config/databaseCon.js');


// GET ALL RIDES
exports.getAllPRides = (req, res) => {
    const query = "SELECT * FROM passengerRide ORDER BY date ASC";

    runQuery(query, (results) => {
        const rides = results.map(ride => ({
            ...ride,
            stops: typeof ride.stops === 'string' ? JSON.parse(ride.stops) : ride.stops,
            joinedRiders: typeof ride.joinedRiders === 'string' ? JSON.parse(ride.joinedRiders) : ride.joinedRiders
        }));

        res.status(200).json(rides);
    });
};


// GET RIDE BY ID
exports.getPRideById = (req, res) => {
    const { id } = req.params;
    const query = `SELECT * FROM passengerRide WHERE id = ${id}`;

    runQuery(query, (results) => {
        if (results.length === 0) return res.status(404).json({ message: "Ride not found" });

        const ride = results[0];
        
        // Parsing JSON fields
        ride.stops = typeof ride.stops === 'string' ? JSON.parse(ride.stops) : ride.stops;
        ride.joinedRiders = typeof ride.joinedRiders === 'string' ? JSON.parse(ride.joinedRiders) : ride.joinedRiders;

        res.status(200).json(ride);
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

    const stopsJSON = stops ? JSON.stringify(stops) : '[]';

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
            status
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
        '${rideStatus}'
        )
    `;

    runQuery(query, (result) => {
        res.status(200).json({ message: "Ride created successfully", status: "200 OK" });
    });
};


// JOIN RIDE
// METHOD: Create array (line 123), push JSON Objects into it, place back into database
exports.joinPRide = (req, res) => {
    const { rideId, userId } = req.body;

    if (!rideId || !userId) {
        return res.status(400).json({ message: "Missing rideId or userId" });
    }

    let query = `SELECT pr.id, u.id, requests FROM passengerride pr, user u WHERE pr.id = ${rideId} AND u.id = ${userId}`;

    runQuery(query, (result) => {
        if (!result) return res.status(404).json({ message: "Ride not found" });
        console.log(result[0]);

        let requests = result.length === 0 ? [] : result[0].requests;

        if (typeof requests === 'string') {
            try {
                requests = JSON.parse(requests);
            } catch {
                requests = []
            }
        }

        requests = Array.isArray(requests) ? requests : []

        requests = requests.map(u => String(u));

        if (userId in requests) {
            return res.status(400).json({ message: "User already joined" });
        }

        let userObj = {
            userId: userId,
            fullname: result.fullName
        }

        requests.push(userObj);
        console.log(requests)

        let query = `UPDATE passengerRide SET requests = ${JSON.stringify(requests)} WHERE passengerRide.id = ${rideId}`;
        runQuery(query, (result) => {
            return res.status(200).json({
                message: "Joined successfully",
                userData: userObj
            });
        });
    });
};


// OWNER SELECTS PASSENGER
exports.selectPassenger = (req, res) => {
    let query = `SELECT selectedPassenger FROM passenger_ride`

    runQuery(query, (result) => {
        if (result != undefined) {
            return res.status(400).json({
                message: "Ride owner has already selected user",
                status: "400 Bad Request"
            });
        } else {
            query = `INSERT INTO passenger_ride (selectedPassenger) VALUES (${JSON.stringify(req.body)})` // FETCH SELECTED USER INFO FROM FRONTEND

            runQuery(query, (result) => {
                console.log(result);
                return res.status(200).json({
                    message: "User inserted successfully",
                    status: "200 OK"
                });
            })
        }
    })

    
}
