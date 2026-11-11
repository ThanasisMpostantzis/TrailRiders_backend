const express = require('express');
const router = express.Router();
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const {
    getAllRides, getRideById, createRide, updateRide, deleteRide, joinRide, leaveRide, getMyRides,
    getComments, addComment, deleteComment, rateRide
} = require('../controllers/ridesController');

// Routes
router.get('/getAllRides', getAllRides);
router.get('/myRides', authenticateUserToken, getMyRides);
router.get('/get/:id', getRideById);
router.post('/createRide', authenticateUserToken, createRide);
router.put('/update/:id', authenticateUserToken, updateRide);
router.delete('/delete/:id', authenticateUserToken, deleteRide);
router.post('/joinRide', authenticateUserToken, joinRide);
router.post('/leaveRide', authenticateUserToken, leaveRide);
router.get('/:id/comments', getComments);
router.post('/:id/comments', authenticateUserToken, addComment);
router.delete('/comments/:commentId', authenticateUserToken, deleteComment);
router.post('/:id/rate', authenticateUserToken, rateRide);

module.exports = router;
