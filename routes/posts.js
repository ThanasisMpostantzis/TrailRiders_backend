'use strict';

// FEED: social posts (photos + text), likes and comments.

const express = require('express');
const router = express.Router();

const authenticateUserToken = require('../middlewares/userAuthToken.js');
const optionalAuth = require('../middlewares/optionalAuth.js');
const { rateLimit } = require('../utils/rateLimit');
const posts = require('../controllers/postsController');

const postLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'You are posting too often. Please try again later.' });
const commentLimit = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'You are commenting too fast.' });

// Public (extra info for logged-in users)
router.get('/', optionalAuth, posts.listPosts);
router.get('/user/:userId', optionalAuth, posts.userPosts);

// Comments by id (declared before /:id routes)
router.delete('/comments/:commentId', authenticateUserToken, posts.deleteComment);

router.get('/:id', optionalAuth, posts.getPost);
router.get('/:id/comments', optionalAuth, posts.getComments);

router.post('/', authenticateUserToken, postLimit, posts.createPost);
router.delete('/:id', authenticateUserToken, posts.deletePost);

router.post('/:id/like', authenticateUserToken, posts.likePost);
router.delete('/:id/like', authenticateUserToken, posts.unlikePost);

router.post('/:id/comments', authenticateUserToken, commentLimit, posts.addComment);

module.exports = router;
