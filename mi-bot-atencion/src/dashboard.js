// mi-bot-atencion/src/dashboard.js
// TODO: Consider using a simple templating engine if HTML generation becomes too complex.

import { logout } from './auth.js';

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
    const knowledgeSuggestionsList = document.getElementById('knowledgeSuggestionsList'); // Assuming this ID exists or will be added

    // RAG Playground Elements
    const playgroundQueryInput = document.getElementById('playgroundQueryInput');
    const runPlaygroundQueryBtn = document.getElementById('runPlaygroundQueryBtn');
    const playgroundStatusMessage = document.getElementById('playgroundStatusMessage');
    const playgroundResultsContainer = document.getElementById('playgroundResultsContainer');
    let currentPlaygroundRagLogId = null; // To store RAG log ID from playground run


    const API_BASE_URL = window.SYNCHAT_CONFIG?.API_BASE_URL || '';


    // Function to display messages (success or error)
    const displayMessage = (element, message, isSuccess) => {
        element.textContent = message;
        element.className = isSuccess ? 'success' : 'error'; // Assumes CSS classes for styling
        element.style.display = 'block';
        setTimeout(() => { element.style.display = 'none'; }, 5000);
    };

    // Navigation handling
    const sections = {
        config: document.getElementById('config'),
        ingest: document.getElementById('knowledgeManagement'), // Assuming ingest maps to knowledgeManagement
        widget: null, // Placeholder if there's a widget preview section
        usage: document.getElementById('usage'),
        inboxSection: inboxSection,
        analyticsSection: analyticsSection,
        ragPlayground: document.getElementById('ragPlayground')
    };

    const navLinks = document.querySelectorAll('nav ul li a');
    navLinks.forEach(link => {
        link.addEventListener('click', (event) => {
            const sectionId = link.dataset.section || link.getAttribute('href')?.substring(1);
            if (sectionId && sections[sectionId]) {
                event.preventDefault();
                Object.values(sections).forEach(section => {
                    if (section) section.style.display = 'none';
                });
                sections[sectionId].style.display = 'block';

                // Special handling for inbox or other sections if needed
                if (sectionId === 'inboxSection') {
                    loadConversationsForInbox();
                } else if (sectionId === 'analyticsSection') {
                    loadAnalyticsData();
                }

            } else if (!link.getAttribute('href') || link.getAttribute('href') === '#') {
                 event.preventDefault(); // Prevent jumping for placeholder links
            }
        });
    });

    // Initial data loading
    const token = localStorage.getItem('synchat_session_token');
    if (!token) {
        window.location.href = 'login.html'; // Redirect if no token
        return;
    }

    // Show onboarding if needed
    if (!localStorage.getItem('synchat_onboarding_dismissed')) {
        onboardingSection.style.display = 'block';
    }
    if (dismissOnboardingBtn) {
        dismissOnboardingBtn.addEventListener('click', () => {
            onboardingSection.style.display = 'none';
            localStorage.setItem('synchat_onboarding_dismissed', 'true');
        });
    }

    // Fetch and display client config
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

            loadingMessage.style.display = 'none';
            dashboardContent.classList.remove('hidden');
            // By default, show the 'config' section or the one from URL hash
            const initialSectionId = window.location.hash.substring(1) || 'config';
            const initialLink = document.querySelector(`nav ul li a[href="#${initialSectionId}"], nav ul li a[data-section="${initialSectionId}"]`);
            if (initialLink) {
                initialLink.click();
            } else if (sections.config) { // Default to config if hash is invalid
                sections.config.style.display = 'block';
            }


        } catch (error) {
            console.error('Error fetching client config:', error);
            loadingMessage.style.display = 'none';
            errorMessageDashboard.textContent = `Error al cargar configuración: ${error.message}`;
            errorMessageDashboard.style.display = 'block';
        }
    };

    // Handle Config Form Submission
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

    // Logout functionality
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    fetchClientConfig();
    // Other init functions for sections can be called here too
    // e.g., fetchKnowledgeSources(); fetchUsageData();

    // --- Knowledge Management Functions ---
    // ... (existing knowledge management JS code remains here) ...

    // --- RAG Playground Logic ---
    if (runPlaygroundQueryBtn) {
        runPlaygroundQueryBtn.addEventListener('click', async () => {
            currentPlaygroundRagLogId = null; // Reset on new query
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
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ queryText })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'Error desconocido al procesar la respuesta.' }));
                    throw new Error(`Error del servidor: ${response.status} - ${errorData.message || response.statusText}`);
                }

                const data = await response.json();
                // Attempt to get rag_interaction_log_id from the response.
                // This assumes the backend for RAG playground query was updated to return it.
                currentPlaygroundRagLogId = data.rag_interaction_log_id ||
                                           data.pipelineDetails?.rag_interaction_log_id ||
                                           data.searchParams?.rag_interaction_log_id || // Check multiple plausible locations
                                           null;
                console.log("Playground RAG Log ID captured:", currentPlaygroundRagLogId);


                displayPlaygroundResults(data);
                playgroundStatusMessage.textContent = 'Consulta completada.';
                playgroundStatusMessage.className = 'status-message success';
            } catch (error) {
                console.error('Error en RAG Playground:', error);
                playgroundStatusMessage.textContent = `Error: ${error.message}`;
                playgroundStatusMessage.className = 'status-message error';
            }
        });
    }

    function safeText(text) {
        const el = document.createElement('span');
        el.textContent = text || 'N/A';
        return el.innerHTML;
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

    function displayPlaygroundResults(data) {
        playgroundResultsContainer.innerHTML = '';

        if (!data) {
            playgroundResultsContainer.innerHTML = "<p>No se recibieron datos del pipeline.</p>";
            return;
        }

        // Add Overall Response Feedback Button
        const overallFeedbackDiv = document.createElement('div');
        overallFeedbackDiv.style.border = '1px solid #ddd';
        overallFeedbackDiv.style.padding = '10px';
        overallFeedbackDiv.style.marginBottom = '15px';
        overallFeedbackDiv.style.backgroundColor = '#e6f7ff'; // Light blue background

        const overallFeedbackTitle = document.createElement('h5');
        overallFeedbackTitle.textContent = 'Feedback sobre la Calidad General de esta Ejecución del Playground:';
        overallFeedbackTitle.style.marginTop = '0';
        overallFeedbackDiv.appendChild(overallFeedbackTitle);

        const rateOverallResponseBtn = document.createElement('button');
        rateOverallResponseBtn.textContent = 'Valorar Respuesta General del Playground';
        rateOverallResponseBtn.className = 'btn-rate-overall-playground';
        rateOverallResponseBtn.style.padding = '8px 12px';
        rateOverallResponseBtn.style.backgroundColor = '#007bff';
        rateOverallResponseBtn.style.color = 'white';
        rateOverallResponseBtn.style.border = 'none';
        rateOverallResponseBtn.style.borderRadius = '4px';
        rateOverallResponseBtn.style.cursor = 'pointer';
        rateOverallResponseBtn.onclick = () => {
            if (!currentPlaygroundRagLogId) {
                alert('ID de interacción RAG no encontrado para esta ejecución del playground. No se puede enviar feedback para la respuesta general.');
                return;
            }
            openPlaygroundFeedbackModal('overall_response_quality', null, currentPlaygroundRagLogId);
        };
        overallFeedbackDiv.appendChild(rateOverallResponseBtn);
        playgroundResultsContainer.appendChild(overallFeedbackDiv);


        // Section 1: Query Processing
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 1: Procesamiento Inicial y Descomposición de Consulta', (div) => {
            let html = `<p><strong>Consulta Original:</strong> ${safeText(data.originalQuery)}</p>`;
            if (data.queryDecomposition) {
                html += `<h4>Descomposición de Consulta:</h4>
                         <p><strong>¿Fue Descompuesta?:</strong> ${data.queryDecomposition.wasDecomposed ? 'Sí' : 'No'}</p>`;
                if (data.queryDecomposition.wasDecomposed && data.queryDecomposition.subQueries?.length) {
                    html += `<p><strong>Sub-Consultas Generadas:</strong></p>${renderList(data.queryDecomposition.subQueries, q => safeText(q))}`;
                }
                html += `<p><strong>Consulta(s) Finales para Procesamiento:</strong></p>
                         ${renderList(data.queryDecomposition.finalQueriesProcessed, q => safeText(q))}`;
            }
             div.innerHTML = html;
        }, data));

        // Section 2 to 5 (as before) ...
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 2: Detalles por Consulta Procesada (Preproc., HyDE, Reform.)', (div) => {
             if (data.processedQueries && data.processedQueries.length > 0) {
                data.processedQueries.forEach(pq => {
                    const pqDiv = document.createElement('div');
                    pqDiv.style.marginBottom = '15px'; pqDiv.style.paddingBottom = '10px'; pqDiv.style.borderBottom = '1px dashed #eee';
                    let content = `<h5>Para Consulta: "${safeText(pq.queryIdentifier)}"</h5>
                                   <p><strong>Salida de Preprocesamiento:</strong> ${safeText(pq.preprocessingOutput)}</p>
                                   <h6>Mejoras Aplicadas (Embeddings Generados):</h6>`;
                    content += renderList(pq.enhancements, item => `
                        <strong>Tipo:</strong> ${safeText(item.type)}<br/>
                        ${item.type !== "Original_Query_Embedding" ? `<em>Texto Generado:</em> ${safeText(item.generatedText || item.generatedTextOrIdentifier)}<br/>` : ''}
                        <em>Identificador para Embedding:</em> ${safeText(item.type === "Original_Query_Embedding" ? item.generatedTextOrIdentifier : item.query)}<br/>
                        <strong>Embedding:</strong> ${safeText(item.embeddingVectorPreview)}
                    `);
                    pqDiv.innerHTML = content; div.appendChild(pqDiv);
                });
            } else { div.innerHTML = "<p>No hay detalles de consultas procesadas.</p>"; }
        }, data));
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 3: Recuperación Inicial Agregada (Vectorial y FTS)', (div) => {
            let content = '<h4>Resultados Únicos de Búsqueda Vectorial (Agregados):</h4>';
            content += renderList(data.aggregatedResults?.uniqueVectorResultsPreview, item => `<strong>ID:</strong> ${safeText(item.id)} | <strong>Score:</strong> ${safeText(item.score?.toFixed(4))}<br/><em>Snippet:</em> ${safeText(item.contentSnippet)}`);
            content += '<h4>Resultados Únicos de Búsqueda FTS (Agregados):</h4>';
            content += renderList(data.aggregatedResults?.uniqueFtsResultsPreview, item => `<strong>ID:</strong> ${safeText(item.id)} | <strong>Score (Rank):</strong> ${safeText(item.score?.toFixed(4))}<br/><em>Snippet:</em> ${safeText(item.contentSnippet)}`);
            div.innerHTML = content;
        }, data));
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 4: Fusión y Pre-Clasificación de Resultados (Hybrid Score)', (div) => {
            div.innerHTML = renderList(data.mergedAndPreRankedResultsPreview, item => `<strong>ID:</strong> ${safeText(item.id)} | <strong>Hybrid Score Inicial:</strong> ${safeText(item.initialHybridScore?.toFixed(4))}<br/>(Vector Sim: ${safeText(item.vectorSimilarity?.toFixed(4))}, FTS Score: ${safeText(item.ftsScore?.toFixed(4))})<br/><em>Snippet:</em> ${safeText(item.contentSnippet)}<br/><em>Metadata:</em> <pre>${safeText(JSON.stringify(item.metadata, null, 2))}</pre>`);
        }, data));
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 5: Re-clasificación con Cross-Encoder', (div) => {
            let contentHtml = '<h4>Documentos Enviados al Cross-Encoder (Top K):</h4>';
            contentHtml += renderList(data.crossEncoderProcessing?.inputs, item => `<strong>Consulta (Original):</strong> ${safeText(item.query)}<br/><strong>Documento Snippet:</strong> ${safeText(item.documentContentSnippet)}`);
            contentHtml += '<h4>Resultados del Cross-Encoder:</h4>';
            contentHtml += renderList(data.crossEncoderProcessing?.outputs, item => `<strong>ID:</strong> ${safeText(item.id)}<br/><em>Snippet:</em> ${safeText(item.contentSnippet)}<br/><strong>Score Raw:</strong> ${safeText(item.rawScore?.toFixed(4))} | <strong>Score Normalizado (Sigmoid):</strong> ${safeText(item.normalizedScore?.toFixed(4))}`);
            div.innerHTML = contentHtml;
        }, data));

        // Section 6: Resultados Finales Clasificados (con botones de feedback para chunks)
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 6: Resultados Finales Clasificados (Post-Re-ranking Total)', (div) => {
            div.innerHTML = renderList(data.finalRankedResultsForPlayground, item => {
                // Assuming item.id is the knowledge_base_chunk_id
                const chunkId = item.id;
                let chunkFeedbackHtml = `
                    <div class="chunk-feedback-controls" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
                        <small>Feedback para este chunk (ID: ${chunkId}):</small><br>
                        <button class="btn-chunk-feedback-direct" data-item-id="${chunkId}" data-rating="1" style="background-color: #28a745; color:white; border:none; padding:4px 8px; font-size:0.85em; margin-right:5px; border-radius:3px; cursor:pointer;">👍 Relevante</button>
                        <button class="btn-chunk-feedback-direct" data-item-id="${chunkId}" data-rating="-1" style="background-color: #dc3545; color:white; border:none; padding:4px 8px; font-size:0.85em; margin-right:5px; border-radius:3px; cursor:pointer;">👎 No Relevante</button>
                        <button class="btn-chunk-feedback-comment" data-item-id="${chunkId}" style="font-size:0.85em; padding:4px 8px; border-radius:3px; cursor:pointer;">Comentar...</button>
                    </div>`;
                return `
                    <strong>ID:</strong> ${safeText(chunkId)} | <strong>Score Final Re-clasificado:</strong> ${safeText(item.reranked_score?.toFixed(4))}<br/>
                    <em>Scores Detallados:</em> Hybrid=${safeText(item.hybrid_score?.toFixed(4))}, Keyword=${safeText(item.keywordMatchScore?.toFixed(4))}, Metadata=${safeText(item.metadataRelevanceScore?.toFixed(4))}, CrossEncoderNorm=${safeText(item.cross_encoder_score_normalized?.toFixed(4))}<br/>
                    <em>Snippet:</em> ${safeText(item.contentSnippet)}<br/>
                    <em>Metadata:</em> <pre>${safeText(JSON.stringify(item.metadata, null, 2))}</pre>
                    ${chunkFeedbackHtml}
                `;
            });

            // Add event listeners for the new chunk feedback buttons
            div.querySelectorAll('.btn-chunk-feedback-direct').forEach(button => {
                button.addEventListener('click', (e) => {
                    const itemId = e.target.dataset.itemId;
                    const rating = parseInt(e.target.dataset.rating, 10);
                     if (!currentPlaygroundRagLogId) {
                        alert('ID de interacción RAG no encontrado. No se puede enviar feedback para este chunk.');
                        return;
                    }
                    doSubmitPlaygroundFeedback('chunk_relevance', itemId, currentPlaygroundRagLogId, rating, null)
                        .then(() => alert(`Feedback para chunk ${itemId} (${rating === 1 ? 'relevante' : 'no relevante'}) enviado.`))
                        .catch(err => alert(`Error enviando feedback para chunk: ${err.message}`));
                });
            });
            div.querySelectorAll('.btn-chunk-feedback-comment').forEach(button => {
                 button.addEventListener('click', (e) => {
                    const itemId = e.target.dataset.itemId;
                     if (!currentPlaygroundRagLogId) {
                        alert('ID de interacción RAG no encontrado. No se puede abrir modal de feedback.');
                        return;
                    }
                    openPlaygroundFeedbackModal('chunk_relevance', itemId, currentPlaygroundRagLogId);
                });
            });
        }, data));

        // Section 7, 8, 9 (as before)
        if (data.llmContextualization) {
            playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 7: Contextualización con LLM (Filtrado y Resumen)', (div) => {
                let contentHtml = '<h4>Acciones de Filtrado LLM:</h4>';
                contentHtml += renderList(data.llmContextualization.llmFilteringActions, item => `<strong>ID Chunk:</strong> ${safeText(item.chunkId)}<br/><em>Snippet Original:</em> ${safeText(item.originalContentPreview)}<br/><strong>Decisión:</strong> ${safeText(item.decision)}`);
                contentHtml += '<h4>Acciones de Resumen/Extracción LLM:</h4>';
                contentHtml += renderList(data.llmContextualization.llmSummarizationActions, item => `<strong>ID Chunk:</strong> ${safeText(item.chunkId)}<br/><em>Snippet Original:</em> ${safeText(item.originalContentPreview)}<br/><em>Snippet Resumido/Extraído:</em> ${safeText(item.summarizedContentPreview)}<br/><strong>Acción Tomada:</strong> ${safeText(item.actionTaken)}`);
                div.innerHTML = contentHtml;
            }, data));
            playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 8: Contexto Final para LLM Principal', (div) => {
                div.innerHTML = `<pre>${safeText(data.llmContextualization.finalLLMContextString)}</pre>`;
            }, data));
        }
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 9: Búsqueda de Proposiciones (usando embedding de consulta principal)', (div) => {
            div.innerHTML = renderList(data.finalPropositionResults, item => `<strong>ID Proposición:</strong> ${safeText(item.propositionId)} | <strong>Score:</strong> ${safeText(item.score?.toFixed(4))}<br/><em>Texto:</em> ${safeText(item.text)}<br/><em>ID Chunk Padre:</em> ${safeText(item.sourceChunkId)}`);
        }, data));


        playgroundResultsContainer.querySelectorAll('details').forEach(detailsElement => {
            detailsElement.open = true;
        });
    }

    async function loadAnalyticsData() {
        if (!analyticsSection || analyticsSection.style.display === 'none') return;
        analyticsLoadingMessage.style.display = 'block';
        try {
            const period = analyticsPeriodSelector.value;
            const response = await fetch(`${API_BASE_URL}/api/client/me/analytics/summary?period=${period}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Failed to fetch analytics summary');
            const summary = await response.json();
            totalConversationsSpan.textContent = summary.total_conversations || 0;
            escalatedConversationsSpan.textContent = summary.escalated_conversations || 0;
            escalatedPercentageSpan.textContent = summary.total_conversations > 0 ? ((summary.escalated_conversations / summary.total_conversations) * 100).toFixed(1) : 0;
            unansweredByBotConversationsSpan.textContent = summary.unanswered_by_bot_conversations || 0;
            unansweredPercentageSpan.textContent = summary.total_conversations > 0 ? ((summary.unanswered_by_bot_conversations / summary.total_conversations) * 100).toFixed(1) : 0;
            avgDurationSpan.textContent = summary.avg_duration_seconds ? summary.avg_duration_seconds.toFixed(1) : 0;
            avgMessagesPerConversationSpan.textContent = summary.avg_messages_per_conversation ? summary.avg_messages_per_conversation.toFixed(1) : 0;
            const unansweredResponse = await fetch(`${API_BASE_URL}/api/client/me/analytics/suggestions/unanswered?period=${period}&limit=10`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!unansweredResponse.ok) throw new Error('Failed to fetch unanswered queries');
            const unanswered = await unansweredResponse.json();
            unansweredQueriesList.innerHTML = '';
            if (unanswered.length === 0) {
                unansweredQueriesList.innerHTML = '<li>No hay consultas no respondidas recientemente.</li>';
            } else {
                unanswered.forEach(uq => {
                    const li = document.createElement('li');
                    li.textContent = `${uq.summary} (Frecuencia: ${uq.frequency}, Última vez: ${new Date(uq.last_occurred_at).toLocaleDateString()})`;
                    unansweredQueriesList.appendChild(li);
                });
            }
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

    function openPlaygroundFeedbackModal(feedbackType, itemId, ragLogId, initialRating = null) {
        if (!playgroundFeedbackModal) { console.error("Playground feedback modal not found in DOM"); return; }
        playgroundFeedbackTypeStore.value = feedbackType;
        playgroundItemIdStore.value = itemId || '';
        playgroundRagLogIdStore.value = ragLogId || '';
        playgroundFeedbackCommentInput.value = '';
        currentPlaygroundFeedbackRating = initialRating;

        if (feedbackType === 'chunk_relevance') {
            playgroundFeedbackModalTitle.textContent = `Feedback para Chunk ID: ${itemId}`;
        } else if (feedbackType === 'overall_response_quality') {
            playgroundFeedbackModalTitle.textContent = 'Feedback para Respuesta General del Playground';
        } else {
            playgroundFeedbackModalTitle.textContent = 'Proporcionar Feedback';
        }

        playgroundFeedbackPositiveBtn.style.border = (initialRating === 1) ? '2px solid #3B4018' : 'none';
        playgroundFeedbackNegativeBtn.style.border = (initialRating === -1) ? '2px solid #3B4018' : 'none';
        if (initialRating === null) { // Reset if no initial rating for comment-only modal
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
        playgroundFeedbackPositiveBtn.addEventListener('click', () => {
            currentPlaygroundFeedbackRating = parseInt(playgroundFeedbackPositiveBtn.dataset.rating, 10);
            playgroundFeedbackPositiveBtn.style.border = '2px solid #3B4018';
            playgroundFeedbackNegativeBtn.style.border = 'none';
        });
    }

    if(playgroundFeedbackNegativeBtn) {
        playgroundFeedbackNegativeBtn.addEventListener('click', () => {
            currentPlaygroundFeedbackRating = parseInt(playgroundFeedbackNegativeBtn.dataset.rating, 10);
            playgroundFeedbackNegativeBtn.style.border = '2px solid #3B4018';
            playgroundFeedbackPositiveBtn.style.border = 'none';
        });
    }

    if(submitPlaygroundFeedbackBtn) {
        submitPlaygroundFeedbackBtn.addEventListener('click', async () => {
            const feedbackType = playgroundFeedbackTypeStore.value;
            const itemId = playgroundItemIdStore.value || null;
            const ragLogId = playgroundRagLogIdStore.value || null;
            const comment = playgroundFeedbackCommentInput.value.trim();

            if (currentPlaygroundFeedbackRating === null) {
                alert('Por favor, seleccione una calificación.');
                return;
            }
            if (!feedbackType || !ragLogId) {
                 alert('Error: Tipo de feedback o ID de interacción RAG faltante.');
                return;
            }
            if (feedbackType === 'chunk_relevance' && !itemId) {
                alert('Error: ID del chunk faltante para feedback de chunk.');
                return;
            }

            try {
                await doSubmitPlaygroundFeedback(feedbackType, itemId, ragLogId, currentPlaygroundFeedbackRating, comment);
                if(playgroundFeedbackModal) playgroundFeedbackModal.style.display = 'none';
                alert('Feedback del Playground enviado con éxito.');
            } catch (error) {
                console.error('Error submitting playground feedback:', error);
                alert(`Error al enviar feedback del playground: ${error.message}`);
            }
        });
    }

    async function doSubmitPlaygroundFeedback(feedbackType, itemId, ragLogId, rating, comment) {
        const payload = {
            feedback_type: feedbackType,
            rating: rating,
            comment: comment || null,
            rag_interaction_log_id: ragLogId
        };

        if (feedbackType === 'chunk_relevance' && itemId) {
            payload.knowledge_base_chunk_id = itemId;
        }

        const response = await fetch(`${API_BASE_URL}/api/client/me/knowledge/rag-playground/feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Error desconocido al procesar la respuesta.' }));
            throw new Error(errorData.message || `Error del servidor: ${response.status}`);
        }
        return await response.json();
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
    let currentFeedbackRating = null;

    function openInboxFeedbackModal(messageId, ragLogId) {
        if (!inboxFeedbackModal) { console.error("Inbox feedback modal not found in DOM"); return; }
        feedbackMessageIdStore.value = messageId;
        feedbackRagLogIdStore.value = ragLogId || '';
        feedbackCommentInput.value = '';
        currentFeedbackRating = null;

        feedbackPositiveBtn.style.border = 'none';
        feedbackNegativeBtn.style.border = 'none';
        inboxFeedbackModal.style.display = 'block';
    }

    if (closeInboxFeedbackModalBtn) {
        closeInboxFeedbackModalBtn.addEventListener('click', () => {
            if(inboxFeedbackModal) inboxFeedbackModal.style.display = 'none';
        });
    }

    if (feedbackPositiveBtn) {
        feedbackPositiveBtn.addEventListener('click', () => {
            currentFeedbackRating = parseInt(feedbackPositiveBtn.dataset.rating, 10);
            feedbackPositiveBtn.style.border = '2px solid #3B4018';
            feedbackNegativeBtn.style.border = 'none';
        });
    }

    if (feedbackNegativeBtn) {
        feedbackNegativeBtn.addEventListener('click', () => {
            currentFeedbackRating = parseInt(feedbackNegativeBtn.dataset.rating, 10);
            feedbackNegativeBtn.style.border = '2px solid #3B4018';
            feedbackPositiveBtn.style.border = 'none';
        });
    }

    if (submitInboxFeedbackBtn) {
        submitInboxFeedbackBtn.addEventListener('click', async () => {
            const messageId = feedbackMessageIdStore.value;
            const ragLogId = feedbackRagLogIdStore.value || null;
            const comment = feedbackCommentInput.value.trim();

            if (currentFeedbackRating === null) {
                alert('Por favor, seleccione una calificación (Positivo o Negativo).');
                return;
            }
            if (!messageId || !currentOpenConversationId) {
                alert('Error: No se pudo identificar el mensaje o la conversación. Intente de nuevo.');
                return;
            }

            try {
                await submitInboxMessageFeedback(currentOpenConversationId, messageId, ragLogId, currentFeedbackRating, comment);
                if(inboxFeedbackModal) inboxFeedbackModal.style.display = 'none';
                alert('Feedback enviado con éxito.');
            } catch (error) {
                console.error('Error submitting inbox feedback:', error);
                alert(`Error al enviar feedback: ${error.message}`);
            }
        });
    }

    async function submitInboxMessageFeedback(conversationId, messageId, ragLogId, rating, comment) {
        const feedbackPayload = {
            rating: rating,
            comment: comment || null,
            rag_interaction_log_id: ragLogId
        };

        const response = await fetch(`${API_BASE_URL}/api/client/me/inbox/conversations/${conversationId}/messages/${messageId}/rag_feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(feedbackPayload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Error desconocido al procesar la respuesta.' }));
            throw new Error(errorData.message || `Error del servidor: ${response.status}`);
        }
        return await response.json();
    }

    const originalDisplayConversationMessages = window.displayConversationMessages;
    window.displayConversationMessages = (messages) => {
        if (typeof originalDisplayConversationMessages === 'function') {
            originalDisplayConversationMessages(messages);
        }

        const messageElementsContainer = messageHistoryContainer || document.getElementById('messageHistoryContainer'); // Ensure container is valid
        if (!messageElementsContainer) return;

        const messageElements = messageElementsContainer.querySelectorAll('.message-item.bot-message');
        messageElements.forEach(msgElement => {
            if (msgElement.querySelector('.feedback-open-btn')) return;

            const messageId = msgElement.dataset.messageId;
            const ragLogId = msgElement.dataset.ragLogId;

            if (messageId) {
                const feedbackButton = document.createElement('button');
                feedbackButton.textContent = 'Valorar Respuesta';
                feedbackButton.className = 'feedback-open-btn';
                feedbackButton.style.marginLeft = '10px';
                feedbackButton.style.padding = '3px 8px';
                feedbackButton.style.fontSize = '0.8em';
                feedbackButton.style.cursor = 'pointer';
                feedbackButton.onclick = () => {
                    openInboxFeedbackModal(messageId, ragLogId);
                };

                const messageContentDiv = msgElement.querySelector('.message-content');
                if (messageContentDiv) {
                     messageContentDiv.appendChild(feedbackButton);
                } else {
                     msgElement.appendChild(feedbackButton);
                }
            }
        });
    };

}); // End of DOMContentLoaded
