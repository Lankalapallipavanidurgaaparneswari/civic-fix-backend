const cloudinary = require('cloudinary').v2;

const isConfigured = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

if (isConfigured) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });
}

// Upload helper with mock fallback if credentials are not configured
const uploadToCloudinary = async (filePath) => {
    if (!isConfigured) {
        console.log('Cloudinary not configured. Mocking upload and returning local file path reference.');
        // Simulated remote URL. In local mode, we will serve uploaded images from /uploads
        const fileName = filePath.split(/[\\/]/).pop();
        return {
            secure_url: `/uploads/${fileName}`,
            public_id: `mock_${Date.now()}`
        };
    }
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            folder: 'civicfix_complaints',
        });
        return result;
    } catch (error) {
        console.error('Cloudinary upload failure:', error);
        throw error;
    }
};

module.exports = {
    cloudinary,
    isConfigured,
    uploadToCloudinary
};
