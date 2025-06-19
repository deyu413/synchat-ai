// synchat-ai-backend/server.js
import 'dotenv/config'; // Loads .env from CWD (expected to be /app)

// NOTE: All other imports that might depend on process.env should come AFTER the line above.
// The .env file should now be in /app/.env

// --- INICIO DE LA MODIFICACIÓN ---
import { env as transformersEnv } from '@xenova/transformers';

// Forzar la configuración de la caché para @xenova/transformers
// al inicio de la aplicación para entornos serverless (Vercel).
// El directorio /tmp es el único lugar donde se pueden escribir archivos en tiempo de ejecución.
transformersEnv.cacheDir = '/tmp/transformers-cache';
transformersEnv.allowLocalModels = false;
// --- FIN DE LA MODIFICACIÓN ---

// Diagnostic log to see if INTERNAL_API_SECRET is loaded at this point in server.js
console.log(`[server.js] After 'dotenv/config' import - INTERNAL_API_SECRET: ${process.env.INTERNAL_API_SECRET}`);
// Log de confirmación para la nueva configuración
console.log(`[server.js] Transformers.js cache directory set to: ${transformersEnv.cacheDir}`);

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
import authRoutes from './src/routes/authRoutes.js'; // Keep for the target route

const app = express();
const PORT = process.env.PORT || 3001;

// Normaliza la URL del frontend principal una vez
const frontendAppURL = (process.env.FRONTEND_URL || 'https://synchat-ai.vercel.app').replace(/\/$/, '');

// Orígenes permitidos para el widget
// const widgetAllowedOriginsEnv = process.env.WIDGET_ALLOWED_ORIGINS || '';
// let widgetOriginsList = [];
// let allowAllForWidget = false;

// if (widgetAllowedOriginsEnv === '*') {
//     allowAllForWidget = true;
// } else {
//     if (widgetAllowedOriginsEnv) {
//         widgetOriginsList = widgetAllowedOriginsEnv.split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean);
//     }
//     // Ensure frontendAppURL is included if not allowing all and it's not already in the list
//     if (frontendAppURL && !widgetOriginsList.includes(frontendAppURL)) {
//         widgetOriginsList.push(frontendAppURL);
//     }
// }

// const corsOptionsDelegate = function (req, callback) {
//     let corsOptions;
//     const origin = req.header('Origin');

//     // Determinar si la petición es para la ruta raíz (health check)
//     const isHealthCheck = req.path === '/';

//     // Determinar si el origen es la aplicación frontend principal
//     const isFrontendApp = origin && frontendAppURL && origin === frontendAppURL;

//     // Determinar si el origen está permitido para el widget
//     // Si allowAllForWidget es true, cualquier origen es permitido para rutas del widget.
//     // Si no, se verifica contra widgetOriginsList.
//     // Esto aplica específicamente a rutas que comienzan con /api/public-chat (rutas del widget)
//     let isWidgetAllowed = false;
//     if (req.path.startsWith('/api/public-chat')) {
//         if (allowAllForWidget) {
//             isWidgetAllowed = true;
//         } else if (origin && widgetOriginsList.includes(origin)) {
//             isWidgetAllowed = true;
//         }
//     }

//     // Permite específicamente la ruta /api/auth/post-registration desde cualquier origen
//     // Esto es para manejar el caso donde el redirect desde el proveedor de auth (ej. Google)
//     // no tiene un Origin header o es null, o para simplificar la configuración inicial.
//     const isPostRegistration = req.path === '/api/auth/post-registration' && req.method === 'POST';

//     if (isFrontendApp || isWidgetAllowed || isHealthCheck || isPostRegistration) {
//         corsOptions = {
//             origin: true,
//             credentials: true,
//             methods: 'GET,POST,PUT,DELETE,OPTIONS', // Asegúrate que OPTIONS está aquí
//             allowedHeaders: 'Content-Type,Authorization,X-Requested-With,X-CSRF-Token,Device-ID,Auth-Token, Supabase-Auth-Token' // Cabeceras personalizadas
//         };
//         req.isCorsApproved = true;
//         // logger.info(`CORS check PASSED for origin: ${origin || 'Not specified'} (Path: ${req.path})`);
//     } else {
//         corsOptions = { origin: false }; // Rechazar otros orígenes
//         req.isCorsApproved = false;
//         logger.warn(`CORS check FAILED for origin: ${origin || 'Not specified'} (Path: ${req.path})`);
//     }
//     callback(null, corsOptions);
// };

// --- Middlewares ---

// --- START: New CORS Configuration ---

// Define the list of origins that are allowed to access this API
const allowedOrigins = [
  'https://synchat-ai.vercel.app', // Production Frontend
  // Add other origins for local development if needed, for example:
  // 'http://localhost:3000', // Example: Local React development server
  // 'http://127.0.0.1:5500'  // Example: Live Server for static HTML/JS
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests that don't have an origin (e.g., server-to-server, Postman)
    // These are typically non-browser requests or requests made from the same origin in some setups.
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      callback(new Error(msg), false);
    }
  }
  // You might also want to include other CORS options here if needed, for example:
  // methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // allowedHeaders: ['Content-Type', 'Authorization'],
  // credentials: true // If you need to support cookies or authorization headers
};

// Use the CORS middleware with these specific options
app.use(cors(corsOptions));

// --- END: New CORS Configuration ---


// Stripe webhook specific middleware (ANTES de express.json global)
app.post('/api/payments/webhook', express.raw({type: 'application/json'}), (req, res, next) => {
    next();
});

// Middlewares esenciales de Express
app.use(express.json()); // Middleware para parsear JSON - KEEP
app.use(express.urlencoded({ extended: true }));

// Middleware simple para loggear peticiones generales
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
app.use('/api/auth', authRoutes); // KEEP for the target route
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


// --- Manejo de Errores (Al final) --- // KEEP
app.use((req, res, next) => {
    logger.warn(`404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
    logger.error(`Global unhandled error: ${err.message}`, { path: req.path, stack: err.stack });
    if (!res.headersSent) {
        // Check if CORS was approved and an Origin header is present
        if (req.isCorsApproved === true && req.header('Origin')) {
            res.setHeader('Access-Control-Allow-Origin', req.header('Origin'));
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Vary', 'Origin'); // Important for caching
            logger.info(`(GlobalErrorHandler) Added CORS headers for approved origin: ${req.header('Origin')} for path: ${req.path}`);
        }

        res.status(err.status || 500).json({
            error: err.message || 'Error interno del servidor',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack }) // Keep dev stack trace
        });
    }
    // If headers were sent, Express's default mechanism will handle closing the connection.
});

// --- Iniciar el Servidor --- // KEEP
app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
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

export default app;
