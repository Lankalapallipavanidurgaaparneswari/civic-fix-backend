const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load models
const User = require('../models/User');
const Department = require('../models/Department');
const Complaint = require('../models/Complaint');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');

// Load services
const { generateEmbedding } = require('../services/geminiService');
const { upsertVector } = require('../services/pineconeService');
const connectDB = require('../config/db');

dotenv.config();

const seedData = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await connectDB();

        // 1. Clear existing database collections
        console.log('Clearing existing database collections...');
        await User.deleteMany();
        await Department.deleteMany();
        await Complaint.deleteMany();
        await Notification.deleteMany();
        await ActivityLog.deleteMany();

        // Remove local vector store if exists
        const localVectorsPath = path.join(__dirname, '../local_vectors.json');
        if (fs.existsSync(localVectorsPath)) {
            fs.unlinkSync(localVectorsPath);
            console.log('Removed old local vectors json file.');
        }

        console.log('Database cleared.');

        // 2. Create Users (Citizen and Admin)
        console.log('Seeding users...');
        const admin = await User.create({
            name: 'City Administrator',
            email: 'admin@civicfix.com',
            password: 'admin123', // Will be hashed automatically by pre-save hook
            role: 'admin',
            phone: '+15550199',
            address: 'Metropolis City Hall, Plaza Level'
        });

        const citizen = await User.create({
            name: 'John Citizen',
            email: 'citizen@civicfix.com',
            password: 'citizen123',
            role: 'citizen',
            phone: '+15550100',
            address: '42 Main St, Residential District'
        });

        console.log(`Seeded Users: admin (admin@civicfix.com), citizen (citizen@civicfix.com)`);

        // 3. Create Departments
        console.log('Seeding departments...');
        const departmentsData = [
            {
                name: 'Roads & Transportation',
                description: 'Handles street upkeep, potholes, pedestrian sidewalks, traffic signs, and roadblock removal.',
                head: 'Director Sarah Lin',
                responsibilities: ['pothole repairs', 'street maintenance', 'sidewalks cracks', 'traffic lights defect', 'road blockages']
            },
            {
                name: 'Water & Sewage',
                description: 'Manages municipal clean water supply pipelines, sewer leakage, fire hydrants, and flood drainage networks.',
                head: 'Chief Engineer David Vance',
                responsibilities: ['water leakage pipeline', 'seweage backups overflow', 'fire hydrant maintenance', 'clogged street drains', 'dripping valves']
            },
            {
                name: 'Sanitation & Waste',
                description: 'Coordinates garbage disposal bins, residential trash collection failures, municipal dumpsters, and illegal garbage dumping.',
                head: 'Superintendent Mark Miller',
                responsibilities: ['garbage bag piles', 'trash disposal bin', 'illegal street dumping', 'litter cleanups', 'recycling operations']
            },
            {
                name: 'Street Lighting',
                description: 'Maintains streetlights, public park light fixtures, power cabling on poles, and night illumination zones.',
                head: 'Grid Manager Elena Rostova',
                responsibilities: ['streetlight out damage', 'cabling sparks pole', 'bulb replacement lights', 'complete block blackout', 'lighting post repairs']
            },
            {
                name: 'Parks & Forestry',
                description: 'Look after garden shrubs, public parks, fallen branch pruning, and city tree hazard control.',
                head: 'Arborist Jane Oakwood',
                responsibilities: ['fallen tree trunk', 'branch blocking road', 'park weeding overgrown grass', 'limb pruning heights', 'playground structures']
            },
            {
                name: 'Public Infrastructure',
                description: 'Deals with government offices, municipal gates, public benches, post boxes, and city square fountains.',
                head: 'Director Arthur Vance',
                responsibilities: ['public benches paint replacement', 'square fountain maintenance', 'municipal gate locks', 'wall graffiti removal', 'information boards']
            }
        ];

        const seededDepts = [];
        for (const dept of departmentsData) {
            const createdDept = await Department.create(dept);
            seededDepts.push(createdDept);

            // Generate embedding and save to Pinecone/mock vector store
            const deptEmbedText = `${createdDept.name} department handles: ${createdDept.responsibilities.join(', ')}. ${createdDept.description}`;
            const embedding = await generateEmbedding(deptEmbedText);

            await upsertVector(createdDept._id.toString(), embedding, {
                departmentId: createdDept._id.toString(),
                name: createdDept.name,
                type: 'department'
            });
        }
        console.log(`Seeded ${seededDepts.length} departments and vectorized responsibilities.`);

        // 4. Seeding Knowledge Base RAG (City Charter)
        console.log('Seeding RAG City Charter knowledge base...');
        const charterPath = path.join(__dirname, '../city_charter.txt');
        if (!fs.existsSync(charterPath)) {
            throw new Error(`City charter file not found at: ${charterPath}`);
        }

        const charterDoc = fs.readFileSync(charterPath, 'utf8');
        // Split by sections using regex or header indicators
        const sections = charterDoc.split('[SECTION').filter(Boolean);

        console.log(`Parsing charter: identified ${sections.length} sections for embedding indexing.`);

        let sectionIdx = 1;
        for (const section of sections) {
            const fullSectionText = '[SECTION' + section;
            const firstLine = fullSectionText.split('\n')[0].replace(/[\[\]]/g, '').trim();

            // Basic rule extraction
            const ruleName = firstLine.split(':')[1]?.trim() || firstLine;

            // SLA Extraction
            let extSla = '7 Business Days';
            let cleanText = fullSectionText;

            if (cleanText.includes('1 Business Day')) extSla = '1 Business Day';
            else if (cleanText.includes('12 hours')) extSla = '1 Business Day';
            else if (cleanText.includes('2 Business Days')) extSla = '2 Business Days';
            else if (cleanText.includes('3 Business Days')) extSla = '3 Business Days';
            else if (cleanText.includes('5 Business Days')) extSla = '5 Business Days';
            else if (cleanText.includes('10 Business Days')) extSla = '10 Business Days';

            const embedding = await generateEmbedding(fullSectionText);
            await upsertVector(`charter_sec_${sectionIdx}`, embedding, {
                type: 'city_charter',
                rule: ruleName,
                expectedResolutionTime: extSla,
                text: fullSectionText
            });
            sectionIdx++;
        }
        console.log('Knowledge Base (RAG) vector embeddings loaded successfully.');

        // 5. Seeding Sample Complaints
        console.log('Seeding Sample Complaints...');
        const waterDept = seededDepts.find(d => d.name === 'Water & Sewage');
        const roadDept = seededDepts.find(d => d.name === 'Roads & Transportation');
        const wasteDept = seededDepts.find(d => d.name === 'Sanitation & Waste');

        const complaintsData = [
            {
                citizen: citizen._id,
                imageUrl: '/uploads/sample_leak.jpg',
                description: 'Large burst pipe is leaking clean drinking water on the roadway. The flow is very high.',
                aiSummary: 'Clean water leakage running from pavement water pipeline.',
                category: 'Water & Sewage',
                severity: 'High',
                aiConfidence: 0.92,
                department: waterDept._id,
                latitude: 40.7128,
                longitude: -74.0060,
                status: 'In Progress',
                sla: {
                    rule: 'Section 9.1: Water And Sewage Grievances (Code Sec. 8-B)',
                    expectedResolutionTime: '3 Business Days',
                    resolutionDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                },
                supportCount: 4
            },
            {
                citizen: citizen._id,
                imageUrl: '/uploads/sample_pothole.jpg',
                description: 'Deep road potholes opening right near intersection, causing vehicles to swerve into oncoming traffic.',
                aiSummary: 'Deep asphalt pavement failure causing traffic danger.',
                category: 'Roads & Transportation',
                severity: 'Critical',
                aiConfidence: 0.95,
                department: roadDept._id,
                latitude: 40.7135,
                longitude: -74.0048,
                status: 'Routed',
                sla: {
                    rule: 'Section 9.2: Roads And Transportation Oral Codes (Sec. 12-A)',
                    expectedResolutionTime: '1 Business Day',
                    resolutionDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000)
                },
                supportCount: 15
            },
            {
                citizen: citizen._id,
                imageUrl: '/uploads/sample_garbage.jpg',
                description: 'Lots of garbage bags and boxes dumped in public alleyway outside apartments. Rats are starting to appear.',
                aiSummary: 'Overflowing residential waste building pile inside alleyway.',
                category: 'Sanitation & Waste',
                severity: 'Medium',
                aiConfidence: 0.89,
                department: wasteDept._id,
                latitude: 40.7112,
                longitude: -74.0080,
                status: 'Resolved',
                sla: {
                    rule: 'Section 9.3: Sanitation And Solid Waste Service Code (Sec. 15-D)',
                    expectedResolutionTime: '2 Business Days',
                    resolutionDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
                },
                supportCount: 2
            }
        ];

        // Copy mock image assets if they dont exist to keep paths valid locally
        const uploadsDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        fs.writeFileSync(path.join(uploadsDir, 'sample_leak.jpg'), 'leak_image_payload');
        fs.writeFileSync(path.join(uploadsDir, 'sample_pothole.jpg'), 'pothole_image_payload');
        fs.writeFileSync(path.join(uploadsDir, 'sample_garbage.jpg'), 'garbage_image_payload');

        for (const comp of complaintsData) {
            const createdComplaint = await Complaint.create(comp);
            const textToEmbed = `${createdComplaint.category} - ${createdComplaint.description}`;
            const embedding = await generateEmbedding(textToEmbed);

            await upsertVector(createdComplaint._id.toString(), embedding, {
                complaintId: createdComplaint._id.toString(),
                description: createdComplaint.description,
                category: createdComplaint.category,
                latitude: createdComplaint.latitude.toString(),
                longitude: createdComplaint.longitude.toString(),
                type: 'complaint'
            });
        }

        console.log(`Seeded ${complaintsData.length} sample complaints and registered vector indexes.`);

        console.log('Seeder completed successfully. Closing connection...');
        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('Seeder failed with error:', error);
        process.exit(1);
    }
};

seedData();
