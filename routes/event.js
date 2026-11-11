const express = require('express');
const router = express.Router();
const authenticateUserToken = require('../middlewares/userAuthToken.js');

const { listEvents, getEvent, createEvent, updateEvent, deleteEvent, rsvpEvent, myEvents } = require('../controllers/eventController');

router.get('/', listEvents);
router.get('/my', authenticateUserToken, myEvents);
router.post('/create', authenticateUserToken, createEvent);
router.get('/:id', getEvent);
router.put('/:id', authenticateUserToken, updateEvent);
router.delete('/:id', authenticateUserToken, deleteEvent);
router.post('/:id/rsvp', authenticateUserToken, rsvpEvent);

module.exports = router;
