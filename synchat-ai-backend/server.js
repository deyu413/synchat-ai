// server.js (Actualizado a ES Modules)
import 'dotenv/config'; // Carga .env al inicio usando la importación
import express from 'express';
import cors from 'cors';
import apiRoutes from './src/routes/api.js'; // Chat routes (potentially legacy or for other purposes)
import clientDashboardRoutes from './src/routes/clientDashboardRoutes.js'; // Client dashboard routes
import knowledgeManagementRoutes from './src/routes/knowledgeManagementRoutes.js'; // Knowledge management routes
import inboxRoutes from './src/routes/inboxRoutes.js'; // Shared Inbox routes
import paymentRoutes from './src/routes/paymentRoutes.js'; // Payment routes
import publicChatRoutes from './src/routes/publicChatRoutes.js'; // Public chat routes for the widget

const app = express();
const PORT = process.env.PORT || 3001;

// Allowed origins for the widget, from environment variable
// Example WIDGET_ALLOWED_ORIGINS: "https://widget-test.com,http://localhost:8080" or "*"
const widgetAllowedOriginsEnv = process.env.WIDGET_ALLOWED_ORIGINS || ''; 
let allowedWidgetOrigins;

if (widgetAllowedOriginsEnv === '*') {
    allowedWidgetOrigins = true; // Allows all origins
} else if (widgetAllowedOriginsEnv) {
    allowedWidgetOrigins = widgetAllowedOriginsEnv.split(',').map(origin => origin.trim()).filter(Boolean);
} else {
    allowedWidgetOrigins = []; // Default to no specific widget origins if not set and not '*'
}

const frontendDashboardURL = process.env.FRONTEND_URL || 'https://www.synchatai.com';

const corsOptionsDelegate = function (req, callback) {
    let corsOptions = { origin: false }; // Default to disallow
    const origin = req.header('Origin');
    // CORRECTED: Widget routes are under /api/public-chat
    const isWidgetRoute = req.path.startsWith('/api/public-chat'); 

    if (isWidgetRoute) {
        if (allowedWidgetOrigins === true) { // '*' configuration
            corsOptions.origin = true; // Allow any origin for widget routes
        } else if (allowedWidgetOrigins.length === 0 && !widgetAllowedOriginsEnv) {
            // If WIDGET_ALLOWED_ORIGINS is not set at all (empty string from env, resulting in empty array)
            // and not explicitly '*', we might want to default to a stricter policy (e.g., disallow all or allow none).
            // For now, if allowedWidgetOrigins is empty (because env var was empty), it will result in origin:false
            // unless it's caught by another rule (which it won't be for widget routes).
            // This means an unset WIDGET_ALLOWED_ORIGINS effectively blocks widget CORS unless '*' is used.
            // This behavior is acceptable.
             if (allowedWidgetOrigins.includes(origin)) { // This will be false if array is empty.
                corsOptions.origin = true;
             }
        } else if (allowedWidgetOrigins.includes(origin)) {
            corsOptions.origin = true; // Allow if origin is in the widget list
        }
    } else { // For non-widget routes (e.g., dashboard /api/client, /api/payments, or general /api/chat)
        if (origin === frontendDashboardURL) {
            corsOptions.origin = true; // Allow dashboard origin
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
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// --- Rutas ---

// Ruta de prueba básica
app.get('/', (req, res) => {
    res.status(200).send('¡Backend de SynChat AI (v2 - Supabase) funcionando correctamente!');
});

// Montaje de rutas API
// Note: /api/chat is still mounted, ensure it's used for intended purposes if not for the public widget.
console.log('>>> server.js: Montando rutas /api/chat (legacy or other uses)');
app.use('/api/chat', apiRoutes); 
console.log('>>> server.js: Rutas /api/chat montadas');

console.log('>>> server.js: Montando rutas /api/client');
app.use('/api/client', clientDashboardRoutes);
console.log('>>> server.js: Rutas /api/client montadas');

console.log('>>> server.js: Montando rutas /api/client/me/knowledge');
app.use('/api/client/me/knowledge', knowledgeManagementRoutes);
console.log('>>> server.js: Rutas /api/client/me/knowledge montadas');

console.log('>>> server.js: Montando rutas /api/client/me/inbox');
app.use('/api/client/me/inbox', inboxRoutes);
console.log('>>> server.js: Rutas /api/client/me/inbox montadas');

console.log('>>> server.js: Montando rutas /api/payments');
app.use('/api/payments', paymentRoutes);
console.log('>>> server.js: Rutas /api/payments montadas');

console.log('>>> server.js: Montando rutas /api/public-chat (for widget)');
app.use('/api/public-chat', publicChatRoutes);
console.log('>>> server.js: Rutas /api/public-chat montadas');


// --- Manejo de Errores (Al final) ---

app.use((req, res, next) => {
    console.log(`>>> server.js: MANEJADOR 404 para ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
    console.error("Error global no manejado:", err.stack || err);
    const statusCode = err.status || 500;
    res.status(statusCode).json({
         error: err.message || 'Error interno del servidor',
         ...(process.env.NODE_ENV === 'development' && { stack: err.stack }) 
        });
});

// --- Iniciar el Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.OPENAI_API_KEY) {
        console.warn("ADVERTENCIA: Una o más variables de entorno críticas (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY) no están definidas.");
    }
     if (!process.env.FRONTEND_URL) {
         console.warn("ADVERTENCIA: FRONTEND_URL no definida. CORS para el dashboard podría no funcionar como esperado sin fallback a localhost en desarrollo.");
     }
     if (!process.env.WIDGET_ALLOWED_ORIGINS) {
         console.warn("ADVERTENCIA: WIDGET_ALLOWED_ORIGINS no definida. CORS para el widget podría no funcionar como esperado.");
     }
});
