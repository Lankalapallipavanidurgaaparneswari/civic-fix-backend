const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getDepartmentStats,
    getHeatmapData,
    getPriorityAlerts
} = require('../controllers/analyticsController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.get('/dashboard', protect, adminOnly, getDashboardStats);
router.get('/departments', protect, adminOnly, getDepartmentStats);
router.get('/heatmap', protect, getHeatmapData);
router.get('/priority-alerts', protect, adminOnly, getPriorityAlerts);

module.exports = router;
