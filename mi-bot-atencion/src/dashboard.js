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
            const queryText = playgroundQueryInput.value.trim();
            if (!queryText) {
                playgroundStatusMessage.textContent = 'Por favor, ingresa una consulta.';
                playgroundStatusMessage.className = 'status-message error';
                return;
            }

            playgroundStatusMessage.textContent = 'Procesando consulta...';
            playgroundStatusMessage.className = 'status-message loading'; // Assuming 'loading' class styles this
            playgroundResultsContainer.innerHTML = ''; // Clear previous results

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
                displayPlaygroundResults(data); // This function will render the results
                playgroundStatusMessage.textContent = 'Consulta completada.';
                playgroundStatusMessage.className = 'status-message success'; // Assuming 'success' class
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
        ul.style.listStyleType = 'disc'; // Or 'none' if preferred
        ul.style.paddingLeft = '20px';
        items.forEach(item => {
            const li = document.createElement('li');
            li.style.marginBottom = '10px';
            li.innerHTML = itemRenderer(item); // itemRenderer should return HTML string
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
        // details.open = true; // Uncomment to open sections by default
        return details;
    }

    function displayPlaygroundResults(data) {
        playgroundResultsContainer.innerHTML = ''; // Clear previous

        if (!data) {
            playgroundResultsContainer.innerHTML = "<p>No se recibieron datos del pipeline.</p>";
            return;
        }

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

        // Section 2: Detalles por Consulta Procesada (Incluye Preprocesamiento, Mejoras y Embeddings)
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 2: Detalles por Consulta Procesada (Preproc., HyDE, Reform.)', (div) => {
            if (data.processedQueries && data.processedQueries.length > 0) {
                data.processedQueries.forEach(pq => {
                    const pqDiv = document.createElement('div');
                    pqDiv.style.marginBottom = '15px';
                    pqDiv.style.paddingBottom = '10px';
                    pqDiv.style.borderBottom = '1px dashed #eee';
                    let content = `<h5>Para Consulta: "${safeText(pq.queryIdentifier)}"</h5>
                                   <p><strong>Salida de Preprocesamiento:</strong> ${safeText(pq.preprocessingOutput)}</p>
                                   <h6>Mejoras Aplicadas (Embeddings Generados):</h6>`;
                    content += renderList(pq.enhancements, item => `
                        <strong>Tipo:</strong> ${safeText(item.type)}<br/>
                        ${item.type !== "Original_Query_Embedding" ? `<em>Texto Generado:</em> ${safeText(item.generatedText || item.generatedTextOrIdentifier)}<br/>` : ''}
                        <em>Identificador para Embedding:</em> ${safeText(item.type === "Original_Query_Embedding" ? item.generatedTextOrIdentifier : item.query)}<br/>
                        <strong>Embedding:</strong> ${safeText(item.embeddingVectorPreview)}
                    `);
                    pqDiv.innerHTML = content;
                    div.appendChild(pqDiv);
                });
            } else {
                div.innerHTML = "<p>No hay detalles de consultas procesadas.</p>";
            }
        }, data));

        // Section 3: Recuperación Inicial Agregada
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 3: Recuperación Inicial Agregada (Vectorial y FTS)', (div) => {
            let content = '<h4>Resultados Únicos de Búsqueda Vectorial (Agregados):</h4>';
            content += renderList(data.aggregatedResults?.uniqueVectorResultsPreview, item => `
                <strong>ID:</strong> ${safeText(item.id)} | <strong>Score:</strong> ${safeText(item.score?.toFixed(4))}<br/>
                <em>Snippet:</em> ${safeText(item.contentSnippet)}
            `);
            content += '<h4>Resultados Únicos de Búsqueda FTS (Agregados):</h4>';
            content += renderList(data.aggregatedResults?.uniqueFtsResultsPreview, item => `
                <strong>ID:</strong> ${safeText(item.id)} | <strong>Score (Rank):</strong> ${safeText(item.score?.toFixed(4))}<br/>
                <em>Snippet:</em> ${safeText(item.contentSnippet)}
            `);
            div.innerHTML = content;
        }, data));

        // Section 4: Fusión y Pre-Clasificación
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 4: Fusión y Pre-Clasificación de Resultados (Hybrid Score)', (div) => {
            div.innerHTML = renderList(data.mergedAndPreRankedResultsPreview, item => `
                <strong>ID:</strong> ${safeText(item.id)} | <strong>Hybrid Score Inicial:</strong> ${safeText(item.initialHybridScore?.toFixed(4))}<br/>
                (Vector Sim: ${safeText(item.vectorSimilarity?.toFixed(4))}, FTS Score: ${safeText(item.ftsScore?.toFixed(4))})<br/>
                <em>Snippet:</em> ${safeText(item.contentSnippet)}<br/>
                <em>Metadata:</em> <pre>${safeText(JSON.stringify(item.metadata, null, 2))}</pre>
            `);
        }, data));

        // Section 5: Re-clasificación con Cross-Encoder
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 5: Re-clasificación con Cross-Encoder', (div) => {
            let contentHtml = '<h4>Documentos Enviados al Cross-Encoder (Top K):</h4>';
            contentHtml += renderList(data.crossEncoderProcessing?.inputs, item => `
                <strong>Consulta (Original):</strong> ${safeText(item.query)}<br/>
                <strong>Documento Snippet:</strong> ${safeText(item.documentContentSnippet)}
            `);
            contentHtml += '<h4>Resultados del Cross-Encoder:</h4>';
            contentHtml += renderList(data.crossEncoderProcessing?.outputs, item => `
                <strong>ID:</strong> ${safeText(item.id)}<br/>
                <em>Snippet:</em> ${safeText(item.contentSnippet)}<br/>
                <strong>Score Raw:</strong> ${safeText(item.rawScore?.toFixed(4))} | <strong>Score Normalizado (Sigmoid):</strong> ${safeText(item.normalizedScore?.toFixed(4))}
            `);
            div.innerHTML = contentHtml;
        }, data));

        // Section 6: Resultados Finales Clasificados (después de todos los re-rankings)
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 6: Resultados Finales Clasificados (Post-Re-ranking Total)', (div) => {
            div.innerHTML = renderList(data.finalRankedResultsForPlayground, item => `
                <strong>ID:</strong> ${safeText(item.id)} | <strong>Score Final Re-clasificado:</strong> ${safeText(item.reranked_score?.toFixed(4))}<br/>
                <em>Scores Detallados:</em> Hybrid=${safeText(item.hybrid_score?.toFixed(4))}, Keyword=${safeText(item.keywordMatchScore?.toFixed(4))}, Metadata=${safeText(item.metadataRelevanceScore?.toFixed(4))}, CrossEncoderNorm=${safeText(item.cross_encoder_score_normalized?.toFixed(4))}<br/>
                <em>Snippet:</em> ${safeText(item.contentSnippet)}<br/>
                <em>Metadata:</em> <pre>${safeText(JSON.stringify(item.metadata, null, 2))}</pre>
            `);
        }, data));

        // Section 7: Contextualización LLM (Filtrado y Resumen)
        if (data.llmContextualization) {
            playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 7: Contextualización con LLM (Filtrado y Resumen)', (div) => {
                let contentHtml = '<h4>Acciones de Filtrado LLM:</h4>';
                contentHtml += renderList(data.llmContextualization.llmFilteringActions, item => `
                    <strong>ID Chunk:</strong> ${safeText(item.chunkId)}<br/>
                    <em>Snippet Original:</em> ${safeText(item.originalContentPreview)}<br/>
                    <strong>Decisión:</strong> ${safeText(item.decision)}
                `);
                contentHtml += '<h4>Acciones de Resumen/Extracción LLM:</h4>';
                contentHtml += renderList(data.llmContextualization.llmSummarizationActions, item => `
                    <strong>ID Chunk:</strong> ${safeText(item.chunkId)}<br/>
                    <em>Snippet Original:</em> ${safeText(item.originalContentPreview)}<br/>
                    <em>Snippet Resumido/Extraído:</em> ${safeText(item.summarizedContentPreview)}<br/>
                    <strong>Acción Tomada:</strong> ${safeText(item.actionTaken)}
                `);
                div.innerHTML = contentHtml;
            }, data));

            // Section 8: Contexto Final para LLM Principal
            playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 8: Contexto Final para LLM Principal', (div) => {
                div.innerHTML = `<pre>${safeText(data.llmContextualization.finalLLMContextString)}</pre>`;
            }, data));
        }

        // Section 9: Búsqueda de Proposiciones Final
        playgroundResultsContainer.appendChild(createPlaygroundSection('Paso 9: Búsqueda de Proposiciones (usando embedding de consulta principal)', (div) => {
            div.innerHTML = renderList(data.finalPropositionResults, item => `
                <strong>ID Proposición:</strong> ${safeText(item.propositionId)} | <strong>Score:</strong> ${safeText(item.score?.toFixed(4))}<br/>
                <em>Texto:</em> ${safeText(item.text)}<br/>
                <em>ID Chunk Padre:</em> ${safeText(item.sourceChunkId)}
            `);
        }, data));

        // Open all details sections by default for the playground
        playgroundResultsContainer.querySelectorAll('details').forEach(detailsElement => {
            detailsElement.open = true;
        });
    }

    // Make sure other event listeners and functions are below or structured appropriately
    // Example: loadAnalyticsData, loadConversationsForInbox, etc.
    // ... (rest of the existing dashboard.js code) ...
    async function loadAnalyticsData() {
        if (!analyticsSection || analyticsSection.style.display === 'none') return; // Only load if section is active
        analyticsLoadingMessage.style.display = 'block';
        try {
            const period = analyticsPeriodSelector.value;
            // TODO: Implement custom date range if needed. For now, period is enough.
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

            // Fetch unanswered queries
            const unansweredResponse = await fetch(`${API_BASE_URL}/api/client/me/analytics/suggestions/unanswered?period=${period}&limit=10`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!unansweredResponse.ok) throw new Error('Failed to fetch unanswered queries');
            const unanswered = await unansweredResponse.json();
            unansweredQueriesList.innerHTML = ''; // Clear previous
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
    if (refreshAnalyticsBtn) {
      refreshAnalyticsBtn.addEventListener('click', loadAnalyticsData);
    }
    if (analyticsPeriodSelector) {
      analyticsPeriodSelector.addEventListener('change', loadAnalyticsData);
    }
    // ... (rest of the existing dashboard.js code, including inbox functions etc.) ...

}); // End of DOMContentLoaded
