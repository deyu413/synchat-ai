// mi-bot-atencion/src/dashboard.js
// TODO: Consider using a simple templating engine if HTML generation becomes too complex.

import { logout } from './auth.js';

// Global variable for Chart.js instance to allow destruction before re-rendering
let sentimentPieChartInstance = null;

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

    // Knowledge Management Elements
    const knowledgeFileUpload = document.getElementById('knowledgeFileUpload');
    const uploadFileBtn = document.getElementById('uploadFileBtn');
    const uploadStatusMessage = document.getElementById('uploadStatusMessage');
    const knowledgeSourcesList = document.getElementById('knowledgeSourcesList');
    const loadingSourcesMsg = document.getElementById('loadingSourcesMsg');
    const knowledgeManagementMessage = document.getElementById('knowledgeManagementMessage');


    // Usage elements
    const aiResolutionsCountSpan = document.getElementById('aiResolutionsCount');
    const totalQueriesCountSpan = document.getElementById('totalQueriesCount');
    const statsLastUpdatedSpan = document.getElementById('statsLastUpdated');
    const refreshUsageBtn = document.getElementById('refreshUsageBtn');
    const usageMessage = document.getElementById('usageMessage');

    // Onboarding elements
    const onboardingSection = document.getElementById('onboardingMessageSection');
    const dismissOnboardingBtn = document.getElementById('dismissOnboardingBtn');

    // Inbox elements
    const navInboxLink = document.getElementById('navInboxLink');
    const inboxSection = document.getElementById('inboxSection');
    const inboxConvList = document.getElementById('inboxConvList');
    const inboxLoadingMsg = document.getElementById('inboxLoadingMsg');
    const inboxSelectedConvHeader = document.getElementById('inboxSelectedConvHeader');
    const messageHistoryContainer = document.getElementById('messageHistoryContainer');
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


    // Analytics elements
    const analyticsSection = document.getElementById('analyticsSection');
    const analyticsPeriodSelector = document.getElementById('analyticsPeriodSelector');
    const refreshAnalyticsBtn = document.getElementById('refreshAnalyticsBtn');
    const analyticsLoadingMessage = document.getElementById('analyticsLoadingMessage');
    const totalConversationsSpan = document.getElementById('totalConversations');
    const escalatedConversationsSpan = document.getElementById('escalatedConversations');
    const escalatedPercentageSpan = document.getElementById('escalatedPercentage');
    const unansweredByBotConversationsSpan = document.getElementById('unansweredByBotConversations');
    const unansweredPercentageSpan = document.getElementById('unansweredPercentage');
    const avgDurationSpan = document.getElementById('avgDuration');
    const avgMessagesPerConversationSpan = document.getElementById('avgMessagesPerConversation');
    const unansweredQueriesList = document.getElementById('unansweredQueriesList');

    // New Analytics UI Elements
    const sentimentDistributionTableBody = document.getElementById('sentimentDistributionTableBody');
    const sentimentDataLoadingMsg = document.getElementById('sentimentDataLoadingMsg');
    const topicAnalyticsTableBody = document.getElementById('topicAnalyticsTableBody');
    const topicDataLoadingMsg = document.getElementById('topicDataLoadingMsg');
    const sourcePerformanceTableBody = document.getElementById('sourcePerformanceTableBody');
    const sourcePerformanceDataLoadingMsg = document.getElementById('sourcePerformanceDataLoadingMsg');


    // RAG Playground Elements
    const playgroundQueryInput = document.getElementById('playgroundQueryInput');
    const runPlaygroundQueryBtn = document.getElementById('runPlaygroundQueryBtn');
    const playgroundStatusMessage = document.getElementById('playgroundStatusMessage');
    const playgroundResultsContainer = document.getElementById('playgroundResultsContainer');
    let currentPlaygroundRagLogId = null;

    // Chunk Sample Modal Elements
    const chunkSampleModal = document.getElementById('chunkSampleModal');
    const chunkSampleModalTitle = document.getElementById('chunkSampleModalTitle');
    const chunkSampleModalBody = document.getElementById('chunkSampleModalBody');
    const closeChunkSampleModalBtn = document.getElementById('closeChunkSampleModalBtn');

    if (closeChunkSampleModalBtn && chunkSampleModal && chunkSampleModalBody) {
        closeChunkSampleModalBtn.onclick = function() {
            chunkSampleModal.style.display = "none";
            chunkSampleModalBody.innerHTML = ''; // Clear content when closing
        }
    }


    const API_BASE_URL = window.SYNCHAT_CONFIG?.API_BASE_URL || '';


    const displayMessage = (element, message, isSuccess) => {
        if (!element) return;
        element.textContent = message;
        element.className = isSuccess ? 'success-message' : 'error-message'; // Use classes for styling
        element.style.display = 'block';
        setTimeout(() => { element.style.display = 'none'; }, 5000);
    };

    function safeText(text) {
        const el = document.createElement('span');
        el.textContent = text || ''; // Ensure text is not null/undefined
        return el.innerHTML;
    }

    const sections = {
        config: document.getElementById('config'),
        ingest: document.getElementById('knowledgeManagement'), // This is the ID for "Ingesta"
        widget: null, // Assuming no section named 'widget' directly controlled this way
        usage: document.getElementById('usage'),
        inboxSection: inboxSection,
        analyticsSection: analyticsSection,
        ragPlayground: document.getElementById('ragPlayground')
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (event) => {
            const sectionId = link.dataset.section || link.getAttribute('href')?.substring(1);
            if (sectionId && sections[sectionId]) {
                event.preventDefault();
                Object.values(sections).forEach(section => {
                    if (section) section.style.display = 'none';
                });
                sections[sectionId].style.display = 'block';

                // Call load functions when specific sections are displayed
                if (sectionId === 'ingest' || sectionId === 'knowledgeManagement') {
                    loadKnowledgeSources();
                } else if (sectionId === 'analyticsSection') {
                    loadAnalyticsData();
                } else if (sectionId === 'inboxSection') {
                    // loadConversationsForInbox(); // Placeholder, if this function gets defined
                }

            } else if (!link.getAttribute('href') || link.getAttribute('href') === '#') {
                 event.preventDefault();
            }
        });
    });

    const token = localStorage.getItem('synchat_session_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    if (!localStorage.getItem('synchat_onboarding_dismissed')) {
        if(onboardingSection) onboardingSection.style.display = 'block';
    }
    if (dismissOnboardingBtn) {
        dismissOnboardingBtn.addEventListener('click', () => {
            if(onboardingSection) onboardingSection.style.display = 'none';
            localStorage.setItem('synchat_onboarding_dismissed', 'true');
        });
    }

    const fetchClientConfig = async () => {
         try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/config`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                if (response.status === 401) { window.location.href = 'login.html'; return; }
                throw new Error(`Error ${response.status}: ${await response.text()}`);
            }
            const config = await response.json();
            if (userEmailSpan) userEmailSpan.textContent = config.email || 'No disponible';
            if (botNameInput) botNameInput.value = config.widget_config?.botName || '';
            if (welcomeMessageInput) welcomeMessageInput.value = config.widget_config?.welcomeMessage || '';
            if (knowledgeUrlInput) knowledgeUrlInput.value = config.knowledge_source_url || '';

            if(loadingMessage) loadingMessage.style.display = 'none';
            if(dashboardContent) dashboardContent.classList.remove('hidden');

            const initialSectionId = window.location.hash.substring(1) || 'config';
            const initialLink = document.querySelector(`nav ul li a[href="#${initialSectionId}"], nav ul li a[data-section="${initialSectionId}"]`);
            if (initialLink) {
                initialLink.click();
            } else if (sections.config) { // Default to 'config' if no hash or invalid hash
                sections.config.style.display = 'block';
            }
        } catch (error) {
            console.error('Error fetching client config:', error);
            if(loadingMessage) loadingMessage.style.display = 'none';
            if(errorMessageDashboard) {
                errorMessageDashboard.textContent = `Error al cargar configuración: ${error.message}`;
                errorMessageDashboard.style.display = 'block';
            }
        }
    };

    if (configForm) {
        configForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const updatedConfig = {
                widget_config: {
                    botName: botNameInput.value,
                    welcomeMessage: welcomeMessageInput.value,
                },
                knowledge_source_url: knowledgeUrlInput.value
            };

            try {
                const response = await fetch(`${API_BASE_URL}/api/client/me/config`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(updatedConfig)
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.message || `Error ${response.status}`);
                }
                displayMessage(configMessageDiv, 'Configuración guardada con éxito.', true);
            } catch (error) {
                console.error('Error saving client config:', error);
                displayMessage(configMessageDiv, `Error al guardar: ${error.message}`, false);
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    if (typeof fetchClientConfig === "function") fetchClientConfig();

    // --- RAG Playground Logic ---
    if (runPlaygroundQueryBtn) {
         runPlaygroundQueryBtn.addEventListener('click', async () => {
            currentPlaygroundRagLogId = null;
            const queryText = playgroundQueryInput.value.trim();
            if (!queryText) {
                playgroundStatusMessage.textContent = 'Por favor, ingresa una consulta.';
                playgroundStatusMessage.className = 'status-message error';
                return;
            }
            playgroundStatusMessage.textContent = 'Procesando consulta...';
            playgroundStatusMessage.className = 'status-message loading';
            playgroundResultsContainer.innerHTML = '';
            try {
                const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/rag-playground-query`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                    body: JSON.stringify({ queryText })
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'Error desconocido.' }));
                    throw new Error(`Error ${response.status}: ${errorData.message}`);
                }
                const data = await response.json();
                currentPlaygroundRagLogId = data.rag_interaction_log_id || data.pipelineDetails?.rag_interaction_log_id || data.searchParams?.rag_interaction_log_id || null;
                displayPlaygroundResults(data); // data is passed here
                playgroundStatusMessage.textContent = 'Consulta completada.';
                playgroundStatusMessage.className = 'status-message success';
            } catch (error) {
                console.error('Error en RAG Playground:', error);
                playgroundStatusMessage.textContent = `Error: ${error.message}`;
                playgroundStatusMessage.className = 'status-message error';
            }
        });
    }

    function renderList(items, itemRenderer) {
        if (!items || items.length === 0) return '<p>N/A</p>';
        const ul = document.createElement('ul');
        ul.style.listStyleType = 'disc';
        ul.style.paddingLeft = '20px';
        items.forEach(item => {
            const li = document.createElement('li');
            li.style.marginBottom = '10px';
            li.innerHTML = itemRenderer(item);
            ul.appendChild(li);
        });
        return ul.outerHTML;
    }
    
    function createPlaygroundSection(title, contentGenerator, dataForGenerator) {
        const details = document.createElement('details');
        details.style.marginBottom = "10px";
        const summary = document.createElement('summary');
        summary.innerHTML = `<strong>${title}</strong>`;
        details.appendChild(summary);
        const contentDiv = document.createElement('div');
        contentDiv.className = 'playground-step-details';
        try {
            contentGenerator(contentDiv, dataForGenerator);
        } catch (e) {
            console.error(`Error generating content for section ${title}:`, e);
            contentDiv.innerHTML = '<p style="color:red;">Error al mostrar esta sección.</p>';
        }
        details.appendChild(contentDiv);
        return details;
    }

    function displayPlaygroundResults(data) { // 'data' is the full API response for playground
        playgroundResultsContainer.innerHTML = '';
        if (!data) {
            playgroundResultsContainer.innerHTML = "<p>No se recibieron datos del pipeline.</p>";
            return;
        }
        const overallFeedbackDiv = document.createElement('div');
        overallFeedbackDiv.style.border = '1px solid #ddd';
        overallFeedbackDiv.style.padding = '10px';
        overallFeedbackDiv.style.marginBottom = '15px';
        overallFeedbackDiv.style.backgroundColor = '#e6f7ff';
        const overallFeedbackTitle = document.createElement('h5');
        overallFeedbackTitle.textContent = 'Feedback sobre la Calidad General de esta Ejecución del Playground:';
        overallFeedbackTitle.style.marginTop = '0';
        overallFeedbackDiv.appendChild(overallFeedbackTitle);
        const rateOverallResponseBtn = document.createElement('button');
        rateOverallResponseBtn.textContent = 'Valorar Respuesta General del Playground';
        rateOverallResponseBtn.className = 'btn-rate-overall-playground';
        // ... (styling for button)
        rateOverallResponseBtn.onclick = () => {
            if (!currentPlaygroundRagLogId) {
                alert('ID de interacción RAG no encontrado. No se puede enviar feedback.');
                return;
            }
            const queryText = playgroundQueryInput.value;
            const contextForOverallFeedback = {
                query_text: queryText,
                final_context_string: data?.llmContextualization?.finalLLMContextString || data?.finalLLMContextString || "Context string not available"
            };
            openPlaygroundFeedbackModal('overall_response_quality', null, currentPlaygroundRagLogId, null, contextForOverallFeedback);
        };
        overallFeedbackDiv.appendChild(rateOverallResponseBtn);
        playgroundResultsContainer.appendChild(overallFeedbackDiv);

        // ... (rest of displayPlaygroundResults logic, including the part that needs 'data' for chunk feedback context)
        // For brevity, I'm not pasting the entire displayPlaygroundResults, just showing where 'data' is used.
        // The critical part for chunk feedback context:
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 6: Resultados Finales Clasificados (Post-Re-ranking Total)', (div) => {
            div.innerHTML = renderList(data.finalRankedResultsForPlayground, item => { // 'item' is a chunk here
                const chunkId = item.id;
                let chunkFeedbackHtml = `
                    <div class="chunk-feedback-controls" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
                        <small>Feedback para este chunk (ID: ${chunkId}):</small><br>
                        <button class="btn-chunk-feedback-direct" data-item-id="${chunkId}" data-rating="1" style="background-color: #28a745; color:white; border:none; padding:4px 8px; font-size:0.85em; margin-right:5px; border-radius:3px; cursor:pointer;">👍 Relevante</button>
                        <button class="btn-chunk-feedback-direct" data-item-id="${chunkId}" data-rating="-1" style="background-color: #dc3545; color:white; border:none; padding:4px 8px; font-size:0.85em; margin-right:5px; border-radius:3px; cursor:pointer;">👎 No Relevante</button>
                        <button class="btn-chunk-feedback-comment" data-item-id="${chunkId}" style="font-size:0.85em; padding:4px 8px; border-radius:3px; cursor:pointer;">Comentar...</button>
                    </div>`;
                return `<strong>ID:</strong> ${safeText(chunkId)} | <strong>Score Final Re-clasificado:</strong> ${safeText(item.reranked_score?.toFixed(4))}<br/><em>Scores Detallados:</em> Hybrid=${safeText(item.hybrid_score?.toFixed(4))}, Keyword=${safeText(item.keywordMatchScore?.toFixed(4))}, Metadata=${safeText(item.metadataRelevanceScore?.toFixed(4))}, CrossEncoderNorm=${safeText(item.cross_encoder_score_normalized?.toFixed(4))}<br/><em>Snippet:</em> ${safeText(item.contentSnippet)}<br/><em>Metadata:</em> <pre>${safeText(JSON.stringify(item.metadata, null, 2))}</pre>${chunkFeedbackHtml}`;
            });
            div.querySelectorAll('.btn-chunk-feedback-direct').forEach(button => {
                button.addEventListener('click', (e) => {
                    const itemId = e.target.dataset.itemId; const rating = parseInt(e.target.dataset.rating, 10);
                    if (!currentPlaygroundRagLogId) { alert('ID de RAG Log no encontrado.'); return; }
                    const queryText = playgroundQueryInput.value;
                    const directChunkContext = {
                        query_text: queryText,
                        chunk_id: itemId,
                        chunk_content_snippet_preview: "Content preview not directly available for quick feedback"
                    };
                    doSubmitPlaygroundFeedback('chunk_relevance', itemId, currentPlaygroundRagLogId, rating, null, directChunkContext)
                        .then(() => alert(`Feedback para chunk ${itemId} enviado.`))
                        .catch(err => alert(`Error: ${err.message}`));
                });
            });
            div.querySelectorAll('.btn-chunk-feedback-comment').forEach(button => {
                button.addEventListener('click', (e) => {
                    const itemId = e.target.dataset.itemId;
                    if (!currentPlaygroundRagLogId) { alert('ID de RAG Log no encontrado.'); return; }
                    const queryText = playgroundQueryInput.value;
                    const currentItem = data.finalRankedResultsForPlayground.find(it => it.id.toString() === itemId.toString()); // 'data' is accessible here
                    const contextForChunkFeedback = {
                        query_text: queryText,
                        chunk_id: itemId,
                        chunk_content_snippet: currentItem ? (currentItem.contentSnippet || currentItem.content?.substring(0, 250) + '...') : "Snippet not found for this ID"
                    };
                    openPlaygroundFeedbackModal('chunk_relevance', itemId, currentPlaygroundRagLogId, null, contextForChunkFeedback);
                });
            });
        }, data)); // Pass 'data' to contentGenerator
        // ... rest of displayPlaygroundResults
        if (data.llmContextualization) {
            playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 7: Contextualización con LLM (Filtrado y Resumen)', (div) => { /* ... */ }, data));
            playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 8: Contexto Final para LLM Principal', (div) => { div.innerHTML = `<pre>${safeText(data.llmContextualization.finalLLMContextString)}</pre>`; }, data));
        }
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 9: Búsqueda de Proposiciones (usando embedding de consulta principal)', (div) => { /* ... */ }, data));
        playgroundResultsContainer.querySelectorAll('details').forEach(detailsElement => { detailsElement.open = true; });
    }

    // --- Knowledge Source Management Functions ---
    async function loadKnowledgeSources() {
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
                    li.style.border = '1px solid #eee';
                    li.style.padding = '10px';
                    li.style.marginBottom = '10px';
                    li.style.borderRadius = '4px';

                    const sourceId = source.id || source.source_id; // Handle potential differences in ID field name
                    const sourceIdentifier = source.custom_title || source.source_name || source.url || `Fuente ID: ${sourceId}`;
                    const lastIngestDate = source.last_ingest_at ? new Date(source.last_ingest_at).toLocaleString() : 'N/A';
                    const chunkCount = source.metadata?.chunk_count !== undefined ? source.metadata.chunk_count : 'N/A';
                    const currentFrequency = source.reingest_frequency || '';
                    const customTitleVal = source.custom_title || '';

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
                        <div style="margin-top: 10px;">
                            <button class="btn-save-source-metadata" data-source-id="${sourceId}" style="padding: 6px 10px; background-color: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer;">Guardar Cambios</button>
                            <button class="btn-reingest-source" data-source-id="${sourceId}" style="margin-left: 8px; padding: 6px 10px; background-color: #17a2b8; color: white; border: none; border-radius: 3px; cursor: pointer;">Re-Ingestar</button>
                            <button class="btn-view-source-chunks" data-source-id="${sourceId}" style="margin-left: 8px; padding: 6px 10px; background-color: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer;">Ver Chunks</button>
                        </div>
                    `;
                    knowledgeSourcesList.appendChild(li);
                });

                knowledgeSourcesList.querySelectorAll('.btn-save-source-metadata').forEach(button => {
                    button.addEventListener('click', handleSaveSourceMetadata);
                });
                knowledgeSourcesList.querySelectorAll('.btn-reingest-source').forEach(button => {
                    button.addEventListener('click', handleReingestSource);
                });
            } else {
                knowledgeSourcesList.innerHTML = '<p>No se encontraron fuentes de conocimiento.</p>';
            }
        } catch (error) {
            console.error("Error loading knowledge sources:", error);
            if(knowledgeManagementMessage) displayMessage(knowledgeManagementMessage, error.message, false);
            knowledgeSourcesList.innerHTML = '<p>Error al cargar fuentes.</p>';
        } finally {
            if(loadingSourcesMsg) loadingSourcesMsg.style.display = 'none';
        }
    }

    async function handleSaveSourceMetadata(event) {
        const sourceId = event.target.dataset.sourceId;
        const listItem = event.target.closest('.knowledge-source-item');
        if (!listItem) {
            console.error("Could not find parent list item for source metadata save button.");
            return;
        }

        const customTitleInput = listItem.querySelector(`#custom-title-${sourceId}`);
        const frequencySelect = listItem.querySelector(`#reingest-freq-${sourceId}`);

        const payload = {
            custom_title: customTitleInput.value.trim() || null,
            reingest_frequency: frequencySelect.value || null
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/sources/${sourceId}/metadata`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || `Error ${response.status}`);
            }
            if(knowledgeManagementMessage) displayMessage(knowledgeManagementMessage, 'Metadatos de fuente guardados con éxito.', true);
            loadKnowledgeSources();
        } catch (error) {
            console.error('Error saving source metadata:', error);
            if(knowledgeManagementMessage) displayMessage(knowledgeManagementMessage, `Error al guardar: ${error.message}`, false);
        }
    }

    async function handleReingestSource(event) {
        const sourceId = event.target.dataset.sourceId;
        if (!confirm(`¿Estás seguro de que quieres re-ingestar la fuente ID: ${sourceId}? Esta acción puede consumir recursos.`)) return;

        if(knowledgeManagementMessage) displayMessage(knowledgeManagementMessage, `Iniciando re-ingesta para fuente ${sourceId}...`, true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/sources/${sourceId}/ingest`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || `Error ${response.status}`);
            }
            if(knowledgeManagementMessage) displayMessage(knowledgeManagementMessage, result.message || `Re-ingesta para fuente ${sourceId} iniciada.`, true);
            setTimeout(loadKnowledgeSources, 2000);
        } catch (error) {
            console.error('Error re-ingesting source:', error);
            if(knowledgeManagementMessage) displayMessage(knowledgeManagementMessage, `Error en re-ingesta: ${error.message}`, false);
        }
    }

