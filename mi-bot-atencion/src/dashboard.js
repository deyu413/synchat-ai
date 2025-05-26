import { supabase } from './supabaseClientFrontend.js';

const VERCEL_BACKEND_URL = 'https://synchat-ai-backend.vercel.app'; // Added base URL

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

// Usage Section Elements
const aiResolutionsCount = document.getElementById('aiResolutionsCount');
const totalQueriesCount = document.getElementById('totalQueriesCount');
const statsLastUpdated = document.getElementById('statsLastUpdated');
const usageMessage = document.getElementById('usageMessage');
const refreshUsageBtn = document.getElementById('refreshUsageBtn');

// Onboarding Section Elements
const onboardingMessageSection = document.getElementById('onboardingMessageSection');
const dismissOnboardingBtn = document.getElementById('dismissOnboardingBtn');

let currentClientId = null; // Store client_id from session

async function checkAuthAndLoadDashboard() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        console.error('Error de sesión o no autenticado:', sessionError?.message);
        window.location.href = 'login.html'; // Assuming login.html is at the root or accessible path
        return;
    }

    console.log('Sesión activa:', session);
    currentClientId = session.user.id; 
    if (userEmailSpan) userEmailSpan.textContent = session.user.email;

    if (onboardingMessageSection && dismissOnboardingBtn) {
        const onboardingDismissed = localStorage.getItem('synchat_onboarding_dismissed_' + currentClientId);
        if (!onboardingDismissed) {
            onboardingMessageSection.style.display = 'block';
        }
        dismissOnboardingBtn.addEventListener('click', () => {
            onboardingMessageSection.style.display = 'none';
            localStorage.setItem('synchat_onboarding_dismissed_' + currentClientId, 'true');
        });
    }
    
    await loadClientConfig(session.access_token);
    await displayClientUsage(); 
    
    if (loadingMessage) loadingMessage.classList.add('hidden');
    if (dashboardContent) dashboardContent.classList.remove('hidden');
}

