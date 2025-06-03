// src/supabaseClientFrontend.js
// Importar usando la URL explícita para módulos ES desde jsDelivr
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'; // O la que te funcionó antes

const supabaseUrl = 'https://wooiypqmhpgqepdyrjif.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvb2l5cHFtaHBncWVwZHlyamlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgyMjM0MjQsImV4cCI6MjA2Mzc5OTQyNH0.LecPhEk2tqisCGrvrjUDZc3Ncx4MfrrUsez6bYx0rHE';

// Validación simple para asegurar que las variables no estén vacías o con placeholders
if (!supabaseUrl || supabaseUrl === 'URL_DE_TU_NUEVO_PROYECTO_SUPABASE' || supabaseUrl.includes('lyrsyxrjhtkqywqlclue')) { // Incluida la de ejemplo para evitar olvidos
    const errorMsg = "Error Crítico: Las variables supabaseUrl o supabaseAnonKey no están configuradas correctamente en supabaseClientFrontend.js. Por favor, edita el archivo con tus credenciales reales de Supabase.";
    console.error(errorMsg);
    // Podrías incluso lanzar un error para detener la ejecución si prefieres:
    // throw new Error(errorMsg); 
    // O mostrar un mensaje al usuario, aunque console.error es un buen primer paso.
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

console.log("Supabase Client Frontend inicializado.");
