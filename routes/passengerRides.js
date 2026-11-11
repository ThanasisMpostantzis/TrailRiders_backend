const express = require('express');
const router = express.Router();
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const {
    getAllPRides, getPRideById, createPRide, updatePRide, deletePRide,
    joinPRide, cancelRequest, selectPassenger, getMyPRides
} = require('../controllers/passengerRidesController');

// Routes (POST variants of the getters are kept for backwards compatibility)
router.get('/getAllPRides', getAllPRides);
router.post('/getAllPRides', getAllPRides);
router.get('/my', authenticateUserToken, getMyPRides);
router.get('/getPRide/:id', getPRideById);
router.post('/getPRide/:id', getPRideById);
router.post('/createPRide', authenticateUserToken, createPRide);
router.put('/update/:id', authenticateUserToken, updatePRide);
router.delete('/delete/:id', authenticateUserToken, deletePRide);
router.post('/joinPRide', authenticateUserToken, joinPRide);
router.post('/cancelRequest', authenticateUserToken, cancelRequest);
router.post('/selectPassenger', authenticateUserToken, selectPassenger);

module.exports = router;
