// synchat-ai-backend/server.js
import 'dotenv/config';
import logger from './src/utils/logger.js';
import express from 'express';
import cors from 'cors';
import apiRoutes from './src/routes/api.js';
import clientDashboardRoutes from './src/routes/clientDashboardRoutes.js';
import knowledgeManagementRoutes from './src/routes/knowledgeManagementRoutes.js';
import inboxRoutes from './src/routes/inboxRoutes.js';
import paymentRoutes from './src/routes/paymentRoutes.js';
import publicChatRoutes from './src/routes/publicChatRoutes.js';
import internalRoutes from './src/routes/internalRoutes.js';
import authRoutes from './src/routes/authRoutes.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Normaliza la URL del frontend principal una vez
const frontendAppURL = (process.env.FRONTEND_URL || 'https://synchat-ai.vercel.app').replace(/\/$/, '');

// Orígenes permitidos para el widget
const widgetAllowedOriginsEnv = process.env.WIDGET_ALLOWED_ORIGINS || '';
let widgetOriginsList = [];
let allowAllForWidget = false;

if (widgetAllowedOriginsEnv === '*') {
    allowAllForWidget = true;
} else if (widgetAllowedOriginsEnv) {
    widgetOriginsList = widgetAllowedOriginsEnv.split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean);
}

const corsOptionsDelegate = function (req, callback) {
    let corsOptions = { origin: false }; // Default to disallow
    const origin = req.header('Origin');
    const normalizedOrigin = origin ? origin.replace(/\/$/, '') : '';
    let allowOrigin = false;

    const isWidgetRoute = req.path.startsWith('/api/public-chat');

    // Rule 1: Allow if the origin matches the main frontend application URL
    if (normalizedOrigin === frontendAppURL) {
        logger.info(`[CORS-DELEGATE] Request from main frontend app origin: ${origin} for path ${req.path}. Allowing.`);
        allowOrigin = true;
    }
    // Rule 2: Allow localhost in development environment for any route
    else if (process.env.NODE_ENV === 'development' && normalizedOrigin && (normalizedOrigin.startsWith('http://localhost:') || normalizedOrigin.startsWith('http://127.0.0.1:'))) {
        logger.info(`[CORS-DELEGATE] Request from development localhost origin: ${origin} for path ${req.path}. Allowing.`);
        allowOrigin = true;
    }
    // Rule 3: Specific logic for widget routes based on WIDGET_ALLOWED_ORIGINS
    else if (isWidgetRoute) {
        if (allowAllForWidget) {
            logger.info(`[CORS-DELEGATE] Widget route: WIDGET_ALLOWED_ORIGINS is *. Allowing origin: ${origin}`);
            allowOrigin = true;
        } else if (widgetOriginsList.includes(normalizedOrigin)) {
            logger.info(`[CORS-DELEGATE] Widget route: Origin ${origin} matched in WIDGET_ALLOWED_ORIGINS. Allowing.`);
            allowOrigin = true;
        } else {
            logger.warn(`[CORS-DELEGATE] Widget route: Origin ${origin} NOT ALLOWED by WIDGET_ALLOWED_ORIGINS: "${widgetAllowedOriginsEnv}"`);
        }
    }
    // Rule 4: Log for origins not covered explicitly (helps in debugging if a new origin needs to be allowed)
    else {
         logger.warn(`[CORS-DELEGATE] Origin ${normalizedOrigin} (Original: ${origin}) for path ${req.path} did not match explicit rules. Main Frontend URL: '${frontendAppURL}'. Defaulting to disallow.`);
    }

    corsOptions.origin = allowOrigin;

    // Handle preflight (OPTIONS) requests explicitly
    if (req.method === 'OPTIONS') {
        const preflightOptions = {
            origin: allowOrigin, // Reflects if the origin was permitted by the rules above
            methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
            allowedHeaders: "Content-Type,Authorization,X-Client-Info,apikey,X-Supabase-Auth", // Crucial: Ensure 'Content-Type' and 'Authorization' (if used) are here
            credentials: true, // Important if you plan to send cookies or use Authorization headers that depend on credentials
            preflightContinue: false, // The `cors` middleware will send the response itself
            optionsSuccessStatus: 204 // Standard for a successful preflight
        };
        callback(null, preflightOptions);
    } else {
        // For actual requests, just pass the determined corsOptions
        callback(null, corsOptions);
    }
};

// --- Middlewares ---
// Apply CORS globally first
app.use(cors(corsOptionsDelegate));

