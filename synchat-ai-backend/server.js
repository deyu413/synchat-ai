// server.js (Actualizado a ES Modules)
import 'dotenv/config'; // Carga .env al inicio usando la importación
import express from 'express';
import cors from 'cors';
import apiRoutes from './src/routes/api.js'; // Chat routes
import clientDashboardRoutes from './src/routes/clientDashboardRoutes.js'; // Client dashboard routes
import paymentRoutes from './src/routes/paymentRoutes.js'; // Payment routes

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares ---

// Configurar CORS
app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://www.synchatai.com' // Usar variable de entorno es mejor
}));

// Stripe webhook specific middleware (BEFORE global express.json)
// This ensures that for the '/api/payments/webhook' route, we get the raw body.
app.post('/api/payments/webhook', express.raw({type: 'application/json'}), (req, res, next) => {
    // Attach rawBody to req object for the actual handler in paymentRoutes
    // The paymentRoutes router will be configured to handle /api/payments path,
    // so its /webhook sub-route will match this.
    // We call next() to pass control to the paymentRoutes handler.
    // Note: This approach of globally applying raw middleware to a specific path
    // before other routers might be too broad if other POSTs to this path exist
    // and expect express.json(). However, for a dedicated webhook URL, it's common.
    // A more encapsulated way is to apply this middleware directly in the paymentRoutes file
    // or when defining the specific webhook route if express router allows per-route middleware easily.
    // For this setup, we ensure paymentRoutes's webhook handler can access req.rawBody.
    // The actual /api/payments/webhook handler is in paymentRoutes.
    // This middleware just ensures the body is raw for that specific path.
    next();
});


// Middlewares esenciales de Express
// express.json() should come AFTER the specific raw middleware for webhook if paths overlap,
// or if we want to ensure raw body for webhooks and parsed JSON for other routes.
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
console.log('>>> server.js: Montando rutas /api/chat');
app.use('/api/chat', apiRoutes);
console.log('>>> server.js: Rutas /api/chat montadas');

console.log('>>> server.js: Montando rutas /api/client');
app.use('/api/client', clientDashboardRoutes);
console.log('>>> server.js: Rutas /api/client montadas');

console.log('>>> server.js: Montando rutas /api/payments');
app.use('/api/payments', paymentRoutes);
console.log('>>> server.js: Rutas /api/payments montadas');


// --- Manejo de Errores (Al final) ---

// Middleware para manejar rutas no encontradas (404)
app.use((req, res, next) => {
    console.log(`>>> server.js: MANEJADOR 404 para ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Ruta no encontrada' });
});

// Middleware para manejo de errores global
app.use((err, req, res, next) => {
    console.error("Error global no manejado:", err.stack || err);
    // Evitar enviar detalles del error en producción
    const statusCode = err.status || 500;
    res.status(statusCode).json({
         error: err.message || 'Error interno del servidor',
         ...(process.env.NODE_ENV === 'development' && { stack: err.stack }) // Añadir stack en desarrollo
        });
});

// --- Iniciar el Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.OPENAI_API_KEY) {
        console.warn("ADVERTENCIA: Una o más variables de entorno (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY) no están definidas.");
    }
     if (!process.env.FRONTEND_URL) {
         console.warn("ADVERTENCIA: FRONTEND_URL no definida en .env, usando fallback para CORS.");
     }
});

// No se necesita 'module.exports' con ES Modules
