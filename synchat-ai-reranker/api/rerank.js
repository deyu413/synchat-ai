import express from 'express';
import { pipeline, env as transformersEnv } from '@xenova/transformers';

// --- Configuración Esencial para Vercel ---
// Asegura que los modelos se descarguen en el único directorio escribible.
transformersEnv.cacheDir = '/tmp/transformers-cache';
transformersEnv.allowLocalModels = false;

const app = express();
app.use(express.json({ limit: '2mb' })); // Aumentar el límite por si los chunks son grandes

// --- Singleton para el Pipeline del Modelo ---
// Para asegurar que el modelo se cargue una sola vez.
class RerankerPipeline {
    static task = 'text-classification';
    static model = 'Xenova/bge-reranker-base';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            console.log('Reranker: Initializing model pipeline...');
            this.instance = await pipeline(this.task, this.model, { progress_callback });
            console.log('Reranker: Model pipeline initialized successfully.');
        }
        return this.instance;
    }
}

// --- Middleware de Autenticación Interna ---
// Para que solo tu backend principal pueda llamar a este servicio.
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

    // Validate documents structure
    if (!documents.every(doc => doc && typeof doc.id !== 'undefined' && typeof doc.content === 'string')) {
        return res.status(400).json({ error: 'Bad Request: Each document in "documents" must be an object with "id" and "content" (string) properties.' });
    }

    try {
        console.log(`Reranker: Received request to rerank ${documents.length} documents for query: "${query.substring(0, 50)}..."`);
        const reranker = await RerankerPipeline.getInstance();

        const queryDocumentPairs = documents.map(doc => [query, doc.content]);

        console.log('Reranker: Scoring document pairs...');
        const scores = await reranker(queryDocumentPairs, { topK: null }); // Get scores for all pairs

        const rankedDocs = documents.map((doc, i) => ({
            ...doc,
            rerank_score: scores[i].score
        }));

        rankedDocs.sort((a, b) => b.rerank_score - a.rerank_score);
        console.log(`Reranker: Successfully reranked ${rankedDocs.length} documents.`);

        res.status(200).json({ rerankedDocuments: rankedDocs });

    } catch (error) {
        console.error('Reranker Error:', error);
        res.status(500).json({ error: 'Failed to process reranking request.', details: error.message });
    }
});

// --- Endpoint de Health Check / Warm-up ---
app.get('/api/health', (req, res) => {
    console.log('Reranker: Health check / Warm-up ping received.');
    res.status(200).send('Rerank service is active.');
});

// Exporta la app para Vercel
export default app;
