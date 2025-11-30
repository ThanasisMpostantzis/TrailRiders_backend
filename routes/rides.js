const express = require('express');
const router = express.Router();
const ridesController = require('../controllers/ridesController');

// Routes
router.get('/getAllRides', ridesController.getAllRides);
router.get('/get/:id', ridesController.getRideById);
router.post('/createRide', ridesController.createRide);
router.post('/joinRide', ridesController.joinRide);

module.exports = router;