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
const widgetSection = document.getElementById('widget'); // Assuming a widget section exists
const analyticsSection = document.getElementById('analyticsSection'); // New Analytics Section

// --- Navigation Links ---
const navConfigLink = document.querySelector('nav ul li a[href="#config"]');
const navIngestLink = document.querySelector('nav ul li a[href="#ingest"]'); // Note: href="#ingest" was in HTML, but no section for it. Assuming knowledgeManagement is used.
const navWidgetLink = document.querySelector('nav ul li a[href="#widget"]');
const navUsageLink = document.querySelector('nav ul li a[href="#usage"]');
const navInboxLink = document.getElementById('navInboxLink');
const navAnalyticsLink = document.querySelector('nav ul li a[data-section="analyticsSection"]'); // New Analytics Link

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

// --- Analytics Section Elements ---
const analyticsPeriodSelector = document.getElementById('analyticsPeriodSelector');
const refreshAnalyticsBtn = document.getElementById('refreshAnalyticsBtn');
const analyticsLoadingMessage = document.getElementById('analyticsLoadingMessage');
const totalConversationsEl = document.getElementById('totalConversations');
const escalatedConversationsEl = document.getElementById('escalatedConversations');
const escalatedPercentageEl = document.getElementById('escalatedPercentage');
const unansweredByBotConversationsEl = document.getElementById('unansweredByBotConversations');
const unansweredPercentageEl = document.getElementById('unansweredPercentage');
const avgDurationEl = document.getElementById('avgDuration');
const avgMessagesPerConversationEl = document.getElementById('avgMessagesPerConversation');
const unansweredQueriesListEl = document.getElementById('unansweredQueriesList');


// --- State Variables ---
let currentClientId = null;
let currentOpenConversationId = null;
let currentConversations = [];
let analyticsDataLoadedOnce = false; // Flag for initial analytics load

// --- Helper to show/hide sections ---
const allDashboardSections = [configSection, knowledgeManagementSection, usageSection, inboxSection, widgetSection, analyticsSection].filter(Boolean);

function showSection(sectionIdToShow) {
    allDashboardSections.forEach(section => {
        if (section.id === sectionIdToShow) {
            section.style.display = 'block';
            if (section.id === 'analyticsSection' && !analyticsDataLoadedOnce && analyticsPeriodSelector) {
                loadChatbotAnalytics(analyticsPeriodSelector.value);
                analyticsDataLoadedOnce = true;
            }
        } else {
            section.style.display = 'none';
        }
    });
    // Update URL hash
    window.location.hash = sectionIdToShow;
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
    
    const hash = window.location.hash.substring(1);
    const sectionExists = allDashboardSections.some(s => s.id === hash);

    if (hash && sectionExists) {
        showSection(hash);
        if (hash === 'inboxSection' && inboxStatusFilter) await loadInboxConversations(inboxStatusFilter.value);
    } else if (configSection) { // Default to config if no valid hash or hash is empty
        showSection('config');
    }


    if (loadingMessage) loadingMessage.style.display = 'none';
    if (dashboardContent) dashboardContent.classList.remove('hidden');
}

// --- Navigation Event Listeners ---
document.querySelectorAll('nav ul li a[data-section]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const sectionId = e.target.dataset.section;
        if (document.getElementById(sectionId)) { // Check if section actually exists
            showSection(sectionId);
            if (sectionId === 'inboxSection' && inboxStatusFilter) {
                 loadInboxConversations(inboxStatusFilter.value);
            }
        } else {
            console.warn(`Navigation link points to non-existent section: ${sectionId}`);
            if(configSection) showSection('config'); // Default to config if link is broken
        }
    });
});

