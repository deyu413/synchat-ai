import { supabase } from './supabaseClientFrontend.js';

const VERCEL_BACKEND_URL = 'https://synchat-ai-s8cf.vercel.app/'; // Added base URL

const loadingMessage = document.getElementById('loadingMessage');
const dashboardContent = document.getElementById('dashboardContent');
const userEmailSpan = document.getElementById('userEmail');
const logoutBtnDashboard = document.getElementById('logoutBtnDashboard');
const errorMessageDashboard = document.getElementById('errorMessageDashboard');

// Config Form Elements
const configForm = document.getElementById('configForm');
const botNameInput = document.getElementById('botName');
const welcomeMessageInput = document.getElementById('welcomeMessage');
const knowledgeUrlInput = document.getElementById('knowledgeUrl'); // Retained for now, might be part of URL sources
const configMessage = document.getElementById('configMessage');

// (Old) Ingest Section Elements - Will be mostly unused by new JS but selectors kept for now if HTML isn't fully removed
const currentIngestUrlDisplay = document.getElementById('currentIngestUrlDisplay');
const startIngestBtn = document.getElementById('startIngestBtn'); // This button is part of the commented out HTML
const lastIngestStatusDisplay = document.getElementById('lastIngestStatusDisplay');
const lastIngestAtDisplay = document.getElementById('lastIngestAtDisplay');
const ingestMessage = document.getElementById('ingestMessage'); // This div is part of the commented out HTML

// Usage Section Elements
const aiResolutionsCount = document.getElementById('aiResolutionsCount');
const totalQueriesCount = document.getElementById('totalQueriesCount');
const statsLastUpdated = document.getElementById('statsLastUpdated');
const usageMessage = document.getElementById('usageMessage');
const refreshUsageBtn = document.getElementById('refreshUsageBtn');

// Onboarding Section Elements
const onboardingMessageSection = document.getElementById('onboardingMessageSection');
const dismissOnboardingBtn = document.getElementById('dismissOnboardingBtn');

// Knowledge Management Elements
const knowledgeFileUpload = document.getElementById('knowledgeFileUpload');
const uploadFileBtn = document.getElementById('uploadFileBtn');
const knowledgeSourcesList = document.getElementById('knowledgeSourcesList');
const uploadStatusMessage = document.getElementById('uploadStatusMessage');
const loadingSourcesMsg = document.getElementById('loadingSourcesMsg');
const knowledgeManagementMessage = document.getElementById('knowledgeManagementMessage');

let currentClientId = null; // Store client_id from session

async function checkAuthAndLoadDashboard() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        console.error('Error de sesión o no autenticado:', sessionError?.message);
        window.location.href = 'login.html';
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
    await loadKnowledgeSources(); // Load knowledge sources after other data

    if (loadingMessage) loadingMessage.classList.add('hidden');
    if (dashboardContent) dashboardContent.classList.remove('hidden');
}

async function loadClientConfig(token) {
    if(errorMessageDashboard) errorMessageDashboard.textContent = '';
    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/config`, {
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
        // The 'knowledge_source_url' from client config is now one of many sources,
        // so its display here might be redundant if the new list handles it.
        // For now, we keep filling it, but it might be removed later.
        if (knowledgeUrlInput) knowledgeUrlInput.value = config.knowledge_source_url || '';

        // Update old ingest display if elements are still in HTML (they are commented out)
        if (currentIngestUrlDisplay) currentIngestUrlDisplay.textContent = config.knowledge_source_url || 'No configurada';
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
        // The direct knowledge_source_url might be deprecated in favor of the new system
        // For now, it's still sent. Backend might ignore it or handle it.
        knowledge_source_url: knowledgeUrlInput.value
    };

    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/config`, {
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
        // If the knowledgeUrlInput was changed, it might be a good idea to refresh the knowledge sources list
        // if it's considered a 'URL' type source that's managed through this field.
        await loadKnowledgeSources(); // Refresh sources if main URL config changes
        setTimeout(() => { if(configMessage) configMessage.textContent = ''; }, 3000);

    } catch (error) {
        console.error('Error actualizando configuración:', error);
         if(configMessage) {
            configMessage.textContent = `Error al guardar la configuración: ${error.message}. Por favor, verifica los datos e inténtalo de nuevo.`;
            configMessage.className = 'error';
        }
    }
}

// --- Knowledge Management Functions ---

