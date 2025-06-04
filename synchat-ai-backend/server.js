// synchat-ai-backend/server.js
import 'dotenv/config'; // Keep for environment variables if authRoutes depends on them
import logger from './src/utils/logger.js';
import express from 'express';
import cors from 'cors';
// import apiRoutes from './src/routes/api.js'; // Commented out
// import clientDashboardRoutes from './src/routes/clientDashboardRoutes.js'; // Commented out
// import knowledgeManagementRoutes from './src/routes/knowledgeManagementRoutes.js'; // Commented out
// import inboxRoutes from './src/routes/inboxRoutes.js'; // Commented out
// import paymentRoutes from './src/routes/paymentRoutes.js'; // Commented out
// import publicChatRoutes from './src/routes/publicChatRoutes.js'; // Commented out
// import internalRoutes from './src/routes/internalRoutes.js'; // Commented out
import authRoutes from './src/routes/authRoutes.js'; // Keep for the target route

const app = express();
const PORT = process.env.PORT || 3001;

// Normaliza la URL del frontend principal una vez // Commented out
// const frontendAppURL = (process.env.FRONTEND_URL || 'https://synchat-ai.vercel.app').replace(/\/$/, ''); // Commented out

// Orígenes permitidos para el widget // Commented out
// const widgetAllowedOriginsEnv = process.env.WIDGET_ALLOWED_ORIGINS || ''; // Commented out
// let widgetOriginsList = []; // Commented out
// let allowAllForWidget = false; // Commented out

// if (widgetAllowedOriginsEnv === '*') { // Commented out
//     allowAllForWidget = true; // Commented out
// } else if (widgetAllowedOriginsEnv) { // Commented out
//     widgetOriginsList = widgetAllowedOriginsEnv.split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean); // Commented out
// } // Commented out

// const corsOptionsDelegate = function (req, callback) { // Commented out entire function
//     // ... (all original content of corsOptionsDelegate commented out)
// }; // Commented out

// --- Middlewares ---

// SIMPLIFIED: Wide-open CORS
app.use(cors({ origin: '*', methods: 'GET,POST,PUT,DELETE,OPTIONS', allowedHeaders: '*' }));
logger.info('!!!!!! SERVER.JS (SIMPLIFIED): Using wide-open CORS');


// TEMPORARY: Permissive CORS for /api/auth/post-registration // Commented out as the above global CORS should cover it
// app.use('/api/auth/post-registration', cors({ // Commented out
//     origin: '*', // Allow any origin // Commented out
//     methods: 'POST,OPTIONS', // Allow POST and OPTIONS // Commented out
//     allowedHeaders: '*', // Allow any headers // Commented out
//     credentials: true // If your frontend sends credentials // Commented out
// })); // Commented out
// logger.info('!!!!!! SERVER.JS: Applied TEMPORARY permissive CORS for /api/auth/post-registration'); // Commented out

// Logging before main CORS delegate for /api/auth/post-registration // Commented out as specific CORS delegate is removed
// app.use((req, res, next) => { // Commented out
//     if (req.path === '/api/auth/post-registration' && req.method === 'POST') { // Commented out
//         logger.info('!!!!!! SERVER.JS (PRE-CORS-DELEGATE): POST /api/auth/post-registration. Origin:', req.header('Origin'), 'Headers:', req.headers); // Commented out
//     } // Commented out
//     next(); // Commented out
// }); // Commented out

// Aplicar CORS globalmente ANTES de cualquier otra ruta o middleware que procese la solicitud. // Commented out
// app.use(cors(corsOptionsDelegate)); // Commented out

// Log ANTES de express.json para la ruta específica /api/auth/post-registration
app.use((req, res, next) => {
    if (req.path === '/api/auth/post-registration' && req.method === 'POST') {
        logger.info('!!!!!! SERVER.JS (SIMPLIFIED PRE-JSON): POST /api/auth/post-registration hit. Headers:', req.headers);
    }
    next();
});

// Stripe webhook specific middleware (ANTES de express.json global) // Commented out
// app.post('/api/payments/webhook', express.raw({type: 'application/json'}), (req, res, next) => { // Commented out
//     next(); // Commented out
// }); // Commented out

// Middlewares esenciales de Express
app.use(express.json()); // Middleware para parsear JSON - KEEP

// Log DESPUÉS de express.json para la ruta específica /api/auth/post-registration
app.use((req, res, next) => {
    if (req.path === '/api/auth/post-registration' && req.method === 'POST') {
        logger.info('!!!!!! SERVER.JS (SIMPLIFIED POST-JSON): POST /api/auth/post-registration passed express.json. Body:', req.body);
    }
    next();
});

// app.use(express.urlencoded({ extended: true })); // Commented out, assuming JSON is primary for this endpoint

// Middleware simple para loggear peticiones generales (después de los logs específicos) // Commented out
// app.use((req, res, next) => { // Commented out
//     logger.debug(`Request (General): ${req.method} ${req.path} (Origin: ${req.header('Origin')})`); // Commented out
//     next(); // Commented out
// }); // Commented out

// --- Rutas ---
// app.get('/', (req, res) => { // Commented out
//     res.status(200).send('¡Backend de SynChat AI (v2 - Supabase) funcionando correctamente!'); // Commented out
// }); // Commented out

