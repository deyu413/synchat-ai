// widget.js

(function() {
    // --- Dynamic Client ID Retrieval ---
    const currentScript = document.currentScript;
    // Fallback to a default or null if attribute not found or currentScript is null
    const dynamicClientId = currentScript ? currentScript.getAttribute('data-client-id') : 'default-client-id'; 
    if (!dynamicClientId || dynamicClientId === 'default-client-id') {
        console.warn("SynChat AI Widget: 'data-client-id' attribute not found on script tag or is set to default. Ensure the script tag includes this attribute with your Client ID.");
    }

    // --- Configuración Inicial ---
    const WIDGET_CONFIG = {
        clientId: dynamicClientId, // Dynamically set from script tag's data-client-id attribute
        backendUrl: "https://synchat-ai-backend.vercel.app/",
        botName: "Zoe",
        welcomeMessage: "¡Hola! Soy Zoe. ¿En qué puedo ayudarte hoy?",
        inputPlaceholder: "Escribe tu mensaje...",
        triggerLogoUrl: "https://via.placeholder.com/64", // CAMBIAR a ruta real o URL completa
     avatarUrl: "https://via.placeholder.com/64" // CAMBIAR a ruta real o URL completa
    };

    // --- Variables de Estado ---
    let conversationId = sessionStorage.getItem(`synchat_conversationId_${WIDGET_CONFIG.clientId}`);
    let isChatOpen = false;

    // --- CSS del Widget (con 'resize: none;') ---
    const widgetCSS = `
        /* === ESTILOS WIDGET SYNCHAT AI === */
        :root { /* Define variables dentro del scope si es necesario o asume globales */ }
        .synchat-trigger, .synchat-window, .synchat-header, .synchat-messages, .synchat-input-area, #synchat-input, .synchat-send-btn, .synchat-message, .message-content {
            --synchat-primary: #3B4018; --synchat-primary-darker: #2F3314;
            --synchat-secondary: #F5F5DC; --synchat-accent: #B8860B;
            --synchat-accent-hover: #A0740A; --synchat-text-light: #F5F5DC;
            --synchat-text-dark: #333333; --synchat-text-muted-dark: #6c757d;
            --synchat-background-light: #FFFFFF; --synchat-background-alt: #F5F5DC; /* Beige */
            --synchat-border-light: #dee2e6; --synchat-font-primary: 'Poppins', sans-serif;
            --synchat-border-radius: 8px; --synchat-shadow: 0 5px 20px rgba(0, 0, 0, 0.15);
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
            width: 400px; /* Mantenemos tamaño grande */
            max-width: calc(100vw - 30px);
            max-height: 75vh; /* Mantenemos tamaño grande */
            background-color: var(--synchat-background-light);
            border-radius: var(--synchat-border-radius);
            box-shadow: var(--synchat-shadow);
            z-index: 10000; display: none; flex-direction: column;
            overflow: hidden; /* Mantenemos hidden para contener bien */
            /* --- resize ELIMINADO --- */
            resize: none; /* <-- CAMBIO AQUÍ: Desactivar redimensionamiento */
            /* --- fin resize --- */
            min-width: 320px; /* Aún útil para evitar colapso por CSS externo */
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
        .synchat-message.bot { justify-content: flex-start; }
        .synchat-message.bot .message-content { background-color: var(--synchat-background-alt); color: var(--synchat-text-dark); border: 1px solid var(--synchat-border-light); border-bottom-left-radius: 5px; }
        .synchat-message.user { justify-content: flex-end; margin-left: auto; }
        .synchat-message.user .message-content { background-color: var(--synchat-primary); color: var(--synchat-text-light); border-bottom-right-radius: 5px; }

        .synchat-input-area { display: flex; align-items: flex-end; padding: 10px 15px; border-top: 1px solid var(--synchat-border-light); background-color: #fff; flex-shrink: 0; }
        #synchat-input { flex-grow: 1; border: none; padding: 10px 5px; font-family: var(--synchat-font-primary); font-size: 0.95rem; resize: none; max-height: 100px; overflow-y: auto; outline: none; background: transparent; line-height: 1.4; }
        .synchat-send-btn { background: none; border: none; padding: 8px; margin-left: 10px; cursor: pointer; color: var(--synchat-primary); transition: color 0.2s ease, transform 0.2s ease; align-self: flex-end; margin-bottom: 4px; }
        .synchat-send-btn:hover { color: var(--synchat-accent); transform: scale(1.1); }
        .synchat-send-btn svg { display: block; width: 20px; height: 20px; }

        #synchat-input:focus-visible, .synchat-close-btn:focus-visible, .synchat-send-btn:focus-visible, .synchat-trigger:focus-visible { outline: 2px solid var(--synchat-accent); outline-offset: 1px; border-radius: 3px; box-shadow: 0 0 0 3px rgba(184, 134, 11, 0.3); }
        #synchat-input:focus { outline: none; }
    `;

    // --- Funciones Auxiliares ---
    function addMessageToChat(sender, text) {
        const messagesContainer = document.getElementById('synchat-messages');
        if (!messagesContainer) return;
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('synchat-message', sender);
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        contentDiv.textContent = text;
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
        try {
            const response = await fetch(`${WIDGET_CONFIG.backendUrl}/start`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: WIDGET_CONFIG.clientId })
            });
            if (!response.ok) throw new Error(`Error del servidor al iniciar: ${response.status}`);
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
            addMessageToChat("bot", "Lo siento, hubo un problema al iniciar el chat. Inténtalo de nuevo más tarde.");
        }
    }

    async function sendMessage(text) {
        if (!text.trim()) return;
        if (!conversationId) {
            console.error("Error: No hay conversationId. Intentando iniciar nueva conversación...");
            await startNewConversation();
            if (!conversationId) { addMessageToChat("bot", "Error crítico: No se pudo establecer una sesión de chat."); return; }
        }
        addMessageToChat("user", text);
        const input = document.getElementById('synchat-input');
        if(input) { input.value = ''; input.style.height = 'auto'; }
        // Opcional: Añadir indicador 'escribiendo...'
        try {
            const response = await fetch(`${WIDGET_CONFIG.backendUrl}/message`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, conversationId: conversationId, clientId: WIDGET_CONFIG.clientId })
            });
            // Opcional: quitar indicador 'escribiendo...'
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({}));
                 throw new Error(`Error del servidor: ${response.status} - ${errorData.error || 'Error desconocido'}`);
            }
            const data = await response.json();
            if (data.reply) { addMessageToChat("bot", data.reply); }
            else { throw new Error("No se recibió respuesta válida del backend."); }
        } catch (error) {
            console.error("Error al enviar mensaje:", error);
            addMessageToChat("bot", `Lo siento, hubo un problema al procesar tu mensaje.`);
        }
    }

    // --- Creación del Widget en el DOM ---
    function createWidget() {
        if (document.getElementById('synchat-trigger')) return;
        const styleTag = document.createElement('style');
        styleTag.id = 'synchat-styles'; styleTag.textContent = widgetCSS;
        document.head.appendChild(styleTag);
        const trigger = document.createElement('div');
        trigger.id = 'synchat-trigger'; trigger.classList.add('synchat-trigger');
        trigger.setAttribute('role', 'button'); trigger.setAttribute('tabindex', '0');
        trigger.setAttribute('aria-label', 'Abrir chat de ayuda');
        trigger.innerHTML = `<img src="${WIDGET_CONFIG.triggerLogoUrl}" alt="Abrir Chat SynChat AI">`;
        trigger.addEventListener('click', toggleChatWindow);
        trigger.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' ') toggleChatWindow(); });
        document.body.appendChild(trigger);
        const windowEl = document.createElement('div');
        windowEl.id = 'synchat-window'; windowEl.classList.add('synchat-window');
        windowEl.innerHTML = `
            <div class="synchat-header"> <img src="${WIDGET_CONFIG.avatarUrl}" alt="Avatar de ${WIDGET_CONFIG.botName}" class="zoe-avatar"> <div class="header-title"> <span class="zoe-name">${WIDGET_CONFIG.botName}</span> <span class="powered-by"> Potenciado por <img src="${WIDGET_CONFIG.triggerLogoUrl}" alt="SynChat AI" class="synchat-logo-header"> SynChat AI </span> </div> <button id="synchat-close-btn" class="synchat-close-btn" aria-label="Cerrar Chat">&times;</button> </div>
            <div id="synchat-messages" class="synchat-messages" aria-live="polite"></div>
            <div class="synchat-input-area"> <textarea id="synchat-input" placeholder="${WIDGET_CONFIG.inputPlaceholder}" rows="1" aria-label="Escribe tu mensaje"></textarea> <button id="synchat-send-btn" class="synchat-send-btn" aria-label="Enviar Mensaje"> <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg> </button> </div>
        `;
        document.body.appendChild(windowEl);
        const closeButton = document.getElementById('synchat-close-btn');
        const sendButton = document.getElementById('synchat-send-btn');
        const inputField = document.getElementById('synchat-input');
        if(closeButton) closeButton.addEventListener('click', toggleChatWindow);
        function handleSend() { if(inputField && inputField.value) { sendMessage(inputField.value); } }
        if(sendButton) sendButton.addEventListener('click', handleSend);
        if(inputField) {
             inputField.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
             inputField.addEventListener('input', () => { inputField.style.height = 'auto'; const maxHeight = 100; const scrollHeight = inputField.scrollHeight; inputField.style.height = Math.min(scrollHeight, maxHeight) + 'px'; });
        }
    }

    // --- Inicialización del Widget ---
    if (document.readyState === 'complete' || (document.readyState !== 'loading' && !document.documentElement.doScroll)) {
        createWidget(); // Correr si ya está cargado
    } else {
        document.addEventListener('DOMContentLoaded', createWidget); // Esperar si no lo está
    }

})();