import express from 'express';
import { pipeline, env as transformersEnv } from '@xenova/transformers';

// Configure environment for Vercel
transformersEnv.cacheDir = '/tmp/transformers-cache';
transformersEnv.allowLocalModels = false;

const app = express();
app.use(express.json({ limit: '2mb' }));

// Singleton to ensure the model is loaded only once per warm instance
class RerankerPipeline {
    static task = 'text-classification';
    static model = 'Xenova/bge-reranker-base';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            console.log('Reranker Microservice: Initializing model pipeline...');
            this.instance = await pipeline(this.task, this.model, { progress_callback });
            console.log('Reranker Microservice: Model pipeline initialized successfully.');
        }
        return this.instance;
    }
}

// Middleware to secure the endpoint
const internalAuth = (req, res, next) => {
    const secret = req.headers['x-internal-api-secret'];
    if (!process.env.INTERNAL_API_SECRET || secret !== process.env.INTERNAL_API_SECRET) {
        return res.status(403).json({ error: 'Forbidden: Invalid or missing secret.' });
    }
    next();
};

// Main re-ranking endpoint
app.post('/api/rerank', internalAuth, async (req, res) => {
    const { query, documents } = req.body;

    if (!query || !Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({ error: 'Bad Request: "query" (string) and "documents" (array of {id, content}) are required.' });
    }

    try {
        const reranker = await RerankerPipeline.getInstance();

        const queryDocumentPairs = documents.map(doc => [query, doc.content]);
        const scores = await reranker(queryDocumentPairs, { topK: null });

        const rankedDocs = documents.map((doc, i) => ({
            ...doc,
            rerank_score: scores[i].score
        }));

        rankedDocs.sort((a, b) => b.rerank_score - a.rerank_score);

        res.status(200).json({ rerankedDocuments: rankedDocs });

    } catch (error) {
        console.error('Reranker Microservice Error:', error);
        res.status(500).json({ error: 'Failed to process reranking request.', details: error.message });
    }
});

// Health check / warm-up endpoint
app.get('/api/health', (req, res) => {
    console.log('Reranker Microservice: Health check / Warm-up ping received.');
    res.status(200).send('Rerank service is active and warm.');
});

// Catch-all for other routes
app.all('*', (req, res) => {
    res.status(404).send('Not Found');
});

export default app;
