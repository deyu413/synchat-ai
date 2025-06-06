export default async function handler(req, res) { console.log('Reranker Microservice: Basic health check.'); return res.status(200).send('Basic rerank service is active.'); }
