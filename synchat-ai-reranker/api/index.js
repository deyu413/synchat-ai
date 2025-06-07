// Archivo: synchat-ai-reranker/api/index.js
import { pipeline, env as transformersEnv } from '@xenova/transformers';

// Configura el entorno para Vercel
transformersEnv.cacheDir = '/tmp/transformers-cache';
transformersEnv.allowLocalModels = false;

// Singleton para el modelo
class RerankerPipeline {
    static task = 'text-classification';
    static model = 'Xenova/bge-reranker-base';
    static instance = null;

    static async getInstance() {
        if (this.instance === null) {
            console.log('Reranker Microservice: Initializing model...');
            this.instance = await pipeline(this.task, this.model);
            console.log('Reranker Microservice: Model initialized.');
        }
        return this.instance;
    }
}

// El handler principal que Vercel ejecutará
export default async function handler(req, res) {
    // Petición de precalentamiento (warm-up)
    // Petición de precalentamiento (warm-up)
    // Petición de precalentamiento (warm-up)
    if (req.method === 'GET') {
        console.log('Reranker Microservice: Health check / Warm-up ping received.');
        return res.status(200).send('Rerank service is active.');
    }

    // Petición de re-ranking
    if (req.method === 'POST') {
        // Autenticación
        const secret = req.headers['x-internal-api-secret'];
        if (!process.env.INTERNAL_API_SECRET || secret !== process.env.INTERNAL_API_SECRET) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { query, documents } = req.body;
        if (!query || !Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({ error: 'Bad Request' });
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
            return res.status(200).json({ rerankedDocuments: rankedDocs });

        } catch (error) {
            console.error('Reranker Microservice Error:', error);
            return res.status(500).json({ error: 'Failed to process reranking request' });
        }
    }

    // Si el método no es GET ni POST
    return res.status(405).send('Method Not Allowed');
}
