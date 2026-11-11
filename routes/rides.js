const express = require('express');
const router = express.Router();
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const optionalAuth = require('../middlewares/optionalAuth.js');
const {
    getAllRides, getRideById, createRide, updateRide, deleteRide, joinRide, leaveRide, getMyRides,
    getComments, addComment, deleteComment, rateRide, regenerateCode
} = require('../controllers/ridesController');

// Routes
router.get('/getAllRides', optionalAuth, getAllRides);
router.get('/myRides', authenticateUserToken, getMyRides);
router.get('/get/:id', optionalAuth, getRideById);          // private rides are redacted for non-members
router.post('/createRide', authenticateUserToken, createRide);
router.put('/update/:id', authenticateUserToken, updateRide);
router.delete('/delete/:id', authenticateUserToken, deleteRide);
router.post('/joinRide', authenticateUserToken, joinRide);           // { rideId, code? } code required for private rides
router.post('/leaveRide', authenticateUserToken, leaveRide);
router.get('/:id/comments', optionalAuth, getComments);
router.post('/:id/comments', authenticateUserToken, addComment);
router.delete('/comments/:commentId', authenticateUserToken, deleteComment);
router.post('/:id/rate', authenticateUserToken, rateRide);
router.post('/:id/regenerateCode', authenticateUserToken, regenerateCode); // owner: new access code

module.exports = router;
