'use strict';
/* =========================================================================
   LANDING PAGE  (index.html)
   - Showcases the plans you sell + handles signup / email-code / login.
   - On success, redirects to the CRM app: app.html
   ========================================================================= */

const SB = supabase.createClient(SUPA.url, SUPA.anonKey);
const APP_URL = 'app.html';

/* ┌──────────────────────────────────────────────────────────────────────┐
   │  ✏️  YOUR PLANS — edit freely. Add/remove items, change prices, etc.   │
   │     hot:true  => highlighted "popular" plan.                          │
   └──────────────────────────────────────────────────────────────────────┘ */
const PLANS = [
  {
    name: 'Starter',
    desc: 'Pour démarrer et tester sans risque.',
    price: '0',
    period: 'DH / mois',
    features: ['1 utilisateur', "Jusqu'à 20 réservations", 'Gestion véhicules', 'Support par email'],
    cta: 'Commencer gratuitement',
    hot: false,
  },
  {
    name: 'Pro',
    desc: "L'essentiel pour une agence active.",
    price: '199',
    period: 'DH / mois',
    features: ['Réservations illimitées', 'Parc auto illimité', 'Statistiques & export Excel', 'Rappels WhatsApp', 'Support prioritaire'],
    cta: 'Choisir Pro',
    hot: true,
  },
  {
    name: 'Business',
    desc: 'Pour les agences multi-sites.',
    price: '399',
    period: 'DH / mois',
    features: ['Tout le plan Pro', 'Plusieurs agences', 'Sauvegarde cloud avancée', 'Accès multi-appareils', 'Accompagnement dédié'],
    cta: 'Choisir Business',
    hot: false,
  },
];

/* ---- render plans ---- */
function renderPlans() {
  document.getElementById('yr').textContent = new Date().getFullYear();
  document.getElementById('planGrid').innerHTML = PLANS.map(p => `
    <div class="plan ${p.hot ? 'hot' : ''}">
      ${p.hot ? '<span class="tag">⭐ Le plus populaire</span>' : ''}
      <h3>${p.name}</h3>
      <div class="desc">${p.desc}</div>
      <div class="price">${p.price} <small>${p.period}</small></div>
      <ul>${p.features.map(f => `<li>${f}</li>`).join('')}</ul>
      <button class="btn ${p.hot ? 'btn-primary' : 'btn-ghost'} btn-block"
        onclick="openAuth('signup','${p.name.replace(/'/g, "\\'")}')">${p.cta}</button>
    </div>`).join('');
}

function scrollToPlans() { document.getElementById('plans').scrollIntoView({ behavior: 'smooth' }); }

/* ---- signup method (email | phone) + password strength ---- */
let _method = 'email';
let _pending = null; // { type:'email'|'phone', id }

function setMethod(m) {
  _method = m;
  document.querySelectorAll('#suMethod .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.m === m));
  document.getElementById('fldEmail').classList.toggle('hidden', m !== 'email');
  document.getElementById('fldPhone').classList.toggle('hidden', m !== 'phone');
}
// Normalize to E.164 (Morocco default) for Supabase phone auth.
function normPhone(p) {
  p = (p || '').replace(/[\s.\-()]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('0')) p = '+212' + p.slice(1);
  return p;
}
// Strong password, same rules as major platforms.
function pwRules(p) {
  return { len: p.length >= 8, upper: /[A-Z]/.test(p), lower: /[a-z]/.test(p), num: /\d/.test(p), sym: /[^A-Za-z0-9]/.test(p) };
}
function pwCheck(p) {
  const r = pwRules(p);
  document.querySelectorAll('#pwReq li').forEach(li => li.classList.toggle('ok', !!r[li.dataset.r]));
  return Object.values(r).every(Boolean);
}

/* ---- modal helpers ---- */
function openAuth(view, plan) {
  document.getElementById('authOv').classList.add('open');
  const chip = document.getElementById('signupPlan');
  if (plan) { chip.textContent = 'Plan choisi : ' + plan; chip.classList.remove('hidden'); }
  else chip.classList.add('hidden');
  setMethod('email');
  showView(view || 'signup');
}
function closeAuth() { document.getElementById('authOv').classList.remove('open'); }
function showView(v) {
  ['Signup', 'Otp', 'Login'].forEach(id =>
    document.getElementById('v' + id).classList.toggle('hidden', id.toLowerCase() !== v));
  ['suMsg', 'otpMsg', 'liMsg'].forEach(id => { const e = document.getElementById(id); e.textContent = ''; e.className = 'msg'; });
}
function setMsg(id, txt, ok) { const e = document.getElementById(id); e.textContent = txt; e.className = 'msg ' + (ok ? 'ok' : 'err'); }

// Show/hide a password field.
function eye(id, btn) {
  const i = document.getElementById(id);
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
}

/* ---- Google OAuth (1-click) ---- */
async function doGoogle() {
  const { error } = await SB.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') + APP_URL },
  });
  if (error) setMsg('suMsg', '❌ ' + error.message);
}

