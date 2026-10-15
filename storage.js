// Persistencia local: IndexedDB primero, respaldo localStorage si el navegador falla.
const STORE_KEY = 'forja_gym_v1';

async function readStoredDatabase() {
  let indexed = null, legacy = null;
  try {
    const media = await openAppDb();
    indexed = await new Promise((resolve, reject) => {
      const request = media.transaction('appData', 'readonly').objectStore('appData').get('root');
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(request.error);
    });
  } catch {}
  try { legacy = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch {}
  if (!indexed) return legacy;
  return !legacy || new Date(legacy.updatedAt || 0) > new Date(indexed.updatedAt || 0) ? legacy : indexed;
}
async function writeStoredDatabase(snapshot) {
  const media = await openAppDb();
  await new Promise((resolve, reject) => {
    const transaction = media.transaction(['appData', 'autoBackups'], 'readwrite');
    transaction.objectStore('appData').put({ key: 'root', value: snapshot });
    const backups = transaction.objectStore('autoBackups'), today = localDay();
    const existing = backups.get(today);
    existing.onsuccess = () => {
      if (existing.result) return;
      const all = backups.getAll();
      all.onsuccess = () => {
        const retained = ForjaCore.retainDailyBackups(all.result, today, ForjaCore.createBackup(snapshot, [], new Date()), 7);
        backups.clear(); retained.forEach((entry) => backups.put(entry));
      };
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('No pude guardar la base local.'));
  });
  try { localStorage.removeItem(STORE_KEY); } catch {}
}
async function loadDb() {
  db = await readStoredDatabase();
  if (!db || !Array.isArray(db.profiles) || !db.profiles.length) db={version:2,currentProfile:'',profiles:[blankProfile('Tú')]};
  db.version = 2;
  for (const person of db.profiles) {
    person.data ||= {};
    const data = person.data;
    for (const key of ['workouts','customRoutines','favorites','favoriteRoutines','measurements','goals','readiness','challenges']) if (!Array.isArray(data[key])) data[key]=[];
    data.favoriteState ||= {}; data.favoriteRoutineState ||= {}; data.preferences ||= defaultPreferences();
    if (!Array.isArray(data.preferences.trainingDays)) data.preferences.trainingDays=defaultPreferences().trainingDays;
    data.block ||= {weeks:data.preferences.blockWeeks||4,startedAt:localDay()};
    data.reminder ||= {enabled:false,time:'18:00',days:[1,3,5],lastSent:''};
    data.reminders ||= defaultReminders();
    data.reminders.workout = data.reminders.workout || data.reminder;
    data.accent = ['lemon','blue','violet','orange','red'].includes(data.accent)?data.accent:'lemon';
  }
  profile=db.profiles.find((p)=>p.id===db.currentProfile)||db.profiles[0]; db.currentProfile=profile.id;
  db.syncConfig ||= {}; db.syncSession ||= null;
  await persist();
}
function persist() {
  if (!db) return Promise.resolve(false);
  db.version=2; db.currentProfile=profile?.id||db.currentProfile; db.updatedAt=new Date().toISOString();
  let snapshot;
  try { snapshot=structuredClone(db); } catch { snapshot=JSON.parse(JSON.stringify(db)); }
  persistQueue=persistQueue.catch(()=>false).then(async()=>{
    try { await writeStoredDatabase(snapshot); return true; }
    catch {
      try { localStorage.setItem(STORE_KEY,JSON.stringify(snapshot)); return true; }
      catch { toast('No pude guardar los datos. Libera espacio o exporta un respaldo antes de continuar.'); return false; }
    }
  });
  scheduleCloudSync();
  return persistQueue;
}
function queueWorkoutPersist() {
  workoutPersistPending=true; clearTimeout(workoutPersistTimer);
  workoutPersistTimer=setTimeout(()=>{ flushWorkoutPersist(); },250);
}
function flushWorkoutPersist() {
  clearTimeout(workoutPersistTimer); workoutPersistTimer=null;
  if (!workoutPersistPending) return persistQueue;
  workoutPersistPending=false;
  return persist();
}
