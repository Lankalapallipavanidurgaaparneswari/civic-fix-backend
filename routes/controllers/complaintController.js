const fs = require('fs');
const path = require('path');
const Complaint = require('../models/Complaint');
const Department = require('../models/Department');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const { uploadToCloudinary } = require('../config/cloudinary');
const { analyzeComplaintImage, generateEmbedding } = require('../services/geminiService');
const { findDuplicateComplaint, findDepartmentForComplaint, retrieveSlaAndRights, upsertVector } = require('../services/pineconeService');

// Helper to clean up local temp files safely
const deleteTempFile = (filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (err) {
            console.error('Failed to delete temp file:', err);
        }
    }
};

// @desc    Report new citizen complaint
// @route   POST /api/complaints
// @access  Private (Citizen)
const reportComplaint = async (req, res) => {
    let localFilePath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Complaint image is required' });
        }

        localFilePath = req.file.path;
        const { description, latitude, longitude } = req.body;

        if (!description || !latitude || !longitude) {
            deleteTempFile(localFilePath);
            return res.status(400).json({ message: 'Description, latitude, and longitude are required' });
        }

        const latNum = parseFloat(latitude);
        const lngNum = parseFloat(longitude);

        console.log('1. Uploading image to Cloudinary (or mock)...');
        const uploadResult = await uploadToCloudinary(localFilePath);

        console.log('2. Subjecting complaint to Gemini vision analysis...');
        const aiAnalysis = await analyzeComplaintImage(localFilePath, description, req.file.mimetype);
        const { category, severity, aiSummary, confidence } = aiAnalysis;

        console.log('3. Generating embeddings for the complaint text...');
        const complaintText = `${category} - ${description}`;
        const embedding = await generateEmbedding(complaintText);

        console.log('4. Performing duplicate detection check...');
        const duplicate = await findDuplicateComplaint(embedding, latNum, lngNum, category);

        if (duplicate) {
            console.log(`Duplicate found! Upvoting existing complaint ID: ${duplicate.id}`);

            const existingComplaint = await Complaint.findById(duplicate.id);
            if (existingComplaint) {
                existingComplaint.supportCount += 1;
                existingComplaint.updatedAt = Date.now();
                await existingComplaint.save();

                // Notify reporting user of deduplication upvote
                await Notification.create({
                    user: req.user._id,
                    title: 'Duplicate Complaint Linked',
                    message: `A similar complaint in your area has already been reported. We have added your support upvote to Complaint #${existingComplaint._id.toString().substring(18)}.`,
                    type: 'status_updated'
                });

                // Clean up uploaded image if it was local temp storage
                // (If cloudinary ran, it uploaded but we suppress duplicate file entries in MongoDB)
                deleteTempFile(localFilePath);

                return res.status(200).json({
                    duplicate: true,
                    message: 'A similar complaint exists at this location. Your support has been added to it.',
                    complaint: existingComplaint
                });
            }
        }

        console.log('5. Executing SLA RAG lookup...');
        const ragResult = await retrieveSlaAndRights(embedding);

        // Parse Expected Resolution days. (e.g. "5 Business Days" -> 5)
        let daysNum = 7;
        const matchDays = ragResult.expectedResolutionTime.match(/\d+/);
        if (matchDays) daysNum = parseInt(matchDays[0]);
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() + daysNum);

        console.log('6. Executing department routing calculation...');
        let routedDept = null;
        const deptMatch = await findDepartmentForComplaint(embedding);

        if (deptMatch && deptMatch.departmentId) {
            routedDept = await Department.findById(deptMatch.departmentId);
        }

        if (!routedDept) {
            // Fallback 1: match by category
            routedDept = await Department.findOne({ name: { $regex: new RegExp(category, 'i') } });
        }

        if (!routedDept) {
            // Fallback 2: first department
            routedDept = await Department.findOne();
        }

        console.log(`Reported complaint category: ${category}. Routed to Department: ${routedDept ? routedDept.name : 'Unassigned'}`);

        console.log('7. Creating complaint in database...');
        const complaint = await Complaint.create({
            citizen: req.user._id,
            imageUrl: uploadResult.secure_url,
            description,
            aiSummary: aiSummary || description,
            category,
            severity,
            aiConfidence: confidence,
            department: routedDept ? routedDept._id : null,
            latitude: latNum,
            longitude: lngNum,
            status: routedDept ? 'Routed' : 'Pending',
            sla: {
                rule: ragResult.slaRule,
                expectedResolutionTime: ragResult.expectedResolutionTime,
                resolutionDate: expectedDate
            }
        });

        console.log('8. Indexing new complaint vector in Pinecone...');
        const vectorMetadata = {
            complaintId: complaint._id.toString(),
            description: description,
            category: category,
            latitude: latNum.toString(),
            longitude: lngNum.toString(),
            type: 'complaint'
        };
        await upsertVector(complaint._id.toString(), embedding, vectorMetadata);

        console.log('9. Creating notifications...');
        await Notification.create({
            user: req.user._id,
            title: 'Complaint Registered Successfully',
            message: `Your complaint for "${category}" has been categorized and routed. Expected Resolution: ${ragResult.expectedResolutionTime}.`,
            type: 'complaint_created'
        });

        // Cleanup local temp file
        deleteTempFile(localFilePath);

        // Return full complaint
        res.status(201).json(complaint);

    } catch (error) {
        console.error('Complaint reporting error:', error);
        deleteTempFile(localFilePath);
        res.status(500).json({ message: 'Error processing complaint report: ' + error.message });
    }
};

