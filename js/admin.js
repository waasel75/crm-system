'use strict';

const WA    = '212634829085';

const STATUS = {
  pending:         { label:'En attente',       color:'var(--yellow)', icon:'⏳' },
  payment_pending: { label:'Paiement en cours',color:'#f97316',       icon:'💳' },
  confirmed:       { label:'Confirmé',         color:'var(--green)',  icon:'✅' },
  completed:       { label:'Terminé',          color:'var(--blue)',   icon:'🏁' },
  cancelled:       { label:'Annulé',           color:'var(--red)',    icon:'❌' },
};

/* ===== AUTH ===== */
function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const res = authCheckLogin(u, p);
  if (res.ok) {
    sessionStorage.setItem('md_admin','1');
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    init();
  } else if (res.locked) {
    document.getElementById('loginErr').textContent = `🔒 Trop de tentatives. Réessayez dans ${res.locked}s.`;
  } else {
    document.getElementById('loginErr').textContent = '❌ Identifiant ou mot de passe incorrect.';
  }
}

function doLogout() {
  sessionStorage.removeItem('md_admin');
  location.reload();
}

/* ===== FORGOT PASSWORD ===== */
function openForgot() {
  document.querySelector('.login-box').style.display = 'none';
  document.getElementById('forgotBox').style.display = 'block';
  document.getElementById('forgotStep1').style.display = 'block';
  document.getElementById('forgotStep2').style.display = 'none';
  document.getElementById('forgotErr').textContent = '';
  document.getElementById('forgotQuestionText').textContent = authHasQuestion()
    ? authQuestion()
    : 'Aucune question de sécurité configurée. Contactez un autre administrateur ou configurez-la depuis Paramètres > Sécurité.';
}
function closeForgot() {
  document.getElementById('forgotBox').style.display = 'none';
  document.querySelector('.login-box').style.display = 'block';
}
function checkForgotAnswer() {
  if (!authHasQuestion()) { document.getElementById('forgotErr').textContent = '❌ Pas de question configurée.'; return; }
  if (authCheckAnswer(document.getElementById('forgotAnswer').value)) {
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'block';
    document.getElementById('forgotErr').textContent = '';
  } else {
    document.getElementById('forgotErr').textContent = '❌ Réponse incorrecte.';
  }
}
function submitForgotReset() {
  const u = document.getElementById('forgotNewUser').value.trim();
  const p = document.getElementById('forgotNewPass').value;
  if (!u || !p) { document.getElementById('forgotErr').textContent = '⚠️ Remplissez les deux champs.'; return; }
  authResetCreds(u, p);
  alert('✅ Identifiants réinitialisés. Connectez-vous avec vos nouveaux identifiants.');
  closeForgot();
}

function togglePass() {
  const i = document.getElementById('loginPass');
  i.type = i.type === 'password' ? 'text' : 'password';
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sb.classList.toggle('open');
    document.getElementById('sidebarBackdrop')?.classList.toggle('show', sb.classList.contains('open'));
  } else {
    sb.classList.toggle('collapsed');
  }
}

/* ===== DB ===== */
/* Storage is localStorage; cloud sync per user is handled by js/supabase-store.js,
   which mirrors every md_* key to Supabase. No direct DB calls needed here. */
function getAll() {
  return JSON.parse(localStorage.getItem('md_reservations')||'[]').map(r => ({ amountPaid:0, ...r }));
}
function saveAll(data) {
  localStorage.setItem('md_reservations', JSON.stringify(data));
  renderNotif();
}

/* ===== PAYMENT ===== */
function paymentInfo(r) {
  const total  = +r.total || 0;
  const paid   = Math.min(+r.amountPaid || 0, total);
  const due    = Math.max(total - paid, 0);
  return { total, paid, due, full: due <= 0 && total > 0 };
}
function paymentBadge(r) {
  const p = paymentInfo(r);
  if (p.total <= 0) return '';
  return p.full
    ? `<span class="badge" style="background:rgba(34,197,94,.15);color:var(--green)">✅ Payé complet</span>`
    : `<span class="badge" style="background:rgba(249,115,22,.15);color:#f97316">💳 Avance — reste ${fmtN(p.due)} MAD</span>`;
}
function setPayment(id, amountPaid) {
  saveAll(getAll().map(r => r.id==id ? {...r, amountPaid: Math.max(0, +amountPaid||0)} : r));
  toast('💰 Paiement mis à jour');
  renderTable(); renderDashboard();
}

function setCaution(id, hasCaution, amount) {
  saveAll(getAll().map(r => r.id==id ? {...r, hasCaution, caution: hasCaution ? Math.max(0,+amount||0) : 0} : r));
  toast('🔒 Caution mise à jour');
  showDetail(id);
}
function toggleCautionEdit(id) {
  const r = getAll().find(r=>r.id==id);
  if (!r) return;
  document.getElementById('caution_wrap_'+id).innerHTML = `
    <label style="display:flex;align-items:center;gap:6px;font-size:.82rem">
      <input type="checkbox" id="cau_has_${id}" ${r.hasCaution?'checked':''} onchange="document.getElementById('cau_amt_wrap_${id}').style.display=this.checked?'':'none'"/> Caution prise
    </label>
    <div id="cau_amt_wrap_${id}" style="display:${r.hasCaution?'':'none'};margin-top:6px">
      <input id="cau_amt_${id}" type="number" min="0" placeholder="Montant MAD" value="${r.caution||0}"/>
    </div>
    <button class="act-btn ok" style="margin-top:6px" onclick="setCaution(${id}, document.getElementById('cau_has_${id}').checked, document.getElementById('cau_amt_${id}').value)">💾 Enregistrer</button>`;
}

function addPayment(id, extra) {
  extra = +extra || 0;
  if (extra <= 0) { toast('⚠️ Montant invalide'); return; }
  const r = getAll().find(r=>r.id==id);
  if (!r) return;
  const p = paymentInfo(r);
  const newPaid = Math.min(p.paid + extra, p.total);
  setPayment(id, newPaid);
  showDetail(id);
}

