import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
if(!SUPABASE_URL || !SUPABASE_ANON_KEY){ console.warn("Missing Supabase env vars. Copy .env.example to .env"); }
export const supabase = createClient(SUPABASE_URL || "https://YOUR-PROJECT.supabase.co", SUPABASE_ANON_KEY || "YOUR-ANON-KEY");
