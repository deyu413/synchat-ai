import { supabase } from './supabaseClientFrontend.js';

const VERCEL_BACKEND_URL = window.SYNCHAT_CONFIG.API_BASE_URL;

// --- General Dashboard Elements ---
const loadingMessage = document.getElementById('loadingMessage');
const dashboardContent = document.getElementById('dashboardContent');
const userEmailSpan = document.getElementById('userEmail');
const logoutBtnDashboard = document.getElementById('logoutBtnDashboard');
const errorMessageDashboard = document.getElementById('errorMessageDashboard');

// --- Section Elements ---
const configSection = document.getElementById('config');
const knowledgeManagementSection = document.getElementById('knowledgeManagement');
const usageSection = document.getElementById('usage');
const inboxSection = document.getElementById('inboxSection');
// Add other main sections here if they exist (e.g., widget section)
const widgetSection = document.getElementById('widget'); // Assuming a widget section exists

// --- Navigation Links ---
const navConfigLink = document.querySelector('nav ul li a[href="#config"]');
const navIngestLink = document.querySelector('nav ul li a[href="#ingest"]'); // Corresponds to knowledgeManagementSection
const navWidgetLink = document.querySelector('nav ul li a[href="#widget"]');
const navUsageLink = document.querySelector('nav ul li a[href="#usage"]');
const navInboxLink = document.getElementById('navInboxLink');


// --- Config Form Elements ---
const configForm = document.getElementById('configForm');
const botNameInput = document.getElementById('botName');
const welcomeMessageInput = document.getElementById('welcomeMessage');
const knowledgeUrlInput = document.getElementById('knowledgeUrl');
const configMessage = document.getElementById('configMessage');

// --- Knowledge Management Elements ---
const knowledgeFileUpload = document.getElementById('knowledgeFileUpload');
const uploadFileBtn = document.getElementById('uploadFileBtn');
const knowledgeSourcesList = document.getElementById('knowledgeSourcesList');
const uploadStatusMessage = document.getElementById('uploadStatusMessage');
const loadingSourcesMsg = document.getElementById('loadingSourcesMsg');
const knowledgeManagementMessage = document.getElementById('knowledgeManagementMessage');

// --- Usage Section Elements ---
const aiResolutionsCount = document.getElementById('aiResolutionsCount');
const totalQueriesCount = document.getElementById('totalQueriesCount');
const statsLastUpdated = document.getElementById('statsLastUpdated');
const usageMessage = document.getElementById('usageMessage');
const refreshUsageBtn = document.getElementById('refreshUsageBtn');

// --- Onboarding Section Elements ---
const onboardingMessageSection = document.getElementById('onboardingMessageSection');
const dismissOnboardingBtn = document.getElementById('dismissOnboardingBtn');

// --- Shared Inbox Elements ---
const inboxConvListContainer = document.getElementById('inboxConvListContainer');
const inboxStatusFilter = document.getElementById('inboxStatusFilter');
const refreshInboxBtn = document.getElementById('refreshInboxBtn');
const inboxLoadingMsg = document.getElementById('inboxLoadingMsg');
const inboxConvList = document.getElementById('inboxConvList');
const inboxMessageView = document.getElementById('inboxMessageView');
const inboxSelectedConvHeader = document.getElementById('inboxSelectedConvHeader');
const messageHistoryContainer = document.getElementById('messageHistoryContainer');
const inboxReplyArea = document.getElementById('inboxReplyArea');
const inboxReplyText = document.getElementById('inboxReplyText');
const inboxSendReplyBtn = document.getElementById('inboxSendReplyBtn');
const inboxConvActions = document.getElementById('inboxConvActions');
const inboxCloseConvBtn = document.getElementById('inboxCloseConvBtn');
const inboxChangeStatusDropdown = document.getElementById('inboxChangeStatusDropdown');
const inboxApplyStatusChangeBtn = document.getElementById('inboxApplyStatusChangeBtn');

// --- State Variables ---
let currentClientId = null;
let currentOpenConversationId = null;
let currentConversations = []; // Stores fetched conversations for the inbox

// --- Helper to show/hide sections ---
const allDashboardSections = [configSection, knowledgeManagementSection, usageSection, inboxSection, widgetSection].filter(Boolean);

function showSection(sectionIdToShow) {
    allDashboardSections.forEach(section => {
        if (section.id === sectionIdToShow) {
            section.style.display = 'block'; // Or 'flex' if needed
        } else {
            section.style.display = 'none';
        }
    });
    // Update URL hash for bookmarking/navigation (optional)
    // window.location.hash = sectionIdToShow;
}


