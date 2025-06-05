// mi-bot-atencion/widget.js

// --- i18n Initialization ---
let i18nStrings = {};
async function loadI18nStrings() {
    const widgetScriptSrc = document.currentScript.src;
    const widgetBaseUrl = widgetScriptSrc.substring(0, widgetScriptSrc.lastIndexOf('/') + 1);
    const langFilePath = `${widgetBaseUrl}locales/es.json`;
    try {
        const response = await fetch(langFilePath);
        if (!response.ok) {
            (typeof widgetLogger !== 'undefined' ? widgetLogger : console).error(`Failed to load language file from ${langFilePath}. Status: ${response.status}`);
            return {};
        }
        return await response.json();
    } catch (error) {
        (typeof widgetLogger !== 'undefined' ? widgetLogger : console).error(`Error fetching language file from ${langFilePath}:`, error);
        return {};
    }
}

(async function() {
    i18nStrings = await loadI18nStrings();

    const DEBUG = window.SYNCHAT_WIDGET_DEBUG || false;
    const widgetLogger = {
        log: (...args) => { if (DEBUG) console.log("SynChat Widget:", ...args); },
        warn: (...args) => console.warn("SynChat Widget WARNING:", ...args),
        error: (...args) => console.error("SynChat Widget ERROR:", ...args)
    };

    const getString = (key, defaultString = '', params = {}) => {
        const keys = key.split('.');
        let current = i18nStrings;
        for (const k of keys) {
            current = current[k];
            if (current === undefined) {
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

    let dynamicClientId = null;
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        if (script.src && typeof script.src === 'string' && script.src.includes('widget.js') && script.hasAttribute('data-client-id')) {
            dynamicClientId = script.getAttribute('data-client-id');
            break;
        }
    }

    if (!dynamicClientId) {
        widgetLogger.error(getString('widget.criticalClientIdMissing', "SynChat AI Widget: Critical - 'data-client-id' attribute not found on script tag. Widget cannot initialize."));
        return;
    }
    if (!window.SYNCHAT_CONFIG || !window.SYNCHAT_CONFIG.API_BASE_URL) {
        widgetLogger.error("SynChat AI Widget: Critical - 'window.SYNCHAT_CONFIG.API_BASE_URL' is not defined. Widget cannot fetch configuration.");
        return;
    }

    const VERCEL_BACKEND_BASE_URL = window.SYNCHAT_CONFIG.API_BASE_URL;

    let WIDGET_CONFIG = {
        clientId: dynamicClientId,
        backendUrl: `${VERCEL_BACKEND_BASE_URL}/api/public-chat`,
        publicConfigUrl: `${VERCEL_BACKEND_BASE_URL}/api/public-chat/widget-config`,
        botName: "SynChat Bot",
        welcomeMessage: getString('widget.defaultWelcomeMessage', "Hello! How can I help you today?"),
        inputPlaceholder: getString('widget.defaultInputPlaceholder', "Escribe tu mensaje..."),
        triggerLogoUrl: "/images/zoe.png", // Default, puede ser sobrescrito por la config del cliente
        avatarUrl: "/images/zoe.png"     // Default, puede ser sobrescrito por la config del cliente
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
        // Sobrescribir URLs de imágenes si vienen en la configuración del cliente
        WIDGET_CONFIG.triggerLogoUrl = dynamicData.triggerLogoUrl || WIDGET_CONFIG.triggerLogoUrl;
        WIDGET_CONFIG.avatarUrl = dynamicData.avatarUrl || WIDGET_CONFIG.avatarUrl;
        // Aquí podrías añadir más configuraciones como colores, fuentes, si el backend las provee
        // Ejemplo: WIDGET_CONFIG.primaryColor = dynamicData.primaryColor || WIDGET_CONFIG.primaryColor;
    }

    let conversationId = sessionStorage.getItem(`synchat_conversationId_${WIDGET_CONFIG.clientId}`);
    let isChatOpen = false;
    let currentClarificationDetails = null; // Para guardar detalles de la clarificación

    const widgetCSS = `
        :root {
            --synchat-font-primary: 'Poppins', sans-serif; /* Definido para consistencia con styles.css */
            --synchat-primary: ${dynamicData?.primaryColor || '#3B4018'}; /* Verde Oliva Oscuro por defecto */
            --synchat-primary-darker: ${dynamicData?.primaryDarkerColor || '#2F3314'};
            --synchat-secondary: ${dynamicData?.secondaryColor || '#F5F5DC'}; /* Beige por defecto */
            --synchat-accent: ${dynamicData?.accentColor || '#B8860B'}; /* Dorado Oscuro por defecto */
            --synchat-accent-hover: ${dynamicData?.accentHoverColor || '#A0740A'};
            --synchat-text-light: ${dynamicData?.textLightColor || '#F5F5DC'};
            --synchat-border-radius: 6px;
        }
        #synchat-trigger {
            position: fixed; bottom: 20px; right: 20px;
            width: 60px; height: 60px; background-color: var(--synchat-primary);
            border-radius: 50%; cursor: pointer; z-index: 9999;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: transform 0.2s ease-out;
        }
        #synchat-trigger:hover { transform: scale(1.1); }
        #synchat-trigger img { width: 36px; height: 36px; }

        #synchat-window {
            position: fixed; bottom: 90px; right: 20px;
            width: 370px; max-height: 70vh; min-height: 400px;
            background-color: #fff; border-radius: var(--synchat-border-radius);
            box-shadow: 0 5px 25px rgba(0,0,0,0.2);
            display: none; /* Initially hidden */
            flex-direction: column; z-index: 10000;
            overflow: hidden;
        }
        #synchat-window.synchat-is-open { display: flex; }

        .synchat-header {
            background-color: var(--synchat-primary); color: var(--synchat-text-light);
            padding: 12px 15px; display: flex; align-items: center;
            border-top-left-radius: var(--synchat-border-radius);
            border-top-right-radius: var(--synchat-border-radius);
        }
        .synchat-header .zoe-avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 10px; border: 1px solid var(--synchat-secondary); }
        .synchat-header .header-title { flex-grow: 1; }
        .synchat-header .zoe-name { font-weight: 600; display: block; font-size: 1.1em; }
        .synchat-header .powered-by { font-size: 0.75em; opacity: 0.8; display:flex; align-items:center; }
        .synchat-header .powered-by img { width:12px; height:12px; margin: 0 4px; }
        .synchat-close-btn {
            background: none; border: none; color: var(--synchat-text-light);
            font-size: 24px; cursor: pointer; opacity: 0.7;
            padding: 5px; line-height: 1;
        }
        .synchat-close-btn:hover { opacity: 1; }

        #synchat-messages {
            flex-grow: 1; padding: 15px; overflow-y: auto;
            background-color: #f9f9f9;
            display: flex; flex-direction: column;
        }
        .synchat-message {
            max-width: 85%; padding: 8px 12px; margin-bottom: 10px;
            border-radius: 12px; line-height: 1.4; word-wrap: break-word;
            font-size: 0.95em;
        }
        .synchat-message.user {
            background-color: var(--synchat-primary); color: var(--synchat-text-light);
            border-bottom-right-radius: 4px; align-self: flex-end;
        }
        .synchat-message.bot {
            background-color: #e9e9eb; color: #333;
            border-bottom-left-radius: 4px; align-self: flex-start;
        }
         .synchat-message.system {
            background-color: #fffbe6; color: #725c00;
            border: 1px solid #ffe58f; text-align: center;
            font-size: 0.85em; align-self: center; max-width: 95%;
            border-radius: 4px;
        }
        .synchat-message .message-content { /* No specific styles needed if textContent is used directly */ }

        #synchat-input-area {
            display: flex; align-items: flex-end; padding: 10px 15px;
            border-top: 1px solid #e0e0e0; background-color: #fff;
        }
        #synchat-input {
            flex-grow: 1; padding: 10px; border: 1px solid #ccc;
            border-radius: var(--synchat-border-radius); resize: none;
            font-family: var(--synchat-font-primary); font-size: 1em;
            max-height: 100px; overflow-y: auto;
            margin-right: 8px;
            line-height: 1.4;
        }
        #synchat-send-btn {
            background-color: var(--synchat-primary); color: var(--synchat-text-light);
            border: none; border-radius: 50%;
            width: 40px; height: 40px; display: flex;
            align-items: center; justify-content: center; cursor: pointer;
            transition: background-color 0.2s ease; flex-shrink: 0;
        }
        #synchat-send-btn:hover { background-color: var(--synchat-primary-darker); }
        #synchat-send-btn svg { width: 20px; height: 20px; }

        #requestHumanBtn {
            display: block; width: calc(100% - 30px); margin: 0 auto 10px auto;
            padding: 8px 10px; font-size: 0.85em; text-align:center;
            background-color: var(--synchat-secondary); color: var(--synchat-primary);
            border: 1px solid var(--synchat-primary);
            border-radius: var(--synchat-border-radius); cursor: pointer;
        }
        #requestHumanBtn:disabled { background-color: #ccc; color: #777; border-color: #bbb; cursor: not-allowed; }

        .synchat-quick-reply-options {
            display: flex; flex-wrap: wrap; justify-content: flex-start;
            padding: 5px 0px 10px 0px; /* Reduced padding inside message area */
            gap: 8px; align-self: flex-start; /* Align to bot side */
            max-width: 100%;
        }
        .synchat-quick-reply-btn {
            background-color: var(--synchat-accent); color: var(--synchat-text-light);
            border: none; padding: 8px 12px;
            border-radius: var(--synchat-border-radius); cursor: pointer;
            font-size: 0.9em; transition: background-color 0.2s ease;
        }
        .synchat-quick-reply-btn:hover { background-color: var(--synchat-accent-hover); }
        /* Ensure box-sizing for all widget elements */
        #synchat-trigger *, #synchat-window * { box-sizing: border-box; }
    `;

    function clearQuickReplyOptions() {
        const existingOptionsContainer = document.getElementById('synchat-quick-reply-container');
        if (existingOptionsContainer) {
            existingOptionsContainer.remove();
        }
    }

    function addMessageToChat(sender, text, type = 'text') {
        const messagesContainer = document.getElementById('synchat-messages');
        if (!messagesContainer) return;

        // No borrar opciones de clarificación si el mensaje que se añade es la propia pregunta de clarificación del bot
        if (type !== 'clarification_question') {
             clearQuickReplyOptions();
        }

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

    function handleClarificationRequest(responseData) {
        addMessageToChat("bot", responseData.reply, "clarification_question");

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
                    currentClarificationDetails = { // Guardar detalles para el siguiente envío
                        original_query: responseData.original_ambiguous_query,
                        original_chunks: responseData.original_retrieved_chunks
                    };
                    addMessageToChat("user", optionText);
                    sendMessage(optionText); // El texto de la opción es la respuesta
                });
                optionsContainer.appendChild(optionButton);
            });
            messagesContainer.appendChild(optionsContainer);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        currentClarificationDetails = { // Guardar para si el usuario escribe en vez de clickear
            original_query: responseData.original_ambiguous_query,
            original_chunks: responseData.original_retrieved_chunks
        };
    }

    function toggleChatWindow() {
        const windowEl = document.getElementById('synchat-window');
        if (windowEl) {
            isChatOpen = !windowEl.classList.contains('synchat-is-open');
            if (isChatOpen) {
                windowEl.classList.add('synchat-is-open');
                if (!conversationId) {
                    startNewConversation();
                }
                const inputField = document.getElementById('synchat-input');
                if (inputField) inputField.focus();
            } else {
                windowEl.classList.remove('synchat-is-open');
            }
            const trigger = document.getElementById('synchat-trigger');
            if (trigger) trigger.setAttribute('aria-expanded', isChatOpen);
        }
    }

    async function startNewConversation() {
        widgetLogger.log("Iniciando nueva conversación...");
        clearQuickReplyOptions();
        currentClarificationDetails = null;
        const messagesContainer = document.getElementById('synchat-messages');
        if (messagesContainer) messagesContainer.innerHTML = '';
        conversationId = null; // Resetear conversationId
        sessionStorage.removeItem(`synchat_conversationId_${WIDGET_CONFIG.clientId}`); // Limpiar de sessionStorage

        const startUrl = `${WIDGET_CONFIG.backendUrl}/start`;
        try {
            const response = await fetch(startUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: WIDGET_CONFIG.clientId })
            });

            if (!response.ok) {
                let errorDetail = 'Error desconocido al iniciar.';
                try {
                    const errorDataJson = await response.json();
                    errorDetail = errorDataJson.error || errorDataJson.message || `Error del servidor: ${response.status}`;
                } catch (e) {
                    errorDetail = `Error del servidor: ${response.status} - ${await response.text().catch(() => 'No se pudo leer el cuerpo del error.')}`;
                }
                widgetLogger.error("Error del servidor al iniciar nueva conversación:", errorDetail);
                addMessageToChat("bot", getString('widget.errorStartChat', "Lo siento, hubo un problema al iniciar el chat. Inténtalo de nuevo más tarde.") + ` (Detalle: ${errorDetail})`, "system");
                return;
            }

            const data = await response.json();
            if (data && data.conversationId) {
                conversationId = data.conversationId;
                sessionStorage.setItem(`synchat_conversationId_${WIDGET_CONFIG.clientId}`, conversationId);
                addMessageToChat("bot", WIDGET_CONFIG.welcomeMessage);
                const input = document.getElementById('synchat-input');
                if (input) input.focus();
            } else {
                widgetLogger.error("No se recibió conversationId del backend tras la solicitud /start.");
                addMessageToChat("bot", getString('widget.errorCriticalSession', "Error crítico: No se pudo establecer una sesión de chat."), "system");
            }
        } catch (error) {
            widgetLogger.error("Excepción al iniciar conversación:", error.message);
            addMessageToChat("bot", getString('widget.errorStartChat', "Lo siento, hubo un problema al iniciar el chat. Inténtalo de nuevo más tarde.") + ` (Detalle: ${error.message})`, "system");
        }
    }

    async function sendMessage(text, intent = null) {
        const trimmedText = text ? text.trim() : '';
        if (!trimmedText && !intent) return;

        if (intent !== 'request_human_escalation' && trimmedText) {
             // No añadir mensaje de usuario aquí si es una respuesta a clarificación por botón
             // ya que addMessageToChat("user", optionText) lo hace en el handler del botón
             // Solo añadir si es un mensaje tecleado
             if (!currentClarificationDetails || currentClarificationDetails?.original_query !== text ) { // Una heurística simple
                 addMessageToChat("user", trimmedText);
             }
        }

        const input = document.getElementById('synchat-input');
        if (input && intent !== 'request_human_escalation') {
            input.value = '';
            input.style.height = 'auto'; // Reset height
        }

        const messageUrl = `${WIDGET_CONFIG.backendUrl}/message`;
        const payload = {
            message: trimmedText,
            conversationId: conversationId,
            clientId: WIDGET_CONFIG.clientId
        };
        if (intent) {
            payload.intent = intent;
        }
        if (currentClarificationDetails) {
            payload.clarification_response_details = currentClarificationDetails;
            widgetLogger.log("Enviando con clarification_response_details:", currentClarificationDetails);
        }

        widgetLogger.log('SynChat AI Widget: Calling message endpoint:', messageUrl, 'with payload:', payload);
        currentClarificationDetails = null; // Resetear después de enviar
        clearQuickReplyOptions(); // Limpiar opciones después de cualquier envío

        try {
            const response = await fetch(messageUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                let errorDetail = 'Error desconocido';
                try { const errorDataJson = await response.json(); errorDetail = errorDataJson.error || errorDataJson.message || await response.text(); }
                catch(e) { errorDetail = await response.text().catch(() => 'No se pudo leer cuerpo del error'); }
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

    async function handleRequestHumanEscalation() {
        widgetLogger.log("Solicitando escalación humana...");
        const reqHumanBtn = document.getElementById('requestHumanBtn');
        if (reqHumanBtn) reqHumanBtn.disabled = true;

        if (!conversationId) {
            widgetLogger.log("No hay ID de conversación, iniciando una nueva para la escalación.");
            await startNewConversation(); // Esperar a que se establezca conversationId
            if (!conversationId) { // Si sigue sin establecerse, hay un problema mayor
                addMessageToChat("bot", getString('widget.errorCriticalSession', "Error crítico: No se pudo establecer una sesión de chat para la escalación."), "system");
                if (reqHumanBtn) reqHumanBtn.disabled = false; // Re-habilitar si falla
                return;
            }
        }
        // El mensaje del input actual podría ser relevante para la escalación
        const currentInputText = document.getElementById('synchat-input')?.value || "";
        sendMessage(currentInputText, 'request_human_escalation');
    }

    function initializeWidget() {
        if (document.getElementById('synchat-trigger')) {
            widgetLogger.log("Widget ya inicializado.");
            return;
        }

        const styleTag = document.createElement('style');
        styleTag.id = 'synchat-styles';
        styleTag.textContent = widgetCSS;
        document.head.appendChild(styleTag);

        const trigger = document.createElement('div');
        trigger.id = 'synchat-trigger';
        trigger.setAttribute('role', 'button');
        trigger.setAttribute('tabindex', '0');
        trigger.setAttribute('aria-label', getString('widget.ariaLabelOpenChat', 'Abrir chat de ayuda'));
        trigger.innerHTML = `<img src="${WIDGET_CONFIG.triggerLogoUrl}" alt="Abrir Chat SynChat AI">`;
        document.body.appendChild(trigger);

        const windowEl = document.createElement('div');
        windowEl.id = 'synchat-window';
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
            <button id="requestHumanBtn" title="Solicitar hablar con un agente">${getString('widget.requestHumanInitial', 'Hablar con Humano')}</button>
            <div id="synchat-input-area" class="synchat-input-area">
                <textarea id="synchat-input" placeholder="${WIDGET_CONFIG.inputPlaceholder}" rows="1" aria-label="Escribe tu mensaje"></textarea>
                <button id="synchat-send-btn" class="synchat-send-btn" aria-label="${getString('widget.ariaLabelSendMessage', 'Enviar Mensaje')}">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                </button>
            </div>`;
        document.body.appendChild(windowEl);

        // Add event listeners after elements are in the DOM
        trigger.addEventListener('click', toggleChatWindow);
        trigger.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChatWindow(); } });

        const closeButton = document.getElementById('synchat-close-btn');
        const sendButton = document.getElementById('synchat-send-btn');
        const inputField = document.getElementById('synchat-input');
        const requestHumanBtn = document.getElementById('requestHumanBtn');

        if (closeButton) {
            closeButton.addEventListener('click', toggleChatWindow);
            closeButton.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChatWindow(); } });
        }

        async function handleSend() {
            if (inputField && inputField.value.trim()) {
                if (!conversationId) {
                    widgetLogger.log("handleSend: conversationId es nulo o vacío, intentando iniciar nueva conversación...");
                    await startNewConversation();
                }

                if (!conversationId) {
                    widgetLogger.error("handleSend: Error crítico - conversationId sigue siendo nulo después de intentar iniciar una nueva. Mensaje no enviado.");
                    // Opcionalmente, mostrar un mensaje al usuario en la UI del chat.
                    // addMessageToChat("system", getString('widget.errorCriticalSession', "Error crítico: No se pudo establecer una sesión de chat. Intenta recargar."));
                    return;
                }
                sendMessage(inputField.value.trim());
            }
        }

        if (sendButton) {
            sendButton.addEventListener('click', handleSend);
        }

        if (inputField) {
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

        if (requestHumanBtn) {
            requestHumanBtn.addEventListener('click', handleRequestHumanEscalation);
        }

        widgetLogger.log("Widget UI inicializado.");
    }

    initializeWidget();

})();