/* ===== MANUAL RESERVATION ===== */
function openManualModal() {
  document.getElementById('detailModal').innerHTML = `
    <div class="modal-title"><span>${T('m-manual-title')}</span><button class="modal-close-btn" onclick="closeDetail()">✕</button></div>
    <div class="form-group"><label>${T('f-name')}</label><input id="mr_name" type="text" placeholder="Nom complet"/></div>
    <div class="form-group"><label>${T('f-phone')}</label><input id="mr_phone" type="text" placeholder="06..."/></div>
    <div class="form-group"><label>${T('f-email-opt')}</label><input id="mr_email" type="email" placeholder="exemple@gmail.com"/></div>
    <div class="form-group"><label>${T('f-vehicle')}</label>
      <select id="mr_car" onchange="mrCheckAvail()">
        <option value="">${T('f-vehicle-choose')}</option>
        ${getVehicles().map(v=>`<option value="${esc(v.name)}">${esc(v.name)}${v.plate?' ('+esc(v.plate)+')':''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>${T('f-city')}</label><input id="mr_city" type="text" placeholder="Ville / adresse de livraison"/></div>
    <div class="form-group"><label>${T('f-start')}</label><input id="mr_start" type="date" onchange="mrCheckAvail()"/></div>
    <div class="form-group"><label>${T('f-end')}</label><input id="mr_end" type="date" onchange="mrCheckAvail()"/></div>
    <div id="mr_availMsg"></div>
    <div id="mr_miniCal"></div>
    <div class="form-group"><label>${T('f-total')}</label><input id="mr_total" type="number" min="0" placeholder="0" oninput="_mrSyncPaid()"/></div>
    <div class="form-group">
      <label>${T('f-paytype')}</label>
      <select id="mr_paytype" onchange="_mrSyncPaid()">
        <option value="full">${T('f-paid-full')}</option>
        <option value="deposit" selected>${T('f-paid-deposit')}</option>
        <option value="none">${T('f-paid-none')}</option>
      </select>
    </div>
    <div class="form-group" id="mr_paid_wrap"><label>${T('f-paid-amount')}</label><input id="mr_paid" type="number" min="0" placeholder="0"/></div>
    <div class="form-group">
      <label><input id="mr_hasCaution" type="checkbox" onchange="document.getElementById('mr_caution_wrap').style.display=this.checked?'':'none'"/> ${T('f-caution-check')}</label>
    </div>
    <div class="form-group" id="mr_caution_wrap" style="display:none"><label>${T('f-caution-amount')}</label><input id="mr_caution" type="number" min="0" placeholder="0"/></div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="modal-btn-confirm" onclick="submitManualReservation()">${T('btn-save')}</button>
      <button class="modal-btn-close" onclick="closeDetail()">${T('btn-cancel')}</button>
    </div>
  `;
  document.getElementById('detailOverlay').classList.add('open');
}

function _mrSyncPaid() {
  const type = document.getElementById('mr_paytype')?.value;
  const total = +document.getElementById('mr_total')?.value || 0;
  const paidInput = document.getElementById('mr_paid');
  const wrap = document.getElementById('mr_paid_wrap');
  if (!paidInput) return;
  if (type === 'full')      { paidInput.value = total; wrap.style.display = 'none'; }
  else if (type === 'none') { paidInput.value = 0;     wrap.style.display = 'none'; }
  else                      { wrap.style.display = ''; }
}

function mrCheckAvail() {
  const car = document.getElementById('mr_car').value;
  const start = document.getElementById('mr_start').value;
  const end = document.getElementById('mr_end').value;
  const msgEl = document.getElementById('mr_availMsg');
  const calEl = document.getElementById('mr_miniCal');
  window._mrAvailable = true;
  if (!car) { msgEl.innerHTML=''; calEl.innerHTML=''; return; }
  const v = getVehicles().find(x=>x.name===car);
  if (v && (v.status==='accident' || v.status==='maintenance')) {
    window._mrAvailable = false;
    msgEl.innerHTML = `<p style="color:var(--red);font-size:.82rem;font-weight:600">${v.status==='accident'?T('avail-no-accident'):T('avail-no-maint')}${v.note?' : '+esc(v.note):''}</p>`;
  } else if (start && end) {
    const overlap = vehicleReservations(car).find(r => start<=r.end && r.start<=end);
    if (overlap) {
      window._mrAvailable = false;
      msgEl.innerHTML = `<p style="color:var(--red);font-size:.82rem;font-weight:600">${T('avail-no-overlap')} ${overlap.start} ${T('avail-to')} ${overlap.end}</p>`;
    } else {
      msgEl.innerHTML = `<p style="color:var(--green);font-size:.82rem;font-weight:600">${T('avail-ok')}</p>`;
    }
  } else {
    msgEl.innerHTML = '';
  }
  if (v && +v.price && start && end) {
    const days = Math.max(1, Math.round((new Date(end)-new Date(start))/86400000));
    document.getElementById('mr_total').value = days * (+v.price);
    _mrSyncPaid();
  }
  if (v) {
    const d = start ? new Date(start) : new Date();
    calEl.innerHTML = miniCalendarHtml(car, d.getFullYear(), d.getMonth());
  } else calEl.innerHTML = '';
}

function miniCalendarHtml(car, year, month) {
  const resv = vehicleReservations(car);
  const isReserved = ds => resv.some(r => r.start<=ds && ds<=r.end);
  const first = new Date(year, month, 1);
  const startDow = (first.getDay()+6)%7;
  const daysInMonth = new Date(year, month+1, 0).getDate();
  let cells = '';
  for (let i=0;i<startDow;i++) cells += '<div></div>';
  for (let d=1; d<=daysInMonth; d++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const bg = isReserved(ds) ? 'rgba(230,51,41,.35)' : 'rgba(34,197,94,.25)';
    cells += `<div style="background:${bg};border-radius:6px;padding:6px 0;text-align:center;font-size:.7rem">${d}</div>`;
  }
  return `<div style="font-size:.72rem;color:var(--muted);margin:8px 0 4px">${MONTHS_FR[month]} ${year}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${cells}</div>`;
}

function submitManualReservation() {
  const v = id => document.getElementById(id).value.trim();
  const name = v('mr_name'), phone = v('mr_phone'), email = v('mr_email'), car = v('mr_car'), city = v('mr_city');
  const start = v('mr_start'), end = v('mr_end');
  const total = +v('mr_total') || 0;
  const payType = v('mr_paytype');
  const amountPaid = payType === 'full' ? total : payType === 'none' ? 0 : (+v('mr_paid') || 0);
  if (!name || !phone || !car || !city || !start || !end) { toast('⚠️ Remplissez les champs obligatoires'); return; }
  if (window._mrAvailable === false) { toast('❌ Véhicule indisponible pour ces dates'); return; }
  const hasCaution = document.getElementById('mr_hasCaution').checked;
  const caution = hasCaution ? (+v('mr_caution')||0) : 0;
  const days = Math.max(1, Math.round((new Date(end)-new Date(start))/86400000));
  const all = JSON.parse(localStorage.getItem('md_reservations')||'[]');
  all.unshift({ id: Date.now(), car, carPrice: days?Math.round(total/days):total,
    name, phone, email, city, start, end, days, total, status:'confirmed',
    createdAt: new Date().toISOString(), amountPaid, hasCaution, caution });
  localStorage.setItem('md_reservations', JSON.stringify(all));
  toast('✅ Réservation manuelle ajoutée');
  closeDetail();
  renderTable(); renderDashboard();
}

function deleteReservation(id) {
  if (!confirm('Supprimer définitivement cette réservation ?')) return;
  saveAll(getAll().filter(r=>r.id!=id));
  closeDetail();
  renderTable(); renderDashboard();
  toast('🗑️ Réservation supprimée');
}

function openEditReservation(id) {
  const r = getAll().find(r=>r.id==id);
  if (!r) return;
  document.getElementById('detailModal').innerHTML = `
    <div class="modal-title"><span>${T('m-edit-title')}</span><button class="modal-close-btn" onclick="closeDetail()">✕</button></div>
    <div class="form-group"><label>${T('f-name')}</label><input id="er_name" type="text" value="${esc(r.name)}"/></div>
    <div class="form-group"><label>${T('f-phone')}</label><input id="er_phone" type="text" value="${esc(r.phone)}"/></div>
    <div class="form-group"><label>${T('f-email-opt')}</label><input id="er_email" type="email" value="${esc(r.email||'')}"/></div>
    <div class="form-group"><label>${T('f-vehicle')}</label>
      <select id="er_car">${getVehicles().map(v=>`<option value="${esc(v.name)}" ${v.name===r.car?'selected':''}>${esc(v.name)}</option>`).join('')}
        ${!getVehicles().some(v=>v.name===r.car)?`<option value="${esc(r.car)}" selected>${esc(r.car)}</option>`:''}
      </select>
    </div>
    <div class="form-group"><label>${T('f-city')}</label><input id="er_city" type="text" value="${esc(r.city||'')}"/></div>
    <div class="form-group"><label>${T('f-start')}</label><input id="er_start" type="date" value="${r.start}"/></div>
    <div class="form-group"><label>${T('f-end')}</label><input id="er_end" type="date" value="${r.end}"/></div>
    <div class="form-group"><label>${T('f-total')}</label><input id="er_total" type="number" min="0" value="${r.total}"/></div>
    <div class="form-group"><label>${T('f-paid-amount2')}</label><input id="er_paid" type="number" min="0" value="${r.amountPaid||0}"/></div>
    <div class="form-group">
      <label><input id="er_hasCaution" type="checkbox" ${r.hasCaution?'checked':''} onchange="document.getElementById('er_caution_wrap').style.display=this.checked?'':'none'"/> ${T('f-caution-check')}</label>
    </div>
    <div class="form-group" id="er_caution_wrap" style="display:${r.hasCaution?'':'none'}"><label>${T('f-caution-amount')}</label><input id="er_caution" type="number" min="0" value="${r.caution||0}"/></div>
    <div class="form-group"><label>${T('th-status')}</label>
      <select id="er_status">${Object.entries(STATUS).map(([k,s])=>`<option value="${k}" ${r.status===k?'selected':''}>${s.icon} ${statusLabel(k)}</option>`).join('')}</select>
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="modal-btn-confirm" onclick="submitEditReservation(${id})">${T('btn-save')}</button>
      <button class="modal-btn-close" onclick="showDetail(${id})">${T('btn-cancel')}</button>
    </div>`;
}

function submitEditReservation(id) {
  const v = vid => document.getElementById(vid).value.trim();
  const start = v('er_start'), end = v('er_end');
  const days = Math.max(1, Math.round((new Date(end)-new Date(start))/86400000));
  const total = +v('er_total')||0;
  const hasCaution = document.getElementById('er_hasCaution').checked;
  saveAll(getAll().map(r => r.id==id ? {...r,
    name: v('er_name'), phone: v('er_phone'), email: v('er_email'),
    car: v('er_car'), city: v('er_city'), start, end, days, total,
    carPrice: days?Math.round(total/days):total,
    amountPaid: +v('er_paid')||0,
    hasCaution, caution: hasCaution ? (+v('er_caution')||0) : 0,
    status: v('er_status'),
  } : r));
  toast('✅ Réservation mise à jour');
  showDetail(id);
  renderTable(); renderDashboard();
}

function updateStatus(id, status) {
  saveAll(getAll().map(r => r.id==id ? {...r, status} : r));
  toast(`${STATUS[status].icon} Statut mis à jour : ${statusLabel(status)}`);
  renderTable(); renderDashboard();
}

function deleteRes(id) {
  if (!confirm('Supprimer cette réservation ?')) return;
  saveAll(getAll().filter(r => r.id!=id));
  toast('🗑️ Réservation supprimée');
  renderTable(); renderDashboard(); closeDetail();
}

function clearAll() {
  if (!confirm('Vider TOUTES les réservations ? Action irréversible.')) return;
  localStorage.removeItem('md_reservations');
  toast('🗑️ Toutes les réservations supprimées');
  renderTable(); renderDashboard();
}

/* ===== SECURITY: HTML-escape any visitor-supplied text before inserting via innerHTML ===== */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ===== UTILS ===== */
const fmt  = d => new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});
const fmtN = n => Number(n).toLocaleString('fr-FR');
const initials = name => name?.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase() || '?';

function statusLabel(k) { return (typeof T==='function' ? T('st-'+k) : null) || STATUS[k]?.label || k; }

function badge(s) {
  return `<span class="badge badge-${s}">${statusLabel(s)}</span>`;
}

function statusOptions(cur) {
  return Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${cur===k?'selected':''}>${v.icon} ${statusLabel(k)}</option>`).join('');
}

/* ===== TOAST ===== */
let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ===== NOTIF ===== */
function renderNotif() {
  const all = getAll();
  const n = all.filter(r=>r.status==='pending'||r.status==='payment_pending').length;
  const el = document.getElementById('notifBadge');
  if (!el) return;
  if (n) { el.textContent = n+' en attente'; el.style.display='block'; }
  else   { el.style.display='none'; }
}

/* ===== REAL-TIME NEW RESERVATION ALERT ===== */
let _lastResIds = new Set();
let _notifs     = []; // persists until dismissed

function _initBaseline() {
  getAll().forEach(r => _lastResIds.add(String(r.id)));
}

function checkNewReservations() {
  const all = getAll();
  const newOnes = all.filter(r => !_lastResIds.has(String(r.id)));
  newOnes.forEach(r => {
    _lastResIds.add(String(r.id));
    _addNotif(r);
  });
  if (newOnes.length) { renderDashboard(); renderTable(); }
}

function _addNotif(r) {
  _notifs.push({ id: r.id, name: r.name, car: r.car, total: r.total, city: r.city || '', ts: Date.now() });
  _renderBell();
  if (Notification?.permission === 'granted') {
    new Notification(`🔔 Nouvelle réservation — ${agencyInfo().name}`, {
      body: `${r.name} · ${r.car} · ${fmtN(r.total)} MAD`
    });
  }
}

function _renderBell() {
  const wrap = document.getElementById('bellWrap');
  const count = document.getElementById('bellCount');
  const list  = document.getElementById('notifPanelList');
  if (!wrap) return;
  if (!_notifs.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  count.textContent  = _notifs.length;
  list.innerHTML = _notifs.map((n, i) => `
    <div class="notif-item">
      <div class="notif-item-icon">🔔</div>
      <div class="notif-item-body">
        <div class="notif-item-title">Nouvelle réservation #${n.id}</div>
        <div class="notif-item-sub">${esc(n.name)} · ${esc(n.car)} · ${fmtN(n.total)} MAD</div>
      </div>
      <button class="notif-item-close" onclick="dismissNotif(${i})">✕</button>
    </div>
  `).join('');
}

function toggleNotifPanel() {
  document.getElementById('notifPanel').classList.toggle('open');
}

function dismissNotif(i) {
  _notifs.splice(i, 1);
  _renderBell();
  if (!_notifs.length) document.getElementById('notifPanel').classList.remove('open');
}

function dismissAllNotifs() {
  _notifs = [];
  _renderBell();
  document.getElementById('notifPanel').classList.remove('open');
}

// close panel when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('bellWrap');
  if (wrap && !wrap.contains(e.target)) document.getElementById('notifPanel')?.classList.remove('open');
});

function requestNotifPermission() {
  if (Notification?.permission === 'default') Notification.requestPermission();
}

