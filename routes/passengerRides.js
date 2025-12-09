const express = require('express');
const router = express.Router();
const { getAllPRides, getPRideById, createPRide, joinPRide, selectPassenger } = require('../controllers/passengerRidesController');

// Routes
router.post('/getAllPRides', getAllPRides);
router.post('/getPRide/:id', getPRideById);
router.post('/createPRide', createPRide);
router.post('/joinPRide', joinPRide);
router.post('/selectPassenger', selectPassenger);

module.exports = router;