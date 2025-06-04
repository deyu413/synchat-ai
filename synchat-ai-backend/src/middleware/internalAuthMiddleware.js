// src/middleware/internalAuthMiddleware.js
// Environment variables should be loaded by the main server.js entry point

// It's generally safer to read process.env variables inside functions,
// especially for ES modules where initialization order can be complex.
// This ensures the value is read at runtime, after dotenv has configured it.

export const internalAuthMiddleware = (req, res, next) => {
    const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET; // Read at runtime
    const providedSecret = req.headers['x-internal-api-secret'];

    if (!INTERNAL_API_SECRET) {
        // This case means the server itself is misconfigured or dotenv didn't run/work as expected.
        console.error("CRITICAL: INTERNAL_API_SECRET is not defined in environment variables at runtime. Internal API endpoints will not be secure. Denying access.");
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
