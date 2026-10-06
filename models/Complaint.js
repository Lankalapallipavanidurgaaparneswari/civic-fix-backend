const mongoose = require('mongoose');

const ComplaintSchema = new mongoose.Schema({
    citizen: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    imageUrl: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    aiSummary: {
        type: String,
    },
    category: {
        type: String,
    },
    severity: {
        type: String,
        enum: ['Low', 'Medium', 'High', 'Critical'],
        default: 'Medium',
    },
    aiConfidence: {
        type: Number,
        default: 0,
    },
    department: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department',
    },
    latitude: {
        type: Number,
        required: true,
    },
    longitude: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['Pending', 'Routed', 'Assigned', 'In Progress', 'Resolved', 'Rejected'],
        default: 'Pending',
    },
    sla: {
        rule: String,
        expectedResolutionTime: String,
        resolutionDate: Date,
    },
    duplicateReference: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Complaint',
        default: null,
    },
    supportCount: {
        type: Number,
        default: 1,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('Complaint', ComplaintSchema);