async function checkAuthAndLoadDashboard() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        window.location.href = 'login.html';
        return;
    }
    currentClientId = session.user.id;
    if (userEmailSpan) userEmailSpan.textContent = session.user.email;

    if (onboardingMessageSection && dismissOnboardingBtn) {
        const onboardingDismissed = localStorage.getItem('synchat_onboarding_dismissed_' + currentClientId);
        if (!onboardingDismissed) onboardingMessageSection.style.display = 'block';
        dismissOnboardingBtn.addEventListener('click', () => {
            onboardingMessageSection.style.display = 'none';
            localStorage.setItem('synchat_onboarding_dismissed_' + currentClientId, 'true');
        });
    }

    await loadClientConfig(session.access_token);
    await displayClientUsage();
    await loadKnowledgeSources();
    
    // Initial section display logic
    const hash = window.location.hash.substring(1); // Get hash without '#'
    if (hash === 'inboxSection' || (hash === '' && inboxSection)) { // Default to inbox or if hash matches
        showSection('inboxSection');
        if (inboxStatusFilter) await loadInboxConversations(inboxStatusFilter.value);
    } else if (hash && document.getElementById(hash)) {
        showSection(hash);
    } else if (configSection) { // Fallback to config section
        showSection('config');
    }


    if (loadingMessage) loadingMessage.style.display = 'none';
    if (dashboardContent) dashboardContent.classList.remove('hidden');
}

// --- Navigation Event Listeners ---
if (navConfigLink && configSection) navConfigLink.addEventListener('click', (e) => { e.preventDefault(); showSection('config'); });
if (navIngestLink && knowledgeManagementSection) navIngestLink.addEventListener('click', (e) => { e.preventDefault(); showSection('knowledgeManagement'); });
if (navWidgetLink && widgetSection) navWidgetLink.addEventListener('click', (e) => { e.preventDefault(); showSection('widget'); }); // Assuming 'widget' is the ID of widget section
if (navUsageLink && usageSection) navUsageLink.addEventListener('click', (e) => { e.preventDefault(); showSection('usage'); });
if (navInboxLink && inboxSection) {
    navInboxLink.addEventListener('click', async (e) => {
        e.preventDefault();
        showSection('inboxSection');
        if (inboxStatusFilter) await loadInboxConversations(inboxStatusFilter.value);
    });
}


async function loadClientConfig(token) {
    if(errorMessageDashboard) errorMessageDashboard.textContent = '';
    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/config`, {
            method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        const config = await response.json();
        if (config.widget_config) {
            if (botNameInput) botNameInput.value = config.widget_config.botName || '';
            if (welcomeMessageInput) welcomeMessageInput.value = config.widget_config.welcomeMessage || '';
        }
        if (knowledgeUrlInput) knowledgeUrlInput.value = config.knowledge_source_url || '';
    } catch (error) {
        console.error('Error cargando configuración del cliente:', error);
        if (errorMessageDashboard) errorMessageDashboard.textContent = `No se pudo cargar la configuración: ${error.message}.`;
    }
}

async function handleUpdateConfig(event) {
    event.preventDefault();
    if(configMessage) configMessage.textContent = '';
    if(errorMessageDashboard) errorMessageDashboard.textContent = '';
    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) { if(errorMessageDashboard) errorMessageDashboard.textContent = 'Sesión no válida.'; return; }

    const updatedConfig = {
        widget_config: { botName: botNameInput.value, welcomeMessage: welcomeMessageInput.value },
        knowledge_source_url: knowledgeUrlInput.value
    };
    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/config`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(updatedConfig)
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        if(configMessage) { configMessage.textContent = 'Configuración guardada!'; configMessage.className = 'success'; }
        await loadKnowledgeSources();
        setTimeout(() => { if(configMessage) configMessage.textContent = ''; }, 3000);
    } catch (error) {
        console.error('Error actualizando configuración:', error);
        if(configMessage) { configMessage.textContent = `Error: ${error.message}.`; configMessage.className = 'error'; }
    }
}

