const express = require('express');
const router = express.Router();
const {
    reportComplaint,
    getAllComplaints,
    getComplaintById,
    updateComplaintStatus,
    upvoteComplaint
} = require('../controllers/complaintController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.route('/')
    .post(protect, upload.single('image'), reportComplaint)
    .get(protect, getAllComplaints);

router.route('/:id')
    .get(protect, getComplaintById);

router.route('/:id/status')
    .put(protect, adminOnly, updateComplaintStatus);

router.route('/:id/upvote')
    .post(protect, upvoteComplaint);

module.exports = router;
