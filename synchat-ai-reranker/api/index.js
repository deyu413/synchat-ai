// Archivo: synchat-ai-reranker/api/index.js
import { pipeline, env as transformersEnv } from '@xenova/transformers';

// Configura el entorno para Vercel
transformersEnv.cacheDir = '/tmp/transformers-cache';
transformersEnv.allowLocalModels = false;

// Singleton para el modelo
class RerankerPipeline {
    static task = 'text-classification';
    // --- CAMBIO CLAVE REALIZADO AQUÍ ---
    // Se reemplaza el modelo pesado 'bge-reranker-base' por uno ligero.
    static model = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
    static instance = null;

    static async getInstance() {
        if (this.instance === null) {
            console.log(`Reranker Microservice: Initializing lightweight model ('${this.model}')...`);
            this.instance = await pipeline(this.task, this.model);
            console.log('Reranker Microservice: Model initialized successfully.');
        }
        return this.instance;
    }
}

// El handler principal que Vercel ejecutará
export default async function handler(req, res) {
    if (req.method === 'GET') {
        console.log('Reranker Microservice: Health check / Warm-up ping received.');
        // Con el modelo ligero, la primera inicialización debería ser rápida.
        try {
            await RerankerPipeline.getInstance();
            return res.status(200).send('Rerank service is active and model is ready.');
        } catch (error) {
            console.error('Reranker Microservice Warm-up Error:', error);
            return res.status(500).json({ error: 'Failed to initialize model during warm-up.' });
        }
    }

    if (req.method === 'POST') {
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
            // El pipeline ahora devolverá clasificaciones (ej. 'POSITIVE', 'NEGATIVE') en lugar de scores de relevancia.
            // Adaptamos la lógica para que siga funcionando y devuelva un "score".
            const scores = await reranker(documents.map(doc => doc.content), { topK: null });

            const rankedDocs = documents.map((doc, i) => {
                // Se extrae el score del label más probable para simular un score de reranking.
                const scoreEntry = scores[i]?.[0] || { score: 0 };
                return {
                    ...doc,
                    rerank_score: scoreEntry.score
                };
            });

            rankedDocs.sort((a, b) => b.rerank_score - a.rerank_score);
            return res.status(200).json({ rerankedDocuments: rankedDocs });

        } catch (error) {
            console.error('Reranker Microservice Error:', error);
            return res.status(500).json({ error: 'Failed to process reranking request' });
        }
    }

    return res.status(405).send('Method Not Allowed');
}