// @desc    Get all complaints with pagination, filtering, search
// @route   GET /api/complaints
// @access  Private
const getAllComplaints = async (req, res) => {
    try {
        const { page = 1, limit = 10, search, category, severity, status, department, sort } = req.query;

        const query = {};

        // For non-admin, filter by citizen ID unless requested otherwise
        if (req.user.role !== 'admin') {
            query.citizen = req.user._id;
        }

        if (category) query.category = category;
        if (severity) query.severity = severity;
        if (status) query.status = status;
        if (department) query.department = department;

        if (search) {
            query.$or = [
                { description: { $regex: search, $options: 'i' } },
                { aiSummary: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } }
            ];
        }

        // Sort order definition
        let sortObj = { createdAt: -1 };
        if (sort === 'oldest') sortObj = { createdAt: 1 };
        else if (sort === 'severity') sortObj = { severity: -1 }; // note: enum order
        else if (sort === 'upvotes') sortObj = { supportCount: -1 };

        const count = await Complaint.countDocuments(query);
        const complaints = await Complaint.find(query)
            .populate('citizen', 'name email phone')
            .populate('department', 'name head description')
            .sort(sortObj)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        res.json({
            complaints,
            page: parseInt(page),
            pages: Math.ceil(count / parseInt(limit)),
            total: count
        });
    } catch (error) {
        console.error('Get all complaints error:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get single complaint
// @route   GET /api/complaints/:id
// @access  Private
const getComplaintById = async (req, res) => {
    try {
        const complaint = await Complaint.findById(req.params.id)
            .populate('citizen', 'name email phone')
            .populate('department', 'name head description');

        if (!complaint) {
            return res.status(404).json({ message: 'Complaint not found' });
        }

        // Citizen can only access their own. Admin can access all.
        if (req.user.role !== 'admin' && complaint.citizen._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to view this complaint' });
        }

        res.json(complaint);
    } catch (error) {
        console.error('Get complaint by ID error:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update complaint status
// @route   PUT /api/complaints/:id/status
// @access  Private (Admin)
const updateComplaintStatus = async (req, res) => {
    try {
        const { status, remarks } = req.body;

        if (!status) {
            return res.status(400).json({ message: 'Status is required' });
        }

        const complaint = await Complaint.findById(req.params.id);
        if (!complaint) {
            return res.status(404).json({ message: 'Complaint not found' });
        }

        const oldStatus = complaint.status;
        complaint.status = status;
        complaint.updatedAt = Date.now();
        await complaint.save();

        // Create notifications for citizen
        await Notification.create({
            user: complaint.citizen,
            title: 'Complaint Status Updated',
            message: `Your complaint for "${complaint.category}" has been updated from "${oldStatus}" to "${status}".${remarks ? ` Note: ${remarks}` : ''}`,
            type: 'status_updated'
        });

        // Logging action
        await ActivityLog.create({
            user: req.user._id,
            action: 'UPDATE_COMPLAINT_STATUS',
            targetId: complaint._id,
            details: `Status changed from ${oldStatus} to ${status}. Remarks: ${remarks || 'None'}`
        });

        res.json(complaint);
    } catch (error) {
        console.error('Update complaint status error:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Upvote/support a complaint
// @route   POST /api/complaints/:id/upvote
// @access  Private
const upvoteComplaint = async (req, res) => {
    try {
        const complaint = await Complaint.findById(req.params.id);
        if (!complaint) {
            return res.status(404).json({ message: 'Complaint not found' });
        }

        complaint.supportCount += 1;
        await complaint.save();

        res.json({ message: 'Upvoted successfully', supportCount: complaint.supportCount });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    reportComplaint,
    getAllComplaints,
    getComplaintById,
    updateComplaintStatus,
    upvoteComplaint
};
