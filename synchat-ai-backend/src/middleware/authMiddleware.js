// src/middleware/authMiddleware.js
import { supabase } from '../services/supabaseClient.js'; // Backend Supabase client

export const protectRoute = async (req, res, next) => {
    // 1. Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Acceso no autorizado. Token no proporcionado o formato incorrecto.' });
    }

    // 2. Extract token
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Acceso no autorizado. Token ausente después de Bearer.' });
    }

    try {
        // 3. Verify token with Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error) {
            console.warn('Error al verificar token Supabase:', error.message);
            // Distinguir entre errores de token inválido y otros errores de Supabase
            if (error.message.includes('invalid token') || error.message.includes('expired')) {
                 return res.status(403).json({ message: 'Acceso prohibido. Token inválido o expirado.' });
            }
            // Para otros errores de Supabase (ej. problema de red, configuración)
            return res.status(500).json({ message: 'Error del servidor al validar la autenticación.' });
        }

        if (!user) {
            // Esto podría ocurrir si el token es válido pero el usuario ya no existe o está inactivo
            return res.status(403).json({ message: 'Acceso prohibido. Usuario no encontrado o inactivo.' });
        }

        // 4. Attach user to request object
        req.user = user;
        console.log(`(Auth Middleware) Usuario autenticado: ${user.id}, Email: ${user.email}`);
        next();

    } catch (error) {
        // Catch inesperado, por si acaso
        console.error('Error inesperado en middleware de autenticación:', error);
        return res.status(500).json({ message: 'Error interno del servidor durante la autenticación.' });
    }
};

// Example of how to protect a specific role (optional for now, good for future)
// export const protectAdminRoute = async (req, res, next) => {
//     await protectRoute(req, res, async () => { // Primero verifica si es un usuario válido
//         if (req.user && req.user.app_metadata?.roles?.includes('admin')) {
//             next();
//         } else {
//             res.status(403).json({ message: 'Acceso prohibido. Requiere rol de administrador.' });
//         }
//     });
// };
