const Department = require('../models/Department');
const ActivityLog = require('../models/ActivityLog');
const { generateEmbedding } = require('../services/geminiService');
const { upsertVector } = require('../services/pineconeService');

// @desc    Get all departments
// @route   GET /api/departments
// @access  Private
const getDepartments = async (req, res) => {
    try {
        const departments = await Department.find();
        res.json(departments);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a new department
// @route   POST /api/departments
// @access  Private (Admin)
const createDepartment = async (req, res) => {
    try {
        const { name, description, head, responsibilities } = req.body;

        if (!name || !description || !head || !responsibilities) {
            return res.status(400).json({ message: 'All department fields are required' });
        }

        const deptExists = await Department.findOne({ name });
        if (deptExists) {
            return res.status(400).json({ message: 'Department already exists with that name' });
        }

        const department = await Department.create({
            name,
            description,
            head,
            responsibilities: Array.isArray(responsibilities) ? responsibilities : [responsibilities]
        });

        console.log(`Generating embedding for new department responsibilities structure for: ${name}...`);
        // Combine department info to index
        const deptInfo = `${name} responsibilities: ${department.responsibilities.join(', ')}. ${description}`;
        const embedding = await generateEmbedding(deptInfo);

        // Index department responsibilities vector in Pinecone
        const vectorMetadata = {
            departmentId: department._id.toString(),
            name: name,
            type: 'department'
        };
        await upsertVector(department._id.toString(), embedding, vectorMetadata);

        // Logging action
        await ActivityLog.create({
            user: req.user._id,
            action: 'CREATE_DEPARTMENT',
            targetId: department._id,
            details: `Created department "${name}" led by ${head}.`
        });

        res.status(201).json(department);
    } catch (error) {
        console.error('Create department error:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete a department
// @route   DELETE /api/departments/:id
// @access  Private (Admin)
const deleteDepartment = async (req, res) => {
    try {
        const department = await Department.findById(req.params.id);
        if (!department) {
            return res.status(404).json({ message: 'Department not found' });
        }

        const deptName = department.name;
        await Department.deleteOne({ _id: req.params.id });

        // Logging action
        await ActivityLog.create({
            user: req.user._id,
            action: 'DELETE_DEPARTMENT',
            targetId: req.params.id,
            details: `Deleted department "${deptName}".`
        });

        res.json({ message: 'Department removed successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getDepartments,
    createDepartment,
    deleteDepartment
};
