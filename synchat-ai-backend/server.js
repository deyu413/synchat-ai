// server.js (VERSIÓN DE PRUEBA ULTRA-SIMPLIFICADA para Vercel)
import http from 'http'; // Usaremos el módulo http nativo de Node.js

export default function handler(req, res) {
    // Log MUY básico al principio de la ejecución del handler
    console.log(`!!!!!!!!!! VERCEL FUNCTION HANDLER CALLED !!!!!!!!!!`);
    console.log(`!!!!!!!!!! Request: ${req.method} ${req.url}`);
    console.log(`!!!!!!!!!! Request Headers: ${JSON.stringify(req.headers)}`);

    // Responder a una ruta de prueba simple
    if (req.url === '/api/health-check-simple' && req.method === 'GET') {
        console.log('!!!!!!!!!! /api/health-check-simple HIT !!!!!!!!!!');
        res.writeHead(200, { 
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*', // CORS muy permisivo para esta prueba
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end('Simplified Health OK from Vercel function');
        return;
    }

    // Ruta específica para probar la llamada de post-registration
    if (req.url === '/api/auth/post-registration' && req.method === 'POST') {
        console.log('!!!!!!!!!! POST /api/auth/post-registration HIT (Simplified Server) !!!!!!!!!!');
        
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            console.log('!!!!!!!!!! POST /api/auth/post-registration - Received Body:', body);
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*', // CORS muy permisivo
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            });
            res.end(JSON.stringify({ message: 'Simplified post-registration endpoint reached', receivedBody: body }));
        });
        return;
    }
    
    // Manejar solicitudes OPTIONS para CORS de forma muy básica y permisiva
    if (req.method === 'OPTIONS') {
        console.log(`!!!!!!!!!! OPTIONS request for ${req.url} - Responding with permissive CORS headers !!!!!!!!!!`);
        res.writeHead(204, { // 204 No Content es común para preflight
            'Access-Control-Allow-Origin': req.headers.origin || '*', // Reflejar el origen o permitir todos
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400' // 1 día
        });
        res.end();
        return;
    }

    // Si no es ninguna de las rutas anteriores
    console.log(`!!!!!!!!!! Unhandled path by simplified server: ${req.method} ${req.url} !!!!!!!!!!`);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found by Simplified Handler');
}

// Nota: Ya no hay app.listen(PORT) porque Vercel maneja el servidor por nosotros
// cuando se usa el formato de export default function handler.
