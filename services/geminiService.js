const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

const isConfigured = !!process.env.GEMINI_API_KEY;
let genAI = null;

if (isConfigured) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// Simple hash function to generate consistent mock embeddings for identical text content
const getMockEmbedding = (text) => {
    const embeddingDim = 768; // Matching text-embedding-004 dimensions
    const embedding = [];
    let seed = 0;

    const cleanText = text.toLowerCase().trim();
    for (let i = 0; i < cleanText.length; i++) {
        seed = (seed << 5) - seed + cleanText.charCodeAt(i);
        seed |= 0; // Convert to 32bit integer
    }

    for (let i = 0; i < embeddingDim; i++) {
        // Generate pseudo-random numbers in range [-1, 1] using LCG with string seed
        const x = Math.sin(seed + i) * 10000;
        embedding.push(x - Math.floor(x));
    }

    // Normalize the vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / (magnitude || 1));
};

// Help helper for Gemini Vision parts
const fileToGenerativePart = (path, mimeType) => {
    return {
        inlineData: {
            data: Buffer.from(fs.readFileSync(path)).toString('base64'),
            mimeType
        },
    };
};

const analyzeComplaintImage = async (imagePath, description, mimeType = 'image/jpeg') => {
    if (!isConfigured) {
        console.log('Gemini API not configured. Triggering local mock image analysis.');

        // Simulate classification using keywords in description
        const descLower = description.toLowerCase();
        let category = 'Public Infrastructure';
        let severity = 'Medium';
        let summary = 'A citizen reported a public maintenance issue.';

        if (descLower.includes('water') || descLower.includes('leak') || descLower.includes('pipe') || descLower.includes('sewage')) {
            category = 'Water & Sewage';
            severity = descLower.includes('flood') || descLower.includes('burst') ? 'Critical' : 'High';
            summary = 'Water/sewage leakage reported, requiring immediate plumbing or technical inspect.';
        } else if (descLower.includes('pothole') || descLower.includes('road') || descLower.includes('asphalt') || descLower.includes('street')) {
            category = 'Roads & Transportation';
            severity = descLower.includes('accident') || descLower.includes('blocked') ? 'High' : 'Medium';
            summary = 'Road degradation or pothole detected on public driving passage.';
        } else if (descLower.includes('light') || descLower.includes('dark') || descLower.includes('bulb') || descLower.includes('lamp')) {
            category = 'Street Lighting';
            severity = 'Low';
            summary = 'Streetlight malfunction causing reduced visibility.';
        } else if (descLower.includes('garbage') || descLower.includes('trash') || descLower.includes('waste') || descLower.includes('dump')) {
            category = 'Sanitation & Waste';
            severity = 'Medium';
            summary = 'Garbage pile-up or waste blockage reported in residential sector.';
        } else if (descLower.includes('tree') || descLower.includes('branch') || descLower.includes('park') || descLower.includes('plant')) {
            category = 'Parks & Forestry';
            severity = descLower.includes('fallen') || descLower.includes('wire') ? 'High' : 'Low';
            summary = 'Overgrown or fallen branches/trees blocking path/park.';
        }

        return {
            category,
            severity,
            aiSummary: `${summary} Detail: "${description.substring(0, 100)}"`,
            confidence: 0.88
        };
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const imagePart = fileToGenerativePart(imagePath, mimeType);

        const prompt = `You are the CivicFix AI assistant. Analyze this image and this user description of a civic complaint: "${description}".
    Respond strictly with a JSON object containing these keys:
    - "category": Choose the best matching category from: 'Roads & Transportation', 'Water & Sewage', 'Sanitation & Waste', 'Street Lighting', 'Parks & Forestry', 'Public Infrastructure', 'Other'.
    - "severity": Choose from: 'Low', 'Medium', 'High', 'Critical'.
    - "aiSummary": A concise summary (1-2 sentences) of the complaint and evidence in the image.
    - "confidence": Float between 0 and 1, representing your classification confidence.

    Do not output markdown code blocks. Output raw JSON representation.`;

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();

        // Clean potential markdown notation in gemini output
        const cleanJSONStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJSONStr);
    } catch (error) {
        console.error('Gemini classification error:', error);
        // Safe fallback
        return {
            category: 'Other',
            severity: 'Medium',
            aiSummary: `Fallback summary: ${description.substring(0, 80)}`,
            confidence: 0.5
        };
    }
};

const generateEmbedding = async (text) => {
    if (!isConfigured) {
        return getMockEmbedding(text);
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
        const result = await model.embedContent(text);
        return result.embedding.values;
    } catch (error) {
        console.error('Gemini embedding generation error:', error);
        return getMockEmbedding(text);
    }
};

module.exports = {
    isConfigured,
    analyzeComplaintImage,
    generateEmbedding
};
