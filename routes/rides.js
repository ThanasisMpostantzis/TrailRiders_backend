const express = require('express');
const router = express.Router();
const { getAllRides, getRideById, createRide, joinRide } = require('../controllers/ridesController');

// Routes
router.get('/getAllRides', getAllRides);
router.get('/get/:id', getRideById);
router.post('/createRide', createRide);
router.post('/joinRide', joinRide);

module.exports = router;