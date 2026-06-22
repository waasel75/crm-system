'use strict';
/* ===== SHARED ADMIN AUTH (login + lockout + password reset) ===== */
const AUTH_KEY = 'md_admin_creds';
const LOCK_KEY = 'md_admin_lockout';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60000;

function authGetCreds() {
  return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
}
function authDefaultCreds() {
  return { user: '12345', pass: '12345', q: 'Date de naissance', a: '' };
}
function authCreds() { return { ...authDefaultCreds(), ...authGetCreds() }; }
function authSaveCreds(c) { localStorage.setItem(AUTH_KEY, JSON.stringify(c)); }

function authLockStatus() {
  const l = JSON.parse(localStorage.getItem(LOCK_KEY) || '{}');
  if (l.until && Date.now() < l.until) return Math.ceil((l.until - Date.now()) / 1000);
  return 0;
}
function authRegisterFail() {
  const l = JSON.parse(localStorage.getItem(LOCK_KEY) || '{}');
  const count = (l.count || 0) + 1;
  const data = { count };
  if (count >= MAX_ATTEMPTS) data.until = Date.now() + LOCK_MS;
  localStorage.setItem(LOCK_KEY, JSON.stringify(data));
}
function authClearFails() { localStorage.removeItem(LOCK_KEY); }

function authCheckLogin(user, pass) {
  const remaining = authLockStatus();
  if (remaining) return { ok: false, locked: remaining };
  const c = authCreds();
  if (user === c.user && pass === c.pass) { authClearFails(); return { ok: true }; }
  authRegisterFail();
  return { ok: false };
}

function authHasQuestion() { const c = authCreds(); return !!(c.q && c.a); }
function authQuestion() { return authCreds().q; }
function authCheckAnswer(answer) {
  return (answer || '').trim().toLowerCase() === authCreds().a.trim().toLowerCase();
}
function authResetCreds(newUser, newPass) {
  const c = authCreds();
  authSaveCreds({ ...c, user: newUser, pass: newPass });
  authClearFails();
}
