// Archivo: synchat-ai-reranker/api/index.js (anteriormente rerank.js)

const express = require('express');

// La importación dinámica se mantiene igual
const app = express();
app.use(express.json({ limit: '2mb' }));

class RerankerPipeline {
    static task = 'text-classification';
    static model = 'Xenova/bge-reranker-base';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            const { pipeline, env } = await import('@xenova/transformers');
            env.cacheDir = '/tmp/transformers-cache';
            env.allowLocalModels = false;

            console.log('Reranker Microservice: Initializing model pipeline...');
            this.instance = await pipeline(this.task, this.model, { progress_callback });
            console.log('Reranker Microservice: Model pipeline initialized successfully.');
        }
        return this.instance;
    }
}

const internalAuth = (req, res, next) => {
    const secret = req.headers['x-internal-api-secret'];
    if (!process.env.INTERNAL_API_SECRET || secret !== process.env.INTERNAL_API_SECRET) {
        return res.status(403).json({ error: 'Forbidden: Invalid or missing secret.' });
    }
    next();
};

// --- INICIO DEL CAMBIO ---
// Se han simplificado las rutas, eliminando el prefijo '/api'

// Endpoint de Re-Ranking (ahora en /api/rerank)
app.post('/rerank', internalAuth, async (req, res) => {
    // ... la lógica interna de esta función no cambia ...
    const { query, documents } = req.body;
    if (!query || !Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({ error: 'Bad Request: "query" (string) and "documents" (array of {id, content}) are required.' });
    }
    try {
        const reranker = await RerankerPipeline.getInstance();
        const queryDocumentPairs = documents.map(doc => [query, doc.content]);
        const scores = await reranker(queryDocumentPairs, { topK: null });
        const rankedDocs = documents.map((doc, i) => ({ ...doc, rerank_score: scores[i].score }));
        rankedDocs.sort((a, b) => b.rerank_score - a.rerank_score);
        res.status(200).json({ rerankedDocuments: rankedDocs });
    } catch (error) {
        console.error('Reranker Microservice Error:', error);
        res.status(500).json({ error: 'Failed to process reranking request.', details: error.message });
    }
});

// Endpoint de Health Check (ahora en /api/health)
app.get('/health', (req, res) => {
    console.log('Reranker Microservice: Health check / Warm-up ping received.');
    res.status(200).send('Rerank service is active and warm.');
});
// --- FIN DEL CAMBIO ---

// Catch-all (sin cambios)
app.all('*', (req, res) => {
    res.status(404).send('Not Found');
});

module.exports = app;