// Special handling for original nav links if they don't have data-section
if (navConfigLink) navConfigLink.addEventListener('click', (e) => { e.preventDefault(); showSection('config'); });
if (navIngestLink && knowledgeManagementSection) navIngestLink.addEventListener('click', (e) => { e.preventDefault(); showSection('knowledgeManagement'); }); // Assuming ingest maps to knowledgeManagement
if (navWidgetLink && widgetSection) navWidgetLink.addEventListener('click', (e) => { e.preventDefault(); showSection('widget'); });
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
        const configData = await response.json();
        if (configData.widget_config) {
            if (botNameInput) botNameInput.value = configData.widget_config.botName || '';
            if (welcomeMessageInput) welcomeMessageInput.value = configData.widget_config.welcomeMessage || '';
        }
        if (knowledgeUrlInput) knowledgeUrlInput.value = configData.knowledge_source_url || '';
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
                
                const ingestButtonDisabled = source.status === 'ingesting' ? 'disabled' : '';
                const deleteButtonDisabled = (source.source_id === 'main_url' || source.status === 'ingesting') ? 'disabled' : '';

                const textContentDiv = document.createElement('div');
                textContentDiv.innerHTML = `<strong>${source.source_name || 'Fuente sin nombre'}</strong> (${source.source_type || 'N/A'}) - Estado: ${statusDisplay} ${source.last_ingest_at ? `- Última ingesta: ${new Date(source.last_ingest_at).toLocaleString()}` : ''} ${source.last_ingest_error ? `<br><small style="color:red;">Error: ${source.last_ingest_error}</small>` : ''}`;

                const frequencyDiv = document.createElement('div');
                frequencyDiv.style.fontSize = '0.9em';
                frequencyDiv.style.color = '#555';
                frequencyDiv.style.marginTop = '4px';
                frequencyDiv.innerHTML = `Frecuencia de Re-ingesta: <strong class="reingest-frequency-value">${source.reingest_frequency || 'Manual'}</strong>`;
                textContentDiv.appendChild(frequencyDiv);
                li.appendChild(textContentDiv);

                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'source-actions';
                actionsDiv.style.marginTop = '5px';

                const ingestButton = document.createElement('button');
                ingestButton.className = 'ingest-source-btn';
                ingestButton.dataset.sourceId = source.source_id;
                ingestButton.textContent = 'Ingerir Ahora';
                if (ingestButtonDisabled) ingestButton.disabled = true;
                actionsDiv.appendChild(ingestButton);

                const deleteButton = document.createElement('button');
                deleteButton.className = 'delete-source-btn';
                deleteButton.dataset.sourceId = source.source_id;
                deleteButton.textContent = 'Eliminar';
                if (deleteButtonDisabled) deleteButton.disabled = true;
                deleteButton.style.marginLeft = '5px';
                actionsDiv.appendChild(deleteButton);

                const previewChunksButton = document.createElement('button');
                previewChunksButton.className = 'preview-chunks-btn';
                previewChunksButton.dataset.sourceId = source.source_id;
                previewChunksButton.textContent = 'Ver Muestra de Chunks';
                previewChunksButton.style.marginLeft = '5px';
                if (source.status !== 'completed' && source.status !== 'ingesting') {
                    // previewChunksButton.disabled = true;
                }
                actionsDiv.appendChild(previewChunksButton);

                if (source.source_type === 'url' || source.storage_path) {
                    const configReingestButton = document.createElement('button');
                    configReingestButton.className = 'config-reingest-btn btn btn-secondary btn-sm disabled-feature-button';
                    configReingestButton.dataset.sourceId = source.source_id;
                    configReingestButton.textContent = 'Configurar Re-ingesta';
                    configReingestButton.disabled = true;
                    configReingestButton.style.marginLeft = '5px';
                    actionsDiv.appendChild(configReingestButton);

                    const futureNote = document.createElement('em');
                    futureNote.textContent = ' (Próximamente)';
                    futureNote.style.fontSize = '0.8em';
                    futureNote.style.color = '#777';
                    futureNote.classList.add('future-note');
                    actionsDiv.appendChild(futureNote);
                }

                li.appendChild(actionsDiv);
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
    const target = event.target; 
    const sourceId = target.dataset.sourceId; 
    if (!sourceId) return;

    if (target.classList.contains('ingest-source-btn')) {
        await triggerIngestion(sourceId);
    } else if (target.classList.contains('delete-source-btn')) {
        if (sourceId !== 'main_url' && confirm(`¿Eliminar fuente ${sourceId}?`)) {
            await deleteKnowledgeSource(sourceId);
        }
    } else if (target.classList.contains('preview-chunks-btn')) {
        await fetchAndDisplayChunkSample(sourceId);
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
        knowledgeManagementMessage.textContent = result.message || `Ingesta para ${sourceId} iniciada/completada.`; 
        knowledgeManagementMessage.className = result.success ? 'success' : 'info';
        await loadKnowledgeSources();
    } catch (error) {
        console.error(`Error ingiriendo ${sourceId}:`, error);
        knowledgeManagementMessage.textContent = `Error ingesta ${sourceId}: ${error.message}`; knowledgeManagementMessage.className = 'error';
    }
    setTimeout(() => { if(knowledgeManagementMessage) knowledgeManagementMessage.textContent = ''; }, 7000);
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
// ... (existing inbox functions remain here) ...
async function loadInboxConversations(statusFilter = '') {
    if (!inboxLoadingMsg || !inboxConvList) return;
    inboxLoadingMsg.style.display = 'block';
    inboxConvList.innerHTML = '';
    currentConversations = [];

    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) {
        inboxLoadingMsg.textContent = 'Error de autenticación.';
        inboxLoadingMsg.className = 'error';
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
                document.querySelectorAll('#inboxConvList li').forEach(item => item.style.backgroundColor = '');
                li.style.backgroundColor = '#e0e0e0';
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
    inboxReplyArea.style.display = 'flex';
    inboxConvActions.style.display = 'block';

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
        inboxSelectedConvHeader.textContent = `Chat ID: ${conversationId.substring(0,8)}...`;
        messageHistoryContainer.innerHTML = '';

        if (messages.length === 0) {
            messageHistoryContainer.innerHTML = '<p>No hay mensajes en esta conversación aún.</p>';
        } else {
            messages.forEach(msg => {
                const msgDiv = document.createElement('div');
                msgDiv.classList.add('message-item');
                msgDiv.classList.add(`message-${msg.sender}`);
                msgDiv.style.marginBottom = '10px';
                msgDiv.style.padding = '8px';
                msgDiv.style.borderRadius = '4px';

                if (msg.sender === 'user') {
                    msgDiv.style.backgroundColor = '#e1f5fe';
                    msgDiv.style.textAlign = 'left';
                } else if (msg.sender === 'bot') {
                    msgDiv.style.backgroundColor = '#f0f4c3';
                    msgDiv.style.textAlign = 'left';
                } else if (msg.sender === 'agent') {
                    msgDiv.style.backgroundColor = '#d1c4e9';
                    msgDiv.style.textAlign = 'right';
                }
                
                msgDiv.innerHTML = `
                    <p style="margin:0; padding:0;">${msg.content}</p>
                    <small style="font-size:0.75em; color: #555;">${new Date(msg.timestamp).toLocaleString()} (${msg.sender})</small>
                `;

                if (msg.sender === 'bot' && msg.message_id) {
                    const feedbackActionsDiv = document.createElement('div');
                    feedbackActionsDiv.className = 'feedback-actions';
                    feedbackActionsDiv.style.marginTop = '5px';
                    feedbackActionsDiv.style.textAlign = 'left';

                    const thumbUpBtn = document.createElement('button');
                    thumbUpBtn.textContent = '👍';
                    thumbUpBtn.classList.add('feedback-btn');
                    thumbUpBtn.dataset.messageId = msg.message_id;
                    thumbUpBtn.dataset.rating = '1';
                    thumbUpBtn.style.marginLeft = '0px';
                    thumbUpBtn.style.marginRight = '5px';
                    thumbUpBtn.style.border = 'none';
                    thumbUpBtn.style.background = 'none';
                    thumbUpBtn.style.cursor = 'pointer';

                    const thumbDownBtn = document.createElement('button');
                    thumbDownBtn.textContent = '👎';
                    thumbDownBtn.classList.add('feedback-btn');
                    thumbDownBtn.dataset.messageId = msg.message_id;
                    thumbDownBtn.dataset.rating = '-1';
                    thumbDownBtn.style.marginLeft = '5px';
                    thumbDownBtn.style.border = 'none';
                    thumbDownBtn.style.background = 'none';
                    thumbDownBtn.style.cursor = 'pointer';

                    feedbackActionsDiv.appendChild(thumbUpBtn);
                    feedbackActionsDiv.appendChild(thumbDownBtn);
                    msgDiv.appendChild(feedbackActionsDiv);
                }
                messageHistoryContainer.appendChild(msgDiv);
            });
            messageHistoryContainer.scrollTop = messageHistoryContainer.scrollHeight;
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
        
        inboxReplyText.value = '';
        await displayConversationMessages(currentOpenConversationId);
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
        
        alert('Estado de la conversación actualizado con éxito.');
        await loadInboxConversations(inboxStatusFilter ? inboxStatusFilter.value : '');

        if (conversationId === currentOpenConversationId) {
            if (newStatus === 'closed_by_agent' || newStatus === 'archived') {
                messageHistoryContainer.innerHTML = '<p>Esta conversación ha sido cerrada/archivada.</p>';
                inboxReplyArea.style.display = 'none';
                inboxSelectedConvHeader.textContent = `Conversación cerrada/archivada`;
            }
        }
    } catch (error) {
        console.error('Error actualizando estado de conversación:', error);
        alert(`Error al actualizar estado: ${error.message}`);
    }
}