async function loadKnowledgeSources() {
    if (!knowledgeSourcesList || !loadingSourcesMsg || !knowledgeManagementMessage) return;
    loadingSourcesMsg.style.display = 'block';
    knowledgeSourcesList.innerHTML = '';
    knowledgeManagementMessage.textContent = '';
    if(uploadStatusMessage) uploadStatusMessage.textContent = '';

    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) {
        knowledgeManagementMessage.textContent = 'Error de autenticación.'; knowledgeManagementMessage.className = 'error';
        loadingSourcesMsg.style.display = 'none'; return;
    }
    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/knowledge/sources`, {
            method: 'GET', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        const sources = await response.json();
        loadingSourcesMsg.style.display = 'none';
        if (!sources || sources.length === 0) {
            knowledgeSourcesList.innerHTML = '<li>No hay fuentes de conocimiento configuradas.</li>';
        } else {
            sources.forEach(source => {
                if (source.source_id === 'main_url' && !source.source_name) return;
                const li = document.createElement('li');
                li.style.padding = '8px'; li.style.borderBottom = '1px solid #eee';
                let statusDisplay = source.status || 'N/A';
                if (source.status === 'uploaded') statusDisplay = 'Pendiente de ingesta';
                else if (source.status === 'pending_ingest') statusDisplay = 'En cola para ingesta';
                else if (source.status === 'ingesting') statusDisplay = 'Ingestando...';
                else if (source.status === 'completed') statusDisplay = 'Completada';
                else if (source.status === 'failed_ingest') statusDisplay = 'Falló la ingesta';
                li.innerHTML = `<strong>${source.source_name || 'Fuente sin nombre'}</strong> (${source.source_type || 'N/A'}) - Estado: ${statusDisplay} ${source.last_ingest_at ? `- Última ingesta: ${new Date(source.last_ingest_at).toLocaleString()}` : ''} ${source.last_ingest_error ? `<br><small style="color:red;">Error: ${source.last_ingest_error}</small>` : ''}<br>
                    <button class="ingest-source-btn" data-source-id="${source.source_id}" ${source.status === 'ingesting' ? 'disabled' : ''}>Ingerir Ahora</button> // Botón Ingerir Ahora habilitado para main_url si no está 'ingesting'
<button class="delete-source-btn" data-source-id="${source.source_id}" ${source.source_id === 'main_url' || source.status === 'ingesting' ? 'disabled' : ''}>Eliminar</button> // Botón Eliminar sigue deshabilitado para main_url
                knowledgeSourcesList.appendChild(li);
            });
        }
    } catch (error) {
        console.error('Error cargando fuentes de conocimiento:', error);
        loadingSourcesMsg.style.display = 'none';
        knowledgeManagementMessage.textContent = `Error: ${error.message}`; knowledgeManagementMessage.className = 'error';
    }
}

async function handleFileUpload() {
    if (!knowledgeFileUpload || !uploadStatusMessage) return;
    const file = knowledgeFileUpload.files[0];
    if (!file) { uploadStatusMessage.textContent = 'Selecciona un archivo.'; uploadStatusMessage.className = 'error'; return; }
    if (!['application/pdf', 'text/plain'].includes(file.type)) { uploadStatusMessage.textContent = 'Solo PDF y TXT.'; uploadStatusMessage.className = 'error'; return; }
    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) { uploadStatusMessage.textContent = 'Error de autenticación.'; uploadStatusMessage.className = 'error'; return; }
    const formData = new FormData(); formData.append('file', file);
    uploadStatusMessage.textContent = 'Subiendo...'; uploadStatusMessage.className = 'info';
    if(uploadFileBtn) uploadFileBtn.disabled = true;
    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/knowledge/upload`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        const result = await response.json();
        uploadStatusMessage.textContent = `"${result.source_name}" subido. Estado: ${result.status}.`; uploadStatusMessage.className = 'success';
        knowledgeFileUpload.value = '';
        await loadKnowledgeSources();
        setTimeout(() => { if(uploadStatusMessage) uploadStatusMessage.textContent = ''; }, 5000);
    } catch (error) {
        console.error('Error al subir archivo:', error);
        uploadStatusMessage.textContent = `Error: ${error.message}`; uploadStatusMessage.className = 'error';
    } finally { if(uploadFileBtn) uploadFileBtn.disabled = false; }
}

async function handleSourceAction(event) {
    const target = event.target; const sourceId = target.dataset.sourceId; if (!sourceId) return;
    if (target.classList.contains('ingest-source-btn')) {
        if (sourceId === 'main_url') { console.warn("Ingest for 'main_url' via this button needs specific handling or disabling."); return; }
        await triggerIngestion(sourceId);
    } else if (target.classList.contains('delete-source-btn')) {
        if (sourceId === 'main_url') { console.warn("Delete for 'main_url' via this button needs specific handling or disabling."); return; }
        if (confirm(`¿Eliminar fuente?`)) await deleteKnowledgeSource(sourceId);
    }
}

async function triggerIngestion(sourceId) {
    if (!knowledgeManagementMessage) return;
    knowledgeManagementMessage.textContent = `Iniciando ingesta para ${sourceId}...`; knowledgeManagementMessage.className = 'info';
    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) { knowledgeManagementMessage.textContent = 'Error de autenticación.'; knowledgeManagementMessage.className = 'error'; return; }
    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/knowledge/sources/${sourceId}/ingest`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        const result = await response.json();
        knowledgeManagementMessage.textContent = result.message || `Ingesta para ${sourceId} iniciada.`; knowledgeManagementMessage.className = 'success';
        await loadKnowledgeSources();
    } catch (error) {
        console.error(`Error ingiriendo ${sourceId}:`, error);
        knowledgeManagementMessage.textContent = `Error ingesta ${sourceId}: ${error.message}`; knowledgeManagementMessage.className = 'error';
    }
    setTimeout(() => { if(knowledgeManagementMessage) knowledgeManagementMessage.textContent = ''; }, 5000);
}

