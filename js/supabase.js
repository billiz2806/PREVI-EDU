'use strict';

const SUPABASE_URL = "https://cmvafdzbgwrfmxgeeaim.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_72V7acdNc99UqnI5GSvkzg_eYMVwa7S";

window.supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

console.log('Cliente Supabase inicializado correctamente.');
