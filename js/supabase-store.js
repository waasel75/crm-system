'use strict';
/* =========================================================================
   SUPABASE DATA LAYER (app.html)
   - Gates the CRM: no valid session -> redirect to the landing page.
   - Each account has a PRIVATE namespace in public.kv_store (RLS-isolated).
   - Mirrors the app's existing md_* localStorage keys to/from Supabase,
     so the rest of the app keeps working unchanged.
   Auth (signup / login / OTP) lives on the landing page: js/landing.js.
   ========================================================================= */

const SB = supabase.createClient(SUPA.url, SUPA.anonKey);
const SB_LANDING = 'index.html';

/* Keys that belong to the user's cloud namespace: everything under md_*
   except legacy local-only auth keys and the per-device language choice. */
const SB_LOCAL_ONLY = new Set(['md_admin_creds', 'md_admin_lockout', 'md_panel_lang']);
function sbIsSyncedKey(k) { return typeof k === 'string' && k.startsWith('md_') && !SB_LOCAL_ONLY.has(k); }

let SB_USER = null;
const _rawSet = localStorage.setItem.bind(localStorage);
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

// Wrap localStorage so any md_* write also goes to the cloud.
localStorage.setItem = function (key, val) {
  _rawSet(key, val);
  if (sbIsSyncedKey(key)) sbQueueUpsert(key, val);
};

/* ---- read pull: Supabase -> localStorage ---- */
async function sbPullAll() {
  const { data, error } = await SB.from('kv_store').select('key,value');
  if (error) { console.warn('[supabase] pull failed', error.message); return; }
  for (const row of data) {
    const v = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
    _rawSet(row.key, v);
  }
}

/* ---- realtime: cross-device updates for THIS user only ---- */
function sbStartRealtime() {
  if (!SB_USER) return;
  SB.channel('kv_' + SB_USER.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'kv_store', filter: 'user_id=eq.' + SB_USER.id },
      (payload) => {
        const row = payload.new || payload.old;
        if (!row) return;
        if (payload.eventType === 'DELETE') {
          if (localStorage.getItem(row.key) === null) return; // already gone -> skip echo
          _rawRemove(row.key);
        } else {
          const v = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
          if (localStorage.getItem(row.key) === v) return;     // unchanged -> skip self-echo
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
  if (typeof init === 'function') init();
  sbStartRealtime();
}

// Logout button in the sidebar -> end session and return to landing.
async function doLogout() {
  await SB.auth.signOut();
  sessionStorage.removeItem('md_admin');
  Object.keys(localStorage).filter(sbIsSyncedKey).forEach(k => _rawRemove(k));
  location.replace(SB_LANDING);
}

/* ---- gate: require a session, else go to the landing page ---- */
(async function () {
  const { data } = await SB.auth.getSession();
  if (data.session) { SB_USER = data.session.user; await sbEnterApp(); }
  else { location.replace(SB_LANDING); }
})();
