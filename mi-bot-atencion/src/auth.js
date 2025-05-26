// auth.js
// Importa el cliente Supabase que creaste antes
import { supabase } from './supabaseClientFrontend.js'; // Ajusta la ruta si es necesario

// Elementos del DOM
const authFormsDiv = document.getElementById('authForms');
const dashboardDiv = document.getElementById('dashboard'); // Nota: En dashboard.html el ID es 'dashboardContent'
const userInfoSpan = document.getElementById('userInfo'); // Nota: En dashboard.html el ID es 'userEmail'
const loginForm = document.getElementById('loginForm');
const signUpForm = document.getElementById('signUpForm');
const googleLoginBtn = document.getElementById('googleLoginBtn');
const logoutBtn = document.getElementById('logoutBtn'); // Nota: En dashboard.html el ID es 'logoutBtnDashboard'
const authMessageDiv = document.getElementById('authMessage');
const errorMessageDiv = document.getElementById('errorMessage');

// --- Funciones de Autenticación ---

async function handleSignUp(event) {
    event.preventDefault(); // Evitar recarga de página
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
        if (signUpForm) signUpForm.reset(); // Limpiar formulario
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
        if (authMessageDiv) authMessageDiv.textContent = 'Inicio de sesión correcto.';
        console.log('Usuario logueado:', data.user);
        // onAuthStateChange se encargará de mostrar el dashboard
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

async function handleLogout() {
    clearMessages();
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        console.log('Sesión cerrada');
        // onAuthStateChange se encargará de mostrar el formulario de login
        // Si estás en dashboard.html y quieres redirigir, puedes hacerlo aquí:
        // if (window.location.pathname.includes('dashboard.html')) {
        //     window.location.href = 'login.html'; // o la página de login que uses
        // }
    } catch (error) {
        if (errorMessageDiv) errorMessageDiv.textContent = `Error al cerrar sesión: ${error.message}`;
        console.error('Error al cerrar sesión:', error.message);
    }
}

// --- Gestión del Estado de Autenticación ---
function updateAuthUI(session) {
    console.log('Auth State Change/UpdateUI:', session ? session.user?.email : 'No session');
    // IDs correctos para dashboard.html
    const dashboardContentEl = document.getElementById('dashboardContent'); 
    const userEmailSpanEl = document.getElementById('userEmail');

    if (session && session.user) {
        // Usuario está logueado
        if (authFormsDiv) authFormsDiv.classList.add('hidden');
        
        // Adaptar para dashboard.html o la página principal
        if (window.location.pathname.includes('dashboard.html')) {
            if (dashboardContentEl) dashboardContentEl.classList.remove('hidden');
            if (userEmailSpanEl) userEmailSpanEl.textContent = session.user.email;
        } else if (dashboardDiv) { // Para otros contextos si existiera un 'dashboard' div
            dashboardDiv.classList.remove('hidden');
            if (userInfoSpan) userInfoSpan.textContent = session.user.email;
        }
        
    } else {
        // Usuario no está logueado
        if (authFormsDiv) authFormsDiv.classList.remove('hidden');

        if (window.location.pathname.includes('dashboard.html')) {
            if (dashboardContentEl) dashboardContentEl.classList.add('hidden');
             // Si estás en el dashboard y no hay sesión, redirige a login
            console.log("No session on dashboard page, redirecting to login...");
            // window.location.href = 'login.html'; // O tu página de login principal, ej. registro.html
        } else if (dashboardDiv) { // Para otros contextos
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

// --- Asignar Event Listeners (con comprobaciones) ---
// Esto se ejecuta cuando se carga el script. Si los elementos no están en la página actual, serán null.
if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
}
if (signUpForm) {
    signUpForm.addEventListener('submit', handleSignUp);
}
if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', handleGoogleLogin);
}
// Considerar qué botón de logout usar. 'logoutBtn' es el genérico.
// 'logoutBtnDashboard' está en dashboard.html y se maneja en dashboard.js
if (logoutBtn) { 
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