// Essential Express middlewares for body parsing
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

// Stripe webhook specific middleware (needs raw body, so place before general express.json if it was for all routes)
// However, since it's path-specific, it's fine here if other routes don't need raw body.
// If it was global `app.use(express.raw(...))`, it would need to be before `express.json()`.
app.post('/api/payments/webhook', express.raw({type: 'application/json'}), (req, res, next) => {
    // This specific route handler in paymentRoutes.js will use req.rawBody or req.body (as Buffer)
    next();
});

// Logging middleware (after CORS and body parsing, before routes)
app.use((req, res, next) => {
    const isPostRegistration = req.path === '/api/auth/post-registration' && req.method === 'POST';
    if (isPostRegistration) {
        logger.info('!!!!!! SERVER.JS (FULL - DEBUG): POST /api/auth/post-registration. Headers:', req.headers);
        logger.info('!!!!!! SERVER.JS (FULL - DEBUG): Body (after express.json):', req.body);
    } else {
        logger.debug(`Request (General): ${req.method} ${req.path} (Origin: ${req.header('Origin')})`);
    }
    next();
});


// --- Rutas ---
app.get('/', (req, res) => {
    res.status(200).send('¡Backend de SynChat AI (v2 - Supabase) funcionando correctamente!');
});

logger.info('>>> server.js: Mounting routes /api/auth');
app.use('/api/auth', authRoutes);
logger.info('>>> server.js: Routes /api/auth mounted');

logger.info('>>> server.js: Mounting routes /api/chat (legacy or other uses)');
app.use('/api/chat', apiRoutes);
logger.info('>>> server.js: Routes /api/chat mounted');

logger.info('>>> server.js: Mounting routes /api/client');
app.use('/api/client', clientDashboardRoutes);
logger.info('>>> server.js: Routes /api/client mounted');

logger.info('>>> server.js: Mounting routes /api/client/me/knowledge');
app.use('/api/client/me/knowledge', knowledgeManagementRoutes);
logger.info('>>> server.js: Routes /api/client/me/knowledge mounted');

logger.info('>>> server.js: Mounting routes /api/client/me/inbox');
app.use('/api/client/me/inbox', inboxRoutes);
logger.info('>>> server.js: Routes /api/client/me/inbox mounted');

logger.info('>>> server.js: Mounting routes /api/payments');
app.use('/api/payments', paymentRoutes);
logger.info('>>> server.js: Routes /api/payments mounted');

logger.info('>>> server.js: Mounting routes /api/public-chat (for widget)');
app.use('/api/public-chat', publicChatRoutes);
logger.info('>>> server.js: Routes /api/public-chat mounted');

logger.info('>>> server.js: Mounting routes /api/internal/v1');
app.use('/api/internal/v1', internalRoutes);
logger.info('>>> server.js: Routes /api/internal/v1 mounted');


// --- Manejo de Errores (Al final de todos los middlewares y rutas) ---
app.use((req, res, next) => {
    logger.warn(`404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
    logger.error(`Global unhandled error: ${err.message}`, { path: req.path, stack: err.stack });
    const statusCode = err.status || 500;
    if (err.message === 'Not allowed by CORS' && !res.headersSent) { // Específico del callback de CORS
        return res.status(403).json({ error: 'Not allowed by CORS' });
    }
    if (!res.headersSent) { // Evitar enviar respuesta si ya se envió una
        res.status(statusCode).json({
            error: err.message || 'Error interno del servidor',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    }
});

// --- Iniciar el Servidor ---
app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
    // Advertencias de variables de entorno (puedes mantenerlas o quitarlas si ya las has verificado)
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.OPENAI_API_KEY) {
        logger.warn("ADVERTENCIA: Variables críticas (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY) no definidas.");
    }
     if (!process.env.FRONTEND_URL) {
         logger.warn("ADVERTENCIA: FRONTEND_URL no definida. CORS podría no funcionar como esperado.");
     }
     if (!process.env.WIDGET_ALLOWED_ORIGINS) {
         logger.warn("ADVERTENCIA: WIDGET_ALLOWED_ORIGINS no definida. CORS para el widget podría no funcionar como esperado.");
     } else if (process.env.WIDGET_ALLOWED_ORIGINS === '*' && process.env.NODE_ENV === 'production') {
         logger.warn("ADVERTENCIA DE PRODUCCIÓN: WIDGET_ALLOWED_ORIGINS es '*' (permite cualquier origen). No recomendado para producción.");
     }
});

export default app; // Necesario para Vercel serverless functions