async function loadClientConfig(token) {
    if(errorMessageDashboard) errorMessageDashboard.textContent = '';
    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/config`, { // MODIFIED URL
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
        if (lastIngestStatusDisplay) lastIngestStatusDisplay.textContent = config.last_ingest_status || 'N/A';
        if (lastIngestAtDisplay) lastIngestAtDisplay.textContent = config.last_ingest_at ? new Date(config.last_ingest_at).toLocaleString() : 'N/A';

    } catch (error) {
        console.error('Error cargando configuración del cliente:', error);
        if (errorMessageDashboard) errorMessageDashboard.textContent = `No se pudo cargar la configuración del cliente: ${error.message}. Intenta recargar la página.`;
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
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/config`, { // MODIFIED URL
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
            configMessage.className = 'success';
        }
        setTimeout(() => { if(configMessage) configMessage.textContent = ''; }, 3000);

    } catch (error) {
        console.error('Error actualizando configuración:', error);
         if(configMessage) { 
            configMessage.textContent = `Error al guardar la configuración: ${error.message}. Por favor, verifica los datos e inténtalo de nuevo.`;
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
            window.location.href = 'login.html'; // Assuming login.html is at the root or accessible path
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
            ingestMessage.className = 'error';
        }
        return;
    }

    const knowledgeUrl = knowledgeUrlInput.value; 
    if (!knowledgeUrl) {
        if (ingestMessage) {
            ingestMessage.textContent = 'Por favor, introduce una URL para la ingesta en el campo de configuración y guarda.';
            ingestMessage.className = 'error';
        }
        return;
    }

    if (ingestMessage) {
        ingestMessage.textContent = 'Iniciando ingesta... Esto puede tardar varios minutos.';
        ingestMessage.className = 'info'; 
    }
    if (startIngestBtn) startIngestBtn.disabled = true;

    try {
        const token = (await supabase.auth.getSession())?.data.session?.access_token;
        if (!token) {
            throw new Error('Sesión no válida. Por favor, vuelve a iniciar sesión.');
        }

        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/ingest`, { // MODIFIED URL
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                clientId: currentClientId, 
                url: knowledgeUrl
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || result.error || `Error ${response.status}`);
        }

        if (ingestMessage) {
            ingestMessage.textContent = result.message || '¡Ingesta completada!';
            ingestMessage.className = 'success'; 
        }
        if (lastIngestStatusDisplay) lastIngestStatusDisplay.textContent = 'Pendiente'; 
        if (lastIngestAtDisplay) lastIngestAtDisplay.textContent = new Date().toLocaleString();

    } catch (error) {
        console.error('Error durante la ingesta:', error);
        if (error.message.toLowerCase().includes('sesión no válida') || error.message.toLowerCase().includes('session expired')) {
            if (ingestMessage) {
                ingestMessage.textContent = 'Tu sesión ha expirado. Por favor, inicia sesión de nuevo para realizar esta acción.';
                ingestMessage.className = 'error';
            }
        } else {
            if (ingestMessage) {
                ingestMessage.textContent = `Falló la ingesta de conocimiento: ${error.message}. Revisa la URL y tu conexión, luego intenta de nuevo.`;
                ingestMessage.className = 'error';
            }
        }
        if (lastIngestStatusDisplay) lastIngestStatusDisplay.textContent = 'Fallida';
    } finally {
        if (startIngestBtn) startIngestBtn.disabled = false;
    }
}

if (startIngestBtn) {
    startIngestBtn.addEventListener('click', requestKnowledgeIngest);
}

async function displayClientUsage() {
    if (!currentClientId) {
        if (usageMessage) {
            usageMessage.textContent = 'Error: Client ID no encontrado. Intenta recargar la página.';
            usageMessage.className = 'error';
        }
        return;
    }

    if (usageMessage) {
        usageMessage.textContent = 'Cargando estadísticas de uso...';
        usageMessage.className = 'info';
    }
    if (aiResolutionsCount) aiResolutionsCount.textContent = 'Cargando...';
    if (totalQueriesCount) totalQueriesCount.textContent = 'Cargando...';

    try {
        const token = (await supabase.auth.getSession())?.data.session?.access_token;
        if (!token) {
            throw new Error('Sesión no válida. Por favor, vuelve a iniciar sesión.');
        }

        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/usage/resolutions`, { // MODIFIED URL
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || errorData.error || `Error ${response.status}`);
        }

        const usageData = await response.json(); 

        if (aiResolutionsCount) aiResolutionsCount.textContent = usageData.ai_resolutions_current_month !== undefined ? usageData.ai_resolutions_current_month : 'No disponible';
        if (totalQueriesCount) totalQueriesCount.textContent = usageData.total_queries_current_month !== undefined ? usageData.total_queries_current_month : 'No disponible';
        
        if (statsLastUpdated) statsLastUpdated.textContent = new Date().toLocaleString();
        if (usageMessage) {
            usageMessage.textContent = 'Estadísticas cargadas correctamente.';
            usageMessage.className = 'success';
            setTimeout(() => { if (usageMessage) usageMessage.textContent = ''; }, 3000);
        }

    } catch (error) {
        console.error('Error cargando estadísticas de uso:', error);
        if (error.message.toLowerCase().includes('sesión no válida') || error.message.toLowerCase().includes('session expired')) {
            if (usageMessage) {
                usageMessage.textContent = 'Tu sesión ha expirado. Por favor, inicia sesión de nuevo para ver las estadísticas.';
                usageMessage.className = 'error';
            }
        } else {
            if (usageMessage) {
                usageMessage.textContent = `No se pudieron cargar las estadísticas de uso: ${error.message}. Inténtalo de nuevo más tarde.`;
                usageMessage.className = 'error';
            }
        }
        if (aiResolutionsCount) aiResolutionsCount.textContent = 'Error';
        if (totalQueriesCount) totalQueriesCount.textContent = 'Error';
        if (statsLastUpdated) statsLastUpdated.textContent = 'Error al cargar';
    }
}

if (refreshUsageBtn) {
    refreshUsageBtn.addEventListener('click', displayClientUsage);
}

document.addEventListener('DOMContentLoaded', checkAuthAndLoadDashboard);
