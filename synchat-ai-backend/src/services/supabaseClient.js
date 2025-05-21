// src/services/supabaseClient.js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("¡Error Fatal! Las variables de entorno SUPABASE_URL o SUPABASE_KEY no están definidas.");
    // En un entorno real, podrías querer lanzar un error o manejar esto de forma diferente.
    // process.exit(1);
}

// Crear y exportar una única instancia del cliente Supabase
export const supabase = createClient(supabaseUrl, supabaseKey);

console.log("(Supabase Client) Cliente de Supabase inicializado.");