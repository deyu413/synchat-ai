// server.js (Actualizado a ES Modules)
import 'dotenv/config'; // Carga .env al inicio usando la importación
import logger from './src/utils/logger.js';
import express from 'express';
import cors from 'cors';
import apiRoutes from './src/routes/api.js'; // Chat routes (potentially legacy or for other purposes)
import clientDashboardRoutes from './src/routes/clientDashboardRoutes.js'; // Client dashboard routes
import knowledgeManagementRoutes from './src/routes/knowledgeManagementRoutes.js'; // Knowledge management routes
import inboxRoutes from './src/routes/inboxRoutes.js'; // Shared Inbox routes
import paymentRoutes from './src/routes/paymentRoutes.js'; // Payment routes
import publicChatRoutes from './src/routes/publicChatRoutes.js'; // Public chat routes for the widget
import internalRoutes from './src/routes/internalRoutes.js'; // Internal routes for scheduled tasks etc.
import authRoutes from './src/routes/authRoutes.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Allowed origins for the widget, from environment variable
// Example WIDGET_ALLOWED_ORIGINS: "https://widget-test.com,http://localhost:8080" or "*"
const widgetAllowedOriginsEnv = process.env.WIDGET_ALLOWED_ORIGINS || ''; 
let allowedWidgetOrigins;

if (widgetAllowedOriginsEnv === '*') {
    allowedWidgetOrigins = true; // Allows all origins
} else if (widgetAllowedOriginsEnv) {
    allowedWidgetOrigins = widgetAllowedOriginsEnv.split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean);
} else {
    allowedWidgetOrigins = []; // Default to no specific widget origins if not set and not '*'
}

const frontendDashboardURL = process.env.FRONTEND_URL || 'https://synchat-ai.vercel.app/';

const corsOptionsDelegate = function (req, callback) {
    let corsOptions = { origin: false }; // Default to disallow
    const origin = req.header('Origin');
    // CORRECTED: Widget routes are under /api/public-chat
    const isWidgetRoute = req.path.startsWith('/api/public-chat'); 

    if (isWidgetRoute) {
        if (allowedWidgetOrigins === true) { // '*' configuration from WIDGET_ALLOWED_ORIGINS
            corsOptions.origin = true;
        } else if (allowedWidgetOrigins.length > 0 && origin && allowedWidgetOrigins.includes(origin)) {
            // Origin is in the explicit list from WIDGET_ALLOWED_ORIGINS
            logger.info(`[CORS] Widget Route: Origin ${origin} matched in allowedWidgetOrigins (normalized).`);
            corsOptions.origin = true;
        } else if (allowedWidgetOrigins.length === 0 && process.env.NODE_ENV === 'development') {
            // WIDGET_ALLOWED_ORIGINS is empty/not set, AND it's development mode.
            // Allow common localhost origins for widget development convenience.
            if (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
                logger.info(`(CORS) Allowing development widget origin: ${origin}`);
                corsOptions.origin = true;
            }
        }
        // If WIDGET_ALLOWED_ORIGINS is explicitly set but doesn't include the origin,
        // or if it's empty and not in development mode, or if origin is undefined,
        // corsOptions.origin remains false, thus disallowing the origin by default.
    } else { // For non-widget routes (e.g., dashboard /api/client, /api/payments, or general /api/chat)
        const normalizedOrigin = origin ? origin.replace(/\/$/, '') : '';
        const normalizedFrontendDashboardURL = frontendDashboardURL.replace(/\/$/, ''); // frontendDashboardURL is defined outside this function
        if (normalizedOrigin === normalizedFrontendDashboardURL) {
            logger.info(`[CORS] Dashboard Route: Origin ${origin} (normalized to ${normalizedOrigin}) matched frontendDashboardURL ${frontendDashboardURL} (normalized to ${normalizedFrontendDashboardURL}).`);
            corsOptions.origin = true;
        }
        // Optional: Add localhost for development if FRONTEND_URL is remote
        else if (process.env.NODE_ENV === 'development' && origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
            corsOptions.origin = true;
        }
    }
    
    callback(null, corsOptions); // Callback expects two params: error and options
};

// --- Middlewares ---

// Configurar CORS
app.use(cors(corsOptionsDelegate));

// Stripe webhook specific middleware (BEFORE global express.json)
app.post('/api/payments/webhook', express.raw({type: 'application/json'}), (req, res, next) => {
    next();
});

// Middlewares esenciales de Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware simple para loggear peticiones
app.use((req, res, next) => {
    logger.debug(`Request: ${req.method} ${req.path}`);
    next();
});

// --- Rutas ---

// Ruta de prueba básica
app.get('/', (req, res) => {
    res.status(200).send('¡Backend de SynChat AI (v2 - Supabase) funcionando correctamente!');
});

// Montaje de rutas API
// Note: /api/chat is still mounted, ensure it's used for intended purposes if not for the public widget.
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
app.use('/api/internal/v1', internalRoutes); // Using versioned path
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
         logger.warn("ADVERTENCIA: FRONTEND_URL no definida. CORS para el dashboard podría no funcionar como esperado sin fallback a localhost en desarrollo.");
     }
     if (!process.env.WIDGET_ALLOWED_ORIGINS) {
         logger.warn("ADVERTENCIA: WIDGET_ALLOWED_ORIGINS no definida. CORS para el widget podría no funcionar como esperado (o solo permitir localhost en desarrollo).");
     } else if (process.env.WIDGET_ALLOWED_ORIGINS === '*' && process.env.NODE_ENV === 'production') {
         logger.warn("ADVERTENCIA DE PRODUCCIÓN: WIDGET_ALLOWED_ORIGINS está configurado como '*' lo cual permite cualquier origen. Esto no es recomendado para producción.");
     }
});

// Final review pass complete.
// Another trivial comment for re-commit purposes.
// Re-commit attempt with new branch.
