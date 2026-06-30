'use strict';
/* =========================================================================
   SUPABASE DATA LAYER (app.html)
   - Gates the CRM: no valid session -> redirect to the landing page.
   - Each account has a PRIVATE namespace in public.kv_store (RLS-isolated).
   - Mirrors the app's md_* localStorage keys to/from Supabase.

   MULTI-AGENCY (Business plan only):
   - The Business plan uses a SEPARATE panel (business.html) to manage agencies.
   - An agency's system is just app.html opened as  app.html?agency=<id> .
     In that mode every DATA key is transparently namespaced to that agency
     (md_AG_<id>__<key>) so each agency keeps 100% isolated data — the rest of
     the app code stays exactly the same.
   - Free / Pro plans: no agency param -> behaves exactly like before.
   Auth (signup / login) lives on the landing page: js/landing.js.
   ========================================================================= */

const SB = supabase.createClient(SUPA.url, SUPA.anonKey);
const SB_LANDING = 'index.html';

/* ---- agency scope ---- */
const AG = new URLSearchParams(location.search).get('agency') || '';
// Keys that must stay GLOBAL (never scoped to an agency).
const SB_CONTROL = new Set(['md_admin', 'md_admin_creds', 'md_admin_lockout', 'md_panel_lang', 'md_agencies']);
function sbIsData(k) { return typeof k === 'string' && k.startsWith('md_') && !k.startsWith('md_AG_') && !SB_CONTROL.has(k); }
function phys(k) { return (AG && sbIsData(k)) ? ('md_AG_' + AG + '__' + k) : k; }

/* ---- which keys sync to the cloud ---- */
const SB_LOCAL_ONLY = new Set(['md_admin_creds', 'md_admin_lockout', 'md_panel_lang']);
function sbIsSyncedKey(k) { return typeof k === 'string' && k.startsWith('md_') && !SB_LOCAL_ONLY.has(k); }

let SB_USER = null;
const _rawSet = localStorage.setItem.bind(localStorage);
const _rawGet = localStorage.getItem.bind(localStorage);
const _rawRemove = localStorage.removeItem.bind(localStorage);

/* ---- write mirror: app -> Supabase (debounced per key) ---- */
const _sbPending = new Map();
let _sbTimer = null;
function sbQueueUpsert(key, rawVal) {
  if (!SB_USER) return;
  let value; try { value = JSON.parse(rawVal); } catch { value = rawVal; }
  _sbPending.set(key, value);
  clearTimeout(_sbTimer);
  _sbTimer = setTimeout(sbFlush, 500);
}
async function sbFlush() {
  if (!SB_USER || _sbPending.size === 0) return;
  const rows = [];
  for (const [key, value] of _sbPending) rows.push({ user_id: SB_USER.id, key, value, updated_at: new Date().toISOString() });
  _sbPending.clear();
  const { error } = await SB.from('kv_store').upsert(rows, { onConflict: 'user_id,key' });
  if (error) console.warn('[supabase] sync failed', error.message);
}

/* Transparently scope (agency) + mirror to cloud. The app keeps using md_* keys. */
localStorage.setItem = function (key, val) {
  const p = phys(key);
  _rawSet(p, val);
  if (sbIsSyncedKey(p)) sbQueueUpsert(p, val);
};
localStorage.getItem = function (key) { return _rawGet(phys(key)); };
localStorage.removeItem = function (key) { _rawRemove(phys(key)); };

/* ---- read pull: Supabase -> localStorage (physical keys) ---- */
async function sbPullAll() {
  // Only fetch what THIS view needs: the active agency's data (or, unscoped,
  // the non-agency keys) — never every other agency's data. Keeps it light.
  let q = SB.from('kv_store').select('key,value');
  q = AG ? q.or('key.like.md_AG_' + AG + '__*,key.not.like.md_AG_*')
         : q.not('key', 'like', 'md_AG_*');
  const { data, error } = await q;
  if (error) { console.warn('[supabase] pull failed', error.message); return; }
  for (const row of data) {
    const v = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
    _rawSet(row.key, v);
  }
}

/* ---- realtime: cross-device updates for THIS user only (row.key is physical) ---- */
function sbStartRealtime() {
  if (!SB_USER) return;
  SB.channel('kv_' + SB_USER.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'kv_store', filter: 'user_id=eq.' + SB_USER.id },
      (payload) => {
        const row = payload.new || payload.old;
        if (!row) return;
        if (payload.eventType === 'DELETE') {
          if (_rawGet(row.key) === null) return;
          _rawRemove(row.key);
        } else {
          const v = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
          if (_rawGet(row.key) === v) return;          // unchanged -> skip self-echo
          _rawSet(row.key, v);
        }
        window.dispatchEvent(new Event('db-synced'));
      })
    .subscribe();
}

/* ---- boot the CRM once a valid session is confirmed ---- */
async function sbEnterApp() {
  await sbPullAll();
  sessionStorage.setItem('md_admin', '1');
  const app = document.getElementById('app');
  if (app) app.style.display = 'flex';
  if (AG) {
    const b = document.getElementById('backToAgencies'); if (b) b.style.display = 'inline-flex';
    let list; try { list = JSON.parse(_rawGet('md_agencies') || '[]'); } catch { list = []; }
    const ag = list.find(a => a.id === AG);
    const el = document.getElementById('agencyName');
    if (el && ag) { el.textContent = '🏢 ' + ag.name; el.style.display = 'inline-flex'; document.title = ag.name + ' — CRM'; }
  }
  if (typeof init === 'function') init();
  sbStartRealtime();
}

// Logout -> end session and return to landing.
async function doLogout() {
  await SB.auth.signOut();
  sessionStorage.removeItem('md_admin');
  Object.keys(localStorage).filter(sbIsSyncedKey).forEach(k => _rawRemove(k));
  location.replace(SB_LANDING);
}

/* ---- gate ----
   - no session            -> landing
   - Business + no agency   -> the dedicated multi-agency panel (business.html)
   - otherwise              -> the normal CRM (optionally scoped to ?agency=) */
(async function () {
  const { data } = await SB.auth.getSession();
  if (!data.session) { location.replace(SB_LANDING); return; }
  SB_USER = data.session.user;
  const plan = (SB_USER.user_metadata && SB_USER.user_metadata.plan) || '';
  if (plan === 'Business' && !AG) { location.replace('business.html'); return; }
  await sbEnterApp();
})();