/* ===== DASHBOARD ===== */
function renderDashboard() {
  const all = getAll();
  const total     = all.length;
  const pending         = all.filter(r=>r.status==='pending').length;
  const payment_pending = all.filter(r=>r.status==='payment_pending').length;
  const confirmed       = all.filter(r=>r.status==='confirmed').length;
  const cancelled       = all.filter(r=>r.status==='cancelled').length;
  const revenue         = all.filter(r=>r.status==='completed').reduce((s,r)=>s+ +r.total,0);
  const unpaidDue       = all.reduce((s,r)=>s+paymentInfo(r).due,0);

  // KPI
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-card c-yellow">
      <div class="kpi-icon">💳</div>
      <div class="kpi-val" style="font-size:1.4rem;color:#f97316">${fmtN(unpaidDue)}</div>
      <div class="kpi-label">Restant à percevoir (MAD)</div>
      ${unpaidDue?'<div class="kpi-sub warn">Avances en attente</div>':'<div class="kpi-sub up">Tout payé ✓</div>'}
    </div>
    <div class="kpi-card c-red">
      <div class="kpi-icon">📋</div>
      <div class="kpi-val">${total}</div>
      <div class="kpi-label">Total réservations</div>
      ${pending?`<div class="kpi-sub warn">${pending} en attente</div>`:'<div class="kpi-sub up">Tout traité ✓</div>'}
    </div>
    <div class="kpi-card c-green">
      <div class="kpi-icon">💰</div>
      <div class="kpi-val" style="font-size:1.5rem">${fmtN(revenue)}</div>
      <div class="kpi-label">Chiffre d'affaires (MAD)</div>
      <div class="kpi-sub up">Réservations terminées uniquement</div>
    </div>
    <div class="kpi-card c-yellow">
      <div class="kpi-icon">⏳</div>
      <div class="kpi-val" style="color:var(--yellow)">${pending + payment_pending}</div>
      <div class="kpi-label">En attente</div>
      ${payment_pending?`<div class="kpi-sub" style="color:#f97316">💳 ${payment_pending} paiement en cours</div>`:
        pending?`<div class="kpi-sub warn">Action requise</div>`:'<div class="kpi-sub up">Aucune en attente</div>'}
    </div>
    <div class="kpi-card c-blue">
      <div class="kpi-icon">✅</div>
      <div class="kpi-val" style="color:var(--green)">${confirmed}</div>
      <div class="kpi-label">Confirmées</div>
      ${cancelled?`<div class="kpi-sub" style="color:var(--red)">${cancelled} annulée(s)</div>`:'<div class="kpi-sub up">0 annulation</div>'}
    </div>
  `;

  // Recent
  const recent = all.slice(0,6);
  document.getElementById('recentList').innerHTML = recent.length
    ? recent.map(r=>`
      <div class="res-item" onclick="showDetail(${r.id})">
        <div class="res-avatar">${esc(initials(r.name))}</div>
        <div class="res-info">
          <div class="res-name">${esc(r.name)}</div>
          <div class="res-sub">${esc(r.car)} · ${esc(r.city)||'—'}</div>
        </div>
        <div class="res-right">
          <div class="res-amount">${fmtN(r.total)} MAD</div>
          <div class="res-date">${badge(r.status)}</div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted);font-size:.82rem;padding:10px 0">Aucune réservation</p>';

  // Pending quick actions
  const pends = all.filter(r=>r.status==='pending').slice(0,5);
  document.getElementById('pendingList').innerHTML = pends.length
    ? pends.map(r=>`
      <div class="pending-item">
        <div class="pending-name">${esc(r.name)}</div>
        <div class="pending-car">🚗 ${esc(r.car)} · ${fmtN(r.total)} MAD</div>
        <div class="pending-btns">
          <button class="p-btn confirm" onclick="updateStatus(${r.id},'confirmed')">✅ Confirmer</button>
          <button class="p-btn cancel"  onclick="updateStatus(${r.id},'cancelled')">❌ Annuler</button>
          <button class="p-btn wa"      onclick="sendWA(${r.id})">📲</button>
        </div>
      </div>`).join('')
    : '<p style="color:var(--muted);font-size:.82rem;padding:10px 0">Aucune en attente ✓</p>';

  // Status bars
  const counts = { pending, confirmed, completed:all.filter(r=>r.status==='completed').length, cancelled };
  document.getElementById('statusBars').innerHTML = Object.entries(STATUS).map(([k,v])=>{
    const n   = counts[k]||0;
    const pct = total ? Math.round(n/total*100) : 0;
    return `<div class="sbar">
      <div class="sbar-val" style="color:${v.color}">${n}</div>
      <div class="sbar-label">${v.label}</div>
      <div class="sbar-track"><div class="sbar-fill" style="width:${pct}%;background:${v.color}"></div></div>
      <div class="sbar-pct">${pct}%</div>
    </div>`;
  }).join('');

  renderEcheances();
}

