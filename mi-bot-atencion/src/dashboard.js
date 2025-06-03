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

    async function fetchClientConfig() {
        const token = localStorage.getItem('synchat_session_token');
        if (!token) {
            console.error('Error de autenticación: No se encontró token.');
            // Optionally, display this message to the user via an alert or a status div
            // alert('Error de autenticación. Por favor, inicie sesión de nuevo.');
            // Consider if redirect to login is appropriate here.
            return;
        }

        // Determine API_BASE_URL locally
        const currentApiBaseUrl = window.SYNCHAT_CONFIG?.API_BASE_URL || '';
        if (!currentApiBaseUrl) {
            console.error('Error crítico: La URL base de la API no está configurada.');
            // alert('Error crítico: La URL base de la API no está configurada. No se puede cargar la configuración.');
            return;
        }

        try {
            const response = await fetch(`${currentApiBaseUrl}/api/client/me/config`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Error al cargar la configuración:', response.status, errorData.message || response.statusText);
                // Example of updating a status UI, assuming a function like this exists or a div for messages
                // updateStatusUIMessage(`Error al cargar configuración: ${errorData.message || response.statusText}`, 'error');
                displayMessage(configMessageDiv, `Error al cargar configuración: ${errorData.message || response.statusText}`, false);
                return;
            }

            const data = await response.json();

            // Populate general fields
            if(knowledgeUrlInput) knowledgeUrlInput.value = data.knowledge_source_url || '';
            if(basePromptOverrideTextarea) basePromptOverrideTextarea.value = data.base_prompt_override || '';

            // Populate widget_config fields
            if (data.widget_config) {
                if(botNameInput) botNameInput.value = data.widget_config.botName || '';
                if(welcomeMessageInput) welcomeMessageInput.value = data.widget_config.welcomeMessage || '';
                if(botFormalitySelect) botFormalitySelect.value = data.widget_config.botFormality || 'neutral';
                if(botPersonaDescriptionTextarea) botPersonaDescriptionTextarea.value = data.widget_config.botPersonaDescription || '';
                if(botKeyPhrasesToUseTextarea) botKeyPhrasesToUseTextarea.value = (data.widget_config.botKeyPhrasesToUse || []).join('\n');
                if(botKeyPhrasesToAvoidTextarea) botKeyPhrasesToAvoidTextarea.value = (data.widget_config.botKeyPhrasesToAvoid || []).join('\n');
            } else {
                // Defaults if widget_config is missing
                if(botNameInput) botNameInput.value = ''; // Default to empty
                if(welcomeMessageInput) welcomeMessageInput.value = ''; // Default to empty
                if(botFormalitySelect) botFormalitySelect.value = 'neutral';
                if(botPersonaDescriptionTextarea) botPersonaDescriptionTextarea.value = '';
                if(botKeyPhrasesToUseTextarea) botKeyPhrasesToUseTextarea.value = '';
                if(botKeyPhrasesToAvoidTextarea) botKeyPhrasesToAvoidTextarea.value = '';
            }
            // No explicit success message to UI on load, which is fine.
            // displayMessage(configMessageDiv, 'Configuración cargada.', true); // Optional

        } catch (error) {
            console.error('Excepción al cargar la configuración:', error);
            displayMessage(errorMessageDashboard, `Excepción al cargar la configuración: ${error.message}`, false);
        }
    }

    async function fetchClientUsageStats(billingCycleId = null) {
        const aiResolutionsCountEl = document.getElementById('aiResolutionsCount');
        const totalQueriesCountEl = document.getElementById('totalQueriesCount');
        const statsLastUpdatedEl = document.getElementById('statsLastUpdated');
        const usageMessageEl = document.getElementById('usageMessage'); // Assuming displayMessage is available globally or defined before this

        if (!aiResolutionsCountEl || !statsLastUpdatedEl || !totalQueriesCountEl) {
            console.warn("Usage statistics UI elements not found.");
            // Optionally use displayMessage if a general error display area for the whole dashboard exists
            // displayMessage(errorMessageDashboard, "Error interno: Elementos de UI para estadísticas no encontrados.", false);
            return;
        }

        aiResolutionsCountEl.textContent = 'Cargando...';
        totalQueriesCountEl.textContent = 'Cargando...'; // Set to Cargando... initially
        if (usageMessageEl) usageMessageEl.style.display = 'none';

        const token = localStorage.getItem('synchat_session_token');
        if (!token) {
            console.error("Error: No session token found for fetching usage stats.");
            if (usageMessageEl) displayMessage(usageMessageEl, 'Error de autenticación al cargar estadísticas.', false);
            aiResolutionsCountEl.textContent = 'Error';
            totalQueriesCountEl.textContent = 'Error';
            statsLastUpdatedEl.textContent = new Date().toLocaleString(); // Still update time, but show error in counts
            return;
        }

        // Assume API_BASE_URL is defined globally or accessible in this scope
        let requestUrl = `${API_BASE_URL}/api/client/me/usage/resolutions`;
        if (billingCycleId) {
            requestUrl += `?billing_cycle_id=${encodeURIComponent(billingCycleId)}`;
        }

        try {
            const response = await fetch(requestUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const data = await response.json(); // Attempt to parse JSON regardless of response.ok to get error message if available

            if (!response.ok) {
                throw new Error(data.message || `Error fetching usage stats: ${response.status}`);
            }

            aiResolutionsCountEl.textContent = data.ai_resolutions_current_month !== undefined ? data.ai_resolutions_current_month : 'Error';
            // Backend does not return total_queries_current_month, so set to 'N/A'
            totalQueriesCountEl.textContent = 'N/A';
            statsLastUpdatedEl.textContent = new Date().toLocaleString();
            if (usageMessageEl) displayMessage(usageMessageEl, 'Estadísticas actualizadas.', true);

        } catch (error) {
            console.error("Error fetching client usage stats:", error);
            aiResolutionsCountEl.textContent = 'Error';
            totalQueriesCountEl.textContent = 'Error'; // Reflect error for total queries as well
            statsLastUpdatedEl.textContent = 'Error al cargar';
            if (usageMessageEl) displayMessage(usageMessageEl, `Error al cargar estadísticas: ${error.message}`, false);
        }
    }

    if (configForm) {
        configForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            // Clear previous messages by not calling displayMessage or setting textContent to ''
            if (configMessageDiv) {
                 configMessageDiv.style.display = 'none';
                 configMessageDiv.textContent = '';
            }

            try {
                const botKeyPhrasesToUseRaw = botKeyPhrasesToUseTextarea.value.split('\n');
                const botKeyPhrasesToUse = botKeyPhrasesToUseRaw.map(phrase => phrase.trim()).filter(phrase => phrase !== '');

                const botKeyPhrasesToAvoidRaw = botKeyPhrasesToAvoidTextarea.value.split('\n');
                const botKeyPhrasesToAvoid = botKeyPhrasesToAvoidRaw.map(phrase => phrase.trim()).filter(phrase => phrase !== '');

                const formData = {
                    widget_config: {
                        botName: botNameInput.value,
                        welcomeMessage: welcomeMessageInput.value,
                        botFormality: botFormalitySelect.value,
                        botPersonaDescription: botPersonaDescriptionTextarea.value,
                        botKeyPhrasesToUse: botKeyPhrasesToUse,
                        botKeyPhrasesToAvoid: botKeyPhrasesToAvoid
                    },
                    knowledge_source_url: knowledgeUrlInput.value, // This might be managed elsewhere if using new KS system
                    base_prompt_override: basePromptOverrideTextarea.value
                };

                const token = localStorage.getItem('synchat_session_token'); // Assuming using 'synchat_session_token' as per other parts
                if (!token) {
                    alert('Error de autenticación. Por favor, inicie sesión de nuevo.');
                    // Potentially redirect to login: window.location.href = '/login.html';
                    return;
                }

                // Determine API_BASE_URL locally as it might not be available if this script runs before API_BASE_URL is defined globally
                const currentApiBaseUrl = window.SYNCHAT_CONFIG?.API_BASE_URL || '';
                if (!currentApiBaseUrl) {
                    alert('Error crítico: La URL base de la API no está configurada.');
                    return;
                }


                const response = await fetch(`${currentApiBaseUrl}/api/client/me/config`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(formData)
                });

                if (response.ok) {
                    // const result = await response.json(); // Not used
                    await response.json();
                    displayMessage(configMessageDiv, 'Configuración guardada con éxito.', true);
                    // Optionally, refresh parts of the UI or re-fetch config if needed
                } else {
                    const errorData = await response.json().catch(() => ({ message: 'Error desconocido al procesar la respuesta del servidor.' }));
                    console.error('Error saving config:', response.status, errorData);
                    displayMessage(configMessageDiv, `Error al guardar la configuración: ${errorData.message || response.statusText}`, false);
                }
            } catch (error) {
                console.error('Error en el envío del formulario de configuración:', error);
                displayMessage(configMessageDiv, `Se produjo un error al enviar la configuración: ${error.message}`, false);
            }
        });
    } else {
        console.error("El elemento configForm no fue encontrado en el DOM.");
    }

    // Call fetchClientConfig to populate the form on page load
    fetchClientConfig();

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
    // ... other analytics spans ...
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

    if (closeChunkSampleModalBtn && chunkSampleModal && chunkSampleModalBody) {
        closeChunkSampleModalBtn.onclick = function() {
            chunkSampleModal.style.display = "none";
            if(chunkSampleModalBody) chunkSampleModalBody.innerHTML = '';
        }
    }

    const API_BASE_URL = window.SYNCHAT_CONFIG?.API_BASE_URL || '';

    const displayMessage = (element, message, isSuccess) => {
        if (element) {
            element.textContent = message;
            // Consider adding a base class and then modifying for success/error
            // e.g., element.className = 'message-area ' + (isSuccess ? 'success' : 'error');
            // For now, directly setting className as requested.
            element.className = isSuccess ? 'success' : 'error'; // Assumes CSS classes 'success' and 'error' exist
            element.style.display = 'block';
            // Optional: Clear message after some time
            setTimeout(() => {
                if (element) { // Check if element still exists
                    element.style.display = 'none';
                    element.textContent = ''; // Clear text
                    element.className = ''; // Clear class if appropriate or reset to a base class
                }
            }, 5000); // Hide after 5 seconds
        }
    };
    function safeText(text) { /* ... */ }

    // Initialize navigation links for section switching
    const navLinks = document.querySelectorAll('nav ul a'); // Get all anchor tags in the nav
    const allDashboardSections = document.querySelectorAll('.dashboard-section');

    navLinks.forEach(link => {
        // Exclude non-section links like logout button (if it were an anchor) or external links.
        // The logout button is a <button>, so it's not selected by 'nav ul a'.
        const hasHrefHash = link.getAttribute('href') && link.getAttribute('href').startsWith('#');
        const hasDataSection = link.dataset.section;

        if (hasHrefHash || hasDataSection) {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                let targetSectionId = '';

                if (link.dataset.section) {
                    targetSectionId = link.dataset.section;
                } else if (link.getAttribute('href') && link.getAttribute('href') !== '#') {
                    // Standard href like #config, #ingest
                    targetSectionId = link.getAttribute('href').substring(1);
                } else if (link.id === 'navInboxLink' && link.getAttribute('href') === '#') {
                    // Special handling for Inbox link if its href is just "#"
                    targetSectionId = 'inboxSection';
                }
                // Add other specific link ID to section ID mappings here if necessary

                if (targetSectionId) {
                    let sectionFound = false;
                    allDashboardSections.forEach(section => {
                        if (section.id === targetSectionId) {
                            section.style.display = 'block'; // Or remove hide class
                            sectionFound = true;
                        } else {
                            section.style.display = 'none'; // Or use a class to hide
                        }
                    });

                    if (sectionFound) {
                        // Special case for analytics: load data when section is shown
                        if (targetSectionId === 'analyticsSection' && typeof loadAnalyticsData === 'function') {
                            loadAnalyticsData();
                        }
                        // When switching to knowledge management ('ingest' section), reload sources
                        if (targetSectionId === 'ingest' && typeof loadKnowledgeSources === 'function') {
                            loadKnowledgeSources();
                        }
                        if (targetSectionId === 'usage' && typeof fetchClientUsageStats === 'function') {
                            fetchClientUsageStats();
                        }
                        // Add similar conditions for other sections if they need data loaded on view
                        // For example, if RAG Playground needs initialization:
                        // if (targetSectionId === 'ragPlayground' && typeof initializeRagPlayground === 'function') {
                        //    initializeRagPlayground();
                        // }
                    } else {
                        console.warn(`Dashboard section with ID "${targetSectionId}" not found.`);
                        // Optionally, leave the current view as is, or hide all sections,
                        // or show a default section/error message.
                        // For now, if a target isn't found, other sections remain hidden from the loop above.
                    }
                } else {
                    // This case might happen for links like <a href="#"> that are not the inbox link
                    // and don't have a data-section. Decide behavior: either log or ignore.
                    console.log('Clicked a nav link without a clear target section:', link);
                }
            });
        }
    });

    // Determine and show the initial section.
    // Priority: URL hash, then 'config', then first available section.
    let initialSectionIdToShow = 'config'; // Default initial section
    if (window.location.hash) {
        const hash = window.location.hash.substring(1);
        // Ensure the hash corresponds to a valid section ID
        const sectionExists = Array.from(allDashboardSections).some(s => s.id === hash);
        if (sectionExists) {
            initialSectionIdToShow = hash;
        }
    }

    let showedInitial = false;
    allDashboardSections.forEach(s => {
        if (s.id === initialSectionIdToShow) {
            s.style.display = 'block';
            showedInitial = true;
            // If this initial section needs data loading, call its function here
            if (initialSectionIdToShow === 'analyticsSection' && typeof loadAnalyticsData === 'function') {
                loadAnalyticsData();
            }
            if (initialSectionIdToShow === 'ingest' && typeof loadKnowledgeSources === 'function') {
                loadKnowledgeSources();
            }
            if (initialSectionIdToShow === 'usage' && typeof fetchClientUsageStats === 'function') {
                fetchClientUsageStats();
            }
        } else {
            s.style.display = 'none';
        }
    });

    // Fallback if the target initial section (e.g. 'config' or from hash) wasn't found or doesn't exist
    if (!showedInitial && allDashboardSections.length > 0) {
        allDashboardSections[0].style.display = 'block'; // Show the first actual section
        // If this first section needs data loading, call its function
        const firstSectionId = allDashboardSections[0].id;
         if (firstSectionId === 'analyticsSection' && typeof loadAnalyticsData === 'function') {
            loadAnalyticsData();
        }
        if (firstSectionId === 'ingest' && typeof loadKnowledgeSources === 'function') {
            loadKnowledgeSources();
        }
        if (firstSectionId === 'usage' && typeof fetchClientUsageStats === 'function') {
            fetchClientUsageStats();
        }
        // Add more for other sections if needed
    const token = localStorage.getItem('synchat_session_token');
    if (!token) { /* ... */ }
    // ... (onboarding logic) ...
    // ... (fetchClientConfig and configForm submit listener - updated in previous step) ...
    // ... (RAG Playground Logic, Knowledge Source Management Functions - loadKnowledgeSources, handleSaveSourceMetadata, handleReingestSource, handleViewSourceChunks - as defined previously) ...

    // Ensure all existing function definitions are here (fetchClientConfig, configForm listener, RAG playground, Knowledge Sources, etc.)
    // For brevity, only new/modified functions related to analytics display are shown in full if they were placeholders.
    // Assume other functions are complete as per previous steps.

    async function loadKnowledgeSources() { // Copied from previous successful step, with category tags
        if (!knowledgeSourcesList || !loadingSourcesMsg) {
            console.error("Knowledge source list UI elements not found.");
            return;
        }
        loadingSourcesMsg.style.display = 'block';
        knowledgeSourcesList.innerHTML = '';
        if (knowledgeManagementMessage) knowledgeManagementMessage.style.display = 'none';

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
                    li.style.border = '1px solid #eee'; li.style.padding = '10px';
                    li.style.marginBottom = '10px'; li.style.borderRadius = '4px';

                    const sourceId = source.id || source.source_id;
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
                            Tipo: ${safeText(source.source_type)} | Estado: ${safeText(source.status || source.last_ingest_status || 'N/A')} | Chunks: ${safeText(chunkCount)}
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
                        </div>
                    `;
                    knowledgeSourcesList.appendChild(li);
                });

                knowledgeSourcesList.querySelectorAll('.btn-save-source-metadata').forEach(button => button.addEventListener('click', handleSaveSourceMetadata));
                knowledgeSourcesList.querySelectorAll('.btn-reingest-source').forEach(button => button.addEventListener('click', handleReingestSource));
                knowledgeSourcesList.querySelectorAll('.btn-view-source-chunks').forEach(button => {
                    button.addEventListener('click', (event) => {
                        const sourceId = event.target.dataset.sourceId;
                        handleViewSourceChunks(sourceId);
                    });
                });
            } else {
                knowledgeSourcesList.innerHTML = '<p>No se encontraron fuentes de conocimiento.</p>';
            }
        } catch (error) { /* ... */ }
        finally { if(loadingSourcesMsg) loadingSourcesMsg.style.display = 'none'; }
    }

    async function handleSaveSourceMetadata(event) { /* ... as previously defined, including category_tags ... */ }
    async function handleReingestSource(event) { /* ... as previously defined ... */ }
    async function handleViewSourceChunks(sourceId, page = 1) { /* ... as previously defined ... */ }


    // --- Analytics Data Loading and Display ---
    function getPeriodDates(periodValue) { /* ... */ }
    async function fetchApiData(endpoint, params) { /* ... */ }
    async function fetchSentimentDistributionAnalytics(startDate, endDate) { /* ... */ }
    async function fetchTopicAnalyticsData(startDate, endDate) { /* ... */ }
    async function fetchKnowledgeSourcePerformanceAnalytics(startDate, endDate) { /* ... */ }
    function displaySentimentDistribution(apiData) { /* ... */ }

    function displayTopicAnalytics(apiResponse) { // Updated version from previous step
        const tableBody = topicAnalyticsTableBody;
        const loadingMsg = topicDataLoadingMsg;
        const topicTable = document.getElementById('topicAnalyticsTable');
        const chartContainer = document.getElementById('topicBarChartContainer');

        if (!tableBody || !loadingMsg || !topicTable || !chartContainer) {
            console.error("Topic analytics UI elements not found.");
            if (loadingMsg) loadingMsg.style.display = 'none';
            return;
        }

        loadingMsg.style.display = 'none';
        tableBody.innerHTML = '';
        topicTable.style.display = 'none';
        chartContainer.style.display = 'none';

        if (topicBarChartInstance) {
            topicBarChartInstance.destroy();
            topicBarChartInstance = null;
        }

        const displayData = apiResponse && apiResponse.data ? [...apiResponse.data] : [];
        sortData(displayData, currentTopicSort.key, currentTopicSort.direction);

        if (displayData.length > 0) {
            topicTable.style.display = '';
            chartContainer.style.display = 'block';

            const topTopicsForChart = displayData.slice(0, 10).map(topic => ({
                name: topic.topic_name,
                count: topic.queries_in_period !== undefined ? topic.queries_in_period : (topic.total_queries_in_topic || 0)
            })).sort((a,b) => b.count - a.count);

            if (topTopicsForChart.length > 0 && typeof Chart !== 'undefined') {
                const ctxBar = document.getElementById('topicBarChart').getContext('2d');
                topicBarChartInstance = new Chart(ctxBar, {
                    type: 'bar',
                    data: {
                        labels: topTopicsForChart.map(t => t.name),
                        datasets: [{
                            label: 'Consultas en Periodo',
                            data: topTopicsForChart.map(t => t.count),
                            backgroundColor: 'rgba(54, 162, 235, 0.7)',
                            borderColor: 'rgba(54, 162, 235, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                        scales: { x: { beginAtZero: true } },
                        plugins: { legend: { display: true, position: 'top' }, tooltip: { enabled: true } }
                    }
                });
            } else {
                 chartContainer.style.display = 'none';
                 if (typeof Chart === 'undefined') console.warn("Chart.js not loaded. Topic bar chart cannot be displayed.");
            }

            displayData.forEach(topic => {
                const row = tableBody.insertRow();
                row.insertCell().textContent = topic.topic_name || 'N/A';
                row.insertCell().textContent = topic.queries_in_period !== undefined ? topic.queries_in_period : (topic.total_queries_in_topic || 0);
                const escRateCell = row.insertCell();
                escRateCell.textContent = topic.escalation_rate !== null && topic.escalation_rate !== undefined ? (topic.escalation_rate * 100).toFixed(1) + '%' : 'N/A';
                const sentimentCell = row.insertCell();
                sentimentCell.textContent = topic.average_sentiment !== null && topic.average_sentiment !== undefined ? topic.average_sentiment.toFixed(2) : 'N/A';
                const repQueriesCell = row.insertCell();
                repQueriesCell.textContent = topic.representative_queries && topic.representative_queries.length > 0 ? topic.representative_queries.slice(0, 3).join('; ') + (topic.representative_queries.length > 3 ? '...' : '') : 'N/A';
            });

            document.querySelectorAll('#topicAnalyticsTable th[data-sortable="true"]').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
                if (th.dataset.key === currentTopicSort.key) {
                    th.classList.add(currentTopicSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
                }
            });

        } else if (apiResponse && apiResponse.message) {
            loadingMsg.textContent = apiResponse.message;
            loadingMsg.style.display = 'block';
        } else {
            loadingMsg.textContent = 'No topic data available for the selected period.';
            loadingMsg.style.display = 'block';
        }
    }

    // Event listeners for Topic Analytics Table Sorting
    document.querySelectorAll('#topicAnalyticsTable th[data-sortable="true"]').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (currentTopicSort.key === key) {
                currentTopicSort.direction = currentTopicSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentTopicSort.key = key;
                currentTopicSort.direction = 'desc';
            }
            if (lastFetchedTopicDataForSorting.length > 0) {
                displayTopicAnalytics({ data: [...lastFetchedTopicDataForSorting] });
            } else {
                loadAnalyticsData();
            }
        });
    });

    // NEW or REPLACED displayKnowledgeSourcePerformance function
    function displayKnowledgeSourcePerformance(apiResponse) {
        const tableBody = sourcePerformanceTableBody;
        const loadingMsg = sourcePerformanceDataLoadingMsg;
        const perfTable = document.getElementById('sourcePerformanceTable');
        const chartContainer = document.getElementById('sourceFeedbackChartContainer');

        if (!tableBody || !loadingMsg || !perfTable || !chartContainer) {
            console.error("Source performance UI elements not found.");
            if (loadingMsg) loadingMsg.style.display = 'none';
            return;
        }

        loadingMsg.style.display = 'none';
        tableBody.innerHTML = '';
        perfTable.style.display = 'none';
        chartContainer.style.display = 'none';

        if (sourceFeedbackChartInstance) {
            sourceFeedbackChartInstance.destroy();
            sourceFeedbackChartInstance = null;
        }

        const displayData = apiResponse && apiResponse.data ? [...apiResponse.data] : [];
        sortData(displayData, currentSourcePerfSort.key, currentSourcePerfSort.direction);

        if (displayData.length > 0) {
            perfTable.style.display = '';
            chartContainer.style.display = 'block';

            const chartData = displayData.slice(0, 10).map(s => ({
                name: s.source_name,
                positive: s.direct_positive_chunk_feedback_count || 0,
                negative: s.direct_negative_chunk_feedback_count || 0,
                neutral: s.direct_neutral_chunk_feedback_count || 0
            })).sort((a,b) => (b.positive + b.negative + b.neutral) - (a.positive + a.negative + a.neutral)); // Sort for chart by total feedback

            if (chartData.length > 0 && typeof Chart !== 'undefined') {
                const ctxPerf = document.getElementById('sourceFeedbackChart').getContext('2d');
                sourceFeedbackChartInstance = new Chart(ctxPerf, {
                    type: 'bar',
                    data: {
                        labels: chartData.map(s => s.name),
                        datasets: [
                            { label: 'Feedback Positivo (Chunk)', data: chartData.map(s => s.positive), backgroundColor: 'rgba(75, 192, 192, 0.7)' },
                            { label: 'Feedback Negativo (Chunk)', data: chartData.map(s => s.negative), backgroundColor: 'rgba(255, 99, 132, 0.7)' },
                            { label: 'Feedback Neutral (Chunk)', data: chartData.map(s => s.neutral), backgroundColor: 'rgba(201, 203, 207, 0.7)' }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        indexAxis: 'y', // Horizontal bars often better for many categories
                        scales: {
                            y: { stacked: false }, // Grouped, not stacked
                            x: { stacked: false, beginAtZero: true }
                        },
                        plugins: { legend: { display: true, position: 'top' }, tooltip: { mode: 'index', intersect: false } }
                    }
                });
            } else {
                chartContainer.style.display = 'none';
                if(typeof Chart === 'undefined') console.warn("Chart.js not loaded. Source Performance chart cannot be displayed.");
            }

            displayData.forEach(source => {
                const row = tableBody.insertRow();
                row.insertCell().textContent = source.source_name || 'Unknown Source';
                row.insertCell().textContent = source.total_chunks_in_source !== undefined ? source.total_chunks_in_source : 'N/A';
                row.insertCell().textContent = source.direct_positive_chunk_feedback_count || 0;
                row.insertCell().textContent = source.direct_negative_chunk_feedback_count || 0;
                row.insertCell().textContent = source.direct_neutral_chunk_feedback_count || 0;
                row.insertCell().textContent = source.total_direct_chunk_feedback_count || 0;
                row.insertCell().textContent = source.retrieval_count_in_rag_interactions || 0;
                row.insertCell().textContent = source.retrieval_in_ia_resolved_convos_count || 0;
                row.insertCell().textContent = source.retrieval_in_escalated_convos_count || 0;
                const avgRatingCell = row.insertCell();
                avgRatingCell.textContent = source.avg_overall_response_rating_when_used !== null && source.avg_overall_response_rating_when_used !== undefined
                    ? source.avg_overall_response_rating_when_used.toFixed(2)
                    : 'N/A';
            });

            document.querySelectorAll('#sourcePerformanceTable th[data-sortable="true"]').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
                if (th.dataset.key === currentSourcePerfSort.key) {
                    th.classList.add(currentSourcePerfSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
                }
            });

        } else if (apiResponse && apiResponse.message) {
            loadingMsg.textContent = apiResponse.message;
            loadingMsg.style.display = 'block';
        } else {
            loadingMsg.textContent = 'No source performance data available for the selected period.';
            loadingMsg.style.display = 'block';
        }
    }

    // Event listeners for Source Performance Table Sorting
    document.querySelectorAll('#sourcePerformanceTable th[data-sortable="true"]').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (currentSourcePerfSort.key === key) {
                currentSourcePerfSort.direction = currentSourcePerfSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSourcePerfSort.key = key;
                currentSourcePerfSort.direction = 'desc'; // Default to desc for new column
            }
            if (lastFetchedSourcePerfDataForSorting.length > 0) {
                displayKnowledgeSourcePerformance({ data: [...lastFetchedSourcePerfDataForSorting] });
            } else {
                loadAnalyticsData();
            }
        });
    });

    async function loadAnalyticsData() {
        if (!analyticsSection || analyticsSection.style.display === 'none') return;
        if(analyticsLoadingMessage) analyticsLoadingMessage.style.display = 'block';

        if(sentimentDataLoadingMsg) sentimentDataLoadingMsg.style.display = 'block';
        if(topicDataLoadingMsg) topicDataLoadingMsg.style.display = 'block';
        if(sourcePerformanceDataLoadingMsg) sourcePerformanceDataLoadingMsg.style.display = 'block';

        const { startDate, endDate } = getPeriodDates(analyticsPeriodSelector.value);

        try {
            const summaryResponse = await fetch(`${API_BASE_URL}/api/client/me/analytics/summary?startDate=${startDate}&endDate=${endDate}`, { /* ... */ });
            // ... (summary logic)

            const unansweredResponse = await fetch(`${API_BASE_URL}/api/client/me/analytics/suggestions/unanswered?startDate=${startDate}&endDate=${endDate}&limit=10`, { /* ... */ });
            // ... (unanswered queries logic) ...

            fetchSentimentDistributionAnalytics(startDate, endDate)
                .then(displaySentimentDistribution)
                .catch(error => { /* ... */ });

            fetchTopicAnalyticsData(startDate, endDate)
                .then(result => {
                    lastFetchedTopicDataForSorting = result.data ? [...result.data] : [];
                    displayTopicAnalytics(result);
                })
                .catch(error => {
                    console.error('Error fetching/displaying topic analytics:', error);
                    if(topicDataLoadingMsg) topicDataLoadingMsg.textContent = 'Error al cargar datos de temas.';
                    lastFetchedTopicDataForSorting = [];
                    displayTopicAnalytics({ data: [], message: 'Error al cargar datos de temas.' });
                });

            fetchKnowledgeSourcePerformanceAnalytics(startDate, endDate)
                .then(result => { // result is apiResponse = { data: [], message?: ""}
                    lastFetchedSourcePerfDataForSorting = result.data ? [...result.data] : []; // Store for sorting
                    displayKnowledgeSourcePerformance(result); // Initial display
                })
                .catch(error => {
                    console.error('Error fetching/displaying source performance analytics:', error);
                    if(sourcePerformanceDataLoadingMsg) sourcePerformanceDataLoadingMsg.textContent = 'Error al cargar datos de rendimiento.';
                    lastFetchedSourcePerfDataForSorting = []; // Clear on error
                    displayKnowledgeSourcePerformance({ data: [], message: 'Error al cargar datos de rendimiento.' });
                });

        } catch (error) { /* ... */ }
        finally { if (analyticsLoadingMessage) analyticsLoadingMessage.style.display = 'none'; }
    }

    if (refreshAnalyticsBtn) refreshAnalyticsBtn.addEventListener('click', loadAnalyticsData);
    if (analyticsPeriodSelector) analyticsPeriodSelector.addEventListener('change', loadAnalyticsData);

    // Logout button functionality
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            logout(); // Call the imported logout function from auth.js
        });
    }

    const refreshUsageBtn = document.getElementById('refreshUsageBtn');
    if (refreshUsageBtn) {
        refreshUsageBtn.addEventListener('click', () => {
            // Optionally, you might want to provide user feedback that refresh is happening
            // e.g., by briefly disabling the button or showing a message via displayMessage
            if (typeof fetchClientUsageStats === 'function') {
                fetchClientUsageStats();
            } else {
                console.error("fetchClientUsageStats function is not defined.");
                // Optionally, display an error to the user via displayMessage or an alert
            }
        });
    } else {
        console.warn("Refresh usage button with ID 'refreshUsageBtn' not found.");
    }

    // ... (rest of the file, including Playground and Inbox feedback logic, and Monkey patch)
});
