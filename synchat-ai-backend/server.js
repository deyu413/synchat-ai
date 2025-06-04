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

    if (normalizedOrigin === frontendAppURL) {
        logger.info(`[CORS] Request from main frontend app origin: ${origin} for path ${req.path}. Allowing.`);
        allowOrigin = true;
    } else if (process.env.NODE_ENV === 'development' && normalizedOrigin && (normalizedOrigin.startsWith('http://localhost:') || normalizedOrigin.startsWith('http://127.0.0.1:'))) {
        logger.info(`[CORS] Request from development localhost origin: ${origin} for path ${req.path}. Allowing.`);
        allowOrigin = true;
    } else if (isWidgetRoute) {
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

    if (!allowOrigin) {
         logger.warn(`[CORS] Origin ${normalizedOrigin} (Original: ${origin}) for path ${req.path} did not match explicit rules. Main Frontend URL: '${frontendAppURL}'. Defaulting to disallow.`);
    }

    corsOptions.origin = allowOrigin;

    if (req.method === 'OPTIONS') {
        // Para solicitudes preflight, necesitamos configurar los headers incluso si el origin es false inicialmente
        // El middleware 'cors' con la opción de delegate se encargará de enviar la respuesta correcta
        // basado en si corsOptions.origin se estableció a true o a un string de origen.
        // Si corsOptions.origin es true, permite los métodos y headers.
        // Si es false, el middleware cors debería denegar la solicitud OPTIONS apropiadamente.
        const preflightOptions = {
            origin: allowOrigin, // Esto reflejará si el origen fue permitido
            methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
            allowedHeaders: "Content-Type,Authorization,X-Client-Info,apikey,X-Supabase-Auth", // Asegúrate que Content-Type y Authorization estén aquí
            preflightContinue: false,
            optionsSuccessStatus: 204
        };
        callback(null, preflightOptions);
    } else {
        callback(null, corsOptions);
    }
};

// --- Middlewares ---
// Configurar CORS primero
app.use(cors(corsOptionsDelegate));

// Opcional: Manejador explícito para OPTIONS si el anterior no funciona como se espera en todas las rutas
// app.options('*', cors(corsOptionsDelegate)); // Puedes probar añadir esto si sigue fallando el preflight

// Stripe webhook specific middleware (ANTES de express.json global)
app.post('/api/payments/webhook', express.raw({type: 'application/json'}), (req, res, next) => {
    next();
});

// Middlewares esenciales de Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware simple para loggear peticiones
app.use((req, res, next) => {
    logger.debug(`Request: ${req.method} ${req.path} (Origin: ${req.header('Origin')})`);
    next();
});

// --- Rutas ---
app.get('/', (req, res) => {
    res.status(200).send('¡Backend de SynChat AI (v2 - Supabase) funcionando correctamente!');
});

logger.debug('>>> server.js: Mounting routes /api/auth');
app.use('/api/auth', authRoutes);
logger.info('>>> server.js: Routes /api/auth mounted');

// ... (resto de tus montajes de rutas: /api/chat, /api/client, etc.) ...
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
    res.status(statusCode).json({
         error: err.message || 'Error interno del servidor',
         ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
});

// --- Iniciar el Servidor ---
app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
    // ... (advertencias de variables de entorno existentes) ...
});