/* ===== TABLE ===== */
function renderTable() {
  const search = (document.getElementById('searchInput')?.value||'').toLowerCase();
  const status = document.getElementById('filterStatus')?.value||'';
  let data = getAll();
  if (search) data = data.filter(r =>
    r.name?.toLowerCase().includes(search)||r.car?.toLowerCase().includes(search)||
    r.city?.toLowerCase().includes(search)||r.phone?.includes(search)
  );
  if (status) data = data.filter(r=>r.status===status);

  const tbody = document.getElementById('resBody');
  const empty = document.getElementById('emptyState');
  if (!data.length) { tbody.innerHTML=''; empty.style.display='flex'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = data.map((r,i)=>`
    <tr>
      <td style="color:var(--muted);font-size:.72rem">#${String(i+1).padStart(3,'0')}</td>
      <td>
        <div class="td-name">${esc(r.name)}</div>
        <div class="td-phone">${esc(r.phone)}</div>
      </td>
      <td style="font-weight:600">${esc(r.car)}</td>
      <td style="font-size:.78rem;color:var(--muted);max-width:130px">${esc(r.city)||'—'}</td>
      <td style="font-size:.78rem;line-height:1.6">
        📅 ${fmt(r.start)}<br><span style="color:var(--muted)">→ ${fmt(r.end)}</span>
      </td>
      <td style="color:var(--muted)">${r.days}j</td>
      <td class="td-price">${fmtN(r.total)} <span style="color:var(--red);font-size:.7rem">MAD</span></td>
      <td>${paymentBadge(r)||'—'}</td>
      <td><select class="status-select" onchange="updateStatus(${r.id},this.value)">${statusOptions(r.status)}</select></td>
      <td>
        <div class="actions">
          <button class="act-btn" onclick="showDetail(${r.id})" title="Détails">👁</button>
          <button class="act-btn wa" onclick="sendWA(${r.id})" title="WhatsApp">📲</button>
          ${r.status==='pending'?`<button class="act-btn ok" onclick="updateStatus(${r.id},'confirmed')" title="Confirmer">✅</button>`:''}
          ${r.status!=='cancelled'&&r.status!=='completed'?`<button class="act-btn no" onclick="updateStatus(${r.id},'cancelled')" title="Annuler">❌</button>`:''}
          <button class="act-btn del" onclick="deleteRes(${r.id})" title="Supprimer">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

/* ===== DETAIL MODAL ===== */
function showDetail(id) {
  const r = getAll().find(r=>r.id==id);
  if (!r) return;
  document.getElementById('detailModal').innerHTML = `
    <div class="modal-title">
      <span>📋 ${T('nav-res')}</span>
      <button class="modal-close-btn" onclick="closeDetail()">✕</button>
    </div>
    <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">${badge(r.status)}</div>
    <div class="detail-row"><span class="dk">${T('d-client')}</span><span class="dv">${esc(r.name)}</span></div>
    <div class="detail-row"><span class="dk">${T('d-phone')}</span><span class="dv">${esc(r.phone)}</span></div>
    ${r.email?`<div class="detail-row"><span class="dk">${T('d-email')}</span><span class="dv">${esc(r.email)}</span></div>`:''}
    <div class="detail-row"><span class="dk">${T('d-vehicle')}</span><span class="dv">${esc(r.car)}</span></div>
    <div class="detail-row"><span class="dk">${T('d-place')}</span><span class="dv">${esc(r.city)||'—'}</span></div>
    <div class="detail-row"><span class="dk">${T('d-start')}</span><span class="dv">${fmt(r.start)}</span></div>
    <div class="detail-row"><span class="dk">${T('d-end')}</span><span class="dv">${fmt(r.end)}</span></div>
    <div class="detail-row"><span class="dk">${T('d-duration')}</span><span class="dv">${r.days} jour${r.days>1?'s':''}</span></div>
    <div class="detail-row"><span class="dk">${T('d-price-day')}</span><span class="dv">${fmtN(r.carPrice)} MAD</span></div>
    <div class="detail-total-row">
      <span>${T('d-total')}</span>
      <span class="detail-total-val">${fmtN(r.total)} MAD</span>
    </div>
    <div class="detail-row"><span class="dk">${T('d-payment')}</span><span class="dv">${paymentBadge(r)||'—'}</span></div>
    <div class="detail-row"><span class="dk">${T('d-paid')}</span><span class="dv">${fmtN(paymentInfo(r).paid)} MAD</span></div>
    <div class="detail-row"><span class="dk">${T('d-due')}</span><span class="dv">${fmtN(paymentInfo(r).due)} MAD</span></div>
    <div class="detail-row"><span class="dk">${T('d-caution')}</span><span class="dv">${r.hasCaution ? fmtN(r.caution)+' MAD' : T('d-caution-none')} <button class="act-btn" onclick="toggleCautionEdit(${r.id})">✏️</button></span></div>
    <div id="caution_wrap_${r.id}"></div>
    ${paymentInfo(r).due > 0 ? `
    <div class="form-group">
      <label>💰 ${T('f-paid-amount2')}</label>
      <div style="display:flex;gap:8px">
        <input id="addpay_${r.id}" type="number" min="0" max="${paymentInfo(r).due}" placeholder="Ex: 500"/>
        <button class="btn-sm" onclick="addPayment(${r.id}, document.getElementById('addpay_${r.id}').value)">➕ Ajouter</button>
      </div>
      <button class="btn-sm" style="margin-top:6px;width:100%" onclick="addPayment(${r.id}, ${paymentInfo(r).due})">✅ ${fmtN(paymentInfo(r).due)} MAD</button>
    </div>` : ''}
    <button class="modal-btn-wa" style="margin-top:10px;width:100%" onclick="downloadInvoice(${r.id})">${T('btn-invoice')}</button>
    <div class="form-group" style="margin-top:12px">
      <label>📄 ${T('d-contract')||'Contrat de location'}</label>
      ${r.contract ? `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${r.contract.startsWith('data:image') ? `<img src="${r.contract}" style="width:70px;height:70px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="window.open('${r.contract}','_blank')"/>` : `<span style="font-size:1.6rem">📄</span>`}
          <a href="${r.contract}" download="${esc(r.contractName)||'contrat_'+r.id+(r.contract.startsWith('data:application/pdf')?'.pdf':'')}" class="btn-sm">⬇️ ${T('btn-download')||'Télécharger'}</a>
          <button class="btn-sm danger" onclick="removeContract(${r.id})">🗑️ ${T('btn-delete')||'Supprimer'}</button>
        </div>` : `
        <input id="contract_file_${r.id}" type="file" accept="image/*,.pdf"/>
        <button class="btn-sm" style="margin-top:6px" onclick="uploadContract(${r.id})">📤 ${T('btn-upload-contract')||'Téléverser le contrat'}</button>`}
    </div>
    <div class="detail-row"><span class="dk">${T('d-created')}</span><span class="dv">${new Date(r.createdAt).toLocaleString('fr-FR')}</span></div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn-sm" style="width:100%" onclick="openEditReservation(${r.id})">${T('btn-edit-all')}</button>
      ${r.status==='pending'?`<button class="modal-btn-confirm" onclick="updateStatus(${r.id},'confirmed');closeDetail()">${T('btn-confirm')}</button>`:''}
      ${r.status!=='cancelled'&&r.status!=='completed'?`<button class="modal-btn-cancel" onclick="updateStatus(${r.id},'cancelled');closeDetail()">${T('btn-reject')}</button>`:''}
      <button class="modal-btn-wa" onclick="sendWA(${r.id})">${T('btn-wa')}</button>
      <button class="act-btn del" onclick="deleteReservation(${r.id})">${T('btn-delete')}</button>
      <button class="modal-btn-close" onclick="closeDetail()">${T('btn-close')}</button>
    </div>
  `;
  document.getElementById('detailOverlay').classList.add('open');
}

function closeDetail(e) {
  if (!e || e.target===document.getElementById('detailOverlay'))
    document.getElementById('detailOverlay').classList.remove('open');
}

/* ===== CONTRACT (Contrat de location) ===== */
function uploadContract(id) {
  const input = document.getElementById('contract_file_'+id);
  const file = input?.files?.[0];
  if (!file) { toast('⚠️ Choisissez un fichier (image ou PDF)'); return; }
  if (!/^image\/|application\/pdf$/.test(file.type)) { toast('⚠️ Format non supporté — image ou PDF uniquement'); return; }
  if (file.size > 4*1024*1024) { toast('⚠️ Fichier trop lourd (max 4 Mo)'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    saveAll(getAll().map(r => r.id==id ? {...r, contract: ev.target.result, contractName: file.name} : r));
    toast('✅ Contrat téléversé');
    showDetail(id);
  };
  reader.readAsDataURL(file);
}
function removeContract(id) {
  if (!confirm('Supprimer le contrat ?')) return;
  saveAll(getAll().map(r => r.id==id ? {...r, contract: '', contractName: ''} : r));
  toast('🗑️ Contrat supprimé');
  showDetail(id);
}

/* ===== CLIENTS ===== */
let _clientSearch = '';
function avatarColor(seed) {
  const colors = ['#e63329','#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#ec4899','#14b8a6'];
  const s = String(seed || '');
  let h = 0; for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function renderClients() {
  const all = getAll();
  const map = {};
  for (const r of all) {
    const key = r.phone || r.name;
    if (!map[key]) map[key] = { name: r.name, phone: r.phone, email: r.email, reservations: [], total: 0 };
    map[key].reservations.push(r);
    if (r.status !== 'cancelled') map[key].total += +r.total || 0;
  }
  let clients = Object.values(map).sort((a, b) => b.total - a.total);
  if (_clientSearch) {
    const q = _clientSearch.toLowerCase();
    clients = clients.filter(c => c.name?.toLowerCase().includes(q) || (c.phone||'').includes(q) || c.email?.toLowerCase().includes(q));
  }
  document.getElementById('clientCount').textContent = clients.length + ' client(s)';
  document.getElementById('clientGrid').innerHTML = clients.length
    ? clients.map(c => {
        const n = c.reservations.length;
        const active = c.reservations.filter(r => r.status === 'confirmed' || r.status === 'pending').length;
        const last = c.reservations[c.reservations.length - 1];
        return `<div class="client-card" onclick="openClientDetail('${esc(c.phone || c.name).replace(/'/g,"\\'")}')">
          <div class="cc-top">
            <div class="cc-avatar" style="background:${avatarColor(c.phone||c.name)}">${esc(initials(c.name))}</div>
            <div>
              <div class="cc-name">${esc(c.name)}</div>
              <div class="cc-phone">${esc(c.phone) || '—'}</div>
            </div>
          </div>
          <div class="cc-stats">
            <div class="cc-stat"><div class="cc-stat-val">${n}</div><div class="cc-stat-label">Réserv.</div></div>
            <div class="cc-stat"><div class="cc-stat-val" style="color:var(--green);font-size:.8rem">${fmtN(c.total)}</div><div class="cc-stat-label">MAD total</div></div>
            <div class="cc-stat"><div class="cc-stat-val" style="color:var(--blue)">${active}</div><div class="cc-stat-label">En cours</div></div>
          </div>
          ${last ? `<div style="margin-top:10px;font-size:.73rem;color:var(--muted)">Dernière: 🚗 ${esc(last.car)} · ${fmt(last.start)}</div>` : ''}
        </div>`;
      }).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><span>👥</span><p>Aucun client trouvé</p></div>';
}

function openClientDetail(key) {
  const list = getAll().filter(r => (r.phone || r.name) === key);
  if (!list.length) return;
  const c = list[0];
  const totalRevenue = list.filter(r => r.status !== 'cancelled').reduce((s, r) => s + (+r.total||0), 0);
  document.getElementById('detailModal').innerHTML = `
    <div class="modal-title"><span>👤 Profil client</span><button class="modal-close-btn" onclick="closeDetail()">✕</button></div>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)">
      <div class="cc-avatar" style="width:52px;height:52px;font-size:1rem;background:${avatarColor(c.phone||c.name)}">${esc(initials(c.name))}</div>
      <div>
        <div style="font-weight:700;font-size:1rem">${esc(c.name)}</div>
        <div style="color:var(--muted);font-size:.8rem">${esc(c.phone) || '—'} ${c.email ? '· ' + esc(c.email) : ''}</div>
      </div>
    </div>
    <div class="cc-stats" style="margin-bottom:16px">
      <div class="cc-stat"><div class="cc-stat-val">${list.length}</div><div class="cc-stat-label">Réservations</div></div>
      <div class="cc-stat"><div class="cc-stat-val" style="color:var(--green);font-size:.8rem">${fmtN(totalRevenue)}</div><div class="cc-stat-label">MAD dépensé</div></div>
      <div class="cc-stat"><div class="cc-stat-val" style="color:var(--yellow)">${list.filter(r=>r.status==='pending').length}</div><div class="cc-stat-label">En attente</div></div>
    </div>
    <div style="font-weight:600;font-size:.82rem;margin-bottom:8px;color:var(--muted)">HISTORIQUE</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${list.map(r => `
        <div class="res-item" onclick="closeDetail();showDetail(${r.id})" style="cursor:pointer">
          <div style="flex:1">
            <div class="res-name">🚗 ${esc(r.car)}</div>
            <div style="color:var(--muted);font-size:.75rem">${fmt(r.start)} → ${fmt(r.end)} · ${r.days}j</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700">${fmtN(r.total)} MAD</div>
            <div>${badge(r.status)}</div>
          </div>
          ${r.contract ? `<a href="${r.contract}" download="${esc(r.contractName)||'contrat_'+r.id+(r.contract.startsWith('data:application/pdf')?'.pdf':'')}" onclick="event.stopPropagation()" class="btn-sm" style="margin-left:6px">⬇️ ${r.contract.startsWith('data:application/pdf')?'PDF':'Contrat'}</a>` : ''}
        </div>`).join('')}
    </div>
    <div class="modal-actions" style="margin-top:16px">
      ${c.phone ? `<button class="modal-btn-wa" onclick="window.open('https://wa.me/${(c.phone||'').replace(/\\D/g,'')}','_blank')">📲 WhatsApp</button>` : ''}
      <button class="btn-sm" onclick="exportContact('${esc(key).replace(/'/g,"\\'")}')">📇 Exporter contact</button>
      <button class="modal-btn-close" onclick="closeDetail()">Fermer</button>
    </div>
  `;
  document.getElementById('detailOverlay').classList.add('open');
}

/* ── CONTACT EXPORT ── */
function vcardFor(c) {
  const ag = agencyInfo();
  return [
    'BEGIN:VCARD','VERSION:3.0',
    `FN:${c.name||'Client'}`,
    `N:${c.name||'Client'};;;;`,
    c.phone ? `TEL;TYPE=CELL:${c.phone}` : '',
    c.email ? `EMAIL:${c.email}` : '',
    `NOTE:Client ${ag.name} — ${c.reservations?c.reservations.length:1} réservation(s)`,
    'END:VCARD'
  ].filter(Boolean).join('\n');
}
function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function exportContact(key) {
  const list = getAll().filter(r => (r.phone || r.name) === key);
  if (!list.length) return;
  const c = list[0];
  downloadFile(vcardFor({...c, reservations:list}), `Contact_${(c.name||'client').replace(/[^a-zA-Z0-9]+/g,'_')}.vcf`, 'text/vcard');
  toast('📇 Contact exporté');
}
function exportAllContacts() {
  const all = getAll();
  const map = {};
  for (const r of all) {
    const key = r.phone || r.name;
    if (!map[key]) map[key] = { name: r.name, phone: r.phone, email: r.email, reservations: [] };
    map[key].reservations.push(r);
  }
  const clients = Object.values(map);
  if (!clients.length) { toast('⚠️ Aucun client à exporter'); return; }
  downloadFile(clients.map(vcardFor).join('\n'), 'Contacts_clients.vcf', 'text/vcard');
  toast(`📇 ${clients.length} contact(s) exporté(s)`);
}

/* ===== STATS ===== */
function renderStats() {
  const all = getAll();
  const revenue   = all.filter(r=>r.status!=='cancelled').reduce((s,r)=>s+ +r.total,0);
  const avg       = all.length ? Math.round(revenue/all.length) : 0;
  const completed = all.filter(r=>r.status==='completed').length;
  const pending   = all.filter(r=>r.status==='pending').length;

  document.getElementById('statsKpi').innerHTML = `
    <div class="kpi-card c-red"><div class="kpi-icon">📋</div><div class="kpi-val">${all.length}</div><div class="kpi-label">Total réservations</div></div>
    <div class="kpi-card c-green"><div class="kpi-icon">💰</div><div class="kpi-val" style="font-size:1.4rem">${fmtN(revenue)}</div><div class="kpi-label">CA total (MAD)</div></div>
    <div class="kpi-card c-yellow"><div class="kpi-icon">🧮</div><div class="kpi-val">${fmtN(avg)}</div><div class="kpi-label">Panier moyen (MAD)</div></div>
    <div class="kpi-card c-blue"><div class="kpi-icon">🏁</div><div class="kpi-val" style="color:var(--blue)">${completed}</div><div class="kpi-label">Terminées</div></div>
  `;

  // Status chart
  const counts = {};
  const cars   = {};
  const cities = {};
  all.forEach(r=>{
    counts[r.status] = (counts[r.status]||0)+1;
    if(r.car)  cars[r.car]   = (cars[r.car]  ||0)+1;
    if(r.city) cities[r.city]= (cities[r.city]||0)+1;
  });

  const max = Math.max(...Object.values(counts),1);
  document.getElementById('statusChart').innerHTML = Object.entries(STATUS).map(([k,v])=>{
    const n = counts[k]||0;
    return `<div class="bar-row">
      <span class="bar-label">${v.icon} ${v.label}</span>
      <div class="bar-bg"><div class="bar-fill" style="width:${Math.round(n/max*100)}%;background:${v.color}"></div></div>
      <span class="bar-val">${n}</span>
    </div>`;
  }).join('');

  const topList = (obj, max=5) => {
    const sorted = Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,max);
    const mx = sorted[0]?.[1]||1;
    return sorted.map(([k,v])=>`<div class="bar-row">
      <span class="bar-label">${k}</span>
      <div class="bar-bg"><div class="bar-fill" style="width:${Math.round(v/mx*100)}%;background:var(--red)"></div></div>
      <span class="bar-val">${v}</span>
    </div>`).join('') || '<p style="color:var(--muted);font-size:.82rem">Aucune donnée</p>';
  };

  document.getElementById('topCars').innerHTML   = topList(cars);
  document.getElementById('topCities').innerHTML = topList(cities);

  // Revenue chart (last 10 reservations)
  const recent = all.slice(0,10).reverse();
  const maxRev = Math.max(...recent.map(r=>+r.total),1);
  document.getElementById('revenueChart').innerHTML = recent.length
    ? recent.map(r=>`
      <div class="rev-bar-wrap" title="${esc(r.name)} · ${fmtN(r.total)} MAD">
        <div class="rev-bar" style="height:${Math.round(+r.total/maxRev*100)}%;background:${r.status==='cancelled'?'var(--border)':'var(--red)'}"></div>
        <div class="rev-label">${esc(r.car?.split(' ')[0])}</div>
        <div class="rev-val">${Math.round(+r.total/1000)}k</div>
      </div>`).join('')
    : '<p style="color:var(--muted);font-size:.82rem">Aucune donnée</p>';
}

/* ===== AGENCE ===== */
function agencyInfo() {
  const s = JSON.parse(localStorage.getItem('md_site_settings')||'{}');
  return {
    name:    s.agencyName    || 'CRM Réservations',
    phone:   s.agencyPhone   || '',
    email:   s.agencyEmail   || '',
    address: s.agencyAddress || '',
    logo:    s.agencyLogo    || '',
  };
}

/* ===== FACTURE ===== */
function downloadInvoice(id) {
  const r = getAll().find(r=>r.id==id);
  if (!r) return;
  const p = paymentInfo(r);
  const ag = agencyInfo();
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>Facture #${r.id}</title>
  <style>
    body{font-family:Arial,sans-serif;padding:40px;color:#111}
    .ag-header{display:flex;align-items:center;gap:14px;margin-bottom:6px}
    .ag-header img{width:54px;height:54px;border-radius:10px;object-fit:cover}
    h1{color:#e63329;font-size:1.5rem}
    .ag-contact{color:#666;font-size:.85rem;margin-bottom:10px}
    table{width:100%;border-collapse:collapse;margin-top:20px}
    td{padding:8px 0;border-bottom:1px solid #eee}
    td:first-child{color:#666;width:45%}
    .total{font-size:1.3rem;font-weight:bold;color:#e63329;margin-top:20px}
    .badge{display:inline-block;padding:4px 12px;border-radius:100px;font-size:.8rem;font-weight:bold}
  </style></head><body>
    <div class="ag-header">
      ${ag.logo?`<img src="${ag.logo}"/>`:''}
      <h1>${esc(ag.name)} — Facture</h1>
    </div>
    ${(ag.phone||ag.email||ag.address)?`<p class="ag-contact">${[ag.phone&&'📞 '+esc(ag.phone),ag.email&&'✉️ '+esc(ag.email),ag.address&&'📍 '+esc(ag.address)].filter(Boolean).join(' · ')}</p>`:''}
    <p>Facture N° ${r.id} · ${new Date(r.createdAt).toLocaleDateString('fr-FR')}</p>
    <table>
      <tr><td>👤 Client</td><td>${esc(r.name)}</td></tr>
      <tr><td>📞 Téléphone</td><td>${esc(r.phone)}</td></tr>
      ${r.email?`<tr><td>✉️ Email</td><td>${esc(r.email)}</td></tr>`:''}
      <tr><td>📍 Lieu de livraison</td><td>${esc(r.city)||'—'}</td></tr>
      <tr><td>🚘 Véhicule</td><td>${esc(r.car)}</td></tr>
      <tr><td>📅 Départ</td><td>${fmt(r.start)}</td></tr>
      <tr><td>📅 Retour</td><td>${fmt(r.end)}</td></tr>
      <tr><td>⏱ Durée</td><td>${r.days} jour(s)</td></tr>
      <tr><td>💵 Prix/jour</td><td>${fmtN(r.carPrice)} MAD</td></tr>
      <tr><td>💰 Total</td><td>${fmtN(p.total)} MAD</td></tr>
      <tr><td>✅ Déjà payé</td><td>${fmtN(p.paid)} MAD</td></tr>
      <tr><td>⏳ Reste à payer</td><td>${fmtN(p.due)} MAD</td></tr>
      <tr><td>Statut</td><td>${p.full?'Payé complet':'Avance'} · ${statusLabel(r.status)}</td></tr>
      ${r.hasCaution?`<tr><td>🔒 Caution</td><td>${fmtN(r.caution)} MAD</td></tr>`:''}
    </table>
    <p class="total">Total : ${fmtN(p.total)} MAD</p>
  </body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Facture_${ag.name.replace(/[^a-zA-Z0-9]+/g,'_')}_${r.id}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('🧾 Facture téléchargée');
}

/* ===== WHATSAPP ===== */
function sendWA(id) {
  const r = getAll().find(r=>r.id==id);
  if (!r) return;
  const phone = (r.phone || '').replace(/\D/g,'');
  const dest  = phone.startsWith('0') ? '212' + phone.slice(1) : phone || WA;
  const ag = agencyInfo();
  const msg = `🚗 *Réservation ${ag.name}*\n\n👤 *Nom :* ${r.name}\n📞 *Tél :* ${r.phone}${r.email?'\n✉️ *Email :* '+r.email:''}\n📍 *Lieu :* ${r.city||'—'}\n🚘 *Véhicule :* ${r.car}\n📅 *Départ :* ${fmt(r.start)}\n📅 *Retour :* ${fmt(r.end)}\n⏱ *Durée :* ${r.days} jour${r.days>1?'s':''}\n💰 *Total :* ${fmtN(r.total)} MAD\n${STATUS[r.status].icon} *Statut :* ${STATUS[r.status].label}`;
  window.open(`https://wa.me/${dest}?text=${encodeURIComponent(msg)}`, '_blank');
}

/* ===== EXPORT EXCEL ===== */
function openExportModal() { document.getElementById('exportOverlay').style.display='flex'; }
function closeExportModal() { document.getElementById('exportOverlay').style.display='none'; }

function filterByPeriod(data, period) {
  if (period === 'all') return data;
  const from = new Date();
  if      (period==='week')    from.setDate(from.getDate()-7);
  else if (period==='month')   from.setDate(from.getDate()-30);
  else if (period==='3months') from.setMonth(from.getMonth()-3);
  else if (period==='6months') from.setMonth(from.getMonth()-6);
  else if (period==='year')    from.setFullYear(from.getFullYear()-1);
  return data.filter(r => new Date(r.createdAt) >= from);
}

function doExport() {
  const all = getAll();
  if (!all.length) { toast('⚠️ Aucune réservation'); return; }
  const period = document.querySelector('input[name="expPeriod"]:checked')?.value || 'all';
  const data   = filterByPeriod(all, period);
  if (!data.length) { toast('⚠️ Aucune donnée pour cette période'); return; }

  const WB = XLSX.utils.book_new();
  const fmt   = d => d ? new Date(d).toLocaleDateString('fr-FR') : '';
  const fmtDT = d => d ? new Date(d).toLocaleString('fr-FR') : '';
  const sLabel = s => STATUS[s]?.label || s;
  const num = n => Number(n) || 0;
  const PERIOD_LABELS = { week:'Cette semaine', month:'Ce mois (30j)', '3months':'3 derniers mois', '6months':'6 derniers mois', year:'Cette année', all:'Toutes les données' };

  const confirmed = data.filter(r=>r.status==='confirmed');
  const pending   = data.filter(r=>r.status==='pending');
  const cancelled = data.filter(r=>r.status==='cancelled');
  const totalRev  = confirmed.reduce((s,r)=>s+num(r.total),0);
  const byCar = {};
  confirmed.forEach(r=>{ byCar[r.car]=(byCar[r.car]||0)+num(r.total); });
  const topCars = Object.entries(byCar).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // ── Résumé ──
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['📊 RAPPORT MAROCDRIVE','',''],
    ['Période', PERIOD_LABELS[period],''],
    ['Généré le', fmtDT(new Date()),''],
    ['','',''],
    ['INDICATEURS CLÉS','',''],
    ['Total réservations', data.length,''],
    ['Confirmées', confirmed.length,''],
    ['En attente', pending.length,''],
    ['Annulées', cancelled.length,''],
    ['Taux confirmation', confirmed.length ? Math.round(confirmed.length/data.length*100)+'%':'0%',''],
    ['','',''],
    ['CHIFFRE D\'AFFAIRES','',''],
    ['Revenu total (MAD)', totalRev,''],
    ['Panier moyen (MAD)', confirmed.length ? Math.round(totalRev/confirmed.length):0,''],
    ['Total jours loués', confirmed.reduce((s,r)=>s+num(r.days),0),''],
    ['','',''],
    ['TOP 5 VÉHICULES','',''],
    ['Véhicule','Revenu MAD',''],
    ...topCars.map(([c,v])=>[c,v,'']),
  ]);
  ws1['!cols']=[{wch:28},{wch:22},{wch:10}];
  XLSX.utils.book_append_sheet(WB, ws1, '📊 Résumé');

  // ── Réservations ──
  const hdrs = ['ID','Nom','Téléphone','Email','Véhicule','Ville','Date départ','Date retour','Jours','Total MAD','Payé MAD','Reste MAD','Statut','Créé le'];
  const ws2 = XLSX.utils.aoa_to_sheet([hdrs, ...data.map(r=>{
    const p = paymentInfo(r);
    return [r.id, r.name, r.phone, r.email||'', r.car, r.city||'',
    fmt(r.start), fmt(r.end), num(r.days), num(r.total), p.paid, p.due,
    sLabel(r.status), fmtDT(r.createdAt)];
  })]);
  ws2['!cols']=[{wch:14},{wch:20},{wch:16},{wch:22},{wch:18},{wch:18},{wch:13},{wch:13},{wch:7},{wch:12},{wch:10},{wch:10},{wch:12},{wch:18}];
  XLSX.utils.book_append_sheet(WB, ws2, '📋 Réservations');

  // ── Par véhicule ──
  const cs={};
  data.forEach(r=>{ if(!cs[r.car])cs[r.car]={tot:0,conf:0,ann:0,rev:0,days:0}; cs[r.car].tot++; if(r.status==='confirmed'){cs[r.car].conf++;cs[r.car].rev+=num(r.total);cs[r.car].days+=num(r.days);} if(r.status==='cancelled')cs[r.car].ann++; });
  const ws3 = XLSX.utils.aoa_to_sheet([['Véhicule','Total','Confirmées','Annulées','Revenu MAD','Jours','Panier moy.'],
    ...Object.entries(cs).sort((a,b)=>b[1].rev-a[1].rev).map(([c,s])=>[c,s.tot,s.conf,s.ann,s.rev,s.days,s.conf?Math.round(s.rev/s.conf):0])]);
  ws3['!cols']=[{wch:20},{wch:8},{wch:12},{wch:11},{wch:12},{wch:8},{wch:13}];
  XLSX.utils.book_append_sheet(WB, ws3, '🚗 Par véhicule');

  // ── Par ville ──
  const cv={};
  data.forEach(r=>{ const c=r.city||'Non précisé'; if(!cv[c])cv[c]={tot:0,rev:0}; cv[c].tot++; if(r.status==='confirmed')cv[c].rev+=num(r.total); });
  const ws4 = XLSX.utils.aoa_to_sheet([['Ville','Réservations','Revenu MAD'],
    ...Object.entries(cv).sort((a,b)=>b[1].tot-a[1].tot).map(([c,s])=>[c,s.tot,s.rev])]);
  ws4['!cols']=[{wch:22},{wch:14},{wch:13}];
  XLSX.utils.book_append_sheet(WB, ws4, '📍 Par ville');

  // ── Par mois ──
  const cm={};
  data.forEach(r=>{ const k=new Date(r.createdAt).toLocaleDateString('fr-FR',{year:'numeric',month:'long'}); if(!cm[k])cm[k]={tot:0,rev:0}; cm[k].tot++; if(r.status==='confirmed')cm[k].rev+=num(r.total); });
  const ws5 = XLSX.utils.aoa_to_sheet([['Mois','Réservations','Revenu MAD'],
    ...Object.entries(cm).map(([m,s])=>[m,s.tot,s.rev])]);
  ws5['!cols']=[{wch:20},{wch:14},{wch:13}];
  XLSX.utils.book_append_sheet(WB, ws5, '📅 Par mois');

  const pLabel={week:'semaine',month:'mois','3months':'3mois','6months':'6mois',year:'annee',all:'complet'}[period];
  const agName = agencyInfo().name.replace(/[^a-zA-Z0-9]+/g,'_');
  XLSX.writeFile(WB, `${agName}_${pLabel}_${new Date().toISOString().slice(0,10)}.xlsx`);
  closeExportModal();
  toast('✅ Fichier Excel téléchargé');
}

/* ===== TABS ===== */
function showTab(tab, el) {
  document.querySelectorAll('.sb-link').forEach(a=>a.classList.remove('active'));
  if (el) el.classList.add('active');
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarBackdrop')?.classList.remove('show');
  }
  ['Dashboard','Clients','Reservations','Vehicles','Vidange','Stats','Global','Agencies','Account','Settings'].forEach(t=>{
    const el2 = document.getElementById('tab'+t);
    if (el2) el2.style.display = 'none';
  });
  const map = {dashboard:'Dashboard',clients:'Clients',reservations:'Reservations',vehicles:'Vehicles',vidange:'Vidange',stats:'Stats',global:'Global',agencies:'Agencies',account:'Account',settings:'Settings'};
  const elTab = document.getElementById('tab' + map[tab]);
  if (elTab) elTab.style.display = 'block';
  window.currentAdminTab = tab;
  const L = PANEL_LANGS[localStorage.getItem('md_panel_lang') || 'fr'];
  const _fb = {account:'👤 Mon compte',settings:'⚙️ Paramètres',vehicles:'🚙 Véhicules',vidange:'🛢️ Vidange',global:'🌐 Vue globale',agencies:'🏢 Mes agences'};
  document.getElementById('pageTitle').textContent = L.titles[tab] || _fb[tab] || tab;
  if (tab==='global' && typeof renderGlobal==='function') renderGlobal();
  if (tab==='agencies' && typeof renderAgencies==='function') renderAgencies();
  if (tab==='account') renderAccount();
  if (tab==='clients') renderClients();
  if (tab==='reservations') renderTable();
  if (tab==='vehicles') renderVehicles();
  if (tab==='vidange') renderVidange();
  if (tab==='stats') renderStats();
  if (tab==='settings') renderSettings();
  renderEchBadge();
}

/* ===== VEHICLES ===== */
const VSTATUS = {
  available:   { key:'veh-available',   icon:'🟢', cls:'confirmed' },
  reserved:    { key:'veh-reserved',    icon:'🔵', cls:'completed' },
  maintenance: { key:'veh-maintenance', icon:'🛠️', cls:'pending' },
  accident:    { key:'veh-accident',    icon:'🚨', cls:'cancelled' },
};
function vStatusLabel(k) { return (typeof T==='function' ? T(VSTATUS[k].key) : null) || VSTATUS[k].key; }

function getVehicles() { return JSON.parse(localStorage.getItem('md_vehicles')||'[]'); }
function saveVehicles(v) { localStorage.setItem('md_vehicles', JSON.stringify(v)); }

function vehicleReservations(name) {
  return getAll().filter(r => r.car===name && r.status!=='cancelled' && r.start && r.end)
    .sort((a,b)=> new Date(a.start) - new Date(b.start));
}

function vehicleSchedule(name) {
  const today = new Date().toISOString().slice(0,10);
  const resv = vehicleReservations(name);
  const current = resv.find(r => r.start<=today && today<=r.end);
  const next = resv.find(r => r.start>today);
  return { current, next, all: resv };
}

function renderVehicles() {
  const vehicles = getVehicles();
  document.getElementById('vehEmpty').style.display = vehicles.length ? 'none' : 'block';

  const counts = { available:0, reserved:0, maintenance:0, accident:0 };
  vehicles.forEach(v=>{
    const eff = (v.status==='available') ? (vehicleSchedule(v.name).current ? 'reserved' : 'available') : v.status;
    counts[eff] = (counts[eff]||0)+1;
  });
  document.getElementById('vehKpi').innerHTML = `
    <div class="kpi-card c-green"><div class="kpi-val">${counts.available}</div><div class="kpi-label">🟢 ${vStatusLabel('available')}</div></div>
    <div class="kpi-card c-blue"><div class="kpi-val">${counts.reserved}</div><div class="kpi-label">🔵 ${vStatusLabel('reserved')}</div></div>
    <div class="kpi-card c-yellow"><div class="kpi-val">${counts.maintenance}</div><div class="kpi-label">🛠️ ${vStatusLabel('maintenance')}</div></div>
    <div class="kpi-card c-red"><div class="kpi-val">${counts.accident}</div><div class="kpi-label">🚨 ${vStatusLabel('accident')}</div></div>`;

  document.getElementById('vehGrid').innerHTML = vehicles.map(v=>{
    const sched = vehicleSchedule(v.name);
    let status = v.status, sub = '';
    if (status==='available') {
      if (sched.current) { status='reserved'; sub = `🔓 Retour le ${sched.current.end}`; }
      else if (sched.next) { sub = `Prochaine réservation: ${sched.next.start}`; }
      else { sub = 'Aucune réservation prévue'; }
    } else if (status==='maintenance' || status==='accident') {
      sub = v.note ? esc(v.note) : (status==='accident' ? 'En réparation' : 'Entretien en cours');
    }
    const st = VSTATUS[status];
    const img = (v.images&&v.images[0]) ? `<img src="${v.images[0]}" style="width:100%;height:130px;object-fit:cover;border-radius:10px;margin-bottom:10px"/>` : '';
    const ins = echDateInfo(v.insurance), vis = echDateInfo(v.visit), vid = vidangeInfo(v);
    const vidColor = vid.due ? 'var(--red)' : vid.remaining<=1000 ? 'var(--yellow)' : 'var(--green)';
    const alertCard = ins.warn || vis.warn || vid.due || vid.remaining<=1000;
    const infoRow = (icon,label,val,color)=>`<div style="display:flex;justify-content:space-between;gap:8px"><span style="color:var(--muted)">${icon} ${label}</span><span style="color:${color};font-weight:600;text-align:right">${val}</span></div>`;
    return `<div class="dash-panel" style="padding:18px${alertCard?';border:1px solid var(--yellow)':''}">
      ${img}
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700;font-size:1rem">🚗 ${esc(v.name)}</div>
          <div style="color:var(--muted);font-size:.78rem">${esc(v.plate||'—')}${v.price?` · ${esc(v.price)} MAD/j`:''}</div>
        </div>
        <span class="badge badge-${st.cls}">${st.icon} ${vStatusLabel(status)}</span>
      </div>
      <div style="margin-top:10px;font-size:.82rem;color:var(--muted)">${sub}</div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:5px;font-size:.78rem;border-top:1px solid rgba(255,255,255,.08);padding-top:10px">
        ${ins.has ? infoRow('🛡️','Assurance',`${fmt(ins.date)} · ${ins.txt}`, ins.color) : infoRow('🛡️','Assurance','—','var(--muted)')}
        ${vis.has ? infoRow('🔧','Visite tech.',`${fmt(vis.date)} · ${vis.txt}`, vis.color) : infoRow('🔧','Visite tech.','—','var(--muted)')}
        ${infoRow('🛢️','Vidange', vid.due?`dépassée de ${Math.abs(vid.remaining)} km`:`${vid.remaining} km restants`, vidColor)}
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="act-btn" onclick="openVehicleCalendar(${v.id})">📅 Calendrier</button>
        <button class="act-btn ok" onclick="openBlockModal(${v.id})">⛔ Réserver</button>
        <button class="act-btn ok" onclick="openVehicleModal(${v.id})">✏️ Modifier</button>
        <button class="act-btn del" onclick="deleteVehicle(${v.id})">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

const VFIELDS = [
  ['name',      'vf-name',   'text',   'Ex: Dacia Logan'],
  ['plate',     'vf-plate',            'text',   'Ex: 12345-A-6'],
  ['brand',     'vf-brand',            'text',   'Ex: Dacia'],
  ['model',     'vf-model',            'text',   'Ex: Logan'],
  ['year',      'vf-year',             'text',   'Ex: 2022'],
  ['color',     'vf-color',            'text',   'Ex: Blanc'],
  ['fuel',      'vf-fuel',         'text',   'Essence / Diesel'],
  ['gearbox',   'vf-gearbox',            'text',   'Manuelle / Automatique'],
  ['price',     'vf-price',   'number', 'Ex: 300'],
  ['mileage',   'vf-mileage','number', 'Ex: 45000'],
  ['lastVidangeKm', 'vf-lastvidange', 'number', 'Ex: 40000'],
  ['vidangeInterval', 'vf-interval', 'number', 'Ex: 10000'],
  ['insurance', 'vf-insurance', 'date', ''],
  ['visit',     'vf-visit', 'date', ''],
];

function onVehicleImagesChange(e) {
  const files = Array.from(e.target.files||[]);
  let remaining = files.length;
  if (!remaining) return;
  files.forEach(f=>{
    const reader = new FileReader();
    reader.onload = ev => {
      window._vehImagesTemp.push(ev.target.result);
      if (--remaining === 0) renderVehImgPreview();
    };
    reader.readAsDataURL(f);
  });
}
function removeVehicleImage(i) {
  window._vehImagesTemp.splice(i,1);
  renderVehImgPreview();
}
function renderVehImgPreview() {
  document.getElementById('vh_imgPreview').innerHTML = window._vehImagesTemp.map((img,i)=>`
    <div style="position:relative">
      <img src="${img}" style="width:64px;height:64px;object-fit:cover;border-radius:8px"/>
      <button type="button" onclick="removeVehicleImage(${i})" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--red);color:#fff;border:none;font-size:.65rem;line-height:1;cursor:pointer">✕</button>
    </div>`).join('');
}

function openVehicleModal(id) {
  const v = id ? getVehicles().find(x=>x.id===id) : null;
  window._vehImagesTemp = v && v.images ? [...v.images] : [];
  document.getElementById('vehModal').innerHTML = `
    <div class="modal-title">🚗 ${v?T('m-vehicle-edit'):T('m-vehicle-add')}
      <button class="modal-close-btn" onclick="closeVehicleModal()">✕</button>
    </div>
    ${VFIELDS.map(([key,label,type,ph])=>`
      <div class="form-group"><label>${T(label)}</label><input id="vh_${key}" type="${type}" value="${v?esc(v[key]||''):''}" placeholder="${ph}"/></div>
    `).join('')}
    <div class="form-group">
      <label>${T('m-vehicle-photos')}</label>
      <input id="vh_images" type="file" accept="image/*" multiple onchange="onVehicleImagesChange(event)"/>
      <div id="vh_imgPreview" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        ${(v&&v.images||[]).map((img,i)=>`<div style="position:relative">
          <img src="${img}" style="width:64px;height:64px;object-fit:cover;border-radius:8px"/>
          <button type="button" onclick="removeVehicleImage(${i})" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--red);color:#fff;border:none;font-size:.65rem;line-height:1;cursor:pointer">✕</button>
        </div>`).join('')}
      </div>
    </div>
    <div class="form-group"><label>${T('m-vehicle-status')}</label>
      <select id="vh_status">${Object.entries(VSTATUS).map(([k,s])=>`<option value="${k}" ${v&&v.status===k?'selected':''}>${s.icon} ${vStatusLabel(k)}</option>`).join('')}</select>
    </div>
    <div class="form-group"><label>${T('m-vehicle-note')}</label><input id="vh_note" type="text" value="${v?esc(v.note||''):''}" placeholder="Ex: Pare-choc endommagé"/></div>
    <button class="modal-btn-confirm" style="width:100%;padding:12px;border-radius:9px;margin-top:6px" onclick="saveVehicle(${v?v.id:'null'})">${T('btn-save')}</button>`;
  document.getElementById('vehOverlay').classList.add('open');
}
function closeVehicleModal() { document.getElementById('vehOverlay').classList.remove('open'); }

function saveVehicle(id) {
  const data = {};
  VFIELDS.forEach(([key])=> data[key] = document.getElementById('vh_'+key).value.trim());
  data.status = document.getElementById('vh_status').value;
  data.note = document.getElementById('vh_note').value.trim();
  data.images = window._vehImagesTemp || [];
  if (!data.name) { toast('⚠️ Nom du véhicule requis'); return; }
  const list = getVehicles();
  if (id) {
    saveVehicles(list.map(v=>v.id===id?{...v,...data}:v));
  } else {
    list.unshift({ id: Date.now(), ...data });
    saveVehicles(list);
  }
  closeVehicleModal();
  renderVehicles();
  checkVidangeAlerts();
  checkEcheanceAlerts();
  renderEchBadge();
  toast('✅ Véhicule enregistré');
}

function deleteVehicle(id) {
  if (!confirm('Supprimer ce véhicule ?')) return;
  saveVehicles(getVehicles().filter(v=>v.id!==id));
  renderVehicles();
}

function openBlockModal(id) {
  const v = getVehicles().find(x=>x.id===id);
  if (!v) return;
  document.getElementById('vehModal').innerHTML = `
    <div class="modal-title">${T('m-block-title')} — ${esc(v.name)}
      <button class="modal-close-btn" onclick="closeVehicleModal()">✕</button>
    </div>
    <div class="form-group"><label>${T('f-start')}</label><input id="bk_start" type="date"/></div>
    <div class="form-group"><label>${T('f-end')}</label><input id="bk_end" type="date"/></div>
    <div class="form-group"><label>${T('m-block-client')}</label><input id="bk_name" type="text" placeholder="Ex: Réservation interne"/></div>
    <button class="modal-btn-confirm" style="width:100%;padding:12px;border-radius:9px;margin-top:6px" onclick="saveBlock(${id})">${T('m-block-save')}</button>`;
  document.getElementById('vehOverlay').classList.add('open');
}

function saveBlock(id) {
  const v = getVehicles().find(x=>x.id===id);
  const start = document.getElementById('bk_start').value;
  const end = document.getElementById('bk_end').value;
  const name = document.getElementById('bk_name').value.trim() || 'Réservation interne';
  if (!start || !end || end<start) { toast('⚠️ Choisissez des dates valides'); return; }
  const days = Math.max(1, Math.round((new Date(end)-new Date(start))/86400000));
  const all = JSON.parse(localStorage.getItem('md_reservations')||'[]');
  all.unshift({ id: Date.now(), car: v.name, carPrice: +v.price||0,
    name, phone:'', email:'', city:'', start, end, days, total:(+v.price||0)*days,
    status:'confirmed', createdAt: new Date().toISOString(), amountPaid:0 });
  localStorage.setItem('md_reservations', JSON.stringify(all));
  closeVehicleModal();
  renderVehicles();
  toast('✅ Véhicule réservé pour ces dates');
}

/* ===== VIDANGE ===== */
function vidangeInfo(v) {
  const mileage = +v.mileage || 0;
  const last = +v.lastVidangeKm || 0;
  const interval = +v.vidangeInterval || 10000;
  const next = last + interval;
  const remaining = next - mileage;
  return { mileage, last, interval, next, remaining, due: remaining <= 0 };
}

function renderVidange() {
  const vehicles = getVehicles();
  document.getElementById('vidEmpty').style.display = vehicles.length ? 'none' : 'block';
  const due = vehicles.filter(v=>vidangeInfo(v).due).length;
  const soon = vehicles.filter(v=>{ const i=vidangeInfo(v); return !i.due && i.remaining<=1000; }).length;
  document.getElementById('vidKpi').innerHTML = `
    <div class="kpi-card c-red"><div class="kpi-val">${due}</div><div class="kpi-label">🚨 ${T('vid-due')}</div></div>
    <div class="kpi-card c-yellow"><div class="kpi-val">${soon}</div><div class="kpi-label">⚠️ ${T('vid-soon')}</div></div>
    <div class="kpi-card c-green"><div class="kpi-val">${vehicles.length-due-soon}</div><div class="kpi-label">🟢 ${T('vid-ok')}</div></div>`;

  document.getElementById('vidGrid').innerHTML = vehicles.map(v=>{
    const i = vidangeInfo(v);
    const cls = i.due ? 'cancelled' : (i.remaining<=1000 ? 'pending' : 'confirmed');
    const label = i.due ? `🚨 ${T('vid-overdue')} ${Math.abs(i.remaining)} km` : `${i.remaining} ${T('vid-remaining')}`;
    return `<div class="dash-panel" style="padding:18px">
      <div style="font-weight:700;font-size:1rem">🚗 ${esc(v.name)}</div>
      <div style="color:var(--muted);font-size:.78rem;margin-bottom:8px">${esc(v.plate||'—')}</div>
      <div class="detail-row"><span class="dk">${T('vf-mileage')}</span><span class="dv">${i.mileage} km</span></div>
      <div class="detail-row"><span class="dk">${T('vid-last')}</span><span class="dv">${i.last} km</span></div>
      <div class="detail-row"><span class="dk">${T('vid-interval')}</span><span class="dv">${i.interval} km</span></div>
      <div class="detail-row"><span class="dk">${T('vid-next')}</span><span class="dv">${i.next} km</span></div>
      <span class="badge badge-${cls}" style="margin-top:8px;display:inline-block">${label}</span>
      <button class="act-btn ok" style="margin-top:10px;width:100%" onclick="toggleVidangeEdit(${v.id})">✏️ ${T('btn-edit')}</button>
      <div id="vid_edit_${v.id}"></div>
    </div>`;
  }).join('');
}

function toggleVidangeEdit(id) {
  const v = getVehicles().find(x=>x.id===id);
  if (!v) return;
  const wrap = document.getElementById('vid_edit_'+id);
  if (wrap.innerHTML) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="form-group" style="margin-top:10px"><label>${T('vf-mileage')}</label><input id="vid_mileage_${id}" type="number" min="0" value="${v.mileage||0}"/></div>
    <div class="form-group"><label>${T('vf-lastvidange')}</label><input id="vid_last_${id}" type="number" min="0" value="${v.lastVidangeKm||0}"/></div>
    <div class="form-group"><label>${T('vf-interval')}</label><input id="vid_int_${id}" type="number" min="0" value="${v.vidangeInterval||10000}"/></div>
    <button class="modal-btn-confirm" style="width:100%;padding:10px;border-radius:8px" onclick="saveVidangeEdit(${id})">${T('btn-save')}</button>`;
}

function saveVidangeEdit(id) {
  const mileage = +document.getElementById('vid_mileage_'+id).value || 0;
  const lastVidangeKm = +document.getElementById('vid_last_'+id).value || 0;
  const vidangeInterval = +document.getElementById('vid_int_'+id).value || 10000;
  saveVehicles(getVehicles().map(v=>v.id===id?{...v,mileage,lastVidangeKm,vidangeInterval}:v));
  renderVidange();
  checkVidangeAlerts();
  checkEcheanceAlerts();
  renderEchBadge();
  toast('✅ Vidange mise à jour');
}

function checkVidangeAlerts() {
  let seen = JSON.parse(localStorage.getItem('md_vidange_alerted')||'[]');
  const vehicles = getVehicles();
  seen = seen.filter(id => vehicles.some(v=>v.id===id && vidangeInfo(v).due));
  vehicles.forEach(v=>{
    const i = vidangeInfo(v);
    if (i.due && !seen.includes(v.id)) {
      toast(`🛢️ ${v.name} : vidange à faire (dépassée de ${Math.abs(i.remaining)} km)`);
      if (Notification?.permission === 'granted') {
        new Notification('🛢️ Vidange à faire', { body: `${v.name} a dépassé sa vidange de ${Math.abs(i.remaining)} km` });
      }
      seen.push(v.id);
    }
  });
  localStorage.setItem('md_vidange_alerted', JSON.stringify(seen));
}

/* ===== ÉCHÉANCES : Assurance & Visite technique ===== */
const ECH_THRESHOLD = 10; // jours avant échéance
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr); if (isNaN(d)) return null;
  const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}
function echLabelTxt(a) {
  if (a.vidange) return a.expired ? `vidange dépassée de ${Math.abs(a.remaining)} km` : `vidange dans ${a.remaining} km`;
  return a.expired ? `dépassée depuis ${Math.abs(a.days)}j`
       : a.days === 0 ? `expire aujourd'hui` : `dans ${a.days}j`;
}
// Statut d'une date d'échéance pour affichage sur la fiche véhicule
function echDateInfo(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return { has:false };
  const expired = days < 0, warn = days <= ECH_THRESHOLD;
  return {
    has:true, days, expired, warn, date:dateStr,
    txt: expired ? `dépassée (${Math.abs(days)}j)` : days === 0 ? `aujourd'hui ⚠️` : `${days}j restants${warn?' ⚠️':''}`,
    color: expired ? 'var(--red)' : warn ? 'var(--yellow)' : 'var(--green)'
  };
}
function echeanceAlerts() {
  const out = [];
  getVehicles().forEach(v => {
    [['insurance','Assurance','🛡️'], ['visit','Visite technique','🔧']].forEach(([key,label,icon]) => {
      const days = daysUntil(v[key]);
      if (days === null || days > ECH_THRESHOLD) return;
      out.push({ id:v.id, name:v.name, plate:v.plate, key, label, icon, date:v[key], days, expired: days < 0 });
    });
    // Vidange (basée sur les km, pas une date) : alerte si dépassée ou proche (<=1000 km)
    const vi = vidangeInfo(v);
    if (vi.due || vi.remaining <= 1000) {
      out.push({ id:v.id, name:v.name, plate:v.plate, key:'vidange', label:'Vidange', icon:'🛢️',
        vidange:true, remaining:vi.remaining, expired:vi.due, days: vi.due ? -1 : 2 });
    }
  });
  return out.sort((a,b)=> a.days - b.days);
}
function renderEcheances() {
  const wrap = document.getElementById('echeanceList');
  const card = document.getElementById('echeancePanel');
  if (!wrap) return;
  const alerts = echeanceAlerts();
  if (!alerts.length) { if (card) card.style.display = 'none'; return; }
  if (card) card.style.display = '';
  wrap.innerHTML = alerts.map(a => {
    const cls = a.expired ? 'cancelled' : (a.days <= 3 ? 'pending' : 'confirmed');
    return `<div class="pending-item" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div>
        <div class="pending-name">${a.icon} ${esc(a.name)} — ${a.label}</div>
        <div class="pending-car">${a.vidange ? esc(a.plate||'—')+' · entretien moteur' : esc(a.plate||'—')+' · échéance '+fmt(a.date)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge badge-${cls}">${echLabelTxt(a)}</span>
        <button class="p-btn wa" onclick="echeanceWA(${a.id},'${a.key}')">📲</button>
      </div>
    </div>`;
  }).join('');
}
function echeanceWA(id, key) {
  const v = getVehicles().find(x => x.id == id); if (!v) return;
  if (key === 'vidange') {
    const vi = vidangeInfo(v);
    const txt = vi.due ? `dépassée de ${Math.abs(vi.remaining)} km` : `dans ${vi.remaining} km`;
    const msg = `🚗 Rappel Vidange\nVéhicule: ${v.name} (${v.plate||'—'})\nVidange ${txt}.`;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`, '_blank');
    return;
  }
  const label = key === 'insurance' ? 'Assurance' : 'Visite technique';
  const days = daysUntil(v[key]);
  const a = { days, expired: days < 0 };
  const msg = `🚗 Rappel ${label}\nVéhicule: ${v.name} (${v.plate||'—'})\nÉchéance: ${fmt(v[key])} — ${echLabelTxt(a)}.`;
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`, '_blank');
}
// Envoi automatique au propriétaire via CallMeBot (si configuré)
async function sendOwnerWhatsApp(text) {
  const cfg = JSON.parse(localStorage.getItem('md_wa_notify') || '{}');
  if (!cfg.phone || !cfg.apikey) return false;
  try {
    await fetch(`https://api.callmebot.com/whatsapp.php?phone=${cfg.phone}&text=${encodeURIComponent(text)}&apikey=${cfg.apikey}`, { mode:'no-cors' });
    return true;
  } catch (e) { return false; }
}
function setupWANotify() {
  const cfg = JSON.parse(localStorage.getItem('md_wa_notify') || '{}');
  const phone = prompt('📲 Numéro WhatsApp à notifier (format international sans +, ex: 212634829085):', cfg.phone || WA);
  if (phone === null) return;
  const apikey = prompt('🔑 Clé API CallMeBot\n(Pour l\'obtenir: envoyez « I allow callmebot to send me messages » au +34 644 84 71 89 sur WhatsApp, le bot vous renverra votre clé.)\nLaissez vide pour désactiver l\'envoi auto:', cfg.apikey || '');
  if (apikey === null) return;
  localStorage.setItem('md_wa_notify', JSON.stringify({ phone: phone.replace(/\D/g,''), apikey: apikey.trim() }));
  toast(apikey.trim() ? '✅ Notifications WhatsApp auto activées' : 'ℹ️ Envoi auto désactivé');
}
function checkEcheanceAlerts() {
  const today = new Date().toISOString().slice(0,10);
  let seen = JSON.parse(localStorage.getItem('md_ech_alerted') || '{}');
  if (seen._day !== today) seen = { _day: today }; // 1 alerte / échéance / jour
  echeanceAlerts().forEach(a => {
    const k = a.id + '_' + a.key;
    if (seen[k]) return;
    toast(`${a.icon} ${a.name} : ${a.label} ${echLabelTxt(a)}`);
    if (Notification?.permission === 'granted') {
      new Notification(`${a.icon} ${a.label} à renouveler`, { body: `${a.name} (${a.plate||'—'}) — ${echLabelTxt(a)}` });
    }
    sendOwnerWhatsApp(`🚗 Rappel ${a.label} — ${a.name} (${a.plate||'—'}) : ${echLabelTxt(a)}.`);
    seen[k] = 1;
  });
  localStorage.setItem('md_ech_alerted', JSON.stringify(seen));
}
// Badge d'échéances en haut (topbar) — visible sur toutes les sections
function renderEchBadge() {
  const el = document.getElementById('echBadge');
  if (!el) return;
  const n = echeanceAlerts().length;
  if (n) { el.textContent = `🔔 ${n} échéance(s)`; el.style.display = 'inline-block'; }
  else   { el.style.display = 'none'; }
}
function navigateToEcheances() {
  const link = document.querySelector('.sb-link');
  if (typeof showTab === 'function') showTab('dashboard', link);
  setTimeout(() => { const p = document.getElementById('echeancePanel'); if (p) p.scrollIntoView({ behavior:'smooth', block:'center' }); }, 120);
}

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function openVehicleCalendar(id, year, month) {
  const today = new Date();
  if (year==null) year = today.getFullYear();
  if (month==null) month = today.getMonth();
  window._calVeh = id; window._calYear = year; window._calMonth = month;
  const v = getVehicles().find(x=>x.id===id);
  if (!v) return;
  const resv = vehicleReservations(v.name);
  const isReserved = dateStr => resv.some(r => r.start<=dateStr && dateStr<=r.end);

  const first = new Date(year, month, 1);
  const startDow = (first.getDay()+6)%7; // Monday=0
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr = today.toISOString().slice(0,10);

  let cells = '';
  for (let i=0;i<startDow;i++) cells += '<div></div>';
  for (let d=1; d<=daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const reserved = isReserved(dateStr);
    const isToday = dateStr===todayStr;
    const bg = reserved ? 'rgba(230,51,41,.35)' : 'rgba(34,197,94,.25)';
    const border = isToday ? '2px solid var(--yellow)' : '1px solid transparent';
    cells += `<div style="background:${bg};border:${border};border-radius:8px;padding:10px 0;text-align:center;font-weight:600;font-size:.85rem">${d}</div>`;
  }

  document.getElementById('vehModal').innerHTML = `
    <div class="modal-title">${T('m-cal-title')} — ${esc(v.name)}
      <button class="modal-close-btn" onclick="closeVehicleModal()">✕</button>
    </div>
    <div style="display:flex;gap:14px;font-size:.8rem;margin-bottom:14px;color:var(--muted)">
      <span>${T('m-cal-avail')}</span><span>${T('m-cal-reserved')}</span><span>${T('m-cal-today')}</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <button class="act-btn" onclick="openVehicleCalendar(${id},${month===0?year-1:year},${month===0?11:month-1})">‹</button>
      <strong>${MONTHS_FR[month]} ${year}</strong>
      <button class="act-btn" onclick="openVehicleCalendar(${id},${month===11?year+1:year},${month===11?0:month+1})">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;font-size:.72rem;color:var(--muted);text-align:center;margin-bottom:6px">
      <div>Lun</div><div>Mar</div><div>Mer</div><div>Jeu</div><div>Ven</div><div>Sam</div><div>Dim</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">${cells}</div>`;
  document.getElementById('vehOverlay').classList.add('open');
}

/* ===== SETTINGS ===== */
function renderSettings() {
  const s = JSON.parse(localStorage.getItem('md_site_settings')||'{}');
  document.getElementById('set_agencyName').value    = s.agencyName    || '';
  document.getElementById('set_agencyPhone').value   = s.agencyPhone  || '';
  document.getElementById('set_agencyEmail').value   = s.agencyEmail  || '';
  document.getElementById('set_agencyAddress').value = s.agencyAddress|| '';
  document.getElementById('set_logoPreview').innerHTML = s.agencyLogo ? `<img src="${s.agencyLogo}" style="width:100%;height:100%;object-fit:cover"/>` : '🚗';
}

/* ===== ACCOUNT / SUBSCRIPTION (Supabase) ===== */
function renderAccount() {
  const u = (typeof SB_USER !== 'undefined' && SB_USER) ? SB_USER : null;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  if (!u) { set('acc_email', '—'); return; }
  const plan = (u.user_metadata && u.user_metadata.plan) || 'Starter';
  const prov = (u.app_metadata && u.app_metadata.provider) || 'email';
  const fmtD = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const fmtT = d => d ? new Date(d).toLocaleString('fr-FR') : '—';
  set('acc_plan', plan);
  set('acc_status', 'Actif ✅');
  set('acc_since', fmtD(u.created_at));
  set('acc_email', u.email || '—');
  set('acc_provider', prov === 'google' ? '🔵 Google' : '📧 Email / mot de passe');
  set('acc_last', fmtT(u.last_sign_in_at));
  set('acc_id', u.id || '—');
  const note = document.getElementById('acc_googleNote');
  if (note) note.textContent = prov === 'google'
    ? 'ℹ️ Vous êtes connecté via Google. Définir un mot de passe ici vous permettra aussi de vous connecter par email.'
    : '';
}
async function changePassword() {
  const p1 = document.getElementById('acc_newPass').value;
  const p2 = document.getElementById('acc_newPass2').value;
  const msg = document.getElementById('acc_passMsg');
  const red = 'var(--red,#e11d2a)';
  if (p1.length < 8) { msg.style.color = red; msg.textContent = '⚠️ Au moins 8 caractères.'; return; }
  if (p1 !== p2) { msg.style.color = red; msg.textContent = '⚠️ Les mots de passe ne correspondent pas.'; return; }
  msg.style.color = 'var(--muted)'; msg.textContent = '⏳ Mise à jour...';
  const { error } = await SB.auth.updateUser({ password: p1 });
  if (error) { msg.style.color = red; msg.textContent = '❌ ' + error.message; return; }
  msg.style.color = 'var(--green)'; msg.textContent = '✅ Mot de passe mis à jour.';
  document.getElementById('acc_newPass').value = '';
  document.getElementById('acc_newPass2').value = '';
  toast('🔑 Mot de passe mis à jour');
}

function onLogoFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1024*1024) { toast('⚠️ Image trop lourde (max 1 Mo)'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const s = JSON.parse(localStorage.getItem('md_site_settings')||'{}');
    s.agencyLogo = reader.result;
    localStorage.setItem('md_site_settings', JSON.stringify(s));
    document.getElementById('set_logoPreview').innerHTML = `<img src="${s.agencyLogo}" style="width:100%;height:100%;object-fit:cover"/>`;
    applyAgencyLogo();
    toast('✅ Logo mis à jour');
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  const s = JSON.parse(localStorage.getItem('md_site_settings')||'{}');
  delete s.agencyLogo;
  localStorage.setItem('md_site_settings', JSON.stringify(s));
  document.getElementById('set_logoPreview').innerHTML = '🚗';
  document.getElementById('set_logoFile').value = '';
  applyAgencyLogo();
  toast('🗑️ Logo retiré');
}

function applyAgencyLogo() {
  const s = JSON.parse(localStorage.getItem('md_site_settings')||'{}');
  const name = esc(s.agencyName || 'CRM');
  const logoImg = (h, mw) => `<img src="${s.agencyLogo}" style="height:${h}px;width:auto;max-width:${mw}px;border-radius:8px;object-fit:contain;vertical-align:middle;margin-right:12px"/>`;
  // Sidebar — logo bien visible
  const sbLogo = document.getElementById('sbLogo');
  if (sbLogo) sbLogo.innerHTML = s.agencyLogo
    ? `${logoImg(48, 200)}<strong>${name}</strong>`
    : `🚗 <strong>${name}</strong>`;
  // Login — logo grand comme sur le site
  const loginLogo = document.querySelector('.login-logo');
  if (loginLogo) loginLogo.innerHTML = s.agencyLogo
    ? `${logoImg(72, 320)}<span>CRM</span>`
    : `🚗 <strong>${name}</strong> <span>CRM</span>`;
}

function saveAgencySettings() {
  const s = JSON.parse(localStorage.getItem('md_site_settings')||'{}');
  s.agencyName    = document.getElementById('set_agencyName').value.trim();
  s.agencyPhone   = document.getElementById('set_agencyPhone').value.trim();
  s.agencyEmail   = document.getElementById('set_agencyEmail').value.trim();
  s.agencyAddress = document.getElementById('set_agencyAddress').value.trim();
  localStorage.setItem('md_site_settings', JSON.stringify(s));
  applyAgencyLogo();
  toast('✅ Informations de l\'agence enregistrées');
}

function saveCredentials() {
  const user = document.getElementById('set_loginUser').value.trim();
  const pass = document.getElementById('set_loginPass').value;
  if (!user) { toast('⚠️ L\'identifiant ne peut pas être vide'); return; }
  const c = authCreds();
  authSaveCreds({ ...c, user, pass: pass || c.pass });
  document.getElementById('set_loginPass').value = '';
  document.getElementById('settingsCredErr').textContent = '✅ Identifiants mis à jour';
  toast('🔑 Identifiants de connexion mis à jour');
}

function saveSecurityQuestion() {
  const q = document.getElementById('set_secQuestion').value.trim();
  const a = document.getElementById('set_secAnswer').value.trim();
  if (!q || !a) { toast('⚠️ Remplissez la question et la réponse'); return; }
  const c = authCreds();
  authSaveCreds({ ...c, q, a });
  toast('✅ Question de sécurité enregistrée');
}

/* ===== FACTORY RESET ===== */
function factoryReset() {
  if (!confirm('⚠️ Ceci va supprimer TOUTES les données (réservations, véhicules, paramètres). Le site repartira à zéro. Continuer ?')) return;
  ['md_reservations','md_vehicles','md_vidange_alerted','md_cars','md_offers','md_blocks','md_car_settings','md_site_settings'].forEach(k=>localStorage.removeItem(k));
  alert('✅ Toutes les données ont été supprimées. La page va se recharger.');
  location.reload();
}

/* ===== INIT ===== */
function init() {
  applyAgencyLogo();
  renderDashboard();
  renderNotif();
  _initBaseline();
  requestNotifPermission();
  checkVidangeAlerts();
  checkEcheanceAlerts();
  renderEchBadge();

}

// One-time global listeners (NOT inside init(), which re-runs on every sync). */
let _listenersWired = false;
function wireListeners() {
  if (_listenersWired) return;
  _listenersWired = true;
  // detect new reservations from any tab (cross-tab)
  window.addEventListener('storage', e => {
    if (e.key === 'md_reservations') checkNewReservations();
  });
  // detect new reservations same-tab (when admin itself saves)
  const _orig = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, val) {
    _orig(key, val);
    if (key === 'md_reservations') checkNewReservations();
  };
}
wireListeners();

applyAgencyLogo();

// App boot is gated by Supabase auth (js/supabase-store.js -> sbEnterApp()).
// It validates the session, pulls this user's private data, then calls init().

// Re-render after a Supabase realtime sync (js/supabase-store.js) — debounced
// so a burst of synced keys triggers a single lightweight re-render.
let _syncRenderTimer = null;
window.addEventListener('db-synced', () => {
  if (sessionStorage.getItem('md_admin') !== '1') return;
  clearTimeout(_syncRenderTimer);
  _syncRenderTimer = setTimeout(init, 150);
});
