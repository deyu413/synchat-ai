// mi-bot-atencion/src/dashboard.js
// TODO: Consider using a simple templating engine if HTML generation becomes too complex.

import { logout } from './auth.js';

// Global variable for Chart.js instance to allow destruction before re-rendering
let sentimentPieChartInstance = null;
let topicBarChartInstance = null;
let sourceFeedbackChartInstance = null; // For new chart

// --- Globals for Table Sorting ---
let currentTopicSort = { key: 'queries_in_period', direction: 'desc' };
let lastFetchedTopicDataForSorting = [];

let currentSourcePerfSort = { key: 'retrieval_count_in_rag_interactions', direction: 'desc' };
let lastFetchedSourcePerfDataForSorting = [];

// Helper function for sorting arrays of objects
function sortData(dataArray, key, direction) {
    if (!Array.isArray(dataArray)) return [];
    dataArray.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        if (valA === null || valA === undefined) valA = direction === 'asc' ? Infinity : -Infinity;
        if (valB === null || valB === undefined) valB = direction === 'asc' ? Infinity : -Infinity;

        if (typeof valA === 'number' && typeof valB === 'number') {
            // Numeric sort
        } else if (typeof valA === 'string' && typeof valB === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }
        // Fallback for mixed types or other scenarios if necessary

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
    return dataArray;
}