async function handleViewSourceChunks(sourceId, page = 1) {
    if (!chunkSampleModal || !chunkSampleModalTitle || !chunkSampleModalBody) {
        console.error("Chunk sample modal UI elements not found.");
        return;
    }

    chunkSampleModalTitle.textContent = `Chunks para Fuente ID: ${sourceId} (Cargando página ${page}...)`;
    chunkSampleModalBody.innerHTML = '<p>Cargando chunks...</p>'; // Loading indicator
    chunkSampleModal.style.display = 'block';

    const pageSize = 10; // Or make this configurable

    try {
        const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/sources/${sourceId}/chunks?page=${page}&pageSize=${pageSize}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({ message: `Error ${response.status}` }));
            throw new Error(errData.message || `Failed to fetch chunks: ${response.status}`);
        }

        const result = await response.json(); // Expects { data: { chunks, totalCount, page, pageSize } }

        if (!result.data) {
            throw new Error("Respuesta de API inesperada: falta el objeto 'data'.");
        }
        const { chunks, totalCount, page: currentPage, pageSize: currentChunkPageSize } = result.data;

        chunkSampleModalBody.innerHTML = ''; // Clear loading indicator

        if (!chunks || chunks.length === 0) {
            chunkSampleModalBody.innerHTML = '<p>No se encontraron chunks para esta fuente o página.</p>';
            return;
        }

        chunkSampleModalTitle.textContent = `Chunks para Fuente ID: ${sourceId}`; // Update title without loading state

        chunks.forEach(chunk => {
            const chunkElement = document.createElement('div');
            chunkElement.className = 'chunk-detail-item';
            chunkElement.style.borderBottom = '1px solid #eee';
            chunkElement.style.paddingBottom = '10px';
            chunkElement.style.marginBottom = '10px';

            let customMetaHtml = '';
            if (chunk.metadata?.custom_metadata) {
                try {
                    customMetaHtml = `<p><strong>Metadatos Personalizados:</strong> <pre style="white-space: pre-wrap; word-wrap: break-word; background: #f0f0f0; padding: 3px;">${safeText(JSON.stringify(chunk.metadata.custom_metadata, null, 2))}</pre></p>`;
                } catch (e) {
                    customMetaHtml = '<p><strong>Metadatos Personalizados:</strong> (Error al mostrar JSON)</p>';
                }
            }

            // Truncate long content with a simple "show more"
            const maxPreviewLength = 200;
            const fullContent = chunk.content || '';
            let contentHtml;
            if (fullContent.length > maxPreviewLength) {
                const previewContent = safeText(fullContent.substring(0, maxPreviewLength));
                contentHtml = `<pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 100px; overflow-y: auto; background: #f9f9f9; padding: 5px;">${previewContent}...</pre>
                               <button class="btn-show-more-chunk-content" style="font-size:0.8em; padding:2px 5px;">Mostrar más</button>`;
            } else {
                contentHtml = `<pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 100px; overflow-y: auto; background: #f9f9f9; padding: 5px;">${safeText(fullContent)}</pre>`;
            }


            chunkElement.innerHTML = `
                <p style="font-size:0.8em; color:#777;"><strong>Chunk ID:</strong> ${safeText(chunk.id)} | <strong>Índice:</strong> ${safeText(chunk.metadata?.chunk_index !== undefined ? chunk.metadata.chunk_index : 'N/A')}</p>
                <p style="font-size:0.8em; color:#777;"><strong>Largo (caracteres):</strong> ${safeText(chunk.metadata?.chunk_char_length || 'N/A')} | <strong>Tipo Hint:</strong> ${safeText(chunk.metadata?.content_type_hint || 'N/A')}</p>
                <p><strong>Contenido:</strong></p>
                <div class="chunk-content-display">${contentHtml}</div>
                ${customMetaHtml}
            `;

            const showMoreBtn = chunkElement.querySelector('.btn-show-more-chunk-content');
            if (showMoreBtn) {
                showMoreBtn.onclick = () => {
                    const contentDisplay = chunkElement.querySelector('.chunk-content-display');
                    contentDisplay.innerHTML = `<pre style="white-space: pre-wrap; word-wrap: break-word; background: #f9f9f9; padding: 5px;">${safeText(fullContent)}</pre>`;
                };
            }
            chunkSampleModalBody.appendChild(chunkElement);
        });

        // Pagination
        const totalPages = Math.ceil(totalCount / currentChunkPageSize);
        if (totalPages > 1) {
            const paginationDiv = document.createElement('div');
            paginationDiv.className = 'chunk-pagination';
            paginationDiv.style.marginTop = '15px';
            paginationDiv.style.textAlign = 'center';

            const prevButton = document.createElement('button');
            prevButton.textContent = 'Anterior';
            prevButton.disabled = currentPage === 1;
            prevButton.onclick = () => handleViewSourceChunks(sourceId, currentPage - 1);
            prevButton.style.marginRight = "10px";

            const nextButton = document.createElement('button');
            nextButton.textContent = 'Siguiente';
            nextButton.disabled = currentPage === totalPages;
            nextButton.onclick = () => handleViewSourceChunks(sourceId, currentPage + 1);

            const pageInfo = document.createElement('span');
            pageInfo.textContent = ` Página ${currentPage} de ${totalPages} (Total Chunks: ${totalCount}) `;
            pageInfo.style.margin = "0 10px";

            paginationDiv.appendChild(prevButton);
            paginationDiv.appendChild(pageInfo);
            paginationDiv.appendChild(nextButton);
            chunkSampleModalBody.appendChild(paginationDiv);
        }


    } catch (error) {
        console.error(`Error fetching or displaying chunks for source ${sourceId}:`, error);
        chunkSampleModalBody.innerHTML = `<p style="color: red;">Error al cargar chunks: ${error.message}</p>`;
    }
}

    // --- Analytics Data Loading and Display ---
    function getPeriodDates(periodValue) {
        const endDate = new Date();
        const startDate = new Date();
        switch (periodValue) {
            case '7d': startDate.setDate(endDate.getDate() - 7); break;
            case '30d': startDate.setDate(endDate.getDate() - 30); break;
            case 'current_month': startDate.setDate(1); break;
            default: startDate.setDate(endDate.getDate() - 30);
        }
        return {
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0]
        };
    }

    async function fetchApiData(endpoint, params) {
        const url = new URL(`${API_BASE_URL}${endpoint}`);
        if (params) {
            Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
        }
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `Error ${response.status}` }));
            throw new Error(errorData.message);
        }
        return response.json();
    }

    async function fetchSentimentDistributionAnalytics(startDate, endDate) {
        return fetchApiData('/api/client/me/analytics/sentiment', { startDate, endDate });
    }
    async function fetchTopicAnalyticsData(startDate, endDate) {
        return fetchApiData('/api/client/me/analytics/topics', { startDate, endDate });
    }
    async function fetchKnowledgeSourcePerformanceAnalytics(startDate, endDate) {
        return fetchApiData('/api/client/me/analytics/source-performance', { startDate, endDate });
    }

    function displaySentimentDistribution(apiData) {
        const tableBody = sentimentDistributionTableBody;
        const loadingMsg = sentimentDataLoadingMsg;
        const chartContainer = document.getElementById('sentimentDistributionChartContainer');
        if (!tableBody || !loadingMsg || !chartContainer) return;

        tableBody.innerHTML = '';
        loadingMsg.style.display = 'none';

        if (!apiData || apiData.length === 0) {
            loadingMsg.textContent = 'No hay datos de sentimiento para el período seleccionado.';
            loadingMsg.style.display = 'block';
            if (sentimentPieChartInstance) {
                sentimentPieChartInstance.destroy();
                sentimentPieChartInstance = null;
            }
            chartContainer.style.display = 'none';
            return;
        }

        chartContainer.style.display = 'block';
        const labels = apiData.map(item => item.sentiment);
        const counts = apiData.map(item => item.message_count);
        const percentages = apiData.map(item => item.percentage);

        apiData.forEach(item => {
            const row = tableBody.insertRow();
            row.insertCell().textContent = item.sentiment;
            row.insertCell().textContent = item.message_count;
            row.insertCell().textContent = item.percentage + '%';
        });

        if (typeof Chart !== 'undefined') {
            const ctx = document.getElementById('sentimentPieChart').getContext('2d');
            if (sentimentPieChartInstance) {
                sentimentPieChartInstance.destroy();
            }
            sentimentPieChartInstance = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Distribución de Sentimiento',
                        data: counts,
                        backgroundColor: [
                            'rgba(75, 192, 192, 0.7)',
                            'rgba(255, 99, 132, 0.7)',
                            'rgba(201, 203, 207, 0.7)',
                            'rgba(255, 159, 64, 0.7)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: { /* ... options ... */ }
            });
        } else {
            console.warn('Chart.js is not loaded. Sentiment chart cannot be displayed.');
            chartContainer.style.display = 'none';
        }
    }

    function displayTopicAnalytics(apiResponse) {
        const tableBody = topicAnalyticsTableBody;
        const loadingMsg = topicDataLoadingMsg;
        const topicTable = document.getElementById('topicAnalyticsTable');

        if (!tableBody || !loadingMsg || !topicTable) {
            console.error("Topic analytics UI elements not found in displayTopicAnalytics.");
            return;
        }

        loadingMsg.style.display = 'none';
        tableBody.innerHTML = '';
        topicTable.style.display = 'none';

        if (apiResponse && apiResponse.data && apiResponse.data.length > 0) {
            topicTable.style.display = '';
            apiResponse.data.forEach(topic => {
                const row = tableBody.insertRow();
                row.insertCell().textContent = topic.topic_name || 'N/A';
                row.insertCell().textContent = topic.queries_in_period !== undefined ? topic.queries_in_period : (topic.total_queries_in_topic || 0);

                const escalationRateCell = row.insertCell();
                escalationRateCell.textContent = topic.escalation_rate !== null && topic.escalation_rate !== undefined ?
                    (topic.escalation_rate * 100).toFixed(1) + '%' : 'N/A';

                const sentimentCell = row.insertCell();
                sentimentCell.textContent = topic.average_sentiment !== null && topic.average_sentiment !== undefined ?
                    topic.average_sentiment.toFixed(2) : 'N/A';

                const repQueriesCell = row.insertCell();
                repQueriesCell.textContent = topic.representative_queries && topic.representative_queries.length > 0 ?
                    topic.representative_queries.slice(0, 3).join('; ') + (topic.representative_queries.length > 3 ? '...' : '')
                    : 'N/A';
            });
        } else if (apiResponse && apiResponse.message) {
            loadingMsg.textContent = apiResponse.message;
            loadingMsg.style.display = 'block';
        } else {
            loadingMsg.textContent = 'No topic data available for the selected period.';
            loadingMsg.style.display = 'block';
        }
    }

    function displayKnowledgeSourcePerformance(apiResponse) {
        const tableBody = sourcePerformanceTableBody;
        const loadingMsg = sourcePerformanceDataLoadingMsg;
        const perfTable = document.getElementById('sourcePerformanceTable');

        if (!tableBody || !loadingMsg || !perfTable) {
            console.error("Source performance UI elements not found in displayKnowledgeSourcePerformance.");
            return;
        }

        loadingMsg.style.display = 'none';
        tableBody.innerHTML = '';
        perfTable.style.display = 'none';

        if (apiResponse && apiResponse.data && apiResponse.data.length > 0) {
            perfTable.style.display = '';
            apiResponse.data.forEach(source => {
                const row = tableBody.insertRow();
                row.insertCell().textContent = source.source_name || 'Unknown Source';
                row.insertCell().textContent = source.positive_feedback_count || 0;
                row.insertCell().textContent = source.negative_feedback_count || 0;
                row.insertCell().textContent = source.neutral_feedback_count || 0;
                row.insertCell().textContent = source.total_feedback_on_chunks || 0;
            });
        } else if (apiResponse && apiResponse.message) {
            loadingMsg.textContent = apiResponse.message;
            loadingMsg.style.display = 'block';
        } else {
            loadingMsg.textContent = 'No source performance data available for the selected period.';
            loadingMsg.style.display = 'block';
        }
    }

    async function loadAnalyticsData() {
        if (!analyticsSection || analyticsSection.style.display === 'none') return;
        if(analyticsLoadingMessage) analyticsLoadingMessage.style.display = 'block';

        if(sentimentDataLoadingMsg) { sentimentDataLoadingMsg.textContent = 'Cargando datos de sentimiento...'; sentimentDataLoadingMsg.style.display = 'block'; }
        if(topicDataLoadingMsg) { topicDataLoadingMsg.textContent = 'Cargando datos de temas...'; topicDataLoadingMsg.style.display = 'block'; }
        if(sourcePerformanceDataLoadingMsg) { sourcePerformanceDataLoadingMsg.textContent = 'Cargando datos de rendimiento...'; sourcePerformanceDataLoadingMsg.style.display = 'block'; }

        const { startDate, endDate } = getPeriodDates(analyticsPeriodSelector.value);

        try {
            const summaryResponse = await fetch(`${API_BASE_URL}/api/client/me/analytics/summary?startDate=${startDate}&endDate=${endDate}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!summaryResponse.ok) throw new Error('Failed to fetch analytics summary');
            const summary = await summaryResponse.json();
            if(totalConversationsSpan) totalConversationsSpan.textContent = summary.total_conversations || 0;
            if(escalatedConversationsSpan) escalatedConversationsSpan.textContent = summary.escalated_conversations || 0;
            if(escalatedPercentageSpan) escalatedPercentageSpan.textContent = summary.total_conversations > 0 ? ((summary.escalated_conversations / summary.total_conversations) * 100).toFixed(1) : 0;
            // ... (rest of summary display)

            const unansweredResponse = await fetch(`${API_BASE_URL}/api/client/me/analytics/suggestions/unanswered?startDate=${startDate}&endDate=${endDate}&limit=10`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!unansweredResponse.ok) throw new Error('Failed to fetch unanswered queries');
            const unanswered = await unansweredResponse.json();
            if(unansweredQueriesList) {
                unansweredQueriesList.innerHTML = '';
                if (unanswered.length === 0) {
                    unansweredQueriesList.innerHTML = '<li>No hay consultas no respondidas recientemente.</li>';
                } else {
                    unanswered.forEach(uq => { /* ... */ });
                }
            }

            fetchSentimentDistributionAnalytics(startDate, endDate)
                .then(displaySentimentDistribution)
                .catch(error => {
                    console.error('Error fetching/displaying sentiment analytics:', error);
                    if(sentimentDataLoadingMsg) sentimentDataLoadingMsg.textContent = 'Error al cargar datos de sentimiento.';
                });

            fetchTopicAnalyticsData(startDate, endDate)
                .then(displayTopicAnalytics)
                .catch(error => {
                    console.error('Error fetching/displaying topic analytics:', error);
                    if(topicDataLoadingMsg) topicDataLoadingMsg.textContent = 'Error al cargar datos de temas.';
                });

            fetchKnowledgeSourcePerformanceAnalytics(startDate, endDate)
                .then(displayKnowledgeSourcePerformance)
                .catch(error => {
                    console.error('Error fetching/displaying source performance analytics:', error);
                    if(sourcePerformanceDataLoadingMsg) sourcePerformanceDataLoadingMsg.textContent = 'Error al cargar datos de rendimiento.';
                });

        } catch (error) {
            console.error("Error loading analytics:", error);
            if (analyticsLoadingMessage) analyticsLoadingMessage.textContent = "Error al cargar datos analíticos.";
        } finally {
            if (analyticsLoadingMessage) analyticsLoadingMessage.style.display = 'none';
        }
    }
    if (refreshAnalyticsBtn) refreshAnalyticsBtn.addEventListener('click', loadAnalyticsData);
    if (analyticsPeriodSelector) analyticsPeriodSelector.addEventListener('change', loadAnalyticsData);

    // --- Playground Feedback Modal Logic ---
    const playgroundFeedbackModal = document.getElementById('playgroundFeedbackModal');
    const closePlaygroundFeedbackModalBtn = document.getElementById('closePlaygroundFeedbackModalBtn');
    const playgroundFeedbackModalTitle = document.getElementById('playgroundFeedbackModalTitle');
    const playgroundFeedbackTypeStore = document.getElementById('playgroundFeedbackTypeStore');
    const playgroundItemIdStore = document.getElementById('playgroundItemIdStore');
    const playgroundRagLogIdStore = document.getElementById('playgroundRagLogIdStore');
    const playgroundFeedbackPositiveBtn = document.getElementById('playgroundFeedbackPositiveBtn');
    const playgroundFeedbackNegativeBtn = document.getElementById('playgroundFeedbackNegativeBtn');
    const playgroundFeedbackCommentInput = document.getElementById('playgroundFeedbackComment');
    const submitPlaygroundFeedbackBtn = document.getElementById('submitPlaygroundFeedbackBtn');
    let currentPlaygroundFeedbackRating = null;

    function openPlaygroundFeedbackModal(feedbackType, itemId, ragLogId, initialRating = null, feedbackContext = null) {
        if (!playgroundFeedbackModal) { console.error("Playground feedback modal not found in DOM"); return; }
        playgroundFeedbackTypeStore.value = feedbackType;
        playgroundItemIdStore.value = itemId || '';
        playgroundRagLogIdStore.value = ragLogId || '';
        playgroundFeedbackCommentInput.value = '';
        currentPlaygroundFeedbackRating = initialRating;

        const playgroundFeedbackContextStore = document.getElementById('playgroundFeedbackContextStore');
        if (playgroundFeedbackContextStore) {
            playgroundFeedbackContextStore.value = feedbackContext ? JSON.stringify(feedbackContext) : '';
        }

        if (feedbackType === 'chunk_relevance') {
            playgroundFeedbackModalTitle.textContent = `Feedback para Chunk ID: ${itemId}`;
        } else if (feedbackType === 'overall_response_quality') {
            playgroundFeedbackModalTitle.textContent = 'Feedback para Respuesta General del Playground';
        } else {
            playgroundFeedbackModalTitle.textContent = 'Proporcionar Feedback';
        }

        playgroundFeedbackPositiveBtn.style.border = (initialRating === 1) ? '2px solid #3B4018' : 'none';
        playgroundFeedbackNegativeBtn.style.border = (initialRating === -1) ? '2px solid #3B4018' : 'none';
        if (initialRating === null) {
             playgroundFeedbackPositiveBtn.style.border = 'none';
             playgroundFeedbackNegativeBtn.style.border = 'none';
        }
        playgroundFeedbackModal.style.display = 'block';
    }

    if(closePlaygroundFeedbackModalBtn) {
        closePlaygroundFeedbackModalBtn.addEventListener('click', () => {
            if(playgroundFeedbackModal) playgroundFeedbackModal.style.display = 'none';
        });
    }
    if(playgroundFeedbackPositiveBtn) {
        playgroundFeedbackPositiveBtn.addEventListener('click', () => { /* ... */ });
    }
    if(playgroundFeedbackNegativeBtn) {
        playgroundFeedbackNegativeBtn.addEventListener('click', () => { /* ... */ });
    }
    if(submitPlaygroundFeedbackBtn) {
        submitPlaygroundFeedbackBtn.addEventListener('click', async () => { /* ... */ });
    }
    async function doSubmitPlaygroundFeedback(feedbackType, itemId, ragLogId, rating, comment, feedbackContext = null) {
        const payload = {
            feedback_type: feedbackType,
            rating: rating,
            comment: comment || null,
            rag_interaction_log_id: ragLogId,
            feedback_context: feedbackContext
        };
        if (feedbackType === 'chunk_relevance' && itemId) payload.knowledge_base_chunk_id = itemId;
        // ... (fetch call)
    }

    // --- Inbox Feedback Modal Logic ---
    const inboxFeedbackModal = document.getElementById('inboxFeedbackModal');
    const closeInboxFeedbackModalBtn = document.getElementById('closeInboxFeedbackModalBtn');
    const feedbackMessageIdStore = document.getElementById('feedbackMessageIdStore');
    const feedbackRagLogIdStore = document.getElementById('feedbackRagLogIdStore');
    const feedbackPositiveBtn = document.getElementById('feedbackPositiveBtn');
    const feedbackNegativeBtn = document.getElementById('feedbackNegativeBtn');
    const feedbackCommentInput = document.getElementById('feedbackComment');
    const submitInboxFeedbackBtn = document.getElementById('submitInboxFeedbackBtn');
    let currentInboxFeedbackRating = null;

    function openInboxFeedbackModal(messageId, ragLogId, messageContent) { /* ... */ }
    // ... (rest of inbox feedback logic)

    // Monkey patch for displayConversationMessages
    const existingDisplayConvMessages = window.displayConversationMessages;
    window.displayConversationMessages = function(messages, ...args) { /* ... */ };

}); // End of DOMContentLoaded
