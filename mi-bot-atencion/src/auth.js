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
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (authMessageDiv) authMessageDiv.textContent = '¡Registro exitoso! Revisa tu email para confirmar (si es necesario).';
        console.log('Usuario registrado:', data.user);
        if (signUpForm) signUpForm.reset();
        // onAuthStateChange se encargará de la redirección si es necesario (ej. a login o dashboard)
    } catch (error) {
        if (errorMessageDiv) errorMessageDiv.textContent = `Error en registro: ${error.message}`;
        console.error('Error en registro:', error.message);
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

// Renombrada de handleLogout a logout y exportada
export async function logout() {
    clearMessages();
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        console.log('Sesión cerrada');
        // onAuthStateChange se encargará de mostrar el formulario de login o redirigir.
        // Si estás en dashboard.html, la redirección la gestiona updateAuthUI.
        // Si estás en login.html o registro.html, simplemente actualizará la UI para mostrar los forms.
        // No es necesario redirigir desde aquí explícitamente.
    } catch (error) {
        if (errorMessageDiv) { // Asegúrate de que errorMessageDiv existe en el contexto actual
             errorMessageDiv.textContent = `Error al cerrar sesión: ${error.message}`;
        }
        console.error('Error al cerrar sesión:', error.message);
    }
}

// --- Gestión del Estado de Autenticación ---
function updateAuthUI(session) {
    console.log('Auth State Change/UpdateUI:', session ? session.user?.email : 'No session');
    const dashboardContentEl = document.getElementById('dashboardContent'); 
    const userEmailSpanEl = document.getElementById('userEmail'); // Asumo que este es el de dashboard.html

    const isOnDashboardPage = window.location.pathname.includes('dashboard.html');
    const isOnLoginPage = window.location.pathname.includes('login.html');
    const isOnRegisterPage = window.location.pathname.includes('registro.html');

    if (session && session.user) {
        // Usuario está logueado
        if (authFormsDiv) authFormsDiv.classList.add('hidden'); // Oculta formularios de login/registro
        
        // Guardar token y email para uso en dashboard.js
        localStorage.setItem('synchat_session_token', session.access_token);
        localStorage.setItem('synchat_user_email', session.user.email);

        if (!isOnDashboardPage) {
            console.log("Usuario logueado, redirigiendo a dashboard.html");
            window.location.href = 'dashboard.html';
            return; 
        }

        // Si ya estamos en dashboard.html, mostrar el contenido
        if (dashboardContentEl) dashboardContentEl.classList.remove('hidden');
        if (userEmailSpanEl) userEmailSpanEl.textContent = session.user.email;
        // Ocultar mensaje de carga si estaba visible
        const loadingMessageEl = document.getElementById('loadingMessage');
        if(loadingMessageEl) loadingMessageEl.style.display = 'none';
        
    } else {
        // Usuario no está logueado
        localStorage.removeItem('synchat_session_token');
        localStorage.removeItem('synchat_user_email');

        if (isOnDashboardPage) {
            console.log("No session on dashboard page, redirecting to login.html");
            window.location.href = 'login.html';
            return;
        }
        
        // En páginas de login/registro, asegurarse de que los formularios sean visibles
        if (authFormsDiv && (isOnLoginPage || isOnRegisterPage)) {
            authFormsDiv.classList.remove('hidden');
        }
        
        // Ocultar dashboardDiv si existe y no estamos en dashboard.html (esto es más una salvaguarda)
        if (dashboardDiv) dashboardDiv.classList.add('hidden'); 
        if (dashboardContentEl) dashboardContentEl.classList.add('hidden'); // Específicamente para dashboardContent

        if (userEmailSpanEl) userEmailSpanEl.textContent = ''; // En dashboard
        if (userInfoSpan) userInfoSpan.textContent = ''; // En login/registro (si existiera)
    }
}


// Escucha cambios en el estado de autenticación (login, logout)
supabase.auth.onAuthStateChange((event, session) => {
    console.log(`onAuthStateChange event: ${event}`, session);
    updateAuthUI(session);
});

// --- Asignar Event Listeners ---
if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
}
if (signUpForm) {
    signUpForm.addEventListener('submit', handleSignUp);
}
if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', handleGoogleLogin);
}

// Este listener para un botón de logout genérico (no el del dashboard)
// se activaría si existiera un botón con id="logoutBtn" en login.html o registro.html
if (logoutBtn && !document.getElementById('logoutBtnDashboard')) { 
    logoutBtn.addEventListener('click', logout); // Llamando a la función exportada
}

// --- Funciones Auxiliares ---
function clearMessages() {
    if (authMessageDiv) authMessageDiv.textContent = '';
    if (errorMessageDiv) errorMessageDiv.textContent = '';
}

// Forzar una comprobación inicial del estado al cargar la página
(async () => {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
            console.error("Error obteniendo sesión inicial:", error.message);
            // No llamar a updateAuthUI si hay error crítico obteniendo la sesión,
            // o pasar null explícitamente para forzar estado de no logueado.
            updateAuthUI(null);
            return;
        }
        console.log('Sesión inicial comprobada:', session);
        updateAuthUI(session);
    } catch (e) {
        console.error("Excepción catastrófica obteniendo sesión inicial:", e);
        updateAuthUI(null); // Asegurar un estado de UI consistente
    }
})();

console.log("Auth.js: Listeners y UI updater listos.");
