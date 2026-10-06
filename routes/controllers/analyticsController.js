const Complaint = require('../models/Complaint');
const Department = require('../models/Department');
const User = require('../models/User');

// @desc    Get dashboard counts & basic summaries
// @route   GET /api/analytics/dashboard
// @access  Private (Admin)
const getDashboardStats = async (req, res) => {
    try {
        const totalComplaints = await Complaint.countDocuments();
        const pendingComplaints = await Complaint.countDocuments({ status: { $in: ['Pending', 'Routed'] } });
        const activeComplaints = await Complaint.countDocuments({ status: 'In Progress' });
        const resolvedComplaints = await Complaint.countDocuments({ status: 'Resolved' });
        const rejectedComplaints = await Complaint.countDocuments({ status: 'Rejected' });

        const totalUsers = await User.countDocuments({ role: 'citizen' });
        const totalDepts = await Department.countDocuments();

        // Get category counts
        const categoryGroup = await Complaint.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]);

        const recentComplaints = await Complaint.find()
            .populate('citizen', 'name')
            .populate('department', 'name')
            .sort({ createdAt: -1 })
            .limit(5);

        res.json({
            summary: {
                totalComplaints,
                pendingComplaints,
                activeComplaints,
                resolvedComplaints,
                rejectedComplaints,
                totalUsers,
                totalDepts
            },
            categories: categoryGroup,
            recentComplaints
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get department-wise complaint statistics
// @route   GET /api/analytics/departments
// @access  Private (Admin)
const getDepartmentStats = async (req, res) => {
    try {
        const stats = await Complaint.aggregate([
            {
                $group: {
                    _id: '$department',
                    total: { $sum: 1 },
                    resolved: {
                        $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] }
                    },
                    pending: {
                        $sum: { $cond: [{ $in: ['$status', ['Pending', 'Routed', 'Assigned', 'In Progress']] }, 1, 0] }
                    }
                }
            }
        ]);

        // Populate department names manually since aggregate doesn't run Mongoose populate easily
        const populatedStats = await Promise.all(
            stats.map(async (item) => {
                let name = 'Unassigned';
                if (item._id) {
                    const dept = await Department.findById(item._id);
                    if (dept) name = dept.name;
                }
                return {
                    departmentId: item._id,
                    name,
                    total: item.total,
                    resolved: item.resolved,
                    pending: item.pending,
                    resolutionRate: item.total > 0 ? Math.round((item.resolved / item.total) * 100) : 0
                };
            })
        );

        res.json(populatedStats);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get coordinates for priority heatmaps
// @route   GET /api/analytics/heatmap
// @access  Private
const getHeatmapData = async (req, res) => {
    try {
        const complaints = await Complaint.find(
            { status: { $ne: 'Rejected' } },
            'latitude longitude severity category status supportCount'
        );

        // Map severity to index values for maps UI processing
        const severityMap = {
            'Low': 1,
            'Medium': 2,
            'High': 3,
            'Critical': 5
        };

        const heatmap = complaints.map(c => {
            const severityWeight = severityMap[c.severity] || 2;
            // Support count increases weight contextually
            const weight = severityWeight + Math.min(c.supportCount - 1, 5);
            return {
                id: c._id,
                latitude: c.latitude,
                longitude: c.longitude,
                category: c.category,
                severity: c.severity,
                status: c.status,
                weight: weight
            };
        });

        res.json(heatmap);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get high-priority and critical complaints
// @route   GET /api/analytics/priority-alerts
// @access  Private (Admin)
const getPriorityAlerts = async (req, res) => {
    try {
        const alerts = await Complaint.find({
            severity: { $in: ['High', 'Critical'] },
            status: { $ne: 'Resolved' }
        })
            .populate('citizen', 'name phone')
            .populate('department', 'name')
            .sort({ supportCount: -1, createdAt: -1 })
            .limit(10);

        res.json(alerts);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getDashboardStats,
    getDepartmentStats,
    getHeatmapData,
    getPriorityAlerts
};
