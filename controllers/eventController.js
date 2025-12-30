// TBI; OBSOLETE

'use strict';

const { runQuery } = require('../config/databaseCon');


// CREATE EVENT
const createEvent = async (req, res) => {
    const { userId, eventName } = req.body;

    if (!userId || !eventName ) {
        return res.status(400).json({
            message: "Event name and/or user Id",
            status: "Missing info error"
        });
    }
    
    // CHECK FOR DUPLICATE
    let query = `SELECT name, ownerId FROM event WHERE name = '${eventName}' AND ownerId = ${userId}`
    runQuery(query, (result) => {
        if (result) {
            return res.status(400).json({
                message: "Event already exists",
                status: "error"
            });
        } else {
            // CREATE EVENT IF NO DUPLICATES
            query = `INSERT INTO event (name, ownerId) VALUES ('${eventName}', ${userId})`

            runQuery(query, (err) => {
                if (err) return res.status(400).json({
                    message: "An error has occurred. Check log",
                    status: "error"
                });

                return res.status(200).json({
                    message: "Event created successfully",
                    status: "OK"
                });
            });
        }
    });
}


// UPDATE EVENT
const updateEvent = (req, res) => {
    
}


// DELETE EVENT
const deleteEvent = (req, res) => {
    
}

module.exports = {
    createEvent,
    updateEvent,
    deleteEvent
}