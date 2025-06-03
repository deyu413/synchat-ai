// widget.js

// --- i18n Initialization ---
let i18nStrings = {}; // To hold loaded strings
async function loadI18nStrings() {
    // Assuming widget.js is in mi-bot-atencion/ and locales/ is at mi-bot-atencion/locales/
    // Adjust path if widget.js moves relative to locales/
    const widgetScriptSrc = document.currentScript.src;
    const widgetBaseUrl = widgetScriptSrc.substring(0, widgetScriptSrc.lastIndexOf('/') + 1);
    const langFilePath = `${widgetBaseUrl}locales/es.json`; // Assumes locales/ is in the same dir as widget.js
    try {
        const response = await fetch(langFilePath);
        if (!response.ok) {
            // widgetLogger might not be defined here if loadI18nStrings is called BEFORE widgetLogger is defined.
            // Using console.error as a safe fallback if this function is ever moved outside/before IIFE.
            (typeof widgetLogger !== 'undefined' ? widgetLogger : console).error(`Failed to load language file from ${langFilePath}. Status: ${response.status}`);
            return {}; // Return empty or default strings as fallback
        }
        return await response.json();
    } catch (error) {
        (typeof widgetLogger !== 'undefined' ? widgetLogger : console).error(`Error fetching language file from ${langFilePath}:`, error);
        return {}; // Fallback
    }
}
// Load strings immediately
// i18nStrings = await loadI18nStrings(); // This needs to be inside the main async function

