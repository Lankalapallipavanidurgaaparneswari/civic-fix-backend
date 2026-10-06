const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load configurations
dotenv.config();

const verificationScript = async () => {
    console.log('===================================');
    console.log('CivicFix Backend Setup Verification');
    console.log('===================================\n');

    let errors = 0;

    // 1. Check local environment configuration
    console.log('Step 1: Check Environment Configuration...');
    const keyChecks = [
        'PORT',
        'MONGODB_URI',
        'JWT_SECRET',
        'GEMINI_API_KEY',
        'PINECONE_API_KEY',
        'PINECONE_INDEX_NAME',
        'CLOUDINARY_CLOUD_NAME'
    ];

    keyChecks.forEach(key => {
        if (process.env[key]) {
            console.log(`  [+] Env "${key}" is set.`);
        } else {
            console.log(`  [!] Env "${key}" is not set. (Will fallback to Mock services.)`);
        }
    });

    // 2. Check essential file existence
    console.log('\nStep 2: Checking Essential Files...');
    const checkPaths = [
        '../package.json',
        '../server.js',
        '../config/db.js',
        '../config/cloudinary.js',
        '../models/User.js',
        '../models/Complaint.js',
        '../models/Department.js',
        '../models/Notification.js',
        '../models/ActivityLog.js',
        '../services/geminiService.js',
        '../services/pineconeService.js',
        '../local_vectors.json'
    ];

    checkPaths.forEach(relPath => {
        const absPath = path.join(__dirname, relPath);
        if (fs.existsSync(absPath)) {
            console.log(`  [+] Found: ${relPath}`);
        } else {
            if (relPath.endsWith('local_vectors.json')) {
                console.log(`  [!] Warning: ${relPath} not found yet. (Database needs to be seeded: npm run seed)`);
            } else {
                console.log(`  [-] Error: Missing file: ${relPath}`);
                errors++;
            }
        }
    });

    // 3. Check MongoDB connection & Seed Status
    console.log('\nStep 3: Checking Mongoose DB Connection & Data Count...');
    try {
        const connStr = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/civicfix';
        await mongoose.connect(connStr);
        console.log('  [+] MongoDB Connection Successful!');

        // Import models
        const User = require('../models/User');
        const Department = require('../models/Department');
        const Complaint = require('../models/Complaint');

        const userCount = await User.countDocuments();
        const deptCount = await Department.countDocuments();
        const complaintCount = await Complaint.countDocuments();

        console.log(`  [+] Users count in DB: ${userCount}`);
        console.log(`  [+] Departments count in DB: ${deptCount}`);
        console.log(`  [+] Complaints count in DB: ${complaintCount}`);

        if (userCount === 0 || deptCount === 0) {
            console.log('  [!] Database has no records. Please seed it using: npm run seed');
        }
    } catch (error) {
        console.error('  [-] MongoDB Connection Failed:', error.message);
        errors++;
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
        }
    }

    // 4. Test Mock Embedding & Gemini classification structures
    console.log('\nStep 4: Verifying Mock Service Embedding Generics...');
    try {
        const { generateEmbedding, analyzeComplaintImage } = require('../services/geminiService');
        const vecRes = await generateEmbedding('Verify test message');

        if (Array.isArray(vecRes) && vecRes.length === 768) {
            console.log(`  [+] Embedding generation test passed. Vector dimension counts: ${vecRes.length}`);
        } else {
            console.log('  [-] Embedding generation returned malformed data:', vecRes);
            errors++;
        }

        const mockAnalysis = await analyzeComplaintImage(__filename, 'Verify test. Wet street leakage.');
        if (mockAnalysis && mockAnalysis.category && mockAnalysis.severity && mockAnalysis.aiSummary) {
            console.log('  [+] Gemini Vision analyzer parsing matches standard formats:');
            console.log(`      Category: ${mockAnalysis.category}`);
            console.log(`      Severity: ${mockAnalysis.severity}`);
            console.log(`      Confidence: ${mockAnalysis.confidence}`);
        } else {
            console.log('  [-] Multimodal analysis structure check failed.', mockAnalysis);
            errors++;
        }
    } catch (error) {
        console.error('  [-] AI Services check error:', error.message);
        errors++;
    }

    console.log('\n===================================');
    if (errors === 0) {
        console.log('STATUS: VERIFIED SUCCESSFUL. BACKEND READY!');
    } else {
        console.log(`STATUS: FAILED VERIFICATION. ${errors} error(s) discovered.`);
    }
    console.log('===================================');
    process.exit(errors === 0 ? 0 : 1);
};

verificationScript();
