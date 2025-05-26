// src/supabaseClientFrontend.js
// Importar usando el nombre correcto exportado por el módulo CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'

// *** ASEGÚRATE DE TENER TUS VALORES REALES AQUÍ ***
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://wooiypqmhpgqepdyrjif.supabase.co';

const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvb2l5cHFtaHBncWVwZHlyamlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgyMjM0MjQsImV4cCI6MjA2Mzc5OTQyNH0.LecPhEk2tqisCGrvrjUDZc3Ncx4MfrrUsez6bYx0rHE';
// *******************************************

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'TU_SUPABASE_URL') {
    console.error("Error: Configura tu URL y Anon Key de Supabase en supabaseClientFrontend.js");
    alert("Error: Configuración de Supabase incompleta en el frontend.");
    // Considera lanzar un error o deshabilitar la funcionalidad si las claves no están presentes
    // throw new Error("Supabase config missing");
}

// Crear el cliente usando la función importada correctamente
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

console.log("Supabase Client Frontend inicializado (o intentado).");

// Si necesitas exportar algo más de Supabase (raro desde aquí),
// tendrías que ver qué otros nombres exporta el módulo CDN o importarlos por separado si es necesario.
