import express from 'express';

let transformers;

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Inicialización global del entorno de Transformers ---
async function initializeTransformers() {
    if (!transformers) {
        console.log('Reranker: Dynamically importing @xenova/transformers...');
        transformers = await import('@xenova/transformers');
        console.log('Reranker: @xenova/transformers imported successfully.');

        transformers.env.cacheDir = '/tmp/transformers-cache';
        transformers.env.allowLocalModels = false;
        console.log('Reranker: Transformers environment configured.');
    }
    return transformers;
}

// --- Singleton para mantener el modelo cargado en memoria ---
class RerankerPipeline {
    static task = 'text-classification';
    static model = 'Xenova/bge-reranker-base';
    static instance = null;
    static pipelineFunction = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            const { pipeline } = await initializeTransformers();
            this.pipelineFunction = pipeline;

            console.log('Reranker: Initializing model pipeline...');
            this.instance = await this.pipelineFunction(this.task, this.model, { progress_callback });
            console.log('Reranker: Model pipeline initialized successfully.');
        }
        return this.instance;
    }
}

// --- Middleware para autenticación interna ---
const internalAuth = (req, res, next) => {
    const secret = req.headers['x-internal-api-secret'];
    if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
        console.warn(`Reranker: Forbidden attempt with secret: ${secret ? 'provided' : 'missing'}`);
        return res.status(403).json({ error: 'Forbidden: Invalid or missing secret.' });
    }
    next();
};

// --- Endpoint principal de re-ranking ---
app.post('/api/rerank', internalAuth, async (req, res) => {
    const { query, documents } = req.body;

    if (!query || typeof query !== 'string' || !Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({ error: 'Bad Request: "query" (string) and "documents" (array of {id, content}) are required.' });
    }

    if (!documents.every(doc => doc && typeof doc.id !== 'undefined' && typeof doc.content === 'string')) {
        return res.status(400).json({ error: 'Bad Request: Each document must have "id" and "content" (string).' });
    }

    try {
        console.log(`Reranker: Received request to rerank ${documents.length} documents for query: "${query.substring(0, 50)}..."`);
        const reranker = await RerankerPipeline.getInstance();

        const pairs = documents.map(doc => [query, doc.content]);
        console.log('Reranker: Scoring document pairs...');
        const scores = await reranker(pairs, { topK: null });

        const reranked = documents.map((doc, i) => ({
            ...doc,
            rerank_score: scores[i].score
        })).sort((a, b) => b.rerank_score - a.rerank_score);

        console.log(`Reranker: Successfully reranked ${reranked.length} documents.`);
        res.status(200).json({ rerankedDocuments: reranked });

    } catch (error) {
        console.error('Reranker Error:', error);
        const msg = error.message.includes('@xenova/transformers')
            ? 'Failed to initialize reranking model.'
            : 'Failed to process reranking request.';
        res.status(500).json({ error: msg, details: error.message });
    }
});

// --- Endpoint de health check / warm-up ---
app.get('/api/health', async (req, res) => {
    console.log('Reranker: Health check / Warm-up ping received.');
    try {
        await RerankerPipeline.getInstance();
        res.status(200).send('Rerank service is active and model pipeline initialized.');
    } catch (error) {
        console.error('Health Check Error:', error);
        res.status(500).send('Rerank service is active, but model pipeline initialization failed.');
    }
});

// --- Exporta app para Vercel ---
export default app;
