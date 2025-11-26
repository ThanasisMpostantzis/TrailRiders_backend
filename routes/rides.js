const express = require('express');
const router = express.Router();
const ridesController = require('../controllers/ridesController'); // Το αρχείο που φτιάξαμε πάνω

// Routes
router.get('/getAllRides', ridesController.getAllRides);
router.get('/get/:id', ridesController.getRideById);
router.post('/createRide', ridesController.createRide);
router.post('/joinRide/:id', ridesController.joinRide);

module.exports = router;