async function loadKnowledgeSources() {
    if (!knowledgeSourcesList || !loadingSourcesMsg || !knowledgeManagementMessage) return;

    loadingSourcesMsg.style.display = 'block';
    knowledgeSourcesList.innerHTML = '';
    knowledgeManagementMessage.textContent = '';
    if(uploadStatusMessage) uploadStatusMessage.textContent = ''; // Clear upload status too

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        knowledgeManagementMessage.textContent = 'Error de autenticación. Por favor, recarga la página e inicia sesión.';
        knowledgeManagementMessage.className = 'error';
        loadingSourcesMsg.style.display = 'none';
        return;
    }
    const token = session.access_token;

    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/knowledge/sources`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json' // Not strictly needed for GET but good for consistency
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error ${response.status} cargando fuentes.`);
        }

        const sources = await response.json();
        loadingSourcesMsg.style.display = 'none';

        if (!sources || sources.length === 0) {
            knowledgeSourcesList.innerHTML = '<li>No hay fuentes de conocimiento configuradas. Sube un archivo o configura una URL.</li>';
        } else {
            sources.forEach(source => {
                const li = document.createElement('li');
                li.style.padding = '8px';
                li.style.borderBottom = '1px solid #eee';
                // Skip rendering the "main_url" placeholder if the URL itself is not set.
                if (source.source_id === 'main_url' && !source.source_name) { 
                    return;
                }

                let statusDisplay = source.status || 'N/A';
                if (source.status === 'uploaded') statusDisplay = 'Pendiente de ingesta';
                else if (source.status === 'pending_ingest') statusDisplay = 'En cola para ingesta';
                else if (source.status === 'ingesting') statusDisplay = 'Ingestando...';
                else if (source.status === 'completed') statusDisplay = 'Completada';
                else if (source.status === 'failed_ingest') statusDisplay = 'Falló la ingesta';


                li.innerHTML = `
                    <strong>${source.source_name || 'Fuente sin nombre'}</strong> 
                    (${source.source_type || 'N/A'}) - 
                    Estado: ${statusDisplay} 
                    ${source.last_ingest_at ? `- Última ingesta: ${new Date(source.last_ingest_at).toLocaleString()}` : ''}
                    ${source.last_ingest_error ? `<br><small style="color:red;">Error: ${source.last_ingest_error}</small>` : ''}
                    <br>
                    <button class="ingest-source-btn" data-source-id="${source.source_id}" ${source.source_id === 'main_url' || source.status === 'ingesting' ? 'disabled' : ''}>Ingerir Ahora</button>
                    <button class="delete-source-btn" data-source-id="${source.source_id}" ${source.source_id === 'main_url' || source.status === 'ingesting' ? 'disabled' : ''}>Eliminar</button>
                `;
                knowledgeSourcesList.appendChild(li);
            });
        }
    } catch (error) {
        console.error('Error cargando fuentes de conocimiento:', error);
        loadingSourcesMsg.style.display = 'none';
        knowledgeManagementMessage.textContent = `Error al cargar fuentes: ${error.message}`;
        knowledgeManagementMessage.className = 'error';
    }
}

async function handleFileUpload() {
    if (!knowledgeFileUpload || !uploadStatusMessage) return;

    const file = knowledgeFileUpload.files[0];
    if (!file) {
        uploadStatusMessage.textContent = 'Por favor, selecciona un archivo.';
        uploadStatusMessage.className = 'error';
        return;
    }

    const allowedTypes = ['application/pdf', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
        uploadStatusMessage.textContent = 'Tipo de archivo no permitido. Solo PDF y TXT.';
        uploadStatusMessage.className = 'error';
        return;
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        uploadStatusMessage.textContent = 'Error de autenticación. Por favor, recarga la página e inicia sesión.';
        uploadStatusMessage.className = 'error';
        return;
    }
    const token = session.access_token;

    const formData = new FormData();
    formData.append('file', file);

    uploadStatusMessage.textContent = 'Subiendo archivo...';
    uploadStatusMessage.className = 'info';
    if(uploadFileBtn) uploadFileBtn.disabled = true;


    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/knowledge/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
                // Content-Type is NOT set by us, browser does it for FormData
            },
            body: formData
        });

        if (!response.ok) { // Handles 4xx, 5xx status codes
            const errorData = await response.json();
            throw new Error(errorData.message || `Error ${response.status} al subir archivo.`);
        }
        
        const result = await response.json(); // Get the new source details

        uploadStatusMessage.textContent = `Archivo "${result.source_name}" subido con éxito. Estado: ${result.status}. Actualizando lista...`;
        uploadStatusMessage.className = 'success';
        knowledgeFileUpload.value = ''; // Clear the file input

        await loadKnowledgeSources(); // Refresh the list

        setTimeout(() => { if(uploadStatusMessage) uploadStatusMessage.textContent = ''; }, 5000);

    } catch (error) {
        console.error('Error al subir archivo:', error);
        uploadStatusMessage.textContent = `Error al subir el archivo: ${error.message}`;
        uploadStatusMessage.className = 'error';
    } finally {
        if(uploadFileBtn) uploadFileBtn.disabled = false;
    }
}