async function deleteKnowledgeSource(sourceId) {
    if (!knowledgeManagementMessage) return;
    knowledgeManagementMessage.textContent = `Eliminando ${sourceId}...`; knowledgeManagementMessage.className = 'info';
    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) { knowledgeManagementMessage.textContent = 'Error de autenticación.'; knowledgeManagementMessage.className = 'error'; return; }
    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/knowledge/sources/${sourceId}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        knowledgeManagementMessage.textContent = `Fuente ${sourceId} eliminada.`; knowledgeManagementMessage.className = 'success';
        await loadKnowledgeSources();
    } catch (error) {
        console.error(`Error eliminando ${sourceId}:`, error);
        knowledgeManagementMessage.textContent = `Error eliminando ${sourceId}: ${error.message}`; knowledgeManagementMessage.className = 'error';
    }
    setTimeout(() => { if(knowledgeManagementMessage) knowledgeManagementMessage.textContent = ''; }, 5000);
}

// --- Shared Inbox Functions ---
async function loadInboxConversations(statusFilter = '') {
    if (!inboxLoadingMsg || !inboxConvList) return;
    inboxLoadingMsg.style.display = 'block';
    inboxConvList.innerHTML = '';
    currentConversations = [];

    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) {
        inboxLoadingMsg.textContent = 'Error de autenticación.';
        inboxLoadingMsg.className = 'error'; // Assuming you might have styles for this
        return;
    }

    let url = `${VERCEL_BACKEND_URL}/api/client/me/inbox/conversations`;
    if (statusFilter) {
        url += `?status=${encodeURIComponent(statusFilter)}`;
    }

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        
        const result = await response.json();
        currentConversations = result.data || [];
        inboxLoadingMsg.style.display = 'none';

        if (currentConversations.length === 0) {
            inboxConvList.innerHTML = '<li>No se encontraron conversaciones con los filtros actuales.</li>';
            return;
        }

        currentConversations.forEach(conv => {
            const li = document.createElement('li');
            li.dataset.conversationId = conv.conversation_id;
            li.style.padding = '10px';
            li.style.borderBottom = '1px solid #f0f0f0';
            li.style.cursor = 'pointer';
            li.innerHTML = `
                <strong>${conv.last_message_preview ? conv.last_message_preview.substring(0, 50) + '...' : 'Conversación vacía'}</strong><br>
                <small>ID: ${conv.conversation_id.substring(0,8)}... - Estado: ${conv.status}</small><br>
                <small>Último mensaje: ${conv.last_message_at ? new Date(conv.last_message_at).toLocaleString() : 'N/A'}</small>
            `;
            li.addEventListener('click', () => {
                document.querySelectorAll('#inboxConvList li').forEach(item => item.style.backgroundColor = ''); // Reset other highlights
                li.style.backgroundColor = '#e0e0e0'; // Highlight selected
                displayConversationMessages(conv.conversation_id);
            });
            inboxConvList.appendChild(li);
        });

    } catch (error) {
        console.error('Error cargando conversaciones de la bandeja de entrada:', error);
        inboxLoadingMsg.style.display = 'none';
        inboxConvList.innerHTML = `<li>Error al cargar conversaciones: ${error.message}</li>`;
    }
}

