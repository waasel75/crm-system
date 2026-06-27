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
const _rawGet = localStorage.getItem.bind(localStorage);
const _rawRemove = localStorage.removeItem.bind(localStorage);

/* =======================================================================
   MULTI-AGENCY (Business plan only)
   - Business accounts can hold UNLIMITED agencies inside one login.
   - Each agency's data is transparently namespaced: a logical key like
     `md_reservations` is physically stored as `md_AG_<agencyId>__md_reservations`.
   - The rest of the app keeps using logical keys unchanged.
   - Non-Business plans: AG_ACTIVE stays null -> zero behavior change.
   ======================================================================= */
const AG_CONTROL = new Set(['md_panel_lang','md_admin','md_admin_creds','md_admin_lockout','md_agencies','md_active_agency','md_wa_notify','md_ech_alerted']);
let AG_IS_BUSINESS = false;
let AG_ACTIVE = null;
function agKey(k) {
  if (!AG_ACTIVE) return k;
  if (typeof k !== 'string' || !k.startsWith('md_') || k.startsWith('md_AG_') || AG_CONTROL.has(k)) return k;
  return 'md_AG_' + AG_ACTIVE + '__' + k;
}
function agData(id, key) { try { return JSON.parse(_rawGet('md_AG_' + id + '__' + key) || 'null'); } catch { return null; } }

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

// Wrap localStorage: translate logical->physical (per active agency), persist
// locally, and mirror md_* writes to the cloud under the physical key.
localStorage.setItem = function (key, val) {
  const pk = agKey(key);
  _rawSet(pk, val);
  if (sbIsSyncedKey(pk)) sbQueueUpsert(pk, val);
};
localStorage.getItem = function (key) { return _rawGet(agKey(key)); };
localStorage.removeItem = function (key) { _rawRemove(agKey(key)); };

/* ---- agency setup: decide plan, list, active agency (+ first-time migration) ---- */
function setupAgencies() {
  const plan = (SB_USER && SB_USER.user_metadata && SB_USER.user_metadata.plan) || 'Starter';
  AG_IS_BUSINESS = (plan === 'Business');
  if (!AG_IS_BUSINESS) { AG_ACTIVE = null; return; }
  let list; try { list = JSON.parse(_rawGet('md_agencies') || '[]'); } catch { list = []; }
  if (!Array.isArray(list) || list.length === 0) {
    // First Business boot: create a default agency and migrate existing data into it.
    const id = Date.now().toString(36);
    list = [{ id, name: 'Agence principale', created: Date.now() }];
    ['md_reservations', 'md_vehicles', 'md_site_settings', 'md_vidange_alerted'].forEach(k => {
      const v = _rawGet(k);
      if (v != null) { const pk = 'md_AG_' + id + '__' + k; _rawSet(pk, v); sbQueueUpsert(pk, v); }
    });
    _rawSet('md_agencies', JSON.stringify(list)); sbQueueUpsert('md_agencies', JSON.stringify(list));
    _rawSet('md_active_agency', id); sbQueueUpsert('md_active_agency', id);
    AG_ACTIVE = id; sbFlush();
  } else {
    AG_ACTIVE = _rawGet('md_active_agency');
    if (!AG_ACTIVE || !list.some(a => a.id === AG_ACTIVE)) {
      AG_ACTIVE = list[0].id; _rawSet('md_active_agency', AG_ACTIVE); sbQueueUpsert('md_active_agency', AG_ACTIVE);
    }
  }
}

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
  setupAgencies();
  if (typeof applyAgencyUI === 'function') applyAgencyUI();
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
