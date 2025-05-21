document.addEventListener('DOMContentLoaded', () => {

    // --- 1. MENÚ MÓVIL (HAMBURGUESA) ---
    const hamburgerButton = document.querySelector('.hamburger-menu-button');
    const navigationMenu = document.querySelector('.navigation-menu');

    if (hamburgerButton && navigationMenu) {
        hamburgerButton.addEventListener('click', () => {
            const isOpen = navigationMenu.classList.toggle('is-open');
            hamburgerButton.setAttribute('aria-expanded', isOpen);
            // Bloquear/desbloquear scroll del body
            document.body.style.overflow = isOpen ? 'hidden' : '';
        });
    } else {
        console.warn("Elementos del menú móvil no encontrados.");
    }

    // --- 2. MENÚS DESPLEGABLES (DROPDOWNS) ---
    const dropdownItems = document.querySelectorAll('.nav-item.dropdown');

    dropdownItems.forEach(item => {
        const button = item.querySelector('.nav-item-button');
        const submenu = item.querySelector('.nav-submenu');

        if (button && submenu) {
            // Click en el botón para abrir/cerrar
            button.addEventListener('click', (event) => {
                event.stopPropagation(); // Prevenir cierre inmediato por click en documento
                const isAlreadyActive = submenu.classList.contains('is-active');

                // Cerrar todos los demás antes de abrir/cerrar este
                closeOtherDropdowns(null); // Cerrar todos primero

                // Si no estaba activo, abrirlo
                if (!isAlreadyActive) {
                    submenu.classList.add('is-active');
                    button.setAttribute('aria-expanded', 'true');
                } else {
                    // Si ya estaba activo (o se volvió a hacer click), asegurarse que se cierre
                     submenu.classList.remove('is-active');
                     button.setAttribute('aria-expanded', 'false');
                }
            });
        }
    });

    // Función para cerrar todos los desplegables activos
    function closeOtherDropdowns(currentItem) { // currentItem no se usa aquí, pero mantenemos firma por si acaso
        dropdownItems.forEach(item => {
            const button = item.querySelector('.nav-item-button');
            const submenu = item.querySelector('.nav-submenu');
            if (submenu && submenu.classList.contains('is-active')) {
                 submenu.classList.remove('is-active');
                 button.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // Cerrar desplegables si se hace clic fuera de ellos
    document.addEventListener('click', (event) => {
         // Comprobar si el clic fue fuera de un submenú o su botón
         const isClickInsideDropdown = event.target.closest('.nav-item.dropdown');
         if (!isClickInsideDropdown) {
            closeOtherDropdowns(null);
         }
    });

    // Ya no necesitamos parar la propagación dentro del submenú con este enfoque

    // --- 3. PESTAÑAS / ACORDEONES (Código existente, sin uso actual) ---
    // Si añades tabs/acordeones más adelante, este código puede servir de base
    const productCards = document.querySelectorAll('.product-card'); // Cambiar si usas otra clase
    productCards.forEach(card => {
        const triggers = card.querySelectorAll('.tabs-or-accordion .tab');
        const panels = card.querySelectorAll('.tabs-or-accordion .tab-panel');
         if (triggers.length > 0 && triggers.length === panels.length) {
             triggers.forEach((trigger, index) => {
                trigger.addEventListener('click', () => {
                    triggers.forEach((t, i) => { t.classList.remove('active'); t.setAttribute('aria-expanded', 'false'); panels[i].classList.remove('active'); });
                    trigger.classList.add('active'); trigger.setAttribute('aria-expanded', 'true'); panels[index].classList.add('active');
                });
            });
        } else if (triggers.length > 0) {
             console.warn("Número de triggers y panels no coincide:", card);
        }
    });

    // --- 4. ANIMACIÓN FADE-IN AL HACER SCROLL ---
    const fadeElements = document.querySelectorAll('.fade-in-element');

    if (typeof IntersectionObserver === 'function' && fadeElements.length > 0) { // Check if IntersectionObserver is supported
        const observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1 // Umbral de visibilidad (10%)
        };

        const observerCallback = (entries, observer) => {
            entries.forEach(entry => {
                // Cuando el elemento entra en la vista
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target); // Dejar de observarlo una vez animado
                }
                // No necesitamos hacer nada cuando sale (entry.isIntersecting == false)
            });
        };

        const intersectionObserver = new IntersectionObserver(observerCallback, observerOptions);

        fadeElements.forEach(el => {
            intersectionObserver.observe(el);
        });
    } else if (fadeElements.length > 0) {
        // Fallback muy simple si IntersectionObserver no está soportado (navegadores muy antiguos)
        // Simplemente muestra todos los elementos directamente
        fadeElements.forEach(el => {
            el.classList.add('is-visible');
        });
    }

}); // Fin de DOMContentLoaded