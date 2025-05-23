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

// Ingest Section Elements
const currentIngestUrlDisplay = document.getElementById('currentIngestUrlDisplay');
const startIngestBtn = document.getElementById('startIngestBtn');
const lastIngestStatusDisplay = document.getElementById('lastIngestStatusDisplay');
const lastIngestAtDisplay = document.getElementById('lastIngestAtDisplay');
const ingestMessage = document.getElementById('ingestMessage');

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

        if (currentIngestUrlDisplay) {
            currentIngestUrlDisplay.textContent = config.knowledge_source_url || 'No configurada';
        }
        // For MVP, we'll assume ingestion status is not yet available from this endpoint
        if (lastIngestStatusDisplay) lastIngestStatusDisplay.textContent = config.last_ingest_status || 'N/A';
        if (lastIngestAtDisplay) lastIngestAtDisplay.textContent = config.last_ingest_at ? new Date(config.last_ingest_at).toLocaleString() : 'N/A';

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

async function requestKnowledgeIngest() {
    if (!currentClientId) {
        if (ingestMessage) {
            ingestMessage.textContent = 'Error: Client ID no encontrado. Intenta recargar la página.';
            ingestMessage.className = 'error'; // Asegúrate de tener estilos para .error
        }
        return;
    }

    const knowledgeUrl = knowledgeUrlInput.value; // Get the URL from the input field
    if (!knowledgeUrl) {
        if (ingestMessage) {
            ingestMessage.textContent = 'Por favor, introduce una URL para la ingesta en el campo de configuración y guarda.';
            ingestMessage.className = 'error';
        }
        return;
    }

    if (ingestMessage) {
        ingestMessage.textContent = 'Iniciando ingesta... Esto puede tardar varios minutos.';
        ingestMessage.className = 'info'; // Asegúrate de tener estilos para .info
    }
    if (startIngestBtn) startIngestBtn.disabled = true;

    try {
        const token = (await supabase.auth.getSession())?.data.session?.access_token;
        if (!token) {
            throw new Error('Sesión no válida. Por favor, vuelve a iniciar sesión.');
        }

        // Make sure this endpoint '/api/client/me/ingest' matches what you'll create in the backend
        const response = await fetch('/api/client/me/ingest', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                clientId: currentClientId, // Though backend can get this from token, sending it is fine
                url: knowledgeUrl
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || result.error || `Error ${response.status}`);
        }

        if (ingestMessage) {
            ingestMessage.textContent = result.message || '¡Ingesta completada!';
            ingestMessage.className = 'success'; // Asegúrate de tener estilos para .success
        }
        if (lastIngestStatusDisplay) lastIngestStatusDisplay.textContent = 'Completada'; // Or use a status from result if available
        if (lastIngestAtDisplay) lastIngestAtDisplay.textContent = new Date().toLocaleString();
         // Optionally, reload config to get updated status from backend if the backend updates it
        // await loadClientConfig(token);


    } catch (error) {
        console.error('Error durante la ingesta:', error);
        if (ingestMessage) {
            ingestMessage.textContent = `Error durante la ingesta: ${error.message}`;
            ingestMessage.className = 'error';
        }
        if (lastIngestStatusDisplay) lastIngestStatusDisplay.textContent = 'Fallida';
    } finally {
        if (startIngestBtn) startIngestBtn.disabled = false;
    }
}

if (startIngestBtn) {
    startIngestBtn.addEventListener('click', requestKnowledgeIngest);
}

// Cargar al iniciar
document.addEventListener('DOMContentLoaded', checkAuthAndLoadDashboard);