// --- Event Listeners Setup ---
// ... (other listeners remain the same) ...
if (logoutBtnDashboard) {
    logoutBtnDashboard.addEventListener('click', async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('Error al cerrar sesión:', error);
            if (errorMessageDashboard) errorMessageDashboard.textContent = `Error al cerrar sesión: ${error.message}`;
        } else {
            window.location.href = 'login.html';
        }
    });
}
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

// --- Feedback Submission Function ---
async function handleFeedbackSubmit(conversationId, messageId, rating) {
    console.log(`Feedback submitted: ConvID=${conversationId}, MsgID=${messageId}, Rating=${rating}`);

    const buttons = messageHistoryContainer.querySelectorAll(`.feedback-btn[data-message-id="${messageId}"]`);
    const parentFeedbackDiv = buttons.length > 0 ? buttons[0].parentElement : null;

    buttons.forEach(button => {
        button.disabled = true;
        button.style.opacity = '0.5';
        button.style.cursor = 'default';
        if (parseInt(button.dataset.rating, 10) === rating) {
            button.style.transform = 'scale(1.1)';
        }
    });

    let feedbackMsgElement;
    if (parentFeedbackDiv) {
        const existingThanks = parentFeedbackDiv.querySelector('.thanks-feedback');
        if (existingThanks) existingThanks.remove();
        feedbackMsgElement = document.createElement('span');
        feedbackMsgElement.className = 'thanks-feedback';
        feedbackMsgElement.style.fontSize = '0.8em';
        feedbackMsgElement.style.marginLeft = '10px';
        parentFeedbackDiv.appendChild(feedbackMsgElement);
    }

    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) {
        if (feedbackMsgElement) feedbackMsgElement.textContent = 'Error: No autenticado.';
        console.error("Feedback submission failed: Not authenticated.");
        buttons.forEach(button => {
            button.disabled = false;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
            button.style.transform = '';
        });
        return;
    }

    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/inbox/conversations/${conversationId}/messages/${messageId}/feedback`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rating: rating, comment: "" })
        });

        if (response.ok) {
            console.log(`Feedback for MsgID=${messageId} submitted successfully.`);
            if (feedbackMsgElement) {
                feedbackMsgElement.textContent = '¡Gracias!';
                feedbackMsgElement.style.color = 'green';
            }
        } else {
            const errorData = await response.json();
            console.error(`Failed to submit feedback for MsgID=${messageId}:`, errorData.message || response.statusText);
            if (feedbackMsgElement) {
                feedbackMsgElement.textContent = 'Error al enviar.';
                feedbackMsgElement.style.color = 'red';
            }
            buttons.forEach(button => {
                button.disabled = false;
                button.style.opacity = '1';
                button.style.cursor = 'pointer';
                button.style.transform = '';
            });
        }
    } catch (error) {
        console.error(`Exception during feedback submission for MsgID=${messageId}:`, error);
        if (feedbackMsgElement) {
            feedbackMsgElement.textContent = 'Error de red.';
            feedbackMsgElement.style.color = 'red';
        }
         buttons.forEach(button => {
            button.disabled = false;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
            button.style.transform = '';
        });
    } finally {
        if (feedbackMsgElement && feedbackMsgElement.textContent.startsWith("¡Gracias!")) {
            setTimeout(() => {
                if (feedbackMsgElement) feedbackMsgElement.remove();
                 buttons.forEach(button => {
                 });
            }, 3000);
        } else if (feedbackMsgElement) {
             setTimeout(() => {
                if (feedbackMsgElement) feedbackMsgElement.remove();
             }, 3000);
        }
    }
}

if (messageHistoryContainer) {
    messageHistoryContainer.addEventListener('click', function(event) {
        const feedbackButton = event.target.closest('.feedback-btn');
        if (feedbackButton) {
            const messageId = feedbackButton.dataset.messageId;
            const rating = parseInt(feedbackButton.dataset.rating, 10);
            if (currentOpenConversationId && messageId) {
                handleFeedbackSubmit(currentOpenConversationId, messageId, rating);
            } else {
                console.error("Cannot submit feedback: conversationId or messageId missing.", {currentOpenConversationId, messageId});
                alert("No se pudo determinar la conversación o el mensaje para el feedback.");
            }
        }
    });
}

// --- Chunk Sample Modal Functions ---
// ... (existing chunk sample modal functions remain here) ...
const chunkSampleModal = document.getElementById('chunkSampleModal');
const chunkSampleModalTitle = document.getElementById('chunkSampleModalTitle');
const chunkSampleModalBody = document.getElementById('chunkSampleModalBody');
const closeChunkSampleModalBtn = document.getElementById('closeChunkSampleModalBtn');

if (closeChunkSampleModalBtn) {
    closeChunkSampleModalBtn.onclick = function() {
        if(chunkSampleModal) chunkSampleModal.style.display = "none";
    }
}
window.onclick = function(event) {
    if (event.target == chunkSampleModal) {
        if(chunkSampleModal) chunkSampleModal.style.display = "none";
    }
}

async function fetchAndDisplayChunkSample(sourceId) {
    if (!chunkSampleModal || !chunkSampleModalTitle || !chunkSampleModalBody) {
        console.error("Modal elements not found for chunk sample display.");
        alert("Error de UI: No se pueden mostrar los chunks.");
        return;
    }

    chunkSampleModalTitle.textContent = `Muestra de Chunks para Fuente ID: ${sourceId.substring(0,8)}...`;
    chunkSampleModalBody.innerHTML = '<p>Cargando muestra de chunks...</p>';
    chunkSampleModal.style.display = "block";

    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) {
        chunkSampleModalBody.innerHTML = '<p>Error de autenticación.</p>';
        return;
    }

    try {
        const response = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/knowledge/sources/${sourceId}/chunk_sample`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error ${response.status} - ${response.statusText}`);
        }

        const chunks = await response.json();

        if (!chunks || chunks.length === 0) {
            chunkSampleModalBody.innerHTML = '<p>No se encontraron chunks para esta fuente o la muestra está vacía.</p>';
            return;
        }

        let contentHtml = '<ul>';
        chunks.forEach(chunk => {
            contentHtml += `<li style="margin-bottom: 15px; padding: 10px; border: 1px solid #eee; background-color: #f9f9f9;">`;
            contentHtml += `<p><strong>Contenido (primeros 300 caracteres):</strong></p>`;
            contentHtml += `<pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 100px; overflow-y: auto; background-color: #fff; padding: 5px;">${chunk.content ? chunk.content.substring(0, 300) + (chunk.content.length > 300 ? '...' : '') : 'N/A'}</pre>`;

            if (chunk.metadata) {
                contentHtml += `<p style="font-size:0.9em; margin-top:5px;"><strong>Metadata:</strong></p>`;
                contentHtml += `<ul style="font-size:0.85em; list-style-type:square; margin-left:20px;">`;
                if (chunk.metadata.chunk_char_length) {
                    contentHtml += `<li>Longitud: ${chunk.metadata.chunk_char_length} caracteres</li>`;
                }
                if (chunk.metadata.hierarchy && chunk.metadata.hierarchy.length > 0) {
                    const hierarchyString = chunk.metadata.hierarchy.map(h => `${h.level}: ${h.text}`).join(' > ');
                    contentHtml += `<li>Jerarquía: ${hierarchyString}</li>`;
                }
                 if (chunk.metadata.content_type_hint) {
                    contentHtml += `<li>Tipo Contenido (Pista): ${chunk.metadata.content_type_hint}</li>`;
                }
                if (chunk.metadata.source_name) { // From baseMetadata
                    contentHtml += `<li>Nombre Fuente Original: ${chunk.metadata.source_name}</li>`;
                }
                contentHtml += `</ul>`;
            }
            contentHtml += `</li>`;
        });
        contentHtml += '</ul>';
        chunkSampleModalBody.innerHTML = contentHtml;

    } catch (error) {
        console.error(`Error cargando muestra de chunks para ${sourceId}:`, error);
        chunkSampleModalBody.innerHTML = `<p style="color:red;">Error al cargar muestra de chunks: ${error.message}</p>`;
    }
}

