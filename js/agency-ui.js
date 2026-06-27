'use strict';
/* =========================================================================
   MULTI-AGENCY UI (Business plan only) — app.html
   - "Mes agences": add / switch / delete agencies (unlimited).
   - "Vue globale": aggregated dashboard across all agencies.
   The data namespacing itself lives in js/supabase-store.js (agKey / agData).
   ========================================================================= */

function _agEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function _agN(n) { return (typeof fmtN === 'function') ? fmtN(n) : (n || 0).toLocaleString('fr-FR'); }

/* Show/hide Business-only UI + fill the agency switcher. Called after boot. */
function applyAgencyUI() {
  const biz = (typeof AG_IS_BUSINESS !== 'undefined' && AG_IS_BUSINESS);
  document.querySelectorAll('.biz-only').forEach(el => { el.style.display = biz ? '' : 'none'; });
  if (!biz) return;
  let list; try { list = JSON.parse(localStorage.getItem('md_agencies') || '[]'); } catch { list = []; }
  const active = localStorage.getItem('md_active_agency');
  const sel = document.getElementById('agencySwitch');
  if (sel) {
    sel.style.display = 'inline-block';
    sel.innerHTML = list.map(a => `<option value="${a.id}" ${a.id === active ? 'selected' : ''}>🏢 ${_agEsc(a.name)}</option>`).join('');
  }
}

async function switchAgency(id) {
  if (!id) return;
  localStorage.setItem('md_active_agency', id);     // control key -> stored raw + mirrored
  if (typeof sbFlush === 'function') { try { await sbFlush(); } catch (e) {} }
  location.reload();                                 // re-boot loads the new agency's data
}

async function addAgency() {
  const inp = document.getElementById('agNewName');
  const name = (inp.value || '').trim();
  if (!name) { if (typeof toast === 'function') toast('⚠️ Entrez un nom d\'agence'); return; }
  let list; try { list = JSON.parse(localStorage.getItem('md_agencies') || '[]'); } catch { list = []; }
  const id = Date.now().toString(36);
  list.push({ id, name, created: Date.now() });
  localStorage.setItem('md_agencies', JSON.stringify(list));   // new agency starts empty
  await switchAgency(id);
}

async function deleteAgency(id) {
  let list; try { list = JSON.parse(localStorage.getItem('md_agencies') || '[]'); } catch { list = []; }
  if (list.length <= 1) { alert('Vous devez garder au moins une agence.'); return; }
  if (!confirm('Supprimer cette agence et TOUTES ses données ? Cette action est irréversible.')) return;
  list = list.filter(a => a.id !== id);
  localStorage.setItem('md_agencies', JSON.stringify(list));
  // purge this agency's data locally...
  Object.keys(localStorage).filter(k => k.indexOf('md_AG_' + id + '__') === 0).forEach(k => localStorage.removeItem(k));
  // ...and in the cloud
  try { if (typeof SB !== 'undefined' && SB_USER) await SB.from('kv_store').delete().eq('user_id', SB_USER.id).like('key', 'md_AG_' + id + '__%'); } catch (e) {}
  if (localStorage.getItem('md_active_agency') === id) await switchAgency(list[0].id);
  else renderAgencies();
}

function renderAgencies() {
  let list; try { list = JSON.parse(localStorage.getItem('md_agencies') || '[]'); } catch { list = []; }
  const active = localStorage.getItem('md_active_agency');
  const box = document.getElementById('agencyList');
  if (!box) return;
  box.innerHTML = list.map(a => {
    const res = agData(a.id, 'md_reservations') || [];
    const veh = agData(a.id, 'md_vehicles') || [];
    const isA = a.id === active;
    return `<div class="acc-row" style="gap:10px;flex-wrap:wrap">
      <div style="display:flex;flex-direction:column;gap:2px">
        <b style="font-size:1rem">🏢 ${_agEsc(a.name)} ${isA ? '<span class="acc-badge" style="margin-left:6px">Active</span>' : ''}</b>
        <span style="font-size:.78rem">${veh.length} véhicule(s) · ${res.length} réservation(s)</span>
      </div>
      <div style="display:flex;gap:8px;margin-left:auto">
        ${isA ? '' : `<button class="btn-sm" onclick="switchAgency('${a.id}')">📂 Ouvrir</button>`}
        <button class="btn-sm danger" onclick="deleteAgency('${a.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--muted);font-size:.85rem">Aucune agence.</p>';
}

function renderGlobal() {
  let list; try { list = JSON.parse(localStorage.getItem('md_agencies') || '[]'); } catch { list = []; }
  let tCars = 0, tRes = 0, tCli = 0, tRev = 0; const rows = [];
  list.forEach(a => {
    const res = agData(a.id, 'md_reservations') || [];
    const veh = agData(a.id, 'md_vehicles') || [];
    const cli = new Set(res.map(r => r.phone || r.name).filter(Boolean)).size;
    const rev = res.filter(r => r.status === 'completed').reduce((s, r) => s + (+r.total || 0), 0);
    tCars += veh.length; tRes += res.length; tCli += cli; tRev += rev;
    rows.push({ name: a.name, cars: veh.length, res: res.length, cli, rev });
  });
  const kpi = document.getElementById('globalKpi');
  if (kpi) kpi.innerHTML = `
    <div class="kpi-card c-red"><div class="kpi-icon">🏢</div><div class="kpi-val">${list.length}</div><div class="kpi-label">Agences</div></div>
    <div class="kpi-card c-blue"><div class="kpi-icon">🚙</div><div class="kpi-val">${tCars}</div><div class="kpi-label">Total véhicules</div></div>
    <div class="kpi-card c-yellow"><div class="kpi-icon">📋</div><div class="kpi-val">${tRes}</div><div class="kpi-label">Total réservations</div></div>
    <div class="kpi-card c-green"><div class="kpi-icon">👥</div><div class="kpi-val">${tCli}</div><div class="kpi-label">Total clients</div></div>
    <div class="kpi-card c-green"><div class="kpi-icon">💰</div><div class="kpi-val" style="font-size:1.5rem">${_agN(tRev)}</div><div class="kpi-label">Chiffre d'affaires (MAD)</div></div>`;
  const tbl = document.getElementById('globalTable');
  if (tbl) tbl.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Agence</th><th>Véhicules</th><th>Réservations</th><th>Clients</th><th>Chiffre d'affaires</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td><b>🏢 ${_agEsc(r.name)}</b></td><td>${r.cars}</td><td>${r.res}</td><td>${r.cli}</td><td>${_agN(r.rev)} MAD</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}
