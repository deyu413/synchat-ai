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
    let corsOptions = { origin: false }; // Por defecto, no permitir
    const origin = req.header('Origin');
    const normalizedOrigin = origin ? origin.replace(/\/$/, '') : '';
    let allowOrigin = false;

    const isWidgetRoute = req.path.startsWith('/api/public-chat');

    // Regla 1: Permitir siempre si el origen coincide con la URL principal de la aplicación/dashboard
    if (normalizedOrigin === frontendAppURL) {
        logger.info(`[CORS] Request from main frontend app origin: ${origin} for path ${req.path}. Allowing.`);
        allowOrigin = true;
    }
    // Regla 2: Permitir siempre localhost en desarrollo (para cualquier ruta)
    else if (process.env.NODE_ENV === 'development' && normalizedOrigin && (normalizedOrigin.startsWith('http://localhost:') || normalizedOrigin.startsWith('http://127.0.0.1:'))) {
        logger.info(`[CORS] Request from development localhost origin: ${origin} for path ${req.path}. Allowing.`);
        allowOrigin = true;
    }
    // Regla 3: Lógica específica para rutas de widget
    else if (isWidgetRoute) {
        if (allowAllForWidget) {
            logger.info(`[CORS] Widget route: WIDGET_ALLOWED_ORIGINS is *. Allowing origin: ${origin}`);
            allowOrigin = true;
        } else if (widgetOriginsList.includes(normalizedOrigin)) {
            logger.info(`[CORS] Widget route: Origin ${origin} matched in WIDGET_ALLOWED_ORIGINS. Allowing.`);
            allowOrigin = true;
        } else {
            logger.warn(`[CORS] Widget route: Origin ${origin} NOT ALLOWED by WIDGET_ALLOWED_ORIGINS: "${widgetAllowedOriginsEnv}"`);
        }
    }
    // Regla 4: Log para orígenes no cubiertos
    else {
         logger.warn(`[CORS] Origin ${normalizedOrigin} (Original: ${origin}) for path ${req.path} did not match explicit rules. Main Frontend URL: '${frontendAppURL}'. Defaulting to disallow.`);
    }

    corsOptions.origin = allowOrigin;

    // Para solicitudes preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
        const preflightOptions = {
            origin: allowOrigin, // Refleja si el origen fue permitido por las reglas de arriba
            methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
            allowedHeaders: "Content-Type,Authorization,X-Client-Info,apikey,X-Supabase-Auth", // Headers que el frontend puede enviar
            credentials: true,
            preflightContinue: false,
            optionsSuccessStatus: 204 // o 200; 204 es común para preflight exitoso
        };
        callback(null, preflightOptions);
    } else {
        callback(null, corsOptions);
    }
};

// --- Middlewares ---
// Aplicar CORS globalmente ANTES de cualquier otra ruta o middleware que procese la solicitud.
app.use(cors(corsOptionsDelegate));

// Log ANTES de express.json para la ruta específica /api/auth/post-registration
app.use((req, res, next) => {
    if (req.path === '/api/auth/post-registration' && req.method === 'POST') {
        logger.info('!!!!!! SERVER.JS (PRE-JSON): POST /api/auth/post-registration hit. Headers:', req.headers);
    }
    next();
});

// Stripe webhook specific middleware (ANTES de express.json global)
app.post('/api/payments/webhook', express.raw({type: 'application/json'}), (req, res, next) => {
    next();
});

// Middlewares esenciales de Express
app.use(express.json()); // Middleware para parsear JSON

// Log DESPUÉS de express.json para la ruta específica /api/auth/post-registration
app.use((req, res, next) => {
    if (req.path === '/api/auth/post-registration' && req.method === 'POST') {
        logger.info('!!!!!! SERVER.JS (POST-JSON): POST /api/auth/post-registration passed express.json. Body:', req.body);
    }
    next();
});

app.use(express.urlencoded({ extended: true }));

// Middleware simple para loggear peticiones generales (después de los logs específicos)
app.use((req, res, next) => {
    logger.debug(`Request (General): ${req.method} ${req.path} (Origin: ${req.header('Origin')})`);
    next();
});

// --- Rutas ---
app.get('/', (req, res) => {
    res.status(200).send('¡Backend de SynChat AI (v2 - Supabase) funcionando correctamente!');
});

// Montaje de rutas
logger.debug('>>> server.js: Mounting routes /api/auth');
app.use('/api/auth', authRoutes);
logger.info('>>> server.js: Routes /api/auth mounted');

logger.debug('>>> server.js: Mounting routes /api/chat (legacy or other uses)');
app.use('/api/chat', apiRoutes);
logger.info('>>> server.js: Routes /api/chat mounted');

logger.debug('>>> server.js: Mounting routes /api/client');
app.use('/api/client', clientDashboardRoutes);
logger.info('>>> server.js: Routes /api/client mounted');

logger.debug('>>> server.js: Mounting routes /api/client/me/knowledge');
app.use('/api/client/me/knowledge', knowledgeManagementRoutes);
logger.info('>>> server.js: Routes /api/client/me/knowledge mounted');

logger.debug('>>> server.js: Mounting routes /api/client/me/inbox');
app.use('/api/client/me/inbox', inboxRoutes);
logger.info('>>> server.js: Routes /api/client/me/inbox mounted');

logger.debug('>>> server.js: Mounting routes /api/payments');
app.use('/api/payments', paymentRoutes);
logger.info('>>> server.js: Routes /api/payments mounted');

logger.debug('>>> server.js: Mounting routes /api/public-chat (for widget)');
app.use('/api/public-chat', publicChatRoutes);
logger.info('>>> server.js: Routes /api/public-chat mounted');

logger.debug('>>> server.js: Mounting routes /api/internal/v1');
app.use('/api/internal/v1', internalRoutes);
logger.info('>>> server.js: Routes /api/internal/v1 mounted');


// --- Manejo de Errores (Al final) ---
app.use((req, res, next) => {
    logger.warn(`404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
    logger.error(`Global unhandled error: ${err.message}`, { path: req.path, stack: err.stack });
    const statusCode = err.status || 500;
    if (err.message === 'Not allowed by CORS' && !res.headersSent) {
        return res.status(403).json({ error: 'Not allowed by CORS' });
    }
    if (!res.headersSent) {
        res.status(statusCode).json({
            error: err.message || 'Error interno del servidor',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    }
});

// --- Iniciar el Servidor ---
app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.OPENAI_API_KEY) {
        logger.warn("ADVERTENCIA: Una o más variables de entorno críticas (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY) no están definidas.");
    }
     if (!process.env.FRONTEND_URL) {
         logger.warn("ADVERTENCIA: FRONTEND_URL no definida. CORS podría no funcionar como esperado sin fallback a localhost en desarrollo.");
     }
     if (!process.env.WIDGET_ALLOWED_ORIGINS) {
         logger.warn("ADVERTENCIA: WIDGET_ALLOWED_ORIGINS no definida. CORS para el widget podría no funcionar como esperado.");
     } else if (process.env.WIDGET_ALLOWED_ORIGINS === '*' && process.env.NODE_ENV === 'production') {
         logger.warn("ADVERTENCIA DE PRODUCCIÓN: WIDGET_ALLOWED_ORIGINS está configurado como '*' lo cual permite cualquier origen. Esto no es recomendado para producción.");
     }
});