async function handleSourceAction(event) {
    const target = event.target;
    const sourceId = target.dataset.sourceId;

    if (!sourceId) return; // Clicked somewhere else in the list

    if (target.classList.contains('ingest-source-btn')) {
        if (sourceId === 'main_url') {
            // Find the actual source_id for the main_url from knowledgeUrlInput if needed, or adapt.
            // This part needs clarification if 'main_url' is just a placeholder or a real ID.
            // For now, we assume the backend can handle 'main_url' if it's a special case,
            // otherwise this button should be disabled or have the correct ID.
            // The button is currently disabled for 'main_url' in the rendering logic.
            // If knowledgeUrlInput is the source of truth for the 'main_url':
            const mainUrlFromConfig = knowledgeUrlInput.value;
            if(mainUrlFromConfig){
                // This logic is complex: we'd need to find if a source_id for this URL exists.
                // It's better if the list provides the actual source_id or the ingest button is handled differently for it.
                // For now, this specific 'main_url' ingest button is disabled in the list.
                // If it were enabled and meant to use knowledgeUrlInput, it would be:
                // await triggerIngestionForMainUrl(mainUrlFromConfig);
                console.warn("Ingest button for 'main_url' clicked - specific handling needed if it's not disabled.");
                knowledgeManagementMessage.textContent = "La ingesta de la URL principal se gestiona guardando la configuración con la URL deseada y luego usando su botón 'Ingerir Ahora' si aparece en la lista.";
                knowledgeManagementMessage.className = 'info';
                setTimeout(() => { knowledgeManagementMessage.textContent = ''; }, 7000);
                return; 
            }
        }
        await triggerIngestion(sourceId);
    } else if (target.classList.contains('delete-source-btn')) {
        if (sourceId === 'main_url') {
             knowledgeManagementMessage.textContent = "La URL principal configurada no se puede eliminar desde aquí. Para cambiarla o quitarla, modifica el campo 'URL para Ingesta de Conocimiento' en la Configuración y guarda.";
             knowledgeManagementMessage.className = 'info';
             setTimeout(() => { knowledgeManagementMessage.textContent = ''; }, 7000);
            return; // Prevent deletion of the special 'main_url' source from here
        }
        if (confirm(`¿Estás seguro de que quieres eliminar la fuente? Esta acción no se puede deshacer.`)) {
            await deleteKnowledgeSource(sourceId);
        }
    }
}

async function triggerIngestion(sourceId) {
    if (!knowledgeManagementMessage) return;
    knowledgeManagementMessage.textContent = `Iniciando ingesta para la fuente ${sourceId}...`;
    knowledgeManagementMessage.className = 'info';

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        knowledgeManagementMessage.textContent = 'Error de autenticación. Por favor, recarga la página e inicia sesión.';
        knowledgeManagementMessage.className = 'error';
        return;
    }
    const token = session.access_token;

    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/knowledge/sources/${sourceId}/ingest`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error ${response.status} al iniciar ingesta.`);
        }
        const result = await response.json();
        knowledgeManagementMessage.textContent = result.message || `Ingesta para ${sourceId} iniciada/encolada. Actualizando lista...`;
        knowledgeManagementMessage.className = 'success';
        await loadKnowledgeSources(); // Refresh list to show new status
    } catch (error) {
        console.error(`Error ingiriendo fuente ${sourceId}:`, error);
        knowledgeManagementMessage.textContent = `Error al ingerir fuente ${sourceId}: ${error.message}`;
        knowledgeManagementMessage.className = 'error';
    }
     setTimeout(() => { if(knowledgeManagementMessage) knowledgeManagementMessage.textContent = ''; }, 5000);
}

async function deleteKnowledgeSource(sourceId) {
    if (!knowledgeManagementMessage) return;
    knowledgeManagementMessage.textContent = `Eliminando fuente ${sourceId}...`;
    knowledgeManagementMessage.className = 'info';

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        knowledgeManagementMessage.textContent = 'Error de autenticación. Por favor, recarga la página e inicia sesión.';
        knowledgeManagementMessage.className = 'error';
        return;
    }
    const token = session.access_token;

    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/knowledge/sources/${sourceId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error ${response.status} al eliminar.`);
        }
        knowledgeManagementMessage.textContent = `Fuente ${sourceId} eliminada con éxito. Actualizando lista...`;
        knowledgeManagementMessage.className = 'success';
        await loadKnowledgeSources(); // Refresh the list
    } catch (error) {
        console.error(`Error eliminando fuente ${sourceId}:`, error);
        knowledgeManagementMessage.textContent = `Error al eliminar fuente ${sourceId}: ${error.message}`;
        knowledgeManagementMessage.className = 'error';
    }
    setTimeout(() => { if(knowledgeManagementMessage) knowledgeManagementMessage.textContent = ''; }, 5000);
}


if (uploadFileBtn) {
    uploadFileBtn.addEventListener('click', handleFileUpload);
}

if (knowledgeSourcesList) {
    knowledgeSourcesList.addEventListener('click', handleSourceAction);
}


// --- (Old) Ingest Functions --- Kept for reference, but startIngestBtn is commented out in HTML ---
// The old requestKnowledgeIngest tied to the commented-out UI is no longer relevant
// as ingestions are now per-source.
// if (startIngestBtn) { // This button is part of the commented out HTML
//     startIngestBtn.addEventListener('click', requestKnowledgeIngest);
// }


// --- Standard Auth and Utility Functions ---
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

        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/usage/resolutions`, {
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