// Montaje de rutas
// logger.debug('>>> server.js: Mounting routes /api/auth'); // Original log line commented
app.use('/api/auth', authRoutes); // KEEP for the target route
logger.info('!!!!!! SERVER.JS (SIMPLIFIED): Mounted /api/auth routes');


// Alternative direct handler for extreme simplification (as per instructions)
/*
app.post('/api/auth/post-registration', (req, res) => {
    logger.info('!!!!!! SERVER.JS (SIMPLIFIED HANDLER): POST /api/auth/post-registration reached handler. Body:', req.body);
    // Log everything possible about the request
    logger.info('!!!!!! SERVER.JS (SIMPLIFIED HANDLER): Request Headers:', req.headers);
    logger.info('!!!!!! SERVER.JS (SIMPLIFIED HANDLER): Request Method:', req.method);
    logger.info('!!!!!! SERVER.JS (SIMPLIFIED HANDLER): Request URL:', req.originalUrl);
    logger.info('!!!!!! SERVER.JS (SIMPLIFIED HANDLER): Request Query:', req.query);
    logger.info('!!!!!! SERVER.JS (SIMPLIFIED HANDLER): Request Params:', req.params);
    res.status(200).json({ message: 'Simplified handler reached successfully', body: req.body, headers: req.headers });
});
logger.info('!!!!!! SERVER.JS (SIMPLIFIED): Using DIRECT /api/auth/post-registration handler (authRoutes is NOT used).');
*/

// logger.debug('>>> server.js: Mounting routes /api/chat (legacy or other uses)'); // Commented out
// app.use('/api/chat', apiRoutes); // Commented out
// logger.info('>>> server.js: Routes /api/chat mounted'); // Commented out

// logger.debug('>>> server.js: Mounting routes /api/client'); // Commented out
// app.use('/api/client', clientDashboardRoutes); // Commented out
// logger.info('>>> server.js: Routes /api/client mounted'); // Commented out

// logger.debug('>>> server.js: Mounting routes /api/client/me/knowledge'); // Commented out
// app.use('/api/client/me/knowledge', knowledgeManagementRoutes); // Commented out
// logger.info('>>> server.js: Routes /api/client/me/knowledge mounted'); // Commented out

// logger.debug('>>> server.js: Mounting routes /api/client/me/inbox'); // Commented out
// app.use('/api/client/me/inbox', inboxRoutes); // Commented out
// logger.info('>>> server.js: Routes /api/client/me/inbox mounted'); // Commented out

// logger.debug('>>> server.js: Mounting routes /api/payments'); // Commented out
// app.use('/api/payments', paymentRoutes); // Commented out
// logger.info('>>> server.js: Routes /api/payments mounted'); // Commented out

// logger.debug('>>> server.js: Mounting routes /api/public-chat (for widget)'); // Commented out
// app.use('/api/public-chat', publicChatRoutes); // Commented out
// logger.info('>>> server.js: Routes /api/public-chat mounted'); // Commented out

// logger.debug('>>> server.js: Mounting routes /api/internal/v1'); // Commented out
// app.use('/api/internal/v1', internalRoutes); // Commented out
// logger.info('>>> server.js: Routes /api/internal/v1 mounted'); // Commented out


// --- Manejo de Errores (Al final) --- // KEEP
app.use((req, res, next) => {
    logger.warn(`!!!!!! SERVER.JS (SIMPLIFIED) 404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Ruta no encontrada (simplified server)' });
});

app.use((err, req, res, next) => {
    logger.error(`!!!!!! SERVER.JS (SIMPLIFIED) Global unhandled error: ${err.message}`, { path: req.path, stack: err.stack });
    // Remove specific 'Not allowed by CORS' check as CORS is wide open
    if (!res.headersSent) {
        res.status(err.status || 500).json({
            error: err.message || 'Error interno del servidor (simplified server)',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack }) // Keep dev stack trace
        });
    }
});

// --- Iniciar el Servidor --- // KEEP
app.listen(PORT, () => {
    logger.info(`!!!!!! SERVER.JS (SIMPLIFIED): Server listening on port ${PORT}`);
    // Comment out environment variable checks for simplicity during this debug phase
    // if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.OPENAI_API_KEY) {
    //     logger.warn("ADVERTENCIA: Una o más variables de entorno críticas (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY) no están definidas.");
    // }
    //  if (!process.env.FRONTEND_URL) {
    //      logger.warn("ADVERTENCIA: FRONTEND_URL no definida. CORS podría no funcionar como esperado sin fallback a localhost en desarrollo.");
    //  }
    //  if (!process.env.WIDGET_ALLOWED_ORIGINS) {
    //      logger.warn("ADVERTENCIA: WIDGET_ALLOWED_ORIGINS no definida. CORS para el widget podría no funcionar como esperado.");
    //  } else if (process.env.WIDGET_ALLOWED_ORIGINS === '*' && process.env.NODE_ENV === 'production') {
    //      logger.warn("ADVERTENCIA DE PRODUCCIÓN: WIDGET_ALLOWED_ORIGINS está configurado como '*' lo cual permite cualquier origen. Esto no es recomendado para producción.");
    //  }
});
