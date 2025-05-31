// src/middleware/internalAuthMiddleware.js
import 'dotenv/config'; // To access environment variables

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

if (!INTERNAL_API_SECRET) {
    console.error("CRITICAL: INTERNAL_API_SECRET is not defined in environment variables. Internal API endpoints will not be secure.");
}

export const internalAuthMiddleware = (req, res, next) => {
    const providedSecret = req.headers['x-internal-api-secret'];

    if (!INTERNAL_API_SECRET) {
        // This case means the server itself is misconfigured.
        console.error("Internal API Security Alert: INTERNAL_API_SECRET is not configured on the server. Denying access.");
        return res.status(500).json({ message: "Internal server configuration error." });
    }

    if (!providedSecret) {
        console.warn("(InternalAuth) Missing X-Internal-Api-Secret header.");
        return res.status(401).json({ message: "Unauthorized: Missing required secret." });
    }

    if (providedSecret === INTERNAL_API_SECRET) {
        next();
    } else {
        console.warn("(InternalAuth) Invalid X-Internal-Api-Secret provided.");
        return res.status(403).json({ message: "Forbidden: Invalid secret." });
    }
};

export default internalAuthMiddleware; // Also export as default if preferred by router
