// widget.js

(async function() {
    // --- Dynamic Client ID Retrieval ---
    const currentScript = document.currentScript;
    const dynamicClientId = currentScript ? currentScript.getAttribute('data-client-id') : null;

    if (!dynamicClientId) {
        console.error("SynChat AI Widget: Critical - 'data-client-id' attribute not found on script tag. Widget cannot initialize.");
        return; // Stop execution
    }

    // --- Configuración del Backend ---
    const VERCEL_BACKEND_BASE_URL = window.SYNCHAT_CONFIG.API_BASE_URL;

    // --- Configuración Inicial del Widget (con valores por defecto) ---
    let WIDGET_CONFIG = {
        clientId: dynamicClientId,
        backendUrl: `${VERCEL_BACKEND_BASE_URL}/api/public-chat`,
        publicConfigUrl: `${VERCEL_BACKEND_BASE_URL}/api/public-chat/widget-config`,
        botName: "SynChat Bot",
        welcomeMessage: "Hello! How can I help you today?",
        inputPlaceholder: "Escribe tu mensaje...",
        triggerLogoUrl: "[https://www.synchatai.com/zoe.png](https://www.synchatai.com/zoe.png)",
        avatarUrl: "[https://www.synchatai.com/zoe.png](https://www.synchatai.com/zoe.png)"
    };

    // --- Función para Cargar Configuración Dinámica del Widget ---
    async function fetchWidgetConfiguration(clientId) {
        const configUrl = `${WIDGET_CONFIG.publicConfigUrl}?clientId=${clientId}`;
        console.log('SynChat AI Widget: Fetching config from:', configUrl);
        try {
            const response = await fetch(configUrl);
            if (!response.ok) {
                console.error(`SynChat AI Widget: Error fetching config. Status: ${response.status}. Using default config.`);
                return null;
            }
            const fetchedConfig = await response.json();
            if (fetchedConfig.error) {
                console.error(`SynChat AI Widget: Error in fetched config: ${fetchedConfig.error}. Using default config.`);
                return null;
            }
            console.log('SynChat AI Widget: Configuration loaded:', fetchedConfig);
            return fetchedConfig;
        } catch (error) {
            console.error('SynChat AI Widget: Exception fetching config:', error, '. Using default config.');
            return null;
        }
    }

    const dynamicData = await fetchWidgetConfiguration(dynamicClientId);
    if (dynamicData) {
        WIDGET_CONFIG.botName = dynamicData.botName || WIDGET_CONFIG.botName;
        WIDGET_CONFIG.welcomeMessage = dynamicData.welcomeMessage || WIDGET_CONFIG.welcomeMessage;
    }

    // --- Variables de Estado ---
    let conversationId = sessionStorage.getItem(`synchat_conversationId_${WIDGET_CONFIG.clientId}`);
    let isChatOpen = false;

    // --- CSS del Widget ---
    const widgetCSS = `
        :root {
            --synchat-primary: #3B4018; --synchat-primary-darker: #2F3314;
            --synchat-secondary: #F5F5DC; --synchat-accent: #B8860B;
            --synchat-accent-hover: #A0740A; --synchat-text-light: #F5F5DC;
            --synchat-text-dark: #333333; --synchat-text-muted-dark: #6c757d;
            --synchat-background-light: #FFFFFF; --synchat-background-alt: #F5F5DC;
            --synchat-border-light: #dee2e6; --synchat-font-primary: 'Poppins', sans-serif;
            --synchat-border-radius: 8px; --synchat-shadow: 0 5px 20px rgba(0, 0, 0, 0.15);
        }
        .synchat-trigger, .synchat-window, .synchat-header, .synchat-messages, .synchat-input-area, #synchat-input, .synchat-send-btn, .synchat-message, .message-content, #requestHumanBtn {
            box-sizing: border-box;
            font-family: var(--synchat-font-primary);
        }
        .synchat-trigger {
            position: fixed; bottom: 25px; right: 25px; width: 60px; height: 60px;
            background-color: var(--synchat-primary); border-radius: 50%;
            box-shadow: var(--synchat-shadow); display: flex; align-items: center;
            justify-content: center; cursor: pointer; z-index: 9999;
            transition: transform 0.2s ease-in-out; border: 2px solid rgba(255, 255, 255, 0.5);
        }
        .synchat-trigger:hover { transform: scale(1.1); }
        .synchat-trigger img { width: 32px; height: auto; }

        .synchat-window {
            position: fixed; bottom: 100px; right: 25px;
            width: 400px;
            max-width: calc(100vw - 30px);
            max-height: 75vh;
            background-color: var(--synchat-background-light);
            border-radius: var(--synchat-border-radius);
            box-shadow: var(--synchat-shadow);
            z-index: 10000; display: none; flex-direction: column;
            overflow: hidden;
            resize: none;
            min-width: 320px;
            min-height: 400px;
            opacity: 0; transform: translateY(10px);
            transition: opacity 0.3s ease, transform 0.3s ease;
        }
        .synchat-window.is-active { display: flex; opacity: 1; transform: translateY(0); }

        .synchat-header { background-color: var(--synchat-primary); color: var(--synchat-text-light); padding: 12px 15px; display: flex; align-items: center; flex-shrink: 0; }
        .zoe-avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 10px; border: 1px solid rgba(245, 245, 220, 0.5); object-fit: cover; }
        .header-title { flex-grow: 1; line-height: 1.3; }
        .zoe-name { display: block; font-size: 1.1rem; font-weight: 600; }
        .powered-by { display: flex; align-items: center; font-size: 0.7rem; opacity: 0.8; margin-top: 2px; }
        .synchat-logo-header { width: 12px; height: auto; margin: 0 4px; }
        .synchat-close-btn { background: none; border: none; color: var(--synchat-text-light); font-size: 2rem; font-weight: 300; cursor: pointer; padding: 0 5px; opacity: 0.7; transition: opacity 0.2s ease; line-height: 1; }
        .synchat-close-btn:hover { opacity: 1; }

        .synchat-messages { flex-grow: 1; overflow-y: auto; padding: 20px 15px; background-color: var(--synchat-background-light); }
        .synchat-message { margin-bottom: 12px; display: flex; max-width: 85%; }
        .message-content { padding: 10px 15px; border-radius: 15px; font-size: 0.95rem; line-height: 1.5; word-wrap: break-word; }
        .synchat-message.bot .message-content { background-color: var(--synchat-background-alt); color: var(--synchat-text-dark); border: 1px solid var(--synchat-border-light); border-bottom-left-radius: 5px; }
        .synchat-message.user .message-content { background-color: var(--synchat-primary); color: var(--synchat-text-light); border-bottom-right-radius: 5px; }
        .synchat-message.user { justify-content: flex-end; margin-left: auto; }
        .synchat-message.system .message-content {
            background-color: #f0f0f0; /* Light grey for system messages */
            color: #555555;
            font-style: italic;
            font-size: 0.85rem;
            text-align: center;
            width: 100%; /* Make system messages take full width for centering */
            max-width: 100%;
            border-radius: 4px;
            padding: 8px 10px;
        }
        .synchat-message.system { justify-content: center; } /* Center system messages */


        .synchat-input-area { display: flex; align-items: flex-end; padding: 10px 15px; border-top: 1px solid var(--synchat-border-light); background-color: #fff; flex-shrink: 0; }
        #synchat-input { flex-grow: 1; border: none; padding: 10px 5px; font-family: var(--synchat-font-primary); font-size: 0.95rem; resize: none; max-height: 100px; overflow-y: auto; outline: none; background: transparent; line-height: 1.4; }
        .synchat-send-btn { background: none; border: none; padding: 8px; margin-left: 10px; cursor: pointer; color: var(--synchat-primary); transition: color 0.2s ease, transform 0.2s ease; align-self: flex-end; margin-bottom: 4px; }
        .synchat-send-btn:hover { color: var(--synchat-accent); transform: scale(1.1); }
        .synchat-send-btn svg { display: block; width: 20px; height: 20px; }

        #requestHumanBtn {
            padding: 8px 10px;
            margin-left: 8px;
            border: 1px solid #ccc;
            background-color: #f0f0f0;
            color: var(--synchat-text-dark);
            cursor: pointer;
            border-radius: var(--synchat-border-radius);
            font-size: 0.85rem;
            align-self: flex-end; /* Align with send button */
            margin-bottom: 4px; /* Align with send button */
            white-space: nowrap; /* Prevent text wrapping */
        }
        #requestHumanBtn:hover { background-color: #e0e0e0; }
        #requestHumanBtn:disabled { background-color: #e9ecef; cursor: not-allowed; opacity: 0.7; }

        #synchat-input:focus-visible, .synchat-close-btn:focus-visible, .synchat-send-btn:focus-visible, .synchat-trigger:focus-visible, #requestHumanBtn:focus-visible {
            outline: 2px solid var(--synchat-accent); outline-offset: 1px; border-radius: 3px; box-shadow: 0 0 0 3px rgba(184, 134, 11, 0.3);
        }
        #synchat-input:focus { outline: none; }
    `;

    // --- Funciones Auxiliares ---
    function addMessageToChat(sender, text, type = 'text') {
        const messagesContainer = document.getElementById('synchat-messages');
        if (!messagesContainer) return;
        const messageDiv = document.createElement('div');
        const messageClass = (type === 'system') ? 'system' : sender;
        messageDiv.classList.add('synchat-message', messageClass);

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        contentDiv.textContent = text; // Using textContent for security
        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function toggleChatWindow() {
        const windowEl = document.getElementById('synchat-window');
        const triggerEl = document.getElementById('synchat-trigger');
        if (windowEl && triggerEl) {
            isChatOpen = !isChatOpen;
            windowEl.classList.toggle('is-active');
            triggerEl.style.display = isChatOpen ? 'none' : 'flex';
            if (isChatOpen && !conversationId) {
                startNewConversation();
            } else if (isChatOpen) {
                 const input = document.getElementById('synchat-input');
                 if(input) setTimeout(() => input.focus(), 50);
            }
        }
    }

    // --- Funciones API ---
    async function startNewConversation() {
        console.log("Iniciando nueva conversación...");
        const messagesContainer = document.getElementById('synchat-messages');
        if(messagesContainer) messagesContainer.innerHTML = '';
        conversationId = null;
        sessionStorage.removeItem(`synchat_conversationId_${WIDGET_CONFIG.clientId}`);

        const startUrl = `${WIDGET_CONFIG.backendUrl}/start`;
        console.log('SynChat AI Widget: Calling start conversation endpoint:', startUrl);
        try {
            const response = await fetch(startUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: WIDGET_CONFIG.clientId })
            });
            if (!response.ok) throw new Error(`Error del servidor al iniciar: ${response.status} - ${await response.text()}`);
            const data = await response.json();
            if (data.conversationId) {
                conversationId = data.conversationId;
                sessionStorage.setItem(`synchat_conversationId_${WIDGET_CONFIG.clientId}`, conversationId);
                console.log("Nueva conversación iniciada:", conversationId);
                 addMessageToChat("bot", WIDGET_CONFIG.welcomeMessage);
                 const input = document.getElementById('synchat-input');
                 if(input) input.focus();
            } else { throw new Error("No se recibió conversationId del backend."); }
        } catch (error) {
            console.error("Error al iniciar conversación:", error);
            addMessageToChat("bot", "Lo siento, hubo un problema al iniciar el chat. Inténtalo de nuevo más tarde.", "system");
        }
    }

    async function sendMessage(text, intent = null) {
        if (!text.trim() && !intent) return;
        if (!conversationId && intent !== 'request_human_escalation') { // Don't start new conv if it's an escalation on non-existent conv
            await startNewConversation();
            if (!conversationId) {
                addMessageToChat("bot", "Error crítico: No se pudo establecer una sesión de chat.", "system");
                return;
            }
        }

        // Only display user message if it's not a system-generated message for escalation
        if (intent !== 'request_human_escalation' && text.trim()) {
             addMessageToChat("user", text);
        }

        const input = document.getElementById('synchat-input');
        if(input && intent !== 'request_human_escalation') { // Don't clear input if it was an escalation click
            input.value = '';
            input.style.height = 'auto';
        }

        const messageUrl = `${WIDGET_CONFIG.backendUrl}/message`;
        const payload = {
            message: text, // For escalation, this is "El usuario solicita..."
            conversationId: conversationId,
            clientId: WIDGET_CONFIG.clientId
        };
        if (intent) {
            payload.intent = intent;
        }

        console.log('SynChat AI Widget: Calling message endpoint:', messageUrl, 'with payload:', payload);

        try {
            const response = await fetch(messageUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                 let errorDetail = 'Error desconocido';
                 try { const errorDataJson = await response.json(); errorDetail = errorDataJson.error || errorDataJson.message || await response.text(); }
                 catch(e) { errorDetail = await response.text(); }
                 throw new Error(`Error del servidor: ${response.status} - ${errorDetail}`);
            }
            const data = await response.json();

            if (data.status === "escalation_requested") {
                addMessageToChat("bot", data.reply, "system");
                const reqHumanBtn = document.getElementById('requestHumanBtn');
                if (reqHumanBtn) {
                    reqHumanBtn.textContent = 'Solicitud Enviada';
                    reqHumanBtn.disabled = true;
                }
            } else if (data.reply) {
                addMessageToChat("bot", data.reply);
            } else {
                throw new Error("No se recibió respuesta válida del backend.");
            }
        } catch (error) {
            console.error("Error al enviar mensaje:", error);
            addMessageToChat("bot", `Lo siento, hubo un problema al procesar tu mensaje.`, "system");
        }
    }

    // --- User-Initiated Escalation Function ---
    async function handleRequestHumanEscalation() {
        const currentConvId = conversationId;
        const currentClientIdVal = WIDGET_CONFIG.clientId;
        const requestHumanBtn = document.getElementById('requestHumanBtn');

        if (!currentConvId) { // Check if conversation exists
            addMessageToChat('bot', 'Por favor, inicie una conversación antes de solicitar un agente.', 'system');
            // Optionally, attempt to start a conversation first
            // await startNewConversation();
            // if (!conversationId) return; // Exit if still no conversationId
            // For now, just inform and return.
            return;
        }

        if (!currentClientIdVal) { // Should always be set if widget initialized
            addMessageToChat('bot', 'Error: Client ID no configurado. No se puede solicitar agente.', 'system');
            console.error('Escalation request failed: ClientID missing in WIDGET_CONFIG.');
            return;
        }

        if (requestHumanBtn) {
            requestHumanBtn.disabled = true;
            requestHumanBtn.textContent = 'Solicitando...';
        }

        // Use the modified sendMessage function with the specific intent
        await sendMessage("El usuario solicita hablar con un agente humano.", "request_human_escalation");

        // The sendMessage function now handles displaying the response and updating the button
        // based on `data.status === "escalation_requested"`.
        // If the request fails inside sendMessage, it will call addMessageToChat with an error
        // and re-enable the button if it's a general error.
        // If it was successful escalation, sendMessage already updated the button.
        // If it failed with an error, we may need to re-enable the button here if sendMessage doesn't.
        // For now, let's assume sendMessage handles button state on its own errors.
        // If the escalation-specific error handling within sendMessage isn't enough,
        // we might need to check response here or have sendMessage throw specific errors.

        // Fallback to re-enable button if it's still in "Solicitando..." state after some time (e.g. network error not caught by sendMessage)
        // This is a bit of a failsafe, ideally sendMessage handles its own errors and button states.
        setTimeout(() => {
            if (requestHumanBtn && requestHumanBtn.textContent === 'Solicitando...') {
                requestHumanBtn.disabled = false;
                requestHumanBtn.textContent = 'Hablar con Humano';
                addMessageToChat('bot', 'La solicitud de agente no pudo ser confirmada. Intente de nuevo.', 'system');
            }
        }, 7000); // 7 seconds timeout for this failsafe
    }

    // --- Creación del Widget en el DOM ---
    function createWidget() {
        if (document.getElementById('synchat-trigger')) return;

        const styleTag = document.createElement('style');
        styleTag.id = 'synchat-styles';
        styleTag.textContent = widgetCSS;
        document.head.appendChild(styleTag);

        const trigger = document.createElement('div');
        trigger.id = 'synchat-trigger';
        trigger.classList.add('synchat-trigger');
        trigger.setAttribute('role', 'button');
        trigger.setAttribute('tabindex', '0');
        trigger.setAttribute('aria-label', 'Abrir chat de ayuda');
        trigger.innerHTML = `<img src="${WIDGET_CONFIG.triggerLogoUrl}" alt="Abrir Chat SynChat AI">`;
        trigger.addEventListener('click', toggleChatWindow);
        trigger.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChatWindow(); } });
        document.body.appendChild(trigger);

        const windowEl = document.createElement('div');
        windowEl.id = 'synchat-window';
        windowEl.classList.add('synchat-window');
        // Added a placeholder for the escalation button in the input area's HTML structure for clarity
        windowEl.innerHTML = `
            <div class="synchat-header">
                <img src="${WIDGET_CONFIG.avatarUrl}" alt="Avatar de ${WIDGET_CONFIG.botName}" class="zoe-avatar">
                <div class="header-title">
                    <span class="zoe-name">${WIDGET_CONFIG.botName}</span>
                    <span class="powered-by"> Potenciado por <img src="${WIDGET_CONFIG.triggerLogoUrl}" alt="SynChat AI" class="synchat-logo-header"> SynChat AI </span>
                </div>
                <button id="synchat-close-btn" class="synchat-close-btn" aria-label="Cerrar Chat">&times;</button>
            </div>
            <div id="synchat-messages" class="synchat-messages" aria-live="polite"></div>
            <div id="synchat-input-area" class="synchat-input-area">
                <textarea id="synchat-input" placeholder="${WIDGET_CONFIG.inputPlaceholder}" rows="1" aria-label="Escribe tu mensaje"></textarea>
                <button id="synchat-send-btn" class="synchat-send-btn" aria-label="Enviar Mensaje">
                    <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                </button>
                </div>
        `;
        document.body.appendChild(windowEl);

        const closeButton = document.getElementById('synchat-close-btn');
        const sendButton = document.getElementById('synchat-send-btn');
        const inputField = document.getElementById('synchat-input');
        const inputArea = document.getElementById('synchat-input-area'); // Get the input area by ID

        if(closeButton) {
          closeButton.addEventListener('click', toggleChatWindow);
          closeButton.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChatWindow(); } });
        }

        function handleSend() {
            if(inputField && inputField.value) {
                sendMessage(inputField.value.trim()); // Pass the trimmed value
            }
        }

        if(sendButton) {
          sendButton.addEventListener('click', handleSend);
          sendButton.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSend(); } });
        }

        if(inputField) {
             inputField.addEventListener('keypress', (e) => {
                 if (e.key === 'Enter' && !e.shiftKey) {
                     e.preventDefault();
                     handleSend();
                 }
             });
             inputField.addEventListener('input', () => {
                 inputField.style.height = 'auto';
                 const maxHeight = 100;
                 const scrollHeight = inputField.scrollHeight;
                 inputField.style.height = Math.min(scrollHeight, maxHeight) + 'px';
             });
        }

        // Create and append the "Hablar con Humano" button
        if (inputArea) {
            const requestHumanBtn = document.createElement('button');
            requestHumanBtn.id = 'requestHumanBtn';
            requestHumanBtn.title = 'Solicitar hablar con un agente';
            requestHumanBtn.textContent = 'Hablar con Humano';
            // Basic styling is applied via CSS block using #requestHumanBtn ID
            inputArea.appendChild(requestHumanBtn); // Append to the input area
            requestHumanBtn.addEventListener('click', handleRequestHumanEscalation);
        } else {
            console.warn("SynChat AI Widget: '#synchat-input-area' not found. Cannot append escalation button.");
        }
    }

    // --- Inicialización del Widget ---
    createWidget();

})();
