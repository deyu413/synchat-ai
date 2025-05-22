import { supabase } from './supabaseClientFrontend.js';

const loadingMessage = document.getElementById('loadingMessage');
const dashboardContent = document.getElementById('dashboardContent');
const userEmailSpan = document.getElementById('userEmail');
const logoutBtnDashboard = document.getElementById('logoutBtnDashboard');
const errorMessageDashboard = document.getElementById('errorMessageDashboard');

// Config Form Elements
const configForm = document.getElementById('configForm');
const botNameInput = document.getElementById('botName');
const welcomeMessageInput = document.getElementById('welcomeMessage');
const knowledgeUrlInput = document.getElementById('knowledgeUrl');
const configMessage = document.getElementById('configMessage');

let currentClientId = null; // Store client_id from session

async function checkAuthAndLoadDashboard() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        console.error('Error de sesión o no autenticado:', sessionError?.message);
        window.location.href = 'login.html';
        return;
    }

    console.log('Sesión activa:', session);
    currentClientId = session.user.id; // Assuming client_id is user.id from Supabase Auth
    if (userEmailSpan) userEmailSpan.textContent = session.user.email;
    
    await loadClientConfig(session.access_token);
    
    if (loadingMessage) loadingMessage.classList.add('hidden');
    if (dashboardContent) dashboardContent.classList.remove('hidden');
}

async function loadClientConfig(token) {
    if(errorMessageDashboard) errorMessageDashboard.textContent = '';
    try {
        const response = await fetch('/api/client/me/config', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error ${response.status}`);
        }
        const config = await response.json();
        console.log('Configuración recibida:', config);

        if (config.widget_config) {
            if (botNameInput) botNameInput.value = config.widget_config.botName || '';
            if (welcomeMessageInput) welcomeMessageInput.value = config.widget_config.welcomeMessage || '';
        }
        if (knowledgeUrlInput) knowledgeUrlInput.value = config.knowledge_source_url || '';

    } catch (error) {
        console.error('Error cargando configuración del cliente:', error);
        if (errorMessageDashboard) errorMessageDashboard.textContent = `Error cargando configuración: ${error.message}`;
    }
}

async function handleUpdateConfig(event) {
    event.preventDefault();
    if(configMessage) configMessage.textContent = '';
    if(errorMessageDashboard) errorMessageDashboard.textContent = '';
    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) {
        if(errorMessageDashboard) errorMessageDashboard.textContent = 'Sesión no válida. Por favor, vuelve a iniciar sesión.';
        return;
    }

    const updatedConfig = {
        widget_config: {
            botName: botNameInput.value,
            welcomeMessage: welcomeMessageInput.value
        },
        knowledge_source_url: knowledgeUrlInput.value
    };

    try {
        const response = await fetch('/api/client/me/config', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedConfig)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error ${response.status}`);
        }
        const result = await response.json();
        console.log('Configuración actualizada:', result);
        if(configMessage) {
            configMessage.textContent = '¡Configuración guardada con éxito!';
            configMessage.className = 'success'; // Ensure it has success styling
        }
        setTimeout(() => { if(configMessage) configMessage.textContent = ''; }, 3000);

    } catch (error) {
        console.error('Error actualizando configuración:', error);
        if(errorMessageDashboard) {
            errorMessageDashboard.textContent = `Error guardando configuración: ${error.message}`;
        }
         if(configMessage) { // Also ensure configMessage is cleared or shows error
            configMessage.textContent = `Error guardando configuración: ${error.message}`;
            configMessage.className = 'error';
        }
    }
}

if (logoutBtnDashboard) {
    logoutBtnDashboard.addEventListener('click', async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('Error al cerrar sesión:', error);
            if(errorMessageDashboard) errorMessageDashboard.textContent = `Error al cerrar sesión: ${error.message}`;
        } else {
            window.location.href = 'login.html';
        }
    });
}

if (configForm) {
    configForm.addEventListener('submit', handleUpdateConfig);
}

// Cargar al iniciar
document.addEventListener('DOMContentLoaded', checkAuthAndLoadDashboard);
