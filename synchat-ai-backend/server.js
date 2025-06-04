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
