// server.js (Actualizado a ES Modules)
import 'dotenv/config'; // Carga .env al inicio usando la importación
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

    const isWidgetRoute = req.path.startsWith('/api/public-chat');

    // 1. Permitir siempre si el origen coincide con la URL principal de la aplicación/dashboard
    if (normalizedOrigin === frontendAppURL) {
        logger.info(`[CORS] Request from main frontend app origin: ${origin}. Allowing.`);
        corsOptions.origin = true;
    }
    // 2. Permitir siempre localhost en desarrollo (para cualquier ruta)
    else if (process.env.NODE_ENV === 'development' && origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
        logger.info(`[CORS] Request from development localhost origin: ${origin}. Allowing.`);
        corsOptions.origin = true;
    }
    // 3. Lógica específica para rutas de widget
    else if (isWidgetRoute) {
        if (allowAllForWidget) {
            logger.info(`[CORS] Widget route: WIDGET_ALLOWED_ORIGINS is *. Allowing origin: ${origin}`);
            corsOptions.origin = true;
        } else if (widgetOriginsList.includes(normalizedOrigin)) {
            logger.info(`[CORS] Widget route: Origin ${origin} matched in WIDGET_ALLOWED_ORIGINS. Allowing.`);
            corsOptions.origin = true;
        } else {
            logger.warn(`[CORS] Widget route: Origin ${origin} NOT ALLOWED by WIDGET_ALLOWED_ORIGINS: "${widgetAllowedOriginsEnv}"`);
        }
    }
    // 4. Log si no se cumplió ninguna regla de permiso explícita (y no es localhost dev o el frontend principal)
    else if (!corsOptions.origin) {
         logger.warn(`[CORS] Request from origin ${origin} to path ${req.path} - Not explicitly allowed by current rules. Check frontendAppURL ('${frontendAppURL}') and widget specific rules.`);
    }

    callback(null, corsOptions);
};

// --- Middlewares ---
app.use(cors(corsOptionsDelegate));

app.post('/api/payments/webhook', express.raw({type: 'application/json'}), (req, res, next) => {
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    logger.debug(`Request: ${req.method} ${req.path}`);
    next();
});

// --- Rutas ---
app.get('/', (req, res) => {
    res.status(200).send('¡Backend de SynChat AI (v2 - Supabase) funcionando correctamente!');
});

logger.debug('>>> server.js: Mounting routes /api/chat');
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

logger.debug('>>> server.js: Mounting routes /api/auth');
app.use('/api/auth', authRoutes);
logger.info('>>> server.js: Routes /api/auth mounted');

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
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.OPENAI_API_KEY) {
        logger.warn("ADVERTENCIA: Una o más variables de entorno críticas (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY) no están definidas.");
    }
     if (!process.env.FRONTEND_URL) {
         logger.warn("ADVERTENCIA: FRONTEND_URL no definida. CORS para el dashboard y otras rutas podría no funcionar como esperado sin fallback a localhost en desarrollo.");
     }
     if (!process.env.WIDGET_ALLOWED_ORIGINS) {
         logger.warn("ADVERTENCIA: WIDGET_ALLOWED_ORIGINS no definida. CORS para el widget podría no funcionar como esperado (o solo permitir localhost en desarrollo).");
     } else if (process.env.WIDGET_ALLOWED_ORIGINS === '*' && process.env.NODE_ENV === 'production') {
         logger.warn("ADVERTENCIA DE PRODUCCIÓN: WIDGET_ALLOWED_ORIGINS está configurado como '*' lo cual permite cualquier origen. Esto no es recomendado para producción.");
     }
});
