// Single Supabase client shared across the module so we don't spawn duplicate
// GoTrueClients under the same storage key.

const SUPABASE_URL = "https://exglsurpdbmpkvqdfvid.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4Z2xzdXJwZGJtcGt2cWRmdmlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTcyNzAsImV4cCI6MjA5MzQ5MzI3MH0.p6oLn61mhe9hxThh-bwkVIADvSU6oyG4VnAkhkJmHJU";

let _client = null;

export function getSupabase() {
    if (_client) return _client;
    const { createClient } = globalThis.supabase;
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return _client;
}
