const express = require('express');
const router = express.Router();
const {
    registerUser,
    loginUser,
    getUserProfile,
    updateUserProfile,
    getUserNotifications,
    markNotificationRead
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.route('/profile')
    .get(protect, getUserProfile)
    .put(protect, updateUserProfile);

router.route('/notifications')
    .get(protect, getUserNotifications);

router.route('/notifications/:id/read')
    .put(protect, markNotificationRead);

module.exports = router;