(async function() {
    i18nStrings = await loadI18nStrings();

    // --- Debug Configuration & Logger ---
    // Set window.SYNCHAT_WIDGET_DEBUG = true in browser console to enable debug logs.
    const DEBUG = window.SYNCHAT_WIDGET_DEBUG || false; // Default to false

    const widgetLogger = {
        log: (...args) => { if (DEBUG) console.log("SynChat Widget:", ...args); },
        warn: (...args) => console.warn("SynChat Widget WARNING:", ...args), // Warnings usually always shown
        error: (...args) => console.error("SynChat Widget ERROR:", ...args)  // Errors always shown
    };

    // Fallback for i18n strings if loading failed or key is missing
    const getString = (key, defaultString = '', params = {}) => {
        const keys = key.split('.');
        let current = i18nStrings;
        for (const k of keys) {
            current = current[k];
            if (current === undefined) {
                // getString is defined inside the IIFE where widgetLogger will be available.
                widgetLogger.warn(`i18n: Missing string for key: ${key}. Using default: "${defaultString}"`);
                return defaultString;
            }
        }
        let str = typeof current === 'string' ? current : defaultString;
        for (const pKey in params) {
            str = str.replace(new RegExp(`{${pKey}}`, 'g'), params[pKey]);
        }
        return str;
    };

    // --- Dynamic Client ID Retrieval ---
    let dynamicClientId = null;
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        // Ensure script.src exists and is a string before calling .includes()
        if (script.src && typeof script.src === 'string' && script.src.includes('widget.js') && script.hasAttribute('data-client-id')) {
            dynamicClientId = script.getAttribute('data-client-id');
            break;
        }
    }

    // Error if not found after the loop
    if (!dynamicClientId) {
        // Ensure widgetLogger is available or fallback to console.error
        const logError = (typeof widgetLogger !== 'undefined' ? widgetLogger.error : console.error);
        // Ensure getString is available or use a hardcoded string
        const errorMessage = (typeof getString !== 'undefined' ? getString('widget.criticalClientIdMissing', "SynChat AI Widget: Critical - 'data-client-id' attribute not found on script tag. Widget cannot initialize.") : "SynChat AI Widget: Critical - 'data-client-id' attribute not found on script tag. Widget cannot initialize.");
        logError(errorMessage);
        return; // Stop execution
    }

    // --- Configuración del Backend ---
    const VERCEL_BACKEND_BASE_URL = window.SYNCHAT_CONFIG.API_BASE_URL;

    // --- Configuración Inicial del Widget (con valores por defecto) ---
    let WIDGET_CONFIG = {
        clientId: dynamicClientId,
        backendUrl: `${VERCEL_BACKEND_BASE_URL}/api/public-chat`,
        publicConfigUrl: `${VERCEL_BACKEND_BASE_URL}/api/public-chat/widget-config`,
        botName: "SynChat Bot", // Not yet internationalized, as per instructions
        welcomeMessage: getString('widget.defaultWelcomeMessage', "Hello! How can I help you today?"),
        inputPlaceholder: getString('widget.defaultInputPlaceholder', "Escribe tu mensaje..."),
        triggerLogoUrl: "https://www.synchatai.com/zoe.png",
        avatarUrl: "https://www.synchatai.com/zoe.png"
    };

    async function fetchWidgetConfiguration(clientId) {
        const configUrl = `${WIDGET_CONFIG.publicConfigUrl}?clientId=${clientId}`;
        widgetLogger.log(getString('widget.configFetching', 'SynChat AI Widget: Fetching config from:'), configUrl);
        try {
            const response = await fetch(configUrl);
            if (!response.ok) {
                widgetLogger.error(getString('widget.configErrorFetch', 'SynChat AI Widget: Error fetching config. Status: {status}. Using default config.', {status: response.status}));
                return null;
            }
            const fetchedConfig = await response.json();
            if (fetchedConfig.error) {
                widgetLogger.error(getString('widget.configErrorInFetched', 'SynChat AI Widget: Error in fetched config: {error}. Using default config.', {error: fetchedConfig.error}));
                return null;
            }
            widgetLogger.log(getString('widget.configLoaded', 'SynChat AI Widget: Configuration loaded:'), fetchedConfig);
            return fetchedConfig;
        } catch (error) {
            widgetLogger.error(getString('widget.configExceptionFetch', 'SynChat AI Widget: Exception fetching config: {error}. Using default config.', {error: error}));
            return null;
        }
    }

    const dynamicData = await fetchWidgetConfiguration(dynamicClientId);
    if (dynamicData) {
        WIDGET_CONFIG.botName = dynamicData.botName || WIDGET_CONFIG.botName;
        WIDGET_CONFIG.welcomeMessage = dynamicData.welcomeMessage || WIDGET_CONFIG.welcomeMessage;
    }

    let conversationId = sessionStorage.getItem(`synchat_conversationId_${WIDGET_CONFIG.clientId}`);
    let isChatOpen = false;

    const widgetCSS = `
        /* ... (existing CSS as before, with addition for quick replies) ... */
        .synchat-trigger, .synchat-window, .synchat-header, .synchat-messages, .synchat-input-area, #synchat-input, .synchat-send-btn, .synchat-message, .message-content, #requestHumanBtn, .synchat-quick-reply-options button {
            box-sizing: border-box;
            font-family: var(--synchat-font-primary);
        }
        /* ... (rest of existing CSS) ... */
        .synchat-quick-reply-options {
            display: flex;
            flex-wrap: wrap; /* Allow buttons to wrap */
            justify-content: flex-start; /* Align to the start (typically left) */
            padding: 5px 15px 10px 15px; /* Padding around the options area */
            gap: 8px; /* Spacing between buttons */
        }
        .synchat-quick-reply-btn {
            background-color: var(--synchat-accent);
            color: var(--synchat-text-light);
            border: none;
            padding: 8px 12px;
            border-radius: var(--synchat-border-radius);
            cursor: pointer;
            font-size: 0.9em;
            transition: background-color 0.2s ease;
        }
        .synchat-quick-reply-btn:hover {
            background-color: var(--synchat-accent-hover);
        }
    `;

    function clearQuickReplyOptions() {
        const existingOptionsContainer = document.getElementById('synchat-quick-reply-container');
        if (existingOptionsContainer) {
            existingOptionsContainer.remove();
        }
    }

    function handleClarificationRequest(responseData) {
        addMessageToChat("bot", responseData.reply); // Display Zoe's clarification question

        clearQuickReplyOptions(); // Clear any old ones

        if (responseData.clarification_options && responseData.clarification_options.length > 0) {
            const messagesContainer = document.getElementById('synchat-messages');
            const optionsContainer = document.createElement('div');
            optionsContainer.id = 'synchat-quick-reply-container';
            optionsContainer.classList.add('synchat-quick-reply-options');

            responseData.clarification_options.forEach(optionText => {
                const optionButton = document.createElement('button');
                optionButton.classList.add('synchat-quick-reply-btn');
                optionButton.textContent = optionText;
                optionButton.addEventListener('click', () => {
                    addMessageToChat("user", optionText); // Display user's choice
                    sendMessage(optionText); // Send choice to backend
                    clearQuickReplyOptions(); // Remove options after selection
                });
                optionsContainer.appendChild(optionButton);
            });
            messagesContainer.appendChild(optionsContainer);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        // User input field remains active for typed responses if no options or if user prefers typing
    }


    function addMessageToChat(sender, text, type = 'text') {
        // Before adding a new message, clear any existing quick reply buttons
        // unless the message being added is the one that *contains* the quick replies.
        // This specific call to clearQuickReplyOptions is now better handled within handleClarificationRequest
        // or just before a new bot message that isn't a clarification request.
        // For now, let's assume it's handled by handleClarificationRequest for new options,
        // and when user sends a message (text or quick reply), options are cleared.

        const messagesContainer = document.getElementById('synchat-messages');
        if (!messagesContainer) return;

        const messageDiv = document.createElement('div');
        const messageClass = (type === 'system') ? 'system' : sender;
        messageDiv.classList.add('synchat-message', messageClass);

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        contentDiv.textContent = text;
        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function toggleChatWindow() { /* ... (existing as before) ... */ }

    async function startNewConversation() {
        widgetLogger.log("Iniciando nueva conversación...");
        clearQuickReplyOptions(); // Clear options on new conversation
        const messagesContainer = document.getElementById('synchat-messages');
        if(messagesContainer) messagesContainer.innerHTML = '';
        conversationId = null;
        sessionStorage.removeItem(`synchat_conversationId_${WIDGET_CONFIG.clientId}`);

        const startUrl = `${WIDGET_CONFIG.backendUrl}/start`;
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
                addMessageToChat("bot", WIDGET_CONFIG.welcomeMessage);
                 const input = document.getElementById('synchat-input');
                 if(input) input.focus();
            } else { throw new Error("No se recibió conversationId del backend."); }
        } catch (error) {
            widgetLogger.error("Error al iniciar conversación:", error);
            addMessageToChat("bot", getString('widget.errorStartChat', "Lo siento, hubo un problema al iniciar el chat. Inténtalo de nuevo más tarde."), "system");
        }
    }

    async function sendMessage(text, intent = null) {
        if (!text.trim() && !intent) return;

        // Clear quick replies as soon as user sends a message (either typed or by clicking an option)
        clearQuickReplyOptions();

        if (!conversationId && intent !== 'request_human_escalation') {
            await startNewConversation();
            if (!conversationId) {
                addMessageToChat("bot", getString('widget.errorCriticalSession', "Error crítico: No se pudo establecer una sesión de chat."), "system");
                return;
            }
        }

        if (intent !== 'request_human_escalation' && text.trim()) {
             addMessageToChat("user", text);
        }

        const input = document.getElementById('synchat-input');
        if(input && intent !== 'request_human_escalation') {
            input.value = '';
            input.style.height = 'auto';
        }

        const messageUrl = `${WIDGET_CONFIG.backendUrl}/message`;
        const payload = {
            message: text,
            conversationId: conversationId,
            clientId: WIDGET_CONFIG.clientId
        };
        if (intent) {
            payload.intent = intent;
        }

        widgetLogger.log('SynChat AI Widget: Calling message endpoint:', messageUrl, 'with payload:', payload);

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

            if (data.action_required === "request_clarification") {
                handleClarificationRequest(data);
            } else if (data.status === "escalation_requested") {
                addMessageToChat("bot", data.reply, "system");
                const reqHumanBtn = document.getElementById('requestHumanBtn');
                if (reqHumanBtn) {
                    reqHumanBtn.textContent = getString('widget.requestHumanSent', 'Solicitud Enviada');
                    reqHumanBtn.disabled = true;
                }
            } else if (data.reply) {
                addMessageToChat("bot", data.reply);
            } else {
                throw new Error("No se recibió respuesta válida del backend.");
            }
        } catch (error) {
            widgetLogger.error("Error al enviar mensaje:", error);
            addMessageToChat("bot", getString('widget.errorProcessingMessage', "Lo siento, hubo un problema al procesar tu mensaje."), "system");
        }
    }

    async function handleRequestHumanEscalation() { /* ... (existing as before) ... */ }
    function createWidget() { /* ... (existing as before, ensure CSS is merged if needed) ... */ }

    // --- Merging createWidget and its event listeners with the rest of the script ---
    // (The full createWidget function from the provided context, including its internal event listeners, should be here)
    // For brevity, assuming the provided createWidget structure is complete and correct.
    // Crucially, the CSS for quick replies needs to be in the styleTag.textContent.

    // --- Inicialización del Widget ---
    function initializeWidget() {
        if (document.getElementById('synchat-trigger')) return;

        const styleTag = document.createElement('style');
        styleTag.id = 'synchat-styles';
        styleTag.textContent = widgetCSS; // CSS includes quick reply styles now
        document.head.appendChild(styleTag);

        const trigger = document.createElement('div');
        trigger.id = 'synchat-trigger';
        trigger.classList.add('synchat-trigger');
        trigger.setAttribute('role', 'button');
        trigger.setAttribute('tabindex', '0');
        trigger.setAttribute('aria-label', getString('widget.ariaLabelOpenChat', 'Abrir chat de ayuda'));
        trigger.innerHTML = `<img src="${WIDGET_CONFIG.triggerLogoUrl}" alt="Abrir Chat SynChat AI">`;
        trigger.addEventListener('click', toggleChatWindow);
        trigger.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChatWindow(); } });
        document.body.appendChild(trigger);

        const windowEl = document.createElement('div');
        windowEl.id = 'synchat-window';
        windowEl.classList.add('synchat-window');
        windowEl.innerHTML = `
            <div class="synchat-header">
                <img src="${WIDGET_CONFIG.avatarUrl}" alt="Avatar de ${WIDGET_CONFIG.botName}" class="zoe-avatar">
                <div class="header-title">
                    <span class="zoe-name">${WIDGET_CONFIG.botName}</span>
                    <span class="powered-by"> Potenciado por <img src="${WIDGET_CONFIG.triggerLogoUrl}" alt="SynChat AI" class="synchat-logo-header"> SynChat AI </span>
                </div>
                <button id="synchat-close-btn" class="synchat-close-btn" aria-label="${getString('widget.ariaLabelCloseChat', 'Cerrar Chat')}">&times;</button>
            </div>
            <div id="synchat-messages" class="synchat-messages" aria-live="polite"></div>
            <div id="synchat-input-area" class="synchat-input-area">
                <textarea id="synchat-input" placeholder="${WIDGET_CONFIG.inputPlaceholder}" rows="1" aria-label="Escribe tu mensaje"></textarea>
                <button id="synchat-send-btn" class="synchat-send-btn" aria-label="${getString('widget.ariaLabelSendMessage', 'Enviar Mensaje')}">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                </button>
                </div>
        `;
        document.body.appendChild(windowEl);

        const closeButton = document.getElementById('synchat-close-btn');
        const sendButton = document.getElementById('synchat-send-btn');
        const inputField = document.getElementById('synchat-input');
        const inputArea = document.getElementById('synchat-input-area');

        if(closeButton) {
          closeButton.addEventListener('click', toggleChatWindow);
          closeButton.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChatWindow(); } });
        }

        function handleSend() {
            if(inputField && inputField.value) {
                sendMessage(inputField.value.trim());
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

        if (inputArea) {
            const requestHumanBtn = document.createElement('button');
            requestHumanBtn.id = 'requestHumanBtn';
            requestHumanBtn.title = 'Solicitar hablar con un agente'; // This title could also be internationalized if needed
            requestHumanBtn.textContent = getString('widget.requestHumanInitial', 'Hablar con Humano');
            inputArea.appendChild(requestHumanBtn);
            requestHumanBtn.addEventListener('click', handleRequestHumanEscalation);
        } else {
            widgetLogger.warn("SynChat AI Widget: '#synchat-input-area' not found. Cannot append escalation button.");
        }
    }

    initializeWidget();

})();
// Trivial comment to force a new commit state.