/* ---- signup (email or phone) ---- */
async function doSignup() {
  const pass = document.getElementById('suPass').value;
  const pass2 = document.getElementById('suPass2').value;
  const plan = document.getElementById('signupPlan').textContent.replace('Plan choisi : ', '') || 'Starter';
  if (!pwCheck(pass)) return setMsg('suMsg', '⚠️ Mot de passe trop faible : respectez les 5 règles ci-dessus.');
  if (pass !== pass2) return setMsg('suMsg', '⚠️ Les deux mots de passe ne correspondent pas.');

  let creds, target;
  if (_method === 'email') {
    const email = document.getElementById('suEmail').value.trim();
    if (!email) return setMsg('suMsg', '⚠️ Email requis.');
    creds = { email, password: pass, options: { data: { plan } } };
    target = email; _pending = { type: 'email', id: email };
  } else {
    const phone = normPhone(document.getElementById('suPhone').value);
    if (phone.length < 8) return setMsg('suMsg', '⚠️ Numéro de téléphone invalide (ex: +2126…).');
    creds = { phone, password: pass, options: { data: { plan } } };
    target = phone; _pending = { type: 'phone', id: phone };
  }
  setMsg('suMsg', '⏳ Création du compte...', true);
  const { data, error } = await SB.auth.signUp(creds);
  if (error) return setMsg('suMsg', '❌ ' + error.message);
  if (data.session) return location.replace(APP_URL);     // confirmation disabled -> straight in
  document.getElementById('otpEmail').textContent = target;
  showView('otp');
  setMsg('otpMsg', _method === 'email' ? '📧 Code envoyé à votre email.' : '📱 Code envoyé par SMS.', true);
}

/* ---- verify the 6-digit code (email or SMS) ---- */
async function _verify(token) {
  if (_pending.type === 'phone') return SB.auth.verifyOtp({ phone: _pending.id, token, type: 'sms' });
  let r = await SB.auth.verifyOtp({ email: _pending.id, token, type: 'signup' });
  if (r.error) r = await SB.auth.verifyOtp({ email: _pending.id, token, type: 'email' });
  return r;
}
async function doVerify() {
  const token = document.getElementById('otpCode').value.trim();
  if (token.length < 6) return setMsg('otpMsg', '⚠️ Saisissez le code à 6 chiffres.');
  setMsg('otpMsg', '⏳ Vérification...', true);
  const { error } = await _verify(token);
  if (error) return setMsg('otpMsg', '❌ Code invalide ou expiré.');
  location.replace(APP_URL);
}
async function doResend() {
  if (!_pending) return;
  const opts = _pending.type === 'phone' ? { type: 'sms', phone: _pending.id } : { type: 'signup', email: _pending.id };
  const { error } = await SB.auth.resend(opts);
  setMsg('otpMsg', error ? '❌ ' + error.message : '📨 Nouveau code envoyé.', !error);
}

/* ---- login (email or phone) ---- */
async function doSignin() {
  const id = document.getElementById('liEmail').value.trim();
  const pass = document.getElementById('liPass').value;
  if (!id || !pass) return setMsg('liMsg', '⚠️ Identifiant et mot de passe requis.');
  const isEmail = id.includes('@');
  setMsg('liMsg', '⏳ Connexion...', true);
  const { error } = await SB.auth.signInWithPassword(isEmail ? { email: id, password: pass } : { phone: normPhone(id), password: pass });
  if (!error) return location.replace(APP_URL);
  if (/confirm/i.test(error.message)) {           // account not confirmed yet
    _pending = isEmail ? { type: 'email', id } : { type: 'phone', id: normPhone(id) };
    document.getElementById('otpEmail').textContent = _pending.id;
    showView('otp');
    await doResend();
    return setMsg('otpMsg', '⚠️ Compte non confirmé. Nouveau code envoyé.', true);
  }
  setMsg('liMsg', '❌ Identifiant ou mot de passe incorrect.');
}
async function doForgot() {
  const id = document.getElementById('liEmail').value.trim();
  if (!id.includes('@')) return setMsg('liMsg', '⚠️ Entrez votre email pour réinitialiser le mot de passe.');
  const { error } = await SB.auth.resetPasswordForEmail(id, { redirectTo: location.origin + '/' + APP_URL });
  setMsg('liMsg', error ? '❌ ' + error.message : '📧 Lien de réinitialisation envoyé.', !error);
}

/* ---- startup: already logged in -> skip straight to the app ---- */
(async function () {
  renderPlans();
  const { data } = await SB.auth.getSession();
  if (data.session) location.replace(APP_URL);
})();
