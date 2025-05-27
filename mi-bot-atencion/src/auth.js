// auth.js
// Importa el cliente Supabase que creaste antes
import { supabase } from './supabaseClientFrontend.js'; // Ajusta la ruta si es necesario

// Elementos del DOM
const authFormsDiv = document.getElementById('authForms');
const dashboardDiv = document.getElementById('dashboard');
const userInfoSpan = document.getElementById('userInfo');
const loginForm = document.getElementById('loginForm');
const signUpForm = document.getElementById('signUpForm');
const googleLoginBtn = document.getElementById('googleLoginBtn');
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
        // No es necesario redirigir aquí, onAuthStateChange lo hará.
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

async function handleLogout() {
    clearMessages();
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        console.log('Sesión cerrada');
        // onAuthStateChange se encargará de mostrar el formulario de login o redirigir
        // Si estás en dashboard.html, la redirección la gestiona updateAuthUI.
    } catch (error) {
        if (errorMessageDiv) errorMessageDiv.textContent = `Error al cerrar sesión: ${error.message}`;
        console.error('Error al cerrar sesión:', error.message);
    }
}

// --- Gestión del Estado de Autenticación ---
function updateAuthUI(session) {
    console.log('Auth State Change/UpdateUI:', session ? session.user?.email : 'No session');
    const dashboardContentEl = document.getElementById('dashboardContent'); 
    const userEmailSpanEl = document.getElementById('userEmail');

    if (session && session.user) {
        // Usuario está logueado
        if (authFormsDiv) authFormsDiv.classList.add('hidden');
        
        // Si hay sesión y NO estamos en dashboard.html, redirigir a dashboard.html
        if (!window.location.pathname.includes('dashboard.html')) {
            window.location.href = 'dashboard.html'; // <--- CORRECCIÓN AQUÍ
            return; 
        }

        // Si ya estamos en dashboard.html, mostrar el contenido
        // (Esta parte solo se ejecutará si la página actual ya es dashboard.html)
        if (dashboardContentEl) dashboardContentEl.classList.remove('hidden');
        if (userEmailSpanEl) userEmailSpanEl.textContent = session.user.email;
        
    } else {
        // Usuario no está logueado
        if (authFormsDiv) authFormsDiv.classList.remove('hidden');

        // Si estamos en dashboard.html y no hay sesión, redirigir a login.html
        if (window.location.pathname.includes('dashboard.html')) {
            if (dashboardContentEl) dashboardContentEl.classList.add('hidden');
            console.log("No session on dashboard page, redirecting to login...");
            window.location.href = 'login.html'; // <--- CORRECCIÓN/ACTIVACIÓN AQUÍ
            return;
        }
        
        // Para otras páginas (como login.html o registro.html) si el dashboardDiv existiera
        if (dashboardDiv) { 
             dashboardDiv.classList.add('hidden');
        }
        
        if (userEmailSpanEl) userEmailSpanEl.textContent = '';
        if (userInfoSpan) userInfoSpan.textContent = '';
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

// El botón de logout en dashboard.html ('logoutBtnDashboard')
// es manejado por dashboard.js. Si tienes un 'logoutBtn' genérico
// en otras páginas (como login.html o registro.html, aunque sería raro),
// este listener lo cubriría.
if (logoutBtn && !document.getElementById('logoutBtnDashboard')) { 
    logoutBtn.addEventListener('click', handleLogout);
}

// --- Funciones Auxiliares ---
function clearMessages() {
    if (authMessageDiv) authMessageDiv.textContent = '';
    if (errorMessageDiv) errorMessageDiv.textContent = '';
}

// Forzar una comprobación inicial del estado al cargar la página
(async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error("Error obteniendo sesión inicial:", error.message);
    }
    console.log('Sesión inicial comprobada:', session);
    updateAuthUI(session);
})();

console.log("Auth listeners y UI updater listos (con comprobaciones de existencia de elementos).");