async function displayConversationMessages(conversationId) {
    currentOpenConversationId = conversationId;
    if (!messageHistoryContainer || !inboxSelectedConvHeader || !inboxReplyArea || !inboxConvActions) return;

    inboxSelectedConvHeader.textContent = `Cargando mensajes para ID: ${conversationId.substring(0,8)}...`;
    messageHistoryContainer.innerHTML = 'Cargando...';
    inboxReplyArea.style.display = 'flex'; // Show reply area
    inboxConvActions.style.display = 'block'; // Show actions area

    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) {
        messageHistoryContainer.innerHTML = 'Error de autenticación.';
        return;
    }

    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/inbox/conversations/${conversationId}/messages`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        
        const messages = await response.json();
        inboxSelectedConvHeader.textContent = `Chat ID: ${conversationId.substring(0,8)}...`; // Update header
        messageHistoryContainer.innerHTML = ''; // Clear loading message

        if (messages.length === 0) {
            messageHistoryContainer.innerHTML = '<p>No hay mensajes en esta conversación aún.</p>';
        } else {
            messages.forEach(msg => {
                const msgDiv = document.createElement('div');
                msgDiv.classList.add('message-item'); // For general styling
                msgDiv.classList.add(`message-${msg.sender}`); // For sender-specific styling
                msgDiv.style.marginBottom = '10px';
                msgDiv.style.padding = '8px';
                msgDiv.style.borderRadius = '4px';

                if (msg.sender === 'user') {
                    msgDiv.style.backgroundColor = '#e1f5fe'; // Light blue for user
                    msgDiv.style.textAlign = 'left';
                } else if (msg.sender === 'bot') {
                    msgDiv.style.backgroundColor = '#f0f4c3'; // Light green for bot
                    msgDiv.style.textAlign = 'left';
                } else if (msg.sender === 'agent') {
                    msgDiv.style.backgroundColor = '#d1c4e9'; // Light purple for agent
                    msgDiv.style.textAlign = 'right'; // Agent messages on the right
                }
                
                msgDiv.innerHTML = `
                    <p style="margin:0; padding:0;">${msg.content}</p>
                    <small style="font-size:0.75em; color: #555;">${new Date(msg.timestamp).toLocaleString()} (${msg.sender})</small>
                `;
                messageHistoryContainer.appendChild(msgDiv);
            });
            messageHistoryContainer.scrollTop = messageHistoryContainer.scrollHeight; // Scroll to bottom
        }
    } catch (error) {
        console.error(`Error cargando mensajes para ${conversationId}:`, error);
        messageHistoryContainer.innerHTML = `<p>Error al cargar mensajes: ${error.message}</p>`;
    }
}

async function sendAgentReply() {
    if (!inboxReplyText || !currentOpenConversationId) return;
    const text = inboxReplyText.value.trim();
    if (!text) {
        alert('El mensaje no puede estar vacío.');
        return;
    }

    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) { alert('Error de autenticación.'); return; }

    if(inboxSendReplyBtn) inboxSendReplyBtn.disabled = true;
    
    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/inbox/conversations/${currentOpenConversationId}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text })
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        
        inboxReplyText.value = ''; // Clear input
        await displayConversationMessages(currentOpenConversationId); // Refresh messages
        // Optionally, refresh conversation list to update preview/status
        if (inboxStatusFilter) await loadInboxConversations(inboxStatusFilter.value); 

    } catch (error) {
        console.error('Error enviando respuesta:', error);
        alert(`Error al enviar respuesta: ${error.message}`);
    } finally {
        if(inboxSendReplyBtn) inboxSendReplyBtn.disabled = false;
    }
}

async function updateInboxConversationStatus(conversationId, newStatus) {
    if (!conversationId || !newStatus) {
        alert('ID de conversación o nuevo estado no válidos.');
        return;
    }

    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) { alert('Error de autenticación.'); return; }

    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/inbox/conversations/${conversationId}/status`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ newStatus: newStatus })
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`); }
        
        alert('Estado de la conversación actualizado con éxito.'); // Simple feedback
        await loadInboxConversations(inboxStatusFilter ? inboxStatusFilter.value : ''); // Refresh list

        // If the currently open conversation's status changed, update its view or clear if closed/archived
        if (conversationId === currentOpenConversationId) {
            if (newStatus === 'closed_by_agent' || newStatus === 'archived') {
                messageHistoryContainer.innerHTML = '<p>Esta conversación ha sido cerrada/archivada.</p>';
                inboxReplyArea.style.display = 'none';
                // inboxConvActions.style.display = 'none'; // Or just disable certain actions
                inboxSelectedConvHeader.textContent = `Conversación cerrada/archivada`;
            } else {
                // Refresh messages to show potential status update within message view if applicable
                // For now, just reloading the list is the main feedback.
            }
        }
    } catch (error) {
        console.error('Error actualizando estado de conversación:', error);
        alert(`Error al actualizar estado: ${error.message}`);
    }
}


// --- Event Listeners Setup ---
if (logoutBtnDashboard) logoutBtnDashboard.addEventListener('click', async () => { /* ... existing code ... */ });
if (configForm) configForm.addEventListener('submit', handleUpdateConfig);
if (uploadFileBtn) uploadFileBtn.addEventListener('click', handleFileUpload);
if (knowledgeSourcesList) knowledgeSourcesList.addEventListener('click', handleSourceAction);
if (refreshUsageBtn) refreshUsageBtn.addEventListener('click', displayClientUsage);

// Inbox Event Listeners
if (inboxStatusFilter) inboxStatusFilter.addEventListener('change', (e) => loadInboxConversations(e.target.value));
if (refreshInboxBtn) refreshInboxBtn.addEventListener('click', () => loadInboxConversations(inboxStatusFilter ? inboxStatusFilter.value : ''));
if (inboxSendReplyBtn) inboxSendReplyBtn.addEventListener('click', sendAgentReply);
if (inboxCloseConvBtn) {
    inboxCloseConvBtn.addEventListener('click', () => {
        if (currentOpenConversationId) {
            updateInboxConversationStatus(currentOpenConversationId, 'closed_by_agent');
        } else {
            alert('Ninguna conversación seleccionada.');
        }
    });
}
if (inboxApplyStatusChangeBtn && inboxChangeStatusDropdown) {
    inboxApplyStatusChangeBtn.addEventListener('click', () => {
        const newStatus = inboxChangeStatusDropdown.value;
        if (newStatus && currentOpenConversationId) {
            updateInboxConversationStatus(currentOpenConversationId, newStatus);
        } else if (!currentOpenConversationId) {
            alert('Ninguna conversación seleccionada.');
        } else if (!newStatus) {
            alert('Por favor, seleccione un estado para aplicar.');
        }
    });
}

// --- Standard Auth and Utility Functions (Copied from previous version, ensure they are correct) ---
async function displayClientUsage() {
    if (!currentClientId) {
        if (usageMessage) { usageMessage.textContent = 'Error: Client ID no encontrado.'; usageMessage.className = 'error'; }
        return;
    }
    if (usageMessage) { usageMessage.textContent = 'Cargando estadísticas...'; usageMessage.className = 'info'; }
    if (aiResolutionsCount) aiResolutionsCount.textContent = 'Cargando...';
    if (totalQueriesCount) totalQueriesCount.textContent = 'Cargando...';
    try {
        const token = (await supabase.auth.getSession())?.data.session?.access_token;
        if (!token) throw new Error('Sesión no válida.');
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/usage/resolutions`, {
            method: 'GET', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Error ${response.status}`);}
        const usageData = await response.json();
        if (aiResolutionsCount) aiResolutionsCount.textContent = usageData.ai_resolutions_current_month ?? 'N/A';
        if (totalQueriesCount) totalQueriesCount.textContent = usageData.total_queries_current_month ?? 'N/A';
        if (statsLastUpdated) statsLastUpdated.textContent = new Date().toLocaleString();
        if (usageMessage) { usageMessage.textContent = 'Estadísticas cargadas.'; usageMessage.className = 'success'; setTimeout(() => { if (usageMessage) usageMessage.textContent = ''; }, 3000); }
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
        if (usageMessage) { usageMessage.textContent = `Error estadísticas: ${error.message}`; usageMessage.className = 'error';}
        if (aiResolutionsCount) aiResolutionsCount.textContent = 'Error';
        if (totalQueriesCount) totalQueriesCount.textContent = 'Error';
        if (statsLastUpdated) statsLastUpdated.textContent = 'Error';
    }
}

// --- Initialize Dashboard ---
document.addEventListener('DOMContentLoaded', checkAuthAndLoadDashboard);
