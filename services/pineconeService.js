const { Pinecone } = require('@pinecone-database/pinecone');

const isConfigured = !!(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX_NAME);
let pineconeIndex = null;

if (isConfigured) {
    try {
        const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        pineconeIndex = pc.index(process.env.PINECONE_INDEX_NAME);
    } catch (error) {
        console.error('Failed to initialize Pinecone Client:', error);
    }
}

const fs = require('fs');
const path = require('path');
const localVectorsPath = path.join(__dirname, '../local_vectors.json');

// Local in-memory vector database fallback
// Structure: { id, values: number[], metadata: object }
let localVectorStore = [];
try {
    if (fs.existsSync(localVectorsPath)) {
        localVectorStore = JSON.parse(fs.readFileSync(localVectorsPath, 'utf8'));
        console.log(`Loaded ${localVectorStore.length} vectors from local_vectors.json`);
    }
} catch (err) {
    console.error('Failed to load local_vectors.json, starting empty:', err);
}

const saveLocalVectors = () => {
    try {
        fs.writeFileSync(localVectorsPath, JSON.stringify(localVectorStore, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to save local_vectors.json:', err);
    }
};

// Cosine similarity helper
const calculateCosineSimilarity = (vecA, vecB) => {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return normA && normB ? dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
};

// Haversine formula to compute distance in kilometers between two geo-coordinates
const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth default radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

/**
 * Upsert vector into index (or local store)
 */
const upsertVector = async (id, values, metadata = {}) => {
    if (isConfigured && pineconeIndex) {
        try {
            await pineconeIndex.upsert([{ id, values, metadata }]);
            return true;
        } catch (error) {
            console.warn('Pinecone upsert failed, writing to local fallback:', error.message);
        }
    }

    // Local fallback upsert
    const existingIdx = localVectorStore.findIndex(v => v.id === id);
    if (existingIdx !== -1) {
        localVectorStore[existingIdx] = { id, values, metadata };
    } else {
        localVectorStore.push({ id, values, metadata });
    }
    saveLocalVectors();
    return true;
};

/**
 * Query Pinecone or local store for similar vectors
 */
const queryVectors = async (values, topK = 5, filter = {}) => {
    if (isConfigured && pineconeIndex) {
        try {
            const response = await pineconeIndex.query({
                vector: values,
                topK,
                includeMetadata: true,
                filter
            });
            // Standardize Pinecone response to common format
            return response.matches.map(m => ({
                id: m.id,
                score: m.score,
                metadata: m.metadata
            }));
        } catch (error) {
            console.warn('Pinecone query failed, searching local fallback:', error.message);
        }
    }

    // Local fallback query
    let candidates = [...localVectorStore];

    // Apply basic key-value metadata filtering if present
    if (filter && Object.keys(filter).length > 0) {
        candidates = candidates.filter(item => {
            for (const [key, filterVal] of Object.entries(filter)) {
                // Handle basic structure (like { category: 'Water' })
                if (typeof filterVal === 'object' && filterVal !== null) {
                    // Check for sub-operators like $eq
                    if (filterVal.$eq !== undefined && item.metadata[key] !== filterVal.$eq) return false;
                    if (filterVal.$ne !== undefined && item.metadata[key] === filterVal.$ne) return false;
                } else {
                    if (item.metadata[key] !== filterVal) return false;
                }
            }
            return true;
        });
    }

    // Rank by cosine similarity
    const results = candidates.map(item => {
        const similarity = calculateCosineSimilarity(values, item.values);
        return {
            id: item.id,
            score: similarity,
            metadata: item.metadata
        };
    });

    // Sort descending and take top K
    return results.sort((a, b) => b.score - a.score).slice(0, topK);
};

/**
 * Search for duplicates (similar complaints near the location within < 0.5km)
 */
const findDuplicateComplaint = async (complaintEmbedding, lat, lng, category) => {
    // Query similar vector items from same category
    const matches = await queryVectors(complaintEmbedding, 5, {
        category: { $eq: category },
        type: { $eq: 'complaint' }
    });

    // Thresholds: Cosine similarity >= 0.85 and distance < 0.5 km
    const SIMILARITY_THRESHOLD = 0.85;
    const MAX_DISTANCE_KM = 0.5;

    for (const match of matches) {
        if (match.score >= SIMILARITY_THRESHOLD && match.metadata) {
            const dbLat = parseFloat(match.metadata.latitude);
            const dbLng = parseFloat(match.metadata.longitude);

            if (!isNaN(dbLat) && !isNaN(dbLng)) {
                const distance = calculateDistanceKm(lat, lng, dbLat, dbLng);
                if (distance <= MAX_DISTANCE_KM) {
                    return {
                        id: match.id,
                        similarity: match.score,
                        distanceKm: distance,
                        complaintDetails: match.metadata
                    };
                }
            }
        }
    }
    return null;
};

/**
 * Match a complaint embedding against department responsibilities
 * and return the department metadata that scores highest.
 */
const findDepartmentForComplaint = async (complaintEmbedding) => {
    const matches = await queryVectors(complaintEmbedding, 3, {
        type: { $eq: 'department' }
    });

    if (matches.length > 0 && matches[0].score > 0.1) {
        return {
            departmentId: matches[0].metadata.departmentId,
            departmentName: matches[0].metadata.name,
            score: matches[0].score
        };
    }
    return null;
};

/**
 * Retrieve SLA & Rule matching city charter RAG knowledge base.
 */
const retrieveSlaAndRights = async (complaintEmbedding) => {
    const matches = await queryVectors(complaintEmbedding, 2, {
        type: { $eq: 'city_charter' }
    });

    if (matches.length > 0 && matches[0].score > 0.4) {
        const meta = matches[0].metadata;
        // RAG retrieved result fields
        return {
            slaRule: meta.rule || 'Section 12.4 General Civic Maintenance Standards',
            expectedResolutionTime: meta.expectedResolutionTime || '5 Business Days',
            textSnippet: meta.text || '',
            ragScore: matches[0].score
        };
    }

    // Default values
    return {
        slaRule: 'General Local Ordinance (Section 9.1)',
        expectedResolutionTime: '7 Business Days',
        textSnippet: 'City charter outlines standard maintenance timeframes for minor grievances to be resolved within 7 business days under standard conditions.',
        ragScore: 0
    };
};

module.exports = {
    isConfigured,
    upsertVector,
    queryVectors,
    findDuplicateComplaint,
    findDepartmentForComplaint,
    retrieveSlaAndRights,
    calculateCosineSimilarity,
    calculateDistanceKm
};
