// Sincronización Supabase: el cliente solo envía el sobre cifrado.
let syncCloudSession = null;
let cloudSyncBusy = false;

function getSyncConfigFromForm() {
  const url = $('#sync-url').value.trim().replace(/\/$/, ''), key = $('#sync-anon-key').value.trim(), email = $('#sync-email').value.trim(), password = $('#sync-password').value, passphrase = $('#sync-passphrase').value, vapidPublicKey = $('#sync-vapid-public').value.trim();
  if (!/^https:\/\//i.test(url)) throw new Error('Usa la URL HTTPS de tu proyecto Supabase.');
  try { const parsed = new URL(url); if (!parsed.hostname.endsWith('.supabase.co') && !parsed.hostname.includes('.')) throw new Error(); } catch { throw new Error('La URL del proyecto no parece válida.'); }
  if (!key) throw new Error('Pega la clave pública (publishable/anon) de Supabase.');
  return { url, key, email, password, passphrase, vapidPublicKey };
}
function loadSyncConfig() {
  const c = db.syncConfig || {}; $('#sync-url').value = c.url || ''; $('#sync-anon-key').value = c.key || ''; $('#sync-vapid-public').value = c.vapidPublicKey || '';
  try { syncCloudSession = JSON.parse(sessionStorage.getItem('forja_sync_session') || 'null'); } catch { syncCloudSession = null; }
  syncCryptoKey = null; updateSyncStatus(syncCloudSession ? `Sesión de sincronización activa para ${syncCloudSession.email || 'tu cuenta'} en esta pestaña.` : 'Sin sesión. Los datos siguen guardados solo en este dispositivo.');
}
function updateSyncStatus(message) { const node = $('#sync-status'); if (node) node.textContent = message; }
function openSyncDialog() { loadSyncConfig(); $('#sync-dialog').showModal(); }
function saveSyncConfig(c) { db.syncConfig = { ...(db.syncConfig || {}), url: c.url, key: c.key, vapidPublicKey: c.vapidPublicKey }; persist(); }
async function supabaseRequest(path, options = {}, config) {
  const c = config || db.syncConfig, headers = { apikey: c.key, ...(options.headers || {}) };
  const bearer = syncCloudSession?.access_token || (String(c.key).startsWith('sb_publishable_') ? '' : c.key);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] ||= 'application/json';
  const response = await fetch(`${c.url}${path}`, { ...options, headers, signal: AbortSignal.timeout(20000) });
  const text = await response.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(body?.msg || body?.message || body?.error_description || body?.error || `Supabase respondió ${response.status}.`);
  return body;
}
async function syncSignUp() {
  try {
    const c = getSyncConfigFromForm(); if (!c.email || c.password.length < 8) throw new Error('Escribe un correo y una contraseña de al menos 8 caracteres.'); if (c.passphrase.length < 12) throw new Error('La frase privada de cifrado debe tener al menos 12 caracteres.');
    saveSyncConfig(c); updateSyncStatus('Creando la cuenta…'); const result = await supabaseRequest('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: c.email, password: c.password }) }, c);
    if (result?.access_token) { setCloudSession(result, c.email); $('#sync-password').value = ''; await syncNow(); }
    else { updateSyncStatus('Cuenta creada. Revisa tu correo para confirmar la dirección y luego inicia sesión aquí.'); $('#sync-password').value = ''; toast('Revisa tu correo para confirmar la cuenta.'); }
  } catch (error) { updateSyncStatus(error.message); }
}
function setCloudSession(result, email) {
  syncCloudSession = { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() + (Number(result.expires_in) || 3600) * 1000, email: email || result.user?.email || '' };
  try { sessionStorage.setItem('forja_sync_session', JSON.stringify(syncCloudSession)); } catch {}
}
async function ensureCloudSession() {
  if (!syncCloudSession?.access_token) throw new Error('Inicia sesión en tu cuenta de sincronización primero.');
  if (syncCloudSession.expires_at - Date.now() > 60000) return;
  if (!syncCloudSession.refresh_token) throw new Error('La sesión venció. Inicia sesión otra vez.');
  const c = db.syncConfig, result = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: syncCloudSession.refresh_token }) }, c);
  setCloudSession(result, syncCloudSession.email);
}
async function syncLogin() {
  try {
    const c = getSyncConfigFromForm(); if (!c.email || !c.password) throw new Error('Escribe tu correo y contraseña de sincronización.'); if (c.passphrase.length < 12) throw new Error('Escribe tu frase privada de cifrado (mínimo 12 caracteres).');
    saveSyncConfig(c); updateSyncStatus('Iniciando sesión…'); const result = await supabaseRequest('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: c.email, password: c.password }) }, c); setCloudSession(result, c.email); $('#sync-password').value = ''; await syncNow();
  } catch (error) { updateSyncStatus(error.message); }
}
function encodeBytes(bytes) { let binary = ''; new Uint8Array(bytes).forEach((b) => { binary += String.fromCharCode(b); }); return btoa(binary); }
function decodeBytes(value) { const raw = atob(value); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
async function deriveSyncKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function localSyncSnapshot(source = db) {
  const copy = structuredClone(source); delete copy.syncConfig; delete copy.syncSession; delete copy.push; delete copy.accessibility; delete copy.localDeviceId; return copy;
}
async function encryptCloudData(snapshot, passphrase, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), key = await deriveSyncKey(passphrase, salt), plain = new TextEncoder().encode(JSON.stringify(snapshot)), encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { v: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iterations: 310000, salt: encodeBytes(salt), iv: encodeBytes(iv), ciphertext: encodeBytes(encrypted) };
}
async function decryptCloudData(envelope, passphrase) {
  if (!envelope || envelope.v !== 1 || envelope.algorithm !== 'AES-GCM') throw new Error('El respaldo cifrado de la nube no tiene un formato reconocido.');
  const key = await deriveSyncKey(passphrase, decodeBytes(envelope.salt));
  try { const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBytes(envelope.iv) }, key, decodeBytes(envelope.ciphertext)); return JSON.parse(new TextDecoder().decode(raw)); }
  catch { throw new Error('La frase privada no coincide con la copia cifrada.'); }
}
function unionBy(listA = [], listB = [], key = 'id', timeA = 0, timeB = 0) { return ForjaCore.unionBy(listA, listB, key, timeA, timeB); }
function mergeCloudDatabases(local, remote) { return ForjaCore.mergeCloudDatabases(local, remote); }
async function getCloudRow() {
  const userId = syncCloudSession?.user?.id || (await supabaseRequest('/auth/v1/user', {}, db.syncConfig))?.id;
  if (!userId) throw new Error('No pude identificar la cuenta autenticada. Inicia sesión otra vez.');
  const query = `/rest/v1/forja_vault?select=payload,user_id,updated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  const rows = await supabaseRequest(query, { method: 'GET' }); return { userId, row: rows?.[0] || null };
}
async function writeCloudRow(userId, row, envelope) {
  const body = JSON.stringify({ user_id: userId, payload: envelope, updated_at: new Date().toISOString() });
  if (!row) {
    const inserted = await supabaseRequest('/rest/v1/forja_vault?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body });
    return Array.isArray(inserted) && inserted.length > 0;
  }
  const query = `/rest/v1/forja_vault?user_id=eq.${encodeURIComponent(userId)}&updated_at=eq.${encodeURIComponent(row.updated_at)}`;
  const updated = await supabaseRequest(query, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body });
  return Array.isArray(updated) && updated.length > 0;
}
async function syncNow(silent = false) {
  if (cloudSyncBusy) return; cloudSyncBusy = true;
  try {
    const c = getSyncConfigFromForm(); saveSyncConfig(c); await ensureCloudSession();
    const passphrase = $('#sync-passphrase').value; if (passphrase.length < 12) throw new Error('La frase privada de cifrado debe tener al menos 12 caracteres.');
    let merged = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      updateSyncStatus(attempt ? `Otra sincronización llegó primero. Combinando de nuevo (${attempt + 1}/3)…` : 'Cargando la copia cifrada…');
      const { userId, row } = await getCloudRow(); let cloud = null, salt;
      if (row?.payload) { cloud = await decryptCloudData(row.payload, passphrase); salt = decodeBytes(row.payload.salt); }
      else { const saved = db.syncConfig?.encryptionSalt; salt = saved ? decodeBytes(saved) : crypto.getRandomValues(new Uint8Array(16)); db.syncConfig.encryptionSalt = encodeBytes(salt); }
    merged = cloud ? mergeCloudDatabases(localSyncSnapshot(db), cloud) : localSyncSnapshot(db);
      const envelope = await encryptCloudData(merged, passphrase, salt);
      updateSyncStatus('Cifrando y guardando…');
      if (await writeCloudRow(userId, row, envelope)) break;
      merged = null;
    }
    if (!merged) throw new Error('Otra copia se sincronizó al mismo tiempo. Vuelve a intentarlo para combinar los cambios.');
    const config = db.syncConfig, accessibility = db.accessibility; db = merged; db.syncConfig = config; db.accessibility = accessibility; profile = db.profiles.find((p) => p.id === db.currentProfile) || db.profiles[0]; await persist(); populateProfileSelect(); renderAll();
    syncCryptoKey = null; $('#sync-password').value = ''; updateSyncStatus(`Sincronización terminada · ${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}. Las fotos siguen locales.`); if (!silent) toast('Datos cifrados y sincronizados.');
  } catch (error) { updateSyncStatus(error.message.includes('forja_vault') ? `${error.message} Ejecuta el esquema SQL de backend/supabase/schema.sql.` : error.message); if (!silent) toast(error.message); }
  finally { cloudSyncBusy = false; }
}
function scheduleCloudSync() {
  if (!syncCloudSession?.access_token || !db?.syncConfig?.url || cloudSyncBusy || !$('#sync-dialog')) return;
  clearTimeout(syncDebounce); syncDebounce = setTimeout(() => { syncNow(true); }, 1800);
}
function syncLogout() {
  syncCloudSession = null; syncCryptoKey = null; try { sessionStorage.removeItem('forja_sync_session'); } catch {}
  updateSyncStatus('Sesión cerrada. Tus datos locales siguen guardados.'); toast('Sesión de sincronización cerrada.');
}
