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
            const startTime = Date.now();
            try {
                console.log(`Reranker Microservice: Loading model ${this.model} for task ${this.task}...`);
                this.instance = await pipeline(this.task, this.model);
                const endTime = Date.now();
                const duration = (endTime - startTime) / 1000; // Duration in seconds
                console.log(`Reranker Microservice: Model initialized successfully in ${duration} seconds.`);
            } catch (error) {
                console.error('Reranker Microservice: Failed to initialize model.', error);
                throw error; // Re-throw the error to be caught by the caller
            }
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
        const isModelAlreadyWarm = RerankerPipeline.instance !== null;
        try {
            await RerankerPipeline.getInstance();
            if (isModelAlreadyWarm) {
                console.log('Reranker Microservice: Model was already warm.');
            } else {
                console.log('Reranker Microservice: Model initialized during warm-up call.');
            }
            return res.status(200).send('Rerank service is active and model is warm.');
        } catch (error) {
            console.error('Reranker Microservice: Error during warm-up model initialization.', error);
            return res.status(500).json({ error: 'Model initialization failed during warm-up.' });
        }
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
