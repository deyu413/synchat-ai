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
    event.preventDefault(); // Evitar recarga de página
    const email = document.getElementById('signUpEmail').value;
    const password = document.getElementById('signUpPassword').value;
    clearMessages();

    try {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        authMessageDiv.textContent = '¡Registro exitoso! Revisa tu email para confirmar (si es necesario).';
        console.log('Usuario registrado:', data.user);
        signUpForm.reset(); // Limpiar formulario
    } catch (error) {
        errorMessageDiv.textContent = `Error en registro: ${error.message}`;
        console.error('Error en registro:', error.message);
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    clearMessages();

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        authMessageDiv.textContent = 'Inicio de sesión correcto.';
        console.log('Usuario logueado:', data.user);
        // onAuthStateChange se encargará de mostrar el dashboard
        loginForm.reset();
    } catch (error) {
        errorMessageDiv.textContent = `Error en login: ${error.message}`;
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
        errorMessageDiv.textContent = `Error con Google: ${error.message}`;
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
    } catch (error) {
        errorMessageDiv.textContent = `Error al cerrar sesión: ${error.message}`;
        console.error('Error al cerrar sesión:', error.message);
    }
}

// --- Gestión del Estado de Autenticación ---

// Escucha cambios en el estado de autenticación (login, logout)
supabase.auth.onAuthStateChange((event, session) => {
    console.log('Auth State Change:', event, session);
    if (session && session.user) {
        // Usuario está logueado
        authFormsDiv.classList.add('hidden');
        dashboardDiv.classList.remove('hidden');
        userInfoSpan.textContent = session.user.email;
    } else {
        // Usuario no está logueado
        authFormsDiv.classList.remove('hidden');
        dashboardDiv.classList.add('hidden');
        userInfoSpan.textContent = '';
    }
});

// --- Asignar Event Listeners ---

loginForm.addEventListener('submit', handleLogin);
signUpForm.addEventListener('submit', handleSignUp);
googleLoginBtn.addEventListener('click', handleGoogleLogin);
logoutBtn.addEventListener('click', handleLogout);

// --- Funciones Auxiliares ---
function clearMessages() {
    authMessageDiv.textContent = '';
    errorMessageDiv.textContent = '';
}

// Forzar una comprobación inicial del estado al cargar la página
// (Puede que ya haya una sesión activa)
supabase.auth.getSession().then(({ data: { session } }) => {
     console.log('Sesión inicial:', session);
      if (session && session.user) {
        authFormsDiv.classList.add('hidden');
        dashboardDiv.classList.remove('hidden');
        userInfoSpan.textContent = session.user.email;
    } else {
        authFormsDiv.classList.remove('hidden');
        dashboardDiv.classList.add('hidden');
        userInfoSpan.textContent = '';
    }
});

console.log("Auth listeners listos.");