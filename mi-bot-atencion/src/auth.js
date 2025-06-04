// mi-bot-atencion/src/auth.js
// Importa el cliente Supabase que creaste antes
import { supabase } from './supabaseClientFrontend.js'; // Ajusta la ruta si es necesario

// Elementos del DOM (asumimos que existen en las páginas donde se carga este script)
const authFormsDiv = document.getElementById('authForms');
const dashboardDiv = document.getElementById('dashboard'); // Usado para ocultar/mostrar en updateAuthUI
const userInfoSpan = document.getElementById('userInfo'); // Para mostrar email en algunas vistas
const loginForm = document.getElementById('loginForm');
const signUpForm = document.getElementById('signUpForm');
const googleLoginBtn = document.getElementById('googleLoginBtn');
// logoutBtn es referenciado globalmente pero el listener específico para dashboard.html está en dashboard.js
// Este script podría manejar un logoutBtn en login.html o registro.html si existiera.
const logoutBtn = document.getElementById('logoutBtn');
const authMessageDiv = document.getElementById('authMessage');
const errorMessageDiv = document.getElementById('errorMessage');

// --- Funciones de Autenticación ---

async function handleSignUp(event) {
    event.preventDefault();
    const emailInput = document.getElementById('signUpEmail');
    const passwordInput = document.getElementById('signUpPassword');

    if (!emailInput || !passwordInput) {
        console.error("Elementos del formulario de registro no encontrados.");
        if (errorMessageDiv) errorMessageDiv.textContent = 'Error interno del formulario.';
        return;
    }

    const email = emailInput.value;
    const password = passwordInput.value;
    clearMessages();

    try {
        console.log("AUTH.JS: Iniciando supabase.auth.signUp()...");
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });

        if (signUpError) {
            console.error('AUTH.JS: Error en supabase.auth.signUp():', signUpError.message);
            throw signUpError;
        }

        if (authMessageDiv) authMessageDiv.textContent = '¡Registro exitoso! Revisa tu email para confirmar (si es necesario).';
        console.log('AUTH.JS: Usuario registrado en Supabase Auth:', data?.user);

        if (data?.user && data.user.id && data.user.email) {
            console.log(`AUTH.JS: Usuario con ID ${data.user.id} y email ${data.user.email} creado en Supabase Auth. Procediendo a llamar al backend.`);
            // Call backend to create the synchat_clients entry
            try {
                const apiBaseUrl = window.SYNCHAT_CONFIG?.API_BASE_URL || '';
                if (!apiBaseUrl) {
                    console.error("AUTH.JS: API_BASE_URL no está configurada en window.SYNCHAT_CONFIG. No se puede llamar al backend.");
                    if (errorMessageDiv) errorMessageDiv.textContent = 'Error de configuración: No se pudo contactar al servidor para completar el registro.';
                    return; // No continuar si no hay URL base
                }

                const endpointUrl = `${apiBaseUrl}/api/auth/post-registration`;
                console.log(`AUTH.JS: Intentando llamar al backend en: ${endpointUrl}`);
                console.log(`AUTH.JS: Enviando userId: ${data.user.id}, userEmail: ${data.user.email}`);

                const backendResponse = await fetch(endpointUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        // Si tu endpoint de backend para post-registration está protegido por autenticación de usuario:
                        // Si Supabase devuelve una sesión inmediatamente (incluso antes de confirmar email, lo cual puede hacer),
                        // podrías usar data.session.access_token. Verifica la documentación de Supabase para tu flujo exacto.
                        // 'Authorization': `Bearer ${data.session?.access_token}`
                    },
                    body: JSON.stringify({
                        userId: data.user.id,
                        userEmail: data.user.email
                    })
                });

                console.log(`AUTH.JS: Respuesta del backend /post-registration - Status: ${backendResponse.status}`);
                const responseData = await backendResponse.json().catch(e => {
                    console.error('AUTH.JS: Error al parsear JSON de la respuesta del backend:', e);
                    return { message: `Error del servidor (no JSON): ${backendResponse.statusText}`};
                });


                if (!backendResponse.ok) {
                    console.error('AUTH.JS: Error en el backend /post-registration:', responseData.message || backendResponse.statusText);
                    if (errorMessageDiv) errorMessageDiv.textContent = `Registro completado, pero hubo un problema al configurar servicios adicionales: ${responseData.message || backendResponse.statusText}`;
                } else {
                    console.log('AUTH.JS: Backend /post-registration exitoso:', responseData.message);
                    if (authMessageDiv) authMessageDiv.textContent += ' ¡Configuración de cliente completada!';
                }
            } catch (backendCallError) {
                console.error('AUTH.JS: Excepción al llamar al backend /post-registration:', backendCallError);
                if (errorMessageDiv) errorMessageDiv.textContent = `Registro completado, pero ocurrió una excepción al contactar al servidor: ${backendCallError.message}`;
            }
        } else {
            console.warn('AUTH.JS: data.user o sus propiedades id/email no disponibles después del registro en Supabase Auth. No se puede llamar al backend para crear entrada en synchat_clients.');
            if (errorMessageDiv) errorMessageDiv.textContent = 'Registro en Supabase Auth parcial, no se pudo completar la configuración del cliente.';
        }

        if (signUpForm) signUpForm.reset();
        // onAuthStateChange se encargará de la redirección si es necesario (ej. a login o dashboard)
        // o la actualización de la UI.
    } catch (error) {
        if (errorMessageDiv) errorMessageDiv.textContent = `Error en registro: ${error.message}`;
        console.error('AUTH.JS: Error general en handleSignUp:', error.message);
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');

    if (!emailInput || !passwordInput) {
        console.error("Elementos del formulario de login no encontrados.");
        if (errorMessageDiv) errorMessageDiv.textContent = 'Error interno del formulario.';
        return;
    }

    const email = emailInput.value;
    const password = passwordInput.value;
    clearMessages();

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (authMessageDiv) authMessageDiv.textContent = 'Inicio de sesión correcto. Redirigiendo...';
        console.log('Usuario logueado:', data.user);
        // onAuthStateChange se encargará de la redirección final a través de updateAuthUI
        if (loginForm) loginForm.reset();
    } catch (error) {
        if (errorMessageDiv) errorMessageDiv.textContent = `Error en login: ${error.message}`;
        console.error('Error en login:', error.message);
    }
}

