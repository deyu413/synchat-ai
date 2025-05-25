// src/services/supabaseClient.js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Fatal Error: SUPABASE_URL and SUPABASE_KEY must be defined in the environment variables.");
}

// Crear y exportar una única instancia del cliente Supabase
export const supabase = createClient(supabaseUrl, supabaseKey);

console.log("(Supabase Client) Cliente de Supabase inicializado.");