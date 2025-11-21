// Add new features below the last one with DATE.

const express = require('express');
const connection = require('../config/databaseCon.js');
const router = express.Router();

router.get('/', (req, res) => {
    res.send("<h1>API documentation tbi</h1>");
})

// Get farmer ID, return farmer stats. Perhaps it's not considered best practice to return the password. Might fix it later idk
router.get('/farmer/:farmerId', async (req, res) => {
    try {
        //const query = `SELECT farmer_id, farmer_firstname, farmer_lastname, afm, username, password, email FROM farmer WHERE farmer_id = ${req.params.farmerId};` blah blah anti-comment-removal-sql-injection-typa-bullshi protection

        const query = `SELECT farmer_firstname, farmer_lastname, username, COUNT(fi.id) as fields, farmer_id FROM field fi, farmer fa WHERE fi.farmer_id = ${req.params.farmerId}`

        // **POTENTIAL Future Update**
        //const query = `SELECT field_id, crop_type, air_temp, air_hum, soil_temp, soil_hum, weather, water_need, curr_watered, farmer_firstname, farmer_lastname, email FROM farmer fa JOIN field fi ON fa.farmer_id = fi.farmer_id WHERE fa.farmer_id = ${req.params.farmerId}`

        connection.query(query, (err, rows, fields) => {
            if (err) {
                throw err;
            }

            res.json(rows);
        });

    } catch (err) {
        console.error(err);
    }
});

// Get field ID, return field stats & owner name
/* Irrigation history = &history
   Condition history  = &conditions
   Sensors            = &sensors
*/
router.get('/field/:fieldId/', async (req, res) => {
    try {
        let query = `SELECT * FROM field fi WHERE fi.id = ${req.params.fieldId}`
        //let queryarray = [1];
        
        // Get field irrigation history
        if (req.query.history == 'true') {
            query = `SELECT day_time, priority_id, status, percentage, cubic_meters, cost FROM irrigationhistory ih WHERE ih.field_id = ${req.params.fieldId}`
        }

        // Get field condition history
        if (req.query.conditions == 'true') {
            query = `SELECT day, average_measurement, condition_id FROM fieldconditionshistory fch WHERE fch.field_id = ${req.params.fieldId}`
        }

        // Get field sensors
        if (req.query.sensors == 'true') {
            query = `SELECT s.id as sensor_id, sensor_type, sensor_data, sensor_status FROM sensor s WHERE s.field_id = ${req.params.fieldId}`
        }

        /*
        // Get field controller
        if (req.query.controller == 'true') {
            query = `SELECT controller_id, controller_name, controller_energy, controller_type, field_id FROM fieldcontroller WHERE field_id = ${req.params.fieldId}`

            //query = query.concat('; ', controllerQuery);
            //queryarray.push(3);
        }
        */

        //console.log(query)
        
        connection.query(query, async (err, rows, fields) => {
            if (err) {
                console.error(err);
            }

            /*
            let fieldTable = rows[0];
            let historyTable;
            let controllerTable;

            if (req.query.history == 'true' && req.query.controller == 'true') {
                fieldTable = rows[0][0];
                historyTable = rows[1][0];
                controllerTable = rows[2][0];
            } else if (req.query.history == 'true' && req.query.controller == undefined) {
                fieldTable = rows[0][0];
                historyTable = rows[1][0];
            } else if (req.query.history == undefined && req.query.controller == 'true') {
                fieldTable = rows[0][0];
                controllerTable = rows[1][0];
            }

            console.log(fieldTable);
            console.log(historyTable);
            console.log(controllerTable);

            data = `{ "field": [ { "field_id": "${fieldTable.field_id}", "field_size": "${fieldTable.field_size}", "field_plant": "${fieldTable.field_plant}", "farmer_id": "${fieldTable.farmer_id}", "farmer_firstname": "${fieldTable.farmer_firstname}", "farmer_lastname": "${fieldTable.farmer_lastname}", "username": "${fieldTable.username}" }]`

            if (req.query.history == 'true') {
                data = data.concat(`, "irrigation_history": [{ "irr_id": "${historyTable.irr_id}", "day": "${historyTable.day}", "interference": "${historyTable.interference}", "cubic_meters": "${historyTable.cubic_meters}", "cost": "${historyTable.cost}", "farmer_firstname": "${historyTable.farmer_firstname}", "farmer_lastname": "${historyTable.farmer_lastname}", "usermame": "${historyTable.username}" }]`);
            }

            if (req.query.controller == 'true') {
                data = data.concat(`, "controller": [{ "controller_id": "${controllerTable.controller_id}", "controller_name": "${controllerTable.controller_name}", "controller_energy": "${controllerTable.controller_energy}", "controller_type": "${controllerTable.controller_type}"}] }`);
            } else {
                data = data + '}'
            }
            
            res.json(JSON.parse(data));
            */
           res.json(rows);
           //console.log(fields);
        });

    } catch (err) {
        console.error(err);
    }
});

router.get('/sensors/:fieldId', async (req, res) => { // no that's NOT a mistake
    try {
        const query = `SELECT * FROM sensor s WHERE s.field_id = ${req.params.fieldId}`
        
        connection.query(query, (err, rows, result) => {
            if (err) {
                console.error(err);
            }

            res.json(rows);
        });
        
    } catch (err) {
        throw err;
    }
});

module.exports = router;