async function handleGoogleLogin() {
    clearMessages();
    try {
        const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
        if (error) throw error;
        // Supabase maneja la redirección
    } catch (error) {
        if (errorMessageDiv) errorMessageDiv.textContent = `Error con Google: ${error.message}`;
        console.error('Error con Google:', error.message);
    }
}

export async function logout() {
    clearMessages();
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        console.log('Sesión cerrada');
        // onAuthStateChange se encargará de mostrar el formulario de login o redirigir.
    } catch (error) {
        if (errorMessageDiv) {
             errorMessageDiv.textContent = `Error al cerrar sesión: ${error.message}`;
        }
        console.error('Error al cerrar sesión:', error.message);
    }
}

function updateAuthUI(session) {
    console.log('Auth State Change/UpdateUI:', session ? session.user?.email : 'No session');
    const dashboardContentEl = document.getElementById('dashboardContent');
    const userEmailSpanEl = document.getElementById('userEmail');

    const isOnDashboardPage = window.location.pathname.includes('dashboard.html');
    const isOnLoginPage = window.location.pathname.includes('login.html');
    const isOnRegisterPage = window.location.pathname.includes('registro.html');

    if (session && session.user) {
        if (authFormsDiv) authFormsDiv.classList.add('hidden');

        localStorage.setItem('synchat_session_token', session.access_token);
        localStorage.setItem('synchat_user_email', session.user.email);

        if (!isOnDashboardPage) {
            console.log("Usuario logueado, redirigiendo a dashboard.html");
            window.location.href = 'dashboard.html'; // Asumiendo que dashboard.html está en la misma ruta base
            return;
        }

        if (dashboardContentEl) dashboardContentEl.classList.remove('hidden');
        if (userEmailSpanEl) userEmailSpanEl.textContent = session.user.email;
        const loadingMessageEl = document.getElementById('loadingMessage');
        if(loadingMessageEl) loadingMessageEl.style.display = 'none';

    } else {
        localStorage.removeItem('synchat_session_token');
        localStorage.removeItem('synchat_user_email');

        if (isOnDashboardPage) {
            console.log("No session on dashboard page, redirecting to login.html");
            window.location.href = 'login.html'; // Asumiendo que login.html está en la misma ruta base
            return;
        }

        if (authFormsDiv && (isOnLoginPage || isOnRegisterPage)) {
            authFormsDiv.classList.remove('hidden');
        }

        if (dashboardDiv) dashboardDiv.classList.add('hidden');
        if (dashboardContentEl) dashboardContentEl.classList.add('hidden');

        if (userEmailSpanEl) userEmailSpanEl.textContent = '';
        if (userInfoSpan) userInfoSpan.textContent = '';
    }
}

supabase.auth.onAuthStateChange((event, session) => {
    console.log(`onAuthStateChange event: ${event}`, session);
    updateAuthUI(session);
});

if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
}
if (signUpForm) {
    signUpForm.addEventListener('submit', handleSignUp);
}
if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', handleGoogleLogin);
}

if (logoutBtn && !document.getElementById('logoutBtnDashboard')) {
    logoutBtn.addEventListener('click', logout);
}

function clearMessages() {
    if (authMessageDiv) authMessageDiv.textContent = '';
    if (errorMessageDiv) errorMessageDiv.textContent = '';
}

(async () => {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
            console.error("Error obteniendo sesión inicial:", error.message);
            updateAuthUI(null);
            return;
        }
        console.log('Sesión inicial comprobada:', session);
        updateAuthUI(session);
    } catch (e) {
        console.error("Excepción catastrófica obteniendo sesión inicial:", e);
        updateAuthUI(null);
    }
})();

console.log("Auth.js: Listeners y UI updater listos.");
