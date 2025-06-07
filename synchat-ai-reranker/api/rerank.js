import express from 'express';
// REMOVED: import { pipeline, env as transformersEnv } from '@xenova/transformers';

// --- Global variable to hold the dynamically imported transformers library ---
let transformers;

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Helper function to initialize transformers and configure env ---
async function initializeTransformers() {
    if (!transformers) {
        console.log('Reranker: Dynamically importing @xenova/transformers...');
        transformers = await import('@xenova/transformers');
        console.log('Reranker: @xenova/transformers imported successfully.');

        // --- Configuración Esencial para Vercel ---
        // Asegura que los modelos se descarguen en el único directorio escribible.
        transformers.env.cacheDir = '/tmp/transformers-cache';
        transformers.env.allowLocalModels = false;
        console.log('Reranker: Transformers environment configured.');
    }
    return transformers;
}

// --- Singleton para el Pipeline del Modelo ---
class RerankerPipeline {
    static task = 'text-classification';
    static model = 'Xenova/bge-reranker-base';
    static instance = null;
    static pipelineFunction = null; // To store the pipeline function itself

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            const { pipeline } = await initializeTransformers(); // Ensure library is loaded and get pipeline
            this.pipelineFunction = pipeline; // Store it

            console.log('Reranker: Initializing model pipeline...');
            // Use this.pipelineFunction to create the instance
            this.instance = await this.pipelineFunction(this.task, this.model, { progress_callback });
            console.log('Reranker: Model pipeline initialized successfully.');
        }
        return this.instance;
    }
}

// --- Middleware de Autenticación Interna ---
const internalAuth = (req, res, next) => {
    const secret = req.headers['x-internal-api-secret'];
    if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
        console.warn(`Reranker: Forbidden attempt with secret: ${secret ? 'provided' : 'missing'}`);
        return res.status(403).json({ error: 'Forbidden: Invalid or missing secret.' });
    }
    next();
};

// --- Endpoint de Re-Ranking ---
app.post('/api/rerank', internalAuth, async (req, res) => {
    const { query, documents } = req.body;

    if (!query || typeof query !== 'string' || !Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({ error: 'Bad Request: "query" (string) and "documents" (array of {id, content}) are required.' });
    }
    
    if (!documents.every(doc => doc && typeof doc.id !== 'undefined' && typeof doc.content === 'string')) {
        return res.status(400).json({ error: 'Bad Request: Each document in "documents" must be an object with "id" and "content" (string) properties.' });
    }

    try {
        console.log(`Reranker: Received request to rerank ${documents.length} documents for query: "${query.substring(0, 50)}..."`);
        const reranker = await RerankerPipeline.getInstance(); // This will also ensure transformers are loaded

        const queryDocumentPairs = documents.map(doc => [query, doc.content]);
        
        console.log('Reranker: Scoring document pairs...');
        // Reranker is the pipeline instance itself
        const scores = await reranker(queryDocumentPairs, { topK: null });

        const rankedDocs = documents.map((doc, i) => ({
            ...doc,
            rerank_score: scores[i].score
        }));

        rankedDocs.sort((a, b) => b.rerank_score - a.rerank_score);
        console.log(`Reranker: Successfully reranked ${rankedDocs.length} documents.`);

        res.status(200).json({ rerankedDocuments: rankedDocs });

    } catch (error) {
        console.error('Reranker Error:', error);
        // Check if the error is from transformers loading
        if (error.message.includes('@xenova/transformers')) {
             res.status(500).json({ error: 'Failed to initialize reranking model.', details: error.message });
        } else {
             res.status(500).json({ error: 'Failed to process reranking request.', details: error.message });
        }
    }
});

// --- Endpoint de Health Check / Warm-up ---
// Also serves to pre-warm the model by calling getInstance
app.get('/api/health', async (req, res) => {
    console.log('Reranker: Health check / Warm-up ping received.');
    try {
        await RerankerPipeline.getInstance(); // Attempt to initialize the pipeline
        res.status(200).send('Rerank service is active and model pipeline initialized (or was already).');
    } catch (error) {
        console.error('Reranker Health Check Error (during pipeline init):', error);
        res.status(500).send('Rerank service is active, but model pipeline initialization failed.');
    }
});

// Exporta la app para Vercel
export default app;
