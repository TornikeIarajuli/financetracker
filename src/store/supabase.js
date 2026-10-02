import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const isSupabaseConfigured = () => !!supabase;

// ── Auth ─────────────────────────────────────────────────────────
// The finance_data row is protected by row-level security, so every request
// has to carry a signed-in user's token (see supabase/rls.sql).

let currentSession = null;
const authListeners = new Set();

export const getSession = async () => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  currentSession = data?.session || null;
  return currentSession;
};

export const isSignedIn = () => !!currentSession;
export const getUserEmail = () => currentSession?.user?.email || null;

export const onAuthChange = (fn) => {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
};

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session || null;
    authListeners.forEach(fn => { try { fn(currentSession); } catch { /* listener error */ } });
  });
}

export const signIn = async (email, password) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { success: false, error: error.message };
  currentSession = data.session;
  return { success: true };
};

export const signOut = async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
  currentSession = null;
};

// ── Row access ───────────────────────────────────────────────────

// Resolves to { data, updated_at } or null when the row does not exist (or is
// hidden by RLS). Throws on network/permission errors so callers can tell
// "cloud is empty" apart from "could not reach the cloud".
export const readCloudRow = async () => {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('finance_data')
    .select('data, updated_at')
    .eq('id', 'main')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
};

export const writeCloudRow = async (doc) => {
  if (!supabase) throw new Error('Supabase not configured');
  const updatedAt = new Date().toISOString();
  const { error } = await supabase
    .from('finance_data')
    .upsert({ id: 'main', data: doc, updated_at: updatedAt });
  if (error) throw new Error(error.message);
  return updatedAt;
};