document.addEventListener('DOMContentLoaded', () => {
    const userEmailSpan = document.getElementById('userEmail');
    const logoutBtn = document.getElementById('logoutBtnDashboard');
    const dashboardContent = document.getElementById('dashboardContent');
    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessageDashboard = document.getElementById('errorMessageDashboard');

    // Config form elements
    const configForm = document.getElementById('configForm');
    const botNameInput = document.getElementById('botName');
    const welcomeMessageInput = document.getElementById('welcomeMessage');
    const knowledgeUrlInput = document.getElementById('knowledgeUrl');
    const configMessageDiv = document.getElementById('configMessage');
    const botFormalitySelect = document.getElementById('botFormality');
    const botPersonaDescriptionTextarea = document.getElementById('botPersonaDescription');
    const botKeyPhrasesToUseTextarea = document.getElementById('botKeyPhrasesToUse');
    const botKeyPhrasesToAvoidTextarea = document.getElementById('botKeyPhrasesToAvoid');
    const basePromptOverrideTextarea = document.getElementById('basePromptOverride');

    // Knowledge Management Elements
    const knowledgeFileUpload = document.getElementById('knowledgeFileUpload');
    const uploadFileBtn = document.getElementById('uploadFileBtn');
    const uploadStatusMessage = document.getElementById('uploadStatusMessage');
    const knowledgeSourcesList = document.getElementById('knowledgeSourcesList');
    const loadingSourcesMsg = document.getElementById('loadingSourcesMsg');
    const knowledgeManagementMessage = document.getElementById('knowledgeManagementMessage');

    // Analytics elements
    const analyticsSection = document.getElementById('analyticsSection');
    const analyticsPeriodSelector = document.getElementById('analyticsPeriodSelector');
    const refreshAnalyticsBtn = document.getElementById('refreshAnalyticsBtn');
    const analyticsLoadingMessage = document.getElementById('analyticsLoadingMessage');
    const totalConversationsSpan = document.getElementById('totalConversations');
    const escalatedConversationsSpan = document.getElementById('escalatedConversations');
    const escalatedPercentageSpan = document.getElementById('escalatedPercentage');
    const unansweredByBotConversationsSpan = document.getElementById('unansweredByBotConversations'); // Added
    const unansweredPercentageSpan = document.getElementById('unansweredPercentage'); // Added
    const avgDurationSpan = document.getElementById('avgDuration'); // Added
    const avgMessagesPerConversationSpan = document.getElementById('avgMessagesPerConversation'); // Added
    const unansweredQueriesList = document.getElementById('unansweredQueriesList');

    const sentimentDistributionTableBody = document.getElementById('sentimentDistributionTableBody');
    const sentimentDataLoadingMsg = document.getElementById('sentimentDataLoadingMsg');
    const topicAnalyticsTableBody = document.getElementById('topicAnalyticsTableBody');
    const topicDataLoadingMsg = document.getElementById('topicDataLoadingMsg');
    const sourcePerformanceTableBody = document.getElementById('sourcePerformanceTableBody');
    const sourcePerformanceDataLoadingMsg = document.getElementById('sourcePerformanceDataLoadingMsg');

    // Chunk Sample Modal Elements
    const chunkSampleModal = document.getElementById('chunkSampleModal');
    const chunkSampleModalTitle = document.getElementById('chunkSampleModalTitle');
    const chunkSampleModalBody = document.getElementById('chunkSampleModalBody');
    const closeChunkSampleModalBtn = document.getElementById('closeChunkSampleModalBtn');

    // RAG Playground elements
    const ragPlaygroundSection = document.getElementById('ragPlayground');
    const playgroundQueryInput = document.getElementById('playgroundQueryInput');
    const runPlaygroundQueryBtn = document.getElementById('runPlaygroundQueryBtn');
    const playgroundStatusMessage = document.getElementById('playgroundStatusMessage');
    const playgroundResultsContainer = document.getElementById('playgroundResultsContainer');

    // Inbox Feedback Modal Elements
    const inboxFeedbackModal = document.getElementById('inboxFeedbackModal');
    const closeInboxFeedbackModalBtn = document.getElementById('closeInboxFeedbackModalBtn');
    const feedbackMessageIdStore = document.getElementById('feedbackMessageIdStore');
    const feedbackRagLogIdStore = document.getElementById('feedbackRagLogIdStore');
    const feedbackPositiveBtn = document.getElementById('feedbackPositiveBtn');
    const feedbackNegativeBtn = document.getElementById('feedbackNegativeBtn');
    const feedbackComment = document.getElementById('feedbackComment');
    const submitInboxFeedbackBtn = document.getElementById('submitInboxFeedbackBtn');

    // RAG Playground Feedback Modal Elements
    const playgroundFeedbackModal = document.getElementById('playgroundFeedbackModal');
    const closePlaygroundFeedbackModalBtn = document.getElementById('closePlaygroundFeedbackModalBtn');
    const playgroundFeedbackModalTitle = document.getElementById('playgroundFeedbackModalTitle');
    const playgroundFeedbackTypeStore = document.getElementById('playgroundFeedbackTypeStore');
    const playgroundItemIdStore = document.getElementById('playgroundItemIdStore'); // For chunk_id or proposition_id
    const playgroundRagLogIdStore = document.getElementById('playgroundRagLogIdStore'); // For the RAG interaction that led to the item
    const playgroundFeedbackPositiveBtn = document.getElementById('playgroundFeedbackPositiveBtn');
    const playgroundFeedbackNegativeBtn = document.getElementById('playgroundFeedbackNegativeBtn');
    const playgroundFeedbackComment = document.getElementById('playgroundFeedbackComment');
    const submitPlaygroundFeedbackBtn = document.getElementById('submitPlaygroundFeedbackBtn');

    // Usage Stats Elements
    const aiResolutionsCountEl = document.getElementById('aiResolutionsCount');
    const totalQueriesCountEl = document.getElementById('totalQueriesCount');
    const statsLastUpdatedEl = document.getElementById('statsLastUpdated');
    const usageMessageEl = document.getElementById('usageMessage');
    const refreshUsageBtn = document.getElementById('refreshUsageBtn');

    // Onboarding elements
    const onboardingMessageSection = document.getElementById('onboardingMessageSection');
    const dismissOnboardingBtn = document.getElementById('dismissOnboardingBtn');

    const API_BASE_URL = window.SYNCHAT_CONFIG?.API_BASE_URL || '';

    const displayMessage = (element, message, isSuccess) => {
        if (element) {
            element.textContent = message;
            element.className = isSuccess ? 'success' : 'error'; // Assumes CSS classes 'success' and 'error' exist in dashboard.html styles
            element.style.display = 'block';
            setTimeout(() => {
                if (element) { // Check if element still exists
                    element.style.display = 'none';
                    element.textContent = '';
                    element.className = '';
                }
            }, 5000);
        } else {
            console.warn("displayMessage called with a null element. Message:", message);
        }
    };

    function safeText(text) {
        if (text === null || text === undefined) return '';
        const tempEl = document.createElement('div');
        tempEl.textContent = text;
        return tempEl.innerHTML;
    }


    // Function to show onboarding message if not dismissed
    function showOnboardingMessage() {
        if (onboardingMessageSection && localStorage.getItem('synchat_onboarding_dismissed') !== 'true') {
            onboardingMessageSection.style.display = 'block';
        }
    }

    // Function to dismiss onboarding message
    function dismissOnboarding() {
        if (onboardingMessageSection) onboardingMessageSection.style.display = 'none';
        localStorage.setItem('synchat_onboarding_dismissed', 'true');
    }

    if (dismissOnboardingBtn) {
        dismissOnboardingBtn.addEventListener('click', dismissOnboarding);
    }

    showOnboardingMessage(); // Check and show on load

    async function fetchClientConfig() {
        const token = localStorage.getItem('synchat_session_token');
        if (!token) {
            console.error('Error de autenticación: No se encontró token.');
            displayMessage(errorMessageDashboard, 'Error de autenticación. Por favor, inicie sesión de nuevo.', false);
            return;
        }

        if (!API_BASE_URL) {
            console.error('Error crítico: La URL base de la API no está configurada.');
            displayMessage(errorMessageDashboard, 'Error crítico de configuración. Contacte a soporte.', false);
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/config`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = `Error al cargar configuración: ${errorData.message || response.statusText}`;
                console.error(errorMsg, response.status);
                displayMessage(configMessageDiv, errorMsg, false);
                return;
            }

            const data = await response.json();

            if(knowledgeUrlInput) knowledgeUrlInput.value = data.knowledge_source_url || '';
            if(basePromptOverrideTextarea) basePromptOverrideTextarea.value = data.base_prompt_override || '';

            if (data.widget_config) {
                if(botNameInput) botNameInput.value = data.widget_config.botName || '';
                if(welcomeMessageInput) welcomeMessageInput.value = data.widget_config.welcomeMessage || '';
                if(botFormalitySelect) botFormalitySelect.value = data.widget_config.botFormality || 'neutral';
                if(botPersonaDescriptionTextarea) botPersonaDescriptionTextarea.value = data.widget_config.botPersonaDescription || '';
                if(botKeyPhrasesToUseTextarea) botKeyPhrasesToUseTextarea.value = (data.widget_config.botKeyPhrasesToUse || []).join('\n');
                if(botKeyPhrasesToAvoidTextarea) botKeyPhrasesToAvoidTextarea.value = (data.widget_config.botKeyPhrasesToAvoid || []).join('\n');
            } else {
                if(botNameInput) botNameInput.value = '';
                if(welcomeMessageInput) welcomeMessageInput.value = '';
                if(botFormalitySelect) botFormalitySelect.value = 'neutral';
                if(botPersonaDescriptionTextarea) botPersonaDescriptionTextarea.value = '';
                if(botKeyPhrasesToUseTextarea) botKeyPhrasesToUseTextarea.value = '';
                if(botKeyPhrasesToAvoidTextarea) botKeyPhrasesToAvoidTextarea.value = '';
            }
        } catch (error) {
            console.error('Excepción al cargar la configuración:', error);
            displayMessage(errorMessageDashboard, `Excepción al cargar la configuración: ${error.message}`, false);
        }
    }

    if (configForm) {
        configForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (configMessageDiv) {
                configMessageDiv.style.display = 'none';
                configMessageDiv.textContent = '';
            }

            const botKeyPhrasesToUse = botKeyPhrasesToUseTextarea.value.split('\n').map(s => s.trim()).filter(Boolean);
            const botKeyPhrasesToAvoid = botKeyPhrasesToAvoidTextarea.value.split('\n').map(s => s.trim()).filter(Boolean);

            const formData = {
                widget_config: {
                    botName: botNameInput.value,
                    welcomeMessage: welcomeMessageInput.value,
                    botFormality: botFormalitySelect.value,
                    botPersonaDescription: botPersonaDescriptionTextarea.value,
                    botKeyPhrasesToUse: botKeyPhrasesToUse,
                    botKeyPhrasesToAvoid: botKeyPhrasesToAvoid
                },
                knowledge_source_url: knowledgeUrlInput.value,
                base_prompt_override: basePromptOverrideTextarea.value
            };

            const token = localStorage.getItem('synchat_session_token');
            if (!token) {
                displayMessage(configMessageDiv, 'Error de autenticación. Por favor, inicie sesión de nuevo.', false);
                return;
            }
            if (!API_BASE_URL) {
                displayMessage(configMessageDiv, 'Error crítico: La URL base de la API no está configurada.', false);
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/client/me/config`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(formData)
                });

                if (response.ok) {
                    await response.json();
                    displayMessage(configMessageDiv, 'Configuración guardada con éxito.', true);
                } else {
                    const errorData = await response.json().catch(() => ({ message: 'Error desconocido.' }));
                    console.error('Error saving config:', response.status, errorData);
                    displayMessage(configMessageDiv, `Error al guardar: ${errorData.message || response.statusText}`, false);
                }
            } catch (error) {
                console.error('Error en el envío del formulario de configuración:', error);
                displayMessage(configMessageDiv, `Error al enviar: ${error.message}`, false);
            }
        });
    }

    async function loadKnowledgeSources() {
        if (!knowledgeSourcesList || !loadingSourcesMsg || !token) {
            console.error("Knowledge source UI elements not found or user not authenticated.");
            if(loadingSourcesMsg) loadingSourcesMsg.textContent = "Error: no se puede cargar sin autenticación.";
            return;
        }
        loadingSourcesMsg.style.display = 'block';
        knowledgeSourcesList.innerHTML = ''; // Clear previous list
        if (knowledgeManagementMessage) knowledgeManagementMessage.style.display = 'none';
        const token = localStorage.getItem('synchat_session_token');

        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/sources`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || `Error fetching sources: ${response.status}`);
            }
            const sources = await response.json();

            if (sources && sources.length > 0) {
                sources.forEach(source => {
                    const li = document.createElement('li');
                    li.className = 'knowledge-source-item';
                    // Basic styling for clarity
                    li.style.border = '1px solid #eee';
                    li.style.padding = '10px';
                    li.style.marginBottom = '10px';
                    li.style.borderRadius = '4px';

                    const sourceId = source.source_id; // Ensure this matches your actual PK from backend
                    const sourceIdentifier = source.custom_title || source.source_name || source.url || `Fuente ID: ${sourceId}`;
                    const lastIngestDate = source.last_ingest_at ? new Date(source.last_ingest_at).toLocaleString() : 'N/A';
                    const chunkCount = source.metadata?.chunk_count !== undefined ? source.metadata.chunk_count : 'N/A';
                    const currentFrequency = source.reingest_frequency || '';
                    const customTitleVal = source.custom_title || '';
                    const categoryTagsVal = source.category_tags ? source.category_tags.join(', ') : '';

                    li.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h4 style="margin: 0;">${safeText(sourceIdentifier)}</h4>
                            <span>ID: ${safeText(sourceId)}</span>
                        </div>
                        <p style="font-size: 0.9em; color: #555;">
                            Tipo: ${safeText(source.source_type)} | Estado: ${safeText(source.status || 'N/A')} | Chunks: ${safeText(chunkCount)}
                        </p>
                        <p style="font-size: 0.9em; color: #555;">Última Ingesta: ${safeText(lastIngestDate)}</p>
                        <div style="margin-top: 10px;">
                            <label for="custom-title-${sourceId}" style="display: block; margin-bottom: 2px; font-size: 0.9em;">Título Personalizado:</label>
                            <input type="text" id="custom-title-${sourceId}" class="ks-custom-title" value="${safeText(customTitleVal)}" placeholder="Ej: FAQ General" style="width: calc(100% - 22px); padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
                        </div>
                        <div style="margin-top: 8px;">
                            <label for="reingest-freq-${sourceId}" style="display: block; margin-bottom: 2px; font-size: 0.9em;">Frec. Re-ingesta:</label>
                            <select id="reingest-freq-${sourceId}" class="ks-reingest-frequency" style="padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
                                <option value="" ${currentFrequency === '' ? 'selected' : ''}>Default (Automático)</option>
                                <option value="manual" ${currentFrequency === 'manual' ? 'selected' : ''}>Manual</option>
                                <option value="daily" ${currentFrequency === 'daily' ? 'selected' : ''}>Diaria</option>
                                <option value="weekly" ${currentFrequency === 'weekly' ? 'selected' : ''}>Semanal</option>
                            </select>
                        </div>
                        <div style="margin-top: 8px;">
                            <label for="category-tags-${sourceId}" style="display: block; margin-bottom: 2px; font-size: 0.9em;">Etiquetas de Categoría (separadas por coma):</label>
                            <input type="text" id="category-tags-${sourceId}" class="ks-category-tags" value="${safeText(categoryTagsVal)}" placeholder="Ej: soporte, ventas, general" style="width: calc(100% - 22px); padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
                        </div>
                        <div style="margin-top: 10px;">
                            <button class="btn-save-source-metadata" data-source-id="${sourceId}" style="padding: 6px 10px; background-color: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer;">Guardar Cambios</button>
                            <button class="btn-reingest-source" data-source-id="${sourceId}" style="margin-left: 8px; padding: 6px 10px; background-color: #17a2b8; color: white; border: none; border-radius: 3px; cursor: pointer;">Re-Ingestar</button>
                            <button class="btn-view-source-chunks" data-source-id="${sourceId}" style="margin-left: 8px; padding: 6px 10px; background-color: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer;">Ver Chunks</button>
                            <button class="btn-delete-source" data-source-id="${sourceId}" style="margin-left: 8px; padding: 6px 10px; background-color: #dc3545; color: white; border: none; border-radius: 3px; cursor: pointer;">Eliminar</button>
                        </div>
                    `;
                    knowledgeSourcesList.appendChild(li);
                });

                knowledgeSourcesList.querySelectorAll('.btn-save-source-metadata').forEach(button => button.addEventListener('click', handleSaveSourceMetadata));
                knowledgeSourcesList.querySelectorAll('.btn-reingest-source').forEach(button => button.addEventListener('click', handleReingestSource));
                knowledgeSourcesList.querySelectorAll('.btn-view-source-chunks').forEach(button => button.addEventListener('click', (event) => handleViewSourceChunks(event.target.dataset.sourceId)));
                knowledgeSourcesList.querySelectorAll('.btn-delete-source').forEach(button => button.addEventListener('click', handleDeleteSource));

            } else {
                knowledgeSourcesList.innerHTML = '<p>No se encontraron fuentes de conocimiento.</p>';
            }
        } catch (error) {
            console.error("Error loading knowledge sources:", error);
            if(knowledgeSourcesList) knowledgeSourcesList.innerHTML = `<p>Error al cargar fuentes: ${error.message}</p>`;
            if(knowledgeManagementMessage) displayMessage(knowledgeManagementMessage, `Error al cargar fuentes: ${error.message}`, false);
        } finally {
            if(loadingSourcesMsg) loadingSourcesMsg.style.display = 'none';
        }
    }

    async function handleSaveSourceMetadata(event) {
        const sourceId = event.target.dataset.sourceId;
        const customTitle = document.getElementById(`custom-title-${sourceId}`).value;
        const reingestFrequency = document.getElementById(`reingest-freq-${sourceId}`).value;
        const categoryTagsRaw = document.getElementById(`category-tags-${sourceId}`).value;
        const categoryTags = categoryTagsRaw.split(',').map(tag => tag.trim()).filter(tag => tag !== '');

        const payload = {
            custom_title: customTitle,
            reingest_frequency: reingestFrequency,
            category_tags: categoryTags
        };
        const token = localStorage.getItem('synchat_session_token');
        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/sources/${sourceId}/metadata`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (response.ok) {
                displayMessage(knowledgeManagementMessage, 'Metadatos guardados.', true);
                loadKnowledgeSources(); // Refresh list
            } else {
                throw new Error(result.message || 'Error al guardar metadatos.');
            }
        } catch (error) {
            console.error("Error saving source metadata:", error);
            displayMessage(knowledgeManagementMessage, `Error: ${error.message}`, false);
        }
    }

    async function handleReingestSource(event) {
        const sourceId = event.target.dataset.sourceId;
        if (!confirm(`¿Seguro que quieres re-ingestar la fuente ID: ${sourceId}? Esto borrará y reemplazará los datos existentes para esta fuente.`)) return;

        displayMessage(knowledgeManagementMessage, `Iniciando re-ingesta para ${sourceId}...`, true);
        const token = localStorage.getItem('synchat_session_token');
        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/sources/${sourceId}/ingest`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (response.ok) {
                displayMessage(knowledgeManagementMessage, `Re-ingesta para ${sourceId} completada/iniciada. ${result.message || ''}`, true);
                loadKnowledgeSources(); // Refresh the list to show new status
            } else {
                throw new Error(result.message || `Error durante la re-ingesta para ${sourceId}.`);
            }
        } catch (error) {
            console.error("Error re-ingesting source:", error);
            displayMessage(knowledgeManagementMessage, `Error en re-ingesta: ${error.message}`, false);
        }
    }

    async function handleDeleteSource(event) {
        const sourceId = event.target.dataset.sourceId;
        if (!confirm(`¿Estás SEGURO de que quieres eliminar la fuente de conocimiento con ID: ${sourceId}? Esta acción es IRREVERSIBLE y borrará todos los datos asociados.`)) {
            return;
        }
        displayMessage(knowledgeManagementMessage, `Eliminando fuente ${sourceId}...`, true);
        const token = localStorage.getItem('synchat_session_token');
        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/sources/${sourceId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (response.ok) {
                displayMessage(knowledgeManagementMessage, result.message || `Fuente ${sourceId} eliminada exitosamente.`, true);
                loadKnowledgeSources(); // Refresh the list
            } else {
                throw new Error(result.message || `Error al eliminar la fuente ${sourceId}.`);
            }
        } catch (error) {
            console.error("Error deleting source:", error);
            displayMessage(knowledgeManagementMessage, `Error al eliminar: ${error.message}`, false);
        }
    }

    if (uploadFileBtn && knowledgeFileUpload) {
        uploadFileBtn.addEventListener('click', async () => {
            if (!knowledgeFileUpload.files || knowledgeFileUpload.files.length === 0) {
                displayMessage(uploadStatusMessage, 'Por favor, selecciona un archivo para subir.', false);
                return;
            }
            const file = knowledgeFileUpload.files[0];
            const formData = new FormData();
            formData.append('file', file);

            displayMessage(uploadStatusMessage, 'Subiendo archivo...', true);
            const token = localStorage.getItem('synchat_session_token');

            try {
                const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/upload`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                const result = await response.json();
                if (response.ok) {
                    displayMessage(uploadStatusMessage, `Archivo "${result.source_name}" subido con éxito. ID de Fuente: ${result.source_id}. Ahora puedes iniciar la ingesta.`, true);
                    knowledgeFileUpload.value = ''; // Clear file input
                    loadKnowledgeSources(); // Refresh the list
                } else {
                    throw new Error(result.message || 'Error al subir el archivo.');
                }
            } catch (error) {
                console.error("Error uploading file:", error);
                displayMessage(uploadStatusMessage, `Error al subir: ${error.message}`, false);
            }
        });
    }


    async function handleViewSourceChunks(sourceId, page = 1) {
        if (!chunkSampleModal || !chunkSampleModalTitle || !chunkSampleModalBody) return;
        chunkSampleModalTitle.textContent = `Muestra de Chunks para Fuente ID: ${safeText(sourceId)}`;
        chunkSampleModalBody.innerHTML = '<p>Cargando chunks...</p>';
        chunkSampleModal.style.display = "block";
        const token = localStorage.getItem('synchat_session_token');

        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/sources/${sourceId}/chunks?page=${page}&pageSize=10`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || `Error fetching chunks: ${response.status}`);
            }
            const result = await response.json(); // result = { data: { chunks, totalCount, page, pageSize }, error }
            const chunksData = result.data;

            if (chunksData && chunksData.chunks && chunksData.chunks.length > 0) {
                let html = `<p>Mostrando página ${chunksData.page} de ${Math.ceil(chunksData.totalCount / chunksData.pageSize)}. Total Chunks: ${chunksData.totalCount}</p>`;
                html += '<ul>';
                chunksData.chunks.forEach(chunk => {
                    html += `<li style="border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 8px;">
                        <strong>Chunk ID: ${chunk.id}</strong> (Índice: ${chunk.metadata?.chunk_index || 'N/A'})<br>
                        <small>Creado: ${new Date(chunk.created_at).toLocaleString()}</small><br>
                        <small>Fuente Original: ${chunk.metadata?.original_source_id || 'N/A'} - ${chunk.metadata?.source_name || 'N/A'}</small><br>
                        <details>
                            <summary style="cursor:pointer; color:blue;">Ver Contenido y Metadata</summary>
                            <p><strong>Contenido:</strong><br><pre style="white-space: pre-wrap; word-wrap: break-word; background-color: #f8f8f8; padding: 5px;">${safeText(chunk.content)}</pre></p>
                            <p><strong>Metadata:</strong><br><pre style="white-space: pre-wrap; word-wrap: break-word; background-color: #f8f8f8; padding: 5px;">${safeText(JSON.stringify(chunk.metadata, null, 2))}</pre></p>
                        </details>
                    </li>`;
                });
                html += '</ul>';

                // Pagination
                html += '<div class="pagination" style="margin-top:15px; text-align:center;">';
                const totalPages = Math.ceil(chunksData.totalCount / chunksData.pageSize);
                if (chunksData.page > 1) {
                    html += `<button class="btn-chunk-page" data-source-id="${sourceId}" data-page="${chunksData.page - 1}" style="margin-right:5px;">Anterior</button>`;
                }
                html += `Página ${chunksData.page} de ${totalPages}`;
                if (chunksData.page < totalPages) {
                    html += `<button class="btn-chunk-page" data-source-id="${sourceId}" data-page="${chunksData.page + 1}" style="margin-left:5px;">Siguiente</button>`;
                }
                html += '</div>';

                chunkSampleModalBody.innerHTML = html;
                chunkSampleModalBody.querySelectorAll('.btn-chunk-page').forEach(button => {
                    button.addEventListener('click', (e) => {
                        handleViewSourceChunks(e.target.dataset.sourceId, parseInt(e.target.dataset.page));
                    });
                });

            } else {
                chunkSampleModalBody.innerHTML = '<p>No se encontraron chunks para esta fuente o en esta página.</p>';
            }
        } catch (error) {
            console.error("Error fetching chunks sample:", error);
            if(chunkSampleModalBody) chunkSampleModalBody.innerHTML = `<p>Error al cargar chunks: ${error.message}</p>`;
        }
    }

    // --- Inbox ---
    const inboxConvList = document.getElementById('inboxConvList');
    const inboxLoadingMsg = document.getElementById('inboxLoadingMsg');
    const inboxMessageView = document.getElementById('inboxMessageView');
    const messageHistoryContainer = document.getElementById('messageHistoryContainer');
    const inboxSelectedConvHeader = document.getElementById('inboxSelectedConvHeader');
    const inboxReplyArea = document.getElementById('inboxReplyArea');
    const inboxReplyText = document.getElementById('inboxReplyText');
    const inboxSendReplyBtn = document.getElementById('inboxSendReplyBtn');
    const inboxConvActions = document.getElementById('inboxConvActions');
    const inboxCloseConvBtn = document.getElementById('inboxCloseConvBtn');
    const inboxStatusFilter = document.getElementById('inboxStatusFilter');
    const refreshInboxBtn = document.getElementById('refreshInboxBtn');
    const inboxChangeStatusDropdown = document.getElementById('inboxChangeStatusDropdown');
    const inboxApplyStatusChangeBtn = document.getElementById('inboxApplyStatusChangeBtn');

    let currentOpenConversationId = null;

    async function loadInboxConversations() {
        if (!inboxConvList || !inboxLoadingMsg || !token) return;
        inboxLoadingMsg.style.display = 'block';
        inboxConvList.innerHTML = '';
        const token = localStorage.getItem('synchat_session_token');
        const statusFilter = inboxStatusFilter.value;

        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/inbox/conversations?status=${statusFilter}&pageSize=50`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error(`Error ${response.status} fetching conversations.`);
            const result = await response.json(); // result is {data: {conversations, totalCount, ...}, error}

            if (result.error) throw new Error(result.error);

            const conversations = result.data?.conversations || [];

            if (conversations.length > 0) {
                conversations.forEach(conv => {
                    const li = document.createElement('li');
                    li.dataset.conversationId = conv.conversation_id;
                    li.style.padding = '10px';
                    li.style.borderBottom = '1px solid #eee';
                    li.style.cursor = 'pointer';
                    li.innerHTML = `
                        <strong>ID:</strong> ${conv.conversation_id.substring(0,8)}...<br>
                        <strong>Estado:</strong> ${safeText(conv.status)}<br>
                        <small>Último mensaje: ${conv.last_message_preview ? safeText(conv.last_message_preview.substring(0,50)) + '...' : 'N/A'} (${new Date(conv.last_message_at || conv.created_at).toLocaleString()})</small>
                    `;
                    li.addEventListener('click', () => loadMessagesForConversation(conv.conversation_id));
                    inboxConvList.appendChild(li);
                });
            } else {
                inboxConvList.innerHTML = '<li>No hay conversaciones que coincidan con el filtro.</li>';
            }
        } catch (error) {
            console.error("Error loading inbox conversations:", error);
            inboxConvList.innerHTML = `<li>Error al cargar conversaciones: ${error.message}</li>`;
        } finally {
            inboxLoadingMsg.style.display = 'none';
        }
    }

    async function loadMessagesForConversation(conversationId) {
        currentOpenConversationId = conversationId;
        if (!messageHistoryContainer || !inboxSelectedConvHeader || !inboxReplyArea || !inboxConvActions || !token) return;
        messageHistoryContainer.innerHTML = 'Cargando mensajes...';
        inboxSelectedConvHeader.textContent = `Conversación: ${conversationId.substring(0,8)}...`;
        inboxReplyArea.style.display = 'none';
        inboxConvActions.style.display = 'none';
        const token = localStorage.getItem('synchat_session_token');

        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/inbox/conversations/${conversationId}/messages`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error(`Error ${response.status} fetching messages.`);
            const result = await response.json(); // result is {data: messagesArray, error}

            if (result.error) throw new Error(result.error);
            const messages = result.data || [];
            messageHistoryContainer.innerHTML = '';

            if (messages.length > 0) {
                messages.forEach(msg => {
                    const msgDiv = document.createElement('div');
                    msgDiv.style.padding = '8px';
                    msgDiv.style.marginBottom = '5px';
                    msgDiv.style.borderRadius = '5px';
                    msgDiv.style.border = '1px solid #f0f0f0';
                    msgDiv.style.backgroundColor = msg.sender === 'user' ? '#e9f5ff' : (msg.sender === 'agent' ? '#d4edda' : '#f8f9fa');
                    msgDiv.innerHTML = `
                        <strong>${msg.sender.toUpperCase()}:</strong> ${safeText(msg.content)}<br>
                        <small style="color:#777; font-size:0.8em;">${new Date(msg.timestamp).toLocaleString()}</small>
                        ${msg.sender === 'bot' ? `<button class="btn-inbox-feedback" data-message-id="${msg.message_id}" data-rag-log-id="${msg.rag_interaction_ref || ''}" style="margin-left:10px; font-size:0.8em; padding:2px 5px;">Feedback</button>` : ''}
                    `;
                    messageHistoryContainer.appendChild(msgDiv);
                });
                messageHistoryContainer.scrollTop = messageHistoryContainer.scrollHeight;

                messageHistoryContainer.querySelectorAll('.btn-inbox-feedback').forEach(button => {
                    button.addEventListener('click', (e) => {
                        feedbackMessageIdStore.value = e.target.dataset.messageId;
                        feedbackRagLogIdStore.value = e.target.dataset.ragLogId; // Will be empty string if null/undefined
                        feedbackComment.value = ''; // Clear previous comment
                        inboxFeedbackModal.style.display = 'block';
                    });
                });

            } else {
                messageHistoryContainer.innerHTML = '<p>No hay mensajes en esta conversación.</p>';
            }
            inboxReplyArea.style.display = 'block';
            inboxConvActions.style.display = 'block';
        } catch (error) {
            console.error(`Error loading messages for ${conversationId}:`, error);
            messageHistoryContainer.innerHTML = `<p>Error al cargar mensajes: ${error.message}</p>`;
        }
    }

    if (inboxSendReplyBtn) {
        inboxSendReplyBtn.addEventListener('click', async () => {
            if (!currentOpenConversationId || !inboxReplyText.value.trim() || !token) return;
            const content = inboxReplyText.value.trim();
            const token = localStorage.getItem('synchat_session_token');
            try {
                const response = await fetch(`${API_BASE_URL}/api/client/me/inbox/conversations/${currentOpenConversationId}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ content })
                });
                if (!response.ok) throw new Error(`Error ${response.status} sending message.`);
                inboxReplyText.value = '';
                loadMessagesForConversation(currentOpenConversationId); // Refresh messages
                loadInboxConversations(); // Refresh conversation list for potential status/preview update
            } catch (error) {
                console.error("Error sending agent reply:", error);
                alert(`Error al enviar respuesta: ${error.message}`);
            }
        });
    }

    if (inboxApplyStatusChangeBtn) {
        inboxApplyStatusChangeBtn.addEventListener('click', async () => {
            const newStatus = inboxChangeStatusDropdown.value;
            if (!currentOpenConversationId || !newStatus || !token) return;
            const token = localStorage.getItem('synchat_session_token');
            try {
                const response = await fetch(`${API_BASE_URL}/api/client/me/inbox/conversations/${currentOpenConversationId}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ newStatus })
                });
                if (!response.ok) throw new Error(`Error ${response.status} updating status.`);
                loadMessagesForConversation(currentOpenConversationId); // Refresh view
                loadInboxConversations(); // Refresh list
                alert(`Estado de la conversación actualizado a: ${newStatus}`);
            } catch (error) {
                console.error("Error changing conversation status:", error);
                alert(`Error al cambiar estado: ${error.message}`);
            }
        });
    }

    if (inboxStatusFilter) inboxStatusFilter.addEventListener('change', loadInboxConversations);
    if (refreshInboxBtn) refreshInboxBtn.addEventListener('click', loadInboxConversations);

    // Inbox Feedback Modal Logic
    if (closeInboxFeedbackModalBtn) closeInboxFeedbackModalBtn.onclick = () => { inboxFeedbackModal.style.display = "none"; };
    if (feedbackPositiveBtn) feedbackPositiveBtn.onclick = () => submitInboxFeedback(1);
    if (feedbackNegativeBtn) feedbackNegativeBtn.onclick = () => submitInboxFeedback(-1);
    if (submitInboxFeedbackBtn) { // Alternative: if user types comment then hits main submit
        submitInboxFeedbackBtn.addEventListener('click', () => {
            // Determine rating based on which button might have been "selected" or default to 0 (neutral) if only comment
            // For simplicity, this button might imply a neutral rating if no +/- was clicked or handle more complex state.
            // Current setup relies on +/- buttons directly calling submitInboxFeedback.
            // So this button might be redundant or for a "neutral with comment" case.
            // Let's assume for now it's mainly for if a rating button was already clicked.
            // Or it could trigger submit with a specific rating (e.g. 0 for neutral) + comment.
            // For now, this button will submit whatever rating was last "virtually" set by a prior +/- click (not implemented yet)
            // OR, more simply, it just ensures the modal closes.
            // A robust solution needs to store the selected rating if +/- are just for selection.
            // Simplification: assume a rating was given via +/- buttons, this just sends any comment.
            // Better: +/- buttons directly call submit. This button is not strictly needed OR submits neutral.
            // Let's make it submit with neutral if comment has text and no prior rating given by +/-
            const rating = 0; // Example: if this button is "submit comment as neutral"
            if (feedbackComment.value.trim()) {
                submitInboxFeedback(rating);
            } else {
                 inboxFeedbackModal.style.display = "none"; // Just close if no comment and no rating selected.
            }
        });
    }

    async function submitInboxFeedback(rating) {
        const messageId = feedbackMessageIdStore.value;
        const ragInteractionLogId = feedbackRagLogIdStore.value || null; // Ensure null if empty
        const commentText = feedbackComment.value.trim();
        const token = localStorage.getItem('synchat_session_token');

        if (!messageId || !token) {
            alert("Error: Falta información para enviar el feedback.");
            return;
        }

        const payload = {
            rating: rating,
            comment: commentText || null,
            feedback_type: 'response_quality', // Fixed for this feedback mechanism
            rag_interaction_log_id: ragInteractionLogId // May be null
            // conversation_id and message_id are in the URL path
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/inbox/conversations/${currentOpenConversationId}/messages/${messageId}/rag_feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (response.ok) {
                alert('Feedback enviado con éxito.');
            } else {
                throw new Error(result.message || 'Error al enviar feedback.');
            }
        } catch (error) {
            console.error("Error submitting inbox feedback:", error);
            alert(`Error: ${error.message}`);
        } finally {
            inboxFeedbackModal.style.display = "none";
        }
    }

    // --- RAG Playground Logic ---
    if (runPlaygroundQueryBtn) {
        runPlaygroundQueryBtn.addEventListener('click', async () => {
            const query = playgroundQueryInput.value.trim();
            if (!query) {
                playgroundStatusMessage.textContent = 'Por favor, introduce una consulta.';
                playgroundStatusMessage.style.color = 'orange';
                return;
            }
            playgroundStatusMessage.textContent = 'Ejecutando consulta...';
            playgroundStatusMessage.style.color = 'blue';
            playgroundResultsContainer.innerHTML = '';
            const token = localStorage.getItem('synchat_session_token');

            try {
                const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/rag-playground-query`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ queryText: query })
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || data.error || `Error ${response.status}`);
                }
                playgroundStatusMessage.textContent = 'Consulta completada.';
                playgroundStatusMessage.style.color = 'green';
                displayPlaygroundResults(data); // data is the pipelineDetails object

            } catch (error) {
                console.error("Error running RAG playground query:", error);
                playgroundStatusMessage.textContent = `Error: ${error.message}`;
                playgroundStatusMessage.style.color = 'red';
            }
        });
    }

    function displayPlaygroundResults(data) {
        playgroundResultsContainer.innerHTML = ''; // Clear previous results

        // Display RAG Interaction Log ID if available
        if (data.rag_interaction_log_id) {
            const logIdEl = document.createElement('p');
            logIdEl.innerHTML = `<strong>RAG Interaction Log ID:</strong> ${safeText(data.rag_interaction_log_id)} 
                <button class="btn-playground-feedback" data-feedback-type="overall_rag_response" data-rag-log-id="${data.rag_interaction_log_id}" style="margin-left:10px; font-size:0.8em; padding:3px 6px;">Feedback sobre esta Respuesta RAG</button>`;
            playgroundResultsContainer.appendChild(logIdEl);
        }

        // Function to create a collapsible section
        function createCollapsibleSection(title, contentGenerator) {
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = title;
            details.appendChild(summary);
            const contentDiv = document.createElement('div');
            contentDiv.className = 'playground-step-details';
            try {
                contentGenerator(contentDiv); // Populate content
            } catch (e) {
                contentDiv.innerHTML = `<p>Error al renderizar contenido: ${e.message}</p>`;
            }
            details.appendChild(contentDiv);
            playgroundResultsContainer.appendChild(details);
        }

        // 1. Original and Corrected Query
        createCollapsibleSection('1. Corrección de Consulta', (div) => {
            div.innerHTML = `<p><strong>Original:</strong> ${safeText(data.originalQuery)}</p>`;
            if (data.queryCorrection) {
                div.innerHTML += `<p><strong>Corregida:</strong> ${safeText(data.queryCorrection.correctedQuery)} (Cambiado: ${data.queryCorrection.wasChanged ? 'Sí' : 'No'})</p>`;
            }
        });

        // 2. Query Classification
        createCollapsibleSection('2. Clasificación de Consulta', (div) => {
            if (data.queryClassification) {
                div.innerHTML = `<p><strong>Categoría Predicha:</strong> ${safeText(data.queryClassification.predictedCategory || 'Ninguna')}</p>`;
                div.innerHTML += `<p><strong>Categorías Disponibles para Cliente:</strong> ${safeText((data.queryClassification.categoriesAvailable || []).join(', ') || 'Ninguna')}</p>`;
            } else {
                div.innerHTML = '<p>No se realizó clasificación.</p>';
            }
        });

        // 3. Query Decomposition and Expansion (Now part of pipelineDetails.queryDecomposition)
        createCollapsibleSection('3. Descomposición y Expansión de Consultas', (div) => {
            if (data.queryDecomposition) {
                 div.innerHTML += `<p><strong>¿Fue Descompuesta?:</strong> ${data.queryDecomposition.wasDecomposed ? 'Sí' : 'No'}</p>`;
                if (data.queryDecomposition.subQueries && data.queryDecomposition.subQueries.length > 0) {
                    div.innerHTML += `<p><strong>Sub-consultas (si aplica):</strong></p><ul>${data.queryDecomposition.subQueries.map(sq => `<li>${safeText(sq)}</li>`).join('')}</ul>`;
                }
                if (data.queryDecomposition.finalQueriesProcessed && data.queryDecomposition.finalQueriesProcessed.length > 0) {
                    div.innerHTML += `<p><strong>Consultas Finales Procesadas (después de expansión de sinónimos/acrónimos):</strong></p><ul>${data.queryDecomposition.finalQueriesProcessed.map(q => `<li>${safeText(q)}</li>`).join('')}</ul>`;
                } else {
                    div.innerHTML += `<p>Consulta procesada: ${safeText(data.queryCorrection?.correctedQuery || data.originalQuery)}</p>`;
                }
            } else {
                 div.innerHTML = `<p>No se realizó descomposición/expansión explícita o no hay detalles.</p>`;
            }
        });


        // 4. Aggregated Search Results (Vector & FTS Previews)
        createCollapsibleSection('4. Resultados de Búsqueda Agregados (Pre-Ranking)', (div) => {
            if (data.aggregatedResults) {
                div.innerHTML += `<h4>Vector Search (Top 5 preview):</h4>`;
                if (data.aggregatedResults.uniqueVectorResultsPreview && data.aggregatedResults.uniqueVectorResultsPreview.length > 0) {
                    data.aggregatedResults.uniqueVectorResultsPreview.slice(0,5).forEach(r => {
                        div.innerHTML += `<p><small>ID: ${r.id}, Score: ${r.score?.toFixed(4)}, Contenido: ${safeText(r.contentSnippet)}</small></p>`;
                    });
                } else { div.innerHTML += `<p><small>Sin resultados de búsqueda vectorial.</small></p>`; }

                div.innerHTML += `<h4 style="margin-top:10px;">FTS Search (Top 5 preview):</h4>`;
                if (data.aggregatedResults.uniqueFtsResultsPreview && data.aggregatedResults.uniqueFtsResultsPreview.length > 0) {
                    data.aggregatedResults.uniqueFtsResultsPreview.slice(0,5).forEach(r => {
                        div.innerHTML += `<p><small>ID: ${r.id}, Score: ${r.score?.toFixed(4)}, Contenido: ${safeText(r.contentSnippet)}</small></p>`;
                        if (r.highlighted_content) {
                             div.innerHTML += `<p><small>Destacado: ${r.highlighted_content.replace(/<(\/)?strong>/g, '<$1b>')}</small></p>`; // Replace strong with b for basic highlight
                        }
                    });
                } else { div.innerHTML += `<p><small>Sin resultados FTS.</small></p>`; }
            } else {
                div.innerHTML = '<p>No hay datos de resultados agregados.</p>';
            }
        });

        // 5. Merged and Initial Hybrid Ranked Results
        createCollapsibleSection('5. Resultados Fusionados y Ranking Híbrido Inicial (Top 10)', (div) => {
            if (data.mergedAndPreRankedResultsPreview && data.mergedAndPreRankedResultsPreview.length > 0) {
                data.mergedAndPreRankedResultsPreview.slice(0, 10).forEach(item => {
                    div.innerHTML += `<p>
                        <strong>ID: ${item.id}</strong>, Híbrido: ${item.initialHybridScore?.toFixed(4)}, Vector: ${item.vectorSimilarity?.toFixed(4)}, FTS: ${item.ftsScore?.toFixed(4)}<br>
                        <small>${safeText(item.contentSnippet)}</small><br>
                        ${item.highlighted_content ? `<small>Destacado: ${item.highlighted_content.replace(/<(\/)?strong>/g, '<$1b>')}</small><br>` : ''}
                        <small>Metadata: ${safeText(JSON.stringify(item.metadata))}</small>
                    </p>`;
                });
            } else {
                div.innerHTML = '<p>No hay resultados fusionados disponibles.</p>';
            }
        });

        // 6. Cross-Encoder Processing
        createCollapsibleSection('6. Re-ranking con Cross-Encoder', (div) => {
            if (data.crossEncoderProcessing && data.crossEncoderProcessing.inputs && data.crossEncoderProcessing.inputs.length > 0) {
                div.innerHTML += `<p><strong>Pares enviados al Cross-Encoder (Consulta + Documento):</strong></p>`;
                data.crossEncoderProcessing.inputs.forEach((pair, index) => {
                    const output = data.crossEncoderProcessing.outputs?.[index];
                    div.innerHTML += `<p><small>
                        Par ${index + 1}: Consulta -> "${safeText(pair.query.substring(0,50))}..." Documento (ID: ${output?.id || 'N/A'}) -> "${safeText(pair.documentContentSnippet)}"<br>
                        CE Score Raw: ${output?.rawScore?.toFixed(4) || 'N/A'}, CE Score Norm.: ${output?.normalizedScore?.toFixed(4) || 'N/A'}
                    </small></p>`;
                });
            } else {
                div.innerHTML = '<p>No se aplicó Cross-Encoder o no hay datos.</p>';
            }
        });


        // 7. Final Ranked Chunks for LLM (Top N, usually 5 after filtering/summarization if enabled)
        createCollapsibleSection('7. Chunks Finales para Contexto LLM (Después de filtros y resumenes)', (div) => {
            if (data.llmContextualization?.processedKnowledgeForContextAssembly && data.llmContextualization.processedKnowledgeForContextAssembly.length > 0) {
                data.llmContextualization.processedKnowledgeForContextAssembly.forEach(item => {
                    const sourceName = item.metadata?.source_name || item.metadata?.url || 'Fuente Desconocida';
                    const hierarchy = item.metadata?.hierarchy?.map(h => h.text).join(' > ') || 'N/A';
                    div.innerHTML += `<div style="border:1px solid #ddd; padding:8px; margin-bottom:8px; border-radius:3px;">
                        <p><strong>Chunk ID: ${item.id}</strong> (Score Final Reranked: ${item.reranked_score?.toFixed(4)})<br>
                        <small>Fuente: ${safeText(sourceName)} | Ruta: ${safeText(hierarchy)}</small></p>
                        <p><small>Contenido (usado para LLM):</small><br><pre style="font-size:0.8em; max-height:100px; overflow-y:auto;">${safeText(item.extracted_content || item.content)}</pre></p>
                        <button class="btn-playground-feedback" data-feedback-type="chunk_relevance" data-chunk-id="${item.id}" data-rag-log-id="${data.rag_interaction_log_id || ''}" style="font-size:0.8em; padding:3px 6px;">Feedback sobre este Chunk</button>
                    </div>`;
                });
            } else {
                div.innerHTML = '<p>No hay chunks finales después del procesamiento LLM.</p>';
            }
        });

        // 8. Final Proposition Results
        createCollapsibleSection('8. Proposiciones Finales Recuperadas', (div) => {
            if (data.finalPropositionResults && data.finalPropositionResults.length > 0) {
                data.finalPropositionResults.forEach(prop => {
                    div.innerHTML += `<div style="border:1px solid #ddd; padding:8px; margin-bottom:8px; border-radius:3px;">
                        <p><strong>Prop. ID: ${prop.propositionId}</strong> (Score: ${prop.score?.toFixed(4)})<br>
                        <small>Texto: ${safeText(prop.text)}</small><br>
                        <small>Del Chunk ID: ${prop.sourceChunkId}</small></p>
                        </div>`;
                    // Feedback button for propositions could be added here if that feature is developed
                });
            } else {
                div.innerHTML = '<p>No se recuperaron proposiciones.</p>';
            }
        });

        // 9. Final Context String Sent to LLM
        createCollapsibleSection('9. Contexto Final Enviado al LLM (para Respuesta)', (div) => {
            div.innerHTML = `<pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 400px; overflow-y:auto; background-color:#f0f0f0; padding:10px; border-radius:4px;">${safeText(data.llmContextualization?.finalLLMContextString || 'Contexto no disponible.')}</pre>`;
        });

        // Add event listeners for new feedback buttons
        playgroundResultsContainer.querySelectorAll('.btn-playground-feedback').forEach(button => {
            button.addEventListener('click', handlePlaygroundFeedbackBtnClick);
        });
    }


    // Playground Feedback Modal Logic
    if (closePlaygroundFeedbackModalBtn) closePlaygroundFeedbackModalBtn.onclick = () => { playgroundFeedbackModal.style.display = "none"; };
    if (playgroundFeedbackPositiveBtn) playgroundFeedbackPositiveBtn.onclick = () => submitPlaygroundFeedback(1);
    if (playgroundFeedbackNegativeBtn) playgroundFeedbackNegativeBtn.onclick = () => submitPlaygroundFeedback(-1);
    if (submitPlaygroundFeedbackBtn) submitPlaygroundFeedbackBtn.onclick = () => submitPlaygroundFeedback(0); // Submit neutral with comment

    function handlePlaygroundFeedbackBtnClick(event) {
        const button = event.target;
        playgroundFeedbackTypeStore.value = button.dataset.feedbackType;
        playgroundItemIdStore.value = button.dataset.chunkId || button.dataset.propositionId || ''; // Store specific item ID
        playgroundRagLogIdStore.value = button.dataset.ragLogId || ''; // Store the RAG log ID
        playgroundFeedbackComment.value = ''; // Clear previous comment
        playgroundFeedbackModalTitle.textContent = `Feedback sobre: ${button.dataset.feedbackType === 'overall_rag_response' ? 'Respuesta RAG General' : `Item ID ${playgroundItemIdStore.value}`}`;
        playgroundFeedbackModal.style.display = 'block';
    }

    async function submitPlaygroundFeedback(rating) {
        const feedbackType = playgroundFeedbackTypeStore.value;
        const itemId = playgroundItemIdStore.value; // This is chunkId or propositionId
        const ragLogId = playgroundRagLogIdStore.value;
        const commentText = playgroundFeedbackComment.value.trim();
        const token = localStorage.getItem('synchat_session_token');

        if (!feedbackType || !token) {
            alert("Error: Información de feedback incompleta o no autenticado.");
            return;
        }

        const payload = {
            rating: rating,
            comment: commentText || null,
            feedback_type: feedbackType,
            rag_interaction_log_id: ragLogId || null,
            feedback_context: { // Example context
                query: playgroundQueryInput.value, // The original query from the playground
                // Potentially add more context from the playgroundResultsContainer data if needed
            }
        };

        if (feedbackType === 'chunk_relevance' && itemId) {
            payload.knowledge_base_chunk_id = itemId;
        }
        // Add similar for proposition_id if that feedback type is re-enabled
        // if (feedbackType === 'proposition_relevance' && itemId) {
        //   payload.knowledge_proposition_id = itemId;
        // }

        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/rag-playground/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (response.ok) {
                alert('Feedback del Playground enviado con éxito.');
                displayMessage(playgroundStatusMessage, 'Feedback enviado.', true);
            } else {
                throw new Error(result.message || 'Error al enviar feedback del Playground.');
            }
        } catch (error) {
            console.error("Error submitting playground feedback:", error);
            alert(`Error: ${error.message}`);
            displayMessage(playgroundStatusMessage, `Error al enviar feedback: ${error.message}`, false);
        } finally {
            playgroundFeedbackModal.style.display = "none";
        }
    }


    // --- Initialize Section Navigation and Load Initial Data ---
    // (This part remains largely the same, ensure it's correctly placed and calls the appropriate load functions)
    const navLinks = document.querySelectorAll('nav ul a');
    const allDashboardSections = document.querySelectorAll('.dashboard-section');

    navLinks.forEach(link => {
        const hasHrefHash = link.getAttribute('href')?.startsWith('#');
        const hasDataSection = link.dataset.section;

        if (hasHrefHash || hasDataSection) {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                let targetSectionId = '';
                if (link.dataset.section) {
                    targetSectionId = link.dataset.section;
                } else if (hasHrefHash && link.getAttribute('href') !== '#') {
                    targetSectionId = link.getAttribute('href').substring(1);
                } else if (link.id === 'navInboxLink' && link.getAttribute('href') === '#') {
                    targetSectionId = 'inboxSection';
                }

                if (targetSectionId) {
                    allDashboardSections.forEach(section => {
                        section.style.display = (section.id === targetSectionId) ? 'block' : 'none';
                    });
                    // Load data for the activated section
                    if (targetSectionId === 'config') fetchClientConfig();
                    else if (targetSectionId === 'ingest') loadKnowledgeSources(); // 'ingest' is the ID for knowledge management section
                    else if (targetSectionId === 'usage') fetchClientUsageStats();
                    else if (targetSectionId === 'inboxSection') loadInboxConversations();
                    else if (targetSectionId === 'analyticsSection') loadAnalyticsData();
                    // RAG Playground does not auto-load data, it's on button click
                }
            });
        }
    });

    // Determine and show the initial section, and load its data
    let initialSectionIdToShow = 'config';
    if (window.location.hash) {
        const hash = window.location.hash.substring(1);
        if (document.getElementById(hash)) initialSectionIdToShow = hash;
    }

    allDashboardSections.forEach(s => s.style.display = 'none'); // Hide all first
    const initialSectionElement = document.getElementById(initialSectionIdToShow);
    if (initialSectionElement) {
        initialSectionElement.style.display = 'block';
        if (initialSectionIdToShow === 'config') fetchClientConfig();
        else if (initialSectionIdToShow === 'ingest') loadKnowledgeSources();
        else if (initialSectionIdToShow === 'usage') fetchClientUsageStats();
        else if (initialSectionIdToShow === 'inboxSection') loadInboxConversations();
        else if (initialSectionIdToShow === 'analyticsSection') loadAnalyticsData();
    } else if (allDashboardSections.length > 0) { // Fallback if hash section not found
        allDashboardSections[0].style.display = 'block';
        // And load data for this first section if applicable
        if (allDashboardSections[0].id === 'config') fetchClientConfig();
        // Add other initial loads as necessary
    }


    // Initial data loads for visible/default sections
    if (loadingMessage) loadingMessage.style.display = 'none';
    if (dashboardContent) dashboardContent.classList.remove('hidden');
    if (userEmailSpan && localStorage.getItem('synchat_user_email')) {
         userEmailSpan.textContent = localStorage.getItem('synchat_user_email');
    }

    // Logout button
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

}); // THIS IS THE CORRECT FINAL CLOSING BRACE AND PARENTHESIS FOR DOMContentLoaded