// --- Analytics Functions ---
function escapeAttribute(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadChatbotAnalytics(period = '30d') {
    if (!currentClientId || !analyticsLoadingMessage || !totalConversationsEl || !unansweredQueriesListEl) {
        console.warn("Analytics UI elements not ready or missing client ID.");
        return;
    }

    analyticsLoadingMessage.style.display = 'block';
    analyticsLoadingMessage.textContent = 'Cargando datos analíticos...';
    unansweredQueriesListEl.innerHTML = '<li>Cargando sugerencias...</li>';
    // Reset metrics
    totalConversationsEl.textContent = '0';
    escalatedConversationsEl.textContent = '0';
    escalatedPercentageEl.textContent = '0.0';
    unansweredByBotConversationsEl.textContent = '0';
    unansweredPercentageEl.textContent = '0.0';
    avgDurationEl.textContent = '0';
    avgMessagesPerConversationEl.textContent = '0';

    const token = (await supabase.auth.getSession())?.data.session?.access_token;
    if (!token) {
        analyticsLoadingMessage.textContent = 'Error de autenticación para cargar analíticas.';
        return;
    }

    try {
        // Fetch Summary Data
        const summaryResponse = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/analytics/summary?period=${period}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!summaryResponse.ok) {
            const errData = await summaryResponse.json();
            throw new Error(`Error cargando sumario: ${errData.message || summaryResponse.statusText}`);
        }
        const summaryData = await summaryResponse.json();

        const totalConversations = summaryData.total_conversations || 0;
        const escalatedConversations = summaryData.escalated_conversations || 0;
        const unansweredByBot = summaryData.unanswered_by_bot_conversations || 0;

        totalConversationsEl.textContent = totalConversations;
        escalatedConversationsEl.textContent = escalatedConversations;
        unansweredByBotConversationsEl.textContent = unansweredByBot;

        const escalatedPercentage = totalConversations > 0 ? ((escalatedConversations / totalConversations) * 100).toFixed(1) : '0.0';
        const unansweredPercentage = totalConversations > 0 ? ((unansweredByBot / totalConversations) * 100).toFixed(1) : '0.0';
        escalatedPercentageEl.textContent = escalatedPercentage;
        unansweredPercentageEl.textContent = unansweredPercentage;

        avgDurationEl.textContent = (summaryData.avg_duration_seconds || 0).toFixed(0);
        avgMessagesPerConversationEl.textContent = (summaryData.avg_messages_per_conversation || 0).toFixed(1);

        // Fetch Unanswered/Escalated Queries
        const suggestionsResponse = await fetch(`${VERCEL_BACKEND_URL}/api/client/me/analytics/suggestions/unanswered?period=${period}&limit=10`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!suggestionsResponse.ok) {
            const errData = await suggestionsResponse.json();
            throw new Error(`Error cargando sugerencias: ${errData.message || suggestionsResponse.statusText}`);
        }
        const suggestions = await suggestionsResponse.json();

        unansweredQueriesListEl.innerHTML = ''; // Clear loading/previous
        if (suggestions.length === 0) {
            unansweredQueriesListEl.innerHTML = '<li>No hay sugerencias por ahora.</li>';
        } else {
            suggestions.forEach(item => {
                const li = document.createElement('li');
                const queryToEscape = item.summary || "Consulta no disponible";
                const formattedDate = item.last_occurred_at ? new Date(item.last_occurred_at).toLocaleDateString() : 'N/A';
                li.innerHTML = `"${escapeAttribute(queryToEscape)}" (Frecuencia: ${item.frequency || 1}, Última vez: ${formattedDate})
                                <button class="btn btn-sm btn-outline-primary add-to-kb-btn" data-query="${escapeAttribute(queryToEscape)}">Revisar/Añadir</button>`;
                unansweredQueriesListEl.appendChild(li);
            });
        }
        analyticsLoadingMessage.textContent = 'Datos cargados.';
        setTimeout(() => { if(analyticsLoadingMessage) analyticsLoadingMessage.style.display = 'none';}, 2000);

    } catch (error) {
        console.error('Error cargando datos analíticos:', error);
        if (analyticsLoadingMessage) analyticsLoadingMessage.textContent = `Error al cargar: ${error.message}`;
        unansweredQueriesListEl.innerHTML = '<li>Error al cargar sugerencias.</li>';
    } finally {
        // analyticsLoadingMessage.style.display = 'none'; // Already handled or timed out
    }
}

