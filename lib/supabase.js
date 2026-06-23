// lib/supabase.js
//
// Dual-write client for Phia internal Supabase (marketing.*_account_info).
//
// Used by callback / refresh / snapshot / remove handlers to mirror creator
// state from Vercel KV into the internal-dashboard Supabase. Vercel KV remains
// the source of truth; Supabase writes are best-effort and never block the
// primary handler.
//
// Required env vars (gracefully no-ops if missing — backward compatible):
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY  — service_role, used only from Vercel server functions
//   X_PHIA_TOKEN          — encryption key for access_token / refresh_token

import { createClient } from '@supabase/supabase-js';

let _client = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;  // dual-write disabled until env vars set
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export function isSupabaseEnabled() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.X_PHIA_TOKEN);
}

// ---------- generic safe writers ----------

export async function safeUpsert(table, row, conflict) {
  const sb = getClient();
  if (!sb) return { skipped: 'supabase_disabled' };
  try {
    const { error } = await sb.schema('marketing').from(table).upsert(row, { onConflict: conflict });
    if (error) {
      console.error(`[supabase] ${table} upsert failed:`, error.message);
      return { error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[supabase] ${table} upsert threw:`, e.message);
    return { error: e.message };
  }
}

export async function safeUpdate(table, updates, where) {
  const sb = getClient();
  if (!sb) return { skipped: 'supabase_disabled' };
  try {
    let q = sb.schema('marketing').from(table).update(updates);
    for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
    const { error } = await q;
    if (error) {
      console.error(`[supabase] ${table} update failed:`, error.message);
      return { error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[supabase] ${table} update threw:`, e.message);
    return { error: e.message };
  }
}

export async function safeDelete(table, where) {
  const sb = getClient();
  if (!sb) return { skipped: 'supabase_disabled' };
  try {
    let q = sb.schema('marketing').from(table).delete();
    for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
    const { error } = await q;
    if (error) {
      console.error(`[supabase] ${table} delete failed:`, error.message);
      return { error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[supabase] ${table} delete threw:`, e.message);
    return { error: e.message };
  }
}

// ---------- person_id lookup by platform handle ----------

function normalizeHandle(h) {
  return String(h || '').toLowerCase().replace(/^@+/, '').trim();
}

export async function lookupPersonIdByIgHandle(handle) {
  const sb = getClient();
  if (!sb) return null;
  const h = normalizeHandle(handle);
  if (!h) return null;
  try {
    const { data } = await sb
      .schema('marketing')
      .from('people')
      .select('id')
      .contains('instagram_accounts', [h])
      .maybeSingle();
    return data?.id ?? null;
  } catch (e) {
    console.error('[supabase] lookupPersonIdByIgHandle failed:', e.message);
    return null;
  }
}

export async function lookupPersonIdByTtHandle(handle) {
  const sb = getClient();
  if (!sb) return null;
  const h = normalizeHandle(handle);
  if (!h) return null;
  try {
    const { data } = await sb
      .schema('marketing')
      .from('people')
      .select('id')
      .contains('tiktok_accounts', [h])
      .maybeSingle();
    return data?.id ?? null;
  } catch (e) {
    console.error('[supabase] lookupPersonIdByTtHandle failed:', e.message);
    return null;
  }
}

/**
 * YT lookup: prefers youtube_accounts match, falls back to instagram_accounts
 * (since youtube_accounts column is new and may be empty initially).
 */
export async function lookupPersonIdByYtHandle(ytHandle, igFallback) {
  const sb = getClient();
  if (!sb) return null;
  try {
    const yt = normalizeHandle(ytHandle);
    if (yt) {
      const { data } = await sb
        .schema('marketing')
        .from('people')
        .select('id')
        .contains('youtube_accounts', [yt])
        .maybeSingle();
      if (data?.id) return data.id;
    }
    const ig = normalizeHandle(igFallback);
    if (ig) {
      const { data } = await sb
        .schema('marketing')
        .from('people')
        .select('id')
        .contains('instagram_accounts', [ig])
        .maybeSingle();
      return data?.id ?? null;
    }
    return null;
  } catch (e) {
    console.error('[supabase] lookupPersonIdByYtHandle failed:', e.message);
    return null;
  }
}