// Event Listeners for Analytics Controls
if (analyticsPeriodSelector) {
    analyticsPeriodSelector.addEventListener('change', function() {
        loadChatbotAnalytics(this.value);
    });
}
if (refreshAnalyticsBtn) {
    refreshAnalyticsBtn.addEventListener('click', () => {
        if(analyticsPeriodSelector) loadChatbotAnalytics(analyticsPeriodSelector.value);
    });
}

// Event Delegation for "Revisar/Añadir Conocimiento" buttons
if (unansweredQueriesListEl) {
    unansweredQueriesListEl.addEventListener('click', function(event) {
        const target = event.target;
        if (target && target.classList.contains('add-to-kb-btn')) {
            const queryText = target.dataset.query;
            if (queryText) {
                navigator.clipboard.writeText(queryText)
                    .then(() => {
                        alert("Consulta copiada al portapapeles. Por favor, ve a 'Gestionar Fuentes de Conocimiento' para añadir esta información o crear una nueva fuente.");
                        // Optionally navigate
                        if(knowledgeManagementSection) showSection('knowledgeManagement');
                    })
                    .catch(err => {
                        console.error('Error al copiar al portapapeles:', err);
                        alert('Error al copiar la consulta.');
                    });
            }
        }
    });
}


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

document.addEventListener('DOMContentLoaded', checkAuthAndLoadDashboard);

[end of mi-bot-atencion/src/dashboard.js]
