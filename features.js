'use strict';

/* Funciones avanzadas de Forja. Se mantiene en un archivo aparte para que los
   datos nuevos sigan integrados con los perfiles y la persistencia existentes. */
const EXERCISE_VIDEO_IDS = {
  'leg-press': 'sEM_zo9w2ss',
  'lat-pulldown': 'iKrKgWR9wbY',
  'goblet-squat': '5Y3KW5rWMh4'
};
const EXERCISE_SEARCH_TERMS = {
  'chest-press':'lever chest press','db-bench':'dumbbell bench press','db-incline':'incline dumbbell press','pec-deck':'lever pec deck fly','cable-chest-fly':'cable chest fly','push-up':'push up',
  'lat-pulldown':'lat pulldown','seated-row':'seated cable row','db-row':'dumbbell row','chest-row':'chest supported row','face-pull':'cable face pull','shoulder-press':'lever shoulder press','pike-push-up':'pike push up','db-shoulder':'dumbbell shoulder press','lateral-raise':'dumbbell lateral raise','lateral-machine':'lateral raise machine','rear-fly':'reverse pec deck',
  'leg-press':'leg press','goblet-squat':'dumbbell goblet squat','hack-squat':'hack squat','leg-extension':'leg extension','split-squat':'dumbbell split squat','db-rdl':'dumbbell romanian deadlift','leg-curl':'seated leg curl','hip-thrust':'hip thrust machine','db-hip-thrust':'dumbbell hip thrust','abductor':'hip abduction machine','cable-kickback':'cable glute kickback','calf-raise':'standing calf raise machine','db-calf':'dumbbell calf raise',
  'db-curl':'dumbbell biceps curl','preacher-curl':'preacher curl machine','hammer-curl':'dumbbell hammer curl','triceps-pushdown':'cable triceps pushdown','overhead-triceps':'dumbbell overhead triceps extension','triceps-machine':'triceps extension machine','cable-crunch':'cable crunch','plank':'plank','dead-bug':'dead bug','db-lunge':'dumbbell walking lunge','smith-squat':'smith machine squat','cable-row':'cable upright row','db-fly':'incline dumbbell fly','back-extension':'back extension machine','barbell-squat':'barbell squat','barbell-row':'barbell bent over row',
  'assisted-pullup':'assisted pull up machine','cable-pullover':'straight arm cable pulldown','incline-chest-machine':'incline chest press machine','reverse-lunge':'dumbbell reverse lunge','single-leg-curl':'single leg curl machine','seated-calf':'seated calf raise machine','concentration-curl':'dumbbell concentration curl','close-grip-pushup':'close grip push up','cable-biceps-curl':'cable biceps curl','glute-bridge':'barbell glute bridge'
};
let installPromptEvent = null;
const exerciseDemoCache = new Map();
let exerciseMediaIndex = {};
let exerciseCatalogPage = 1;
const EXERCISE_CATALOG_PAGE_SIZE = 36;
let mediaDownloadJob = null;
const REST_TIMER_STORAGE_KEY = 'forja_rest_timer_v1';

function updateVibrationControl() {
  const button = $('#vibration-toggle'), status = $('#vibration-status');
  if (!button) return;
  const supported = typeof navigator.vibrate === 'function', enabled = supported && db.accessibility?.vibration !== false;
  button.setAttribute('aria-pressed', String(enabled));
  button.setAttribute('aria-label', supported ? `${enabled ? 'Desactivar' : 'Activar'} vibración` : 'Vibración no disponible en este navegador');
  button.title = supported ? `${enabled ? 'Vibración activada' : 'Vibración desactivada'} · al completar series y al terminar el descanso` : 'Este navegador no ofrece vibración web; el sonido del temporizador sigue disponible.';
  if (status) status.textContent = supported ? '' : 'Vibración no disponible aquí; el sonido sigue activo.';
}

function initializePwaControls() {
  db.accessibility ||= {};
  if (![100, 112, 125].includes(Number(db.accessibility.fontScale))) db.accessibility.fontScale = db.accessibility.largeText ? 112 : 100;
  applyAccessibilitySettings();
  updateVibrationControl();
  loadExerciseMediaIndex();
  $('#cache-exercise-images')?.addEventListener('click', () => cacheExerciseMediaOffline('images'));
  $('#cache-exercise-gifs')?.addEventListener('click', () => cacheExerciseMediaOffline('animations'));
  $('#exercise-load-more')?.addEventListener('click', () => { exerciseCatalogPage++; renderExercises(); });
  $('#exercise-search')?.addEventListener('input', () => { exerciseCatalogPage = 1; renderExercises(); });
  $('#restore-auto-backup')?.addEventListener('click', restoreAutomaticBackup);
  $('#snooze-reminders')?.addEventListener('click', snoozeReminders);
  for (const selector of ['#equipment-filter','#muscle-filter','#difficulty-filter','#movement-filter']) $(selector)?.addEventListener('change', () => { exerciseCatalogPage = 1; renderExercises(); });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); installPromptEvent = event; $('#install-app').hidden = false;
  });
  window.addEventListener('appinstalled', () => { installPromptEvent = null; $('#install-app').hidden = true; toast('Forja quedó instalada en este dispositivo.'); });
  document.addEventListener('click', (event) => {
    if (event.target.closest('#vibration-toggle')) toggleVibration();
    const swapButton = event.target.closest('[data-select-alternative]');
    if (swapButton) selectExerciseAlternative(swapButton.dataset.selectAlternative);
    if (event.target.closest('[data-close-alternatives]')) $('#alternative-dialog').close();
    const accentChoice = event.target.closest('[data-accent-choice]');
    if (accentChoice) { profile.data.accent = accentChoice.dataset.accentChoice; updateTheme(); persist(); toast('Color de acento guardado en este perfil.'); }
    const challengeShare = event.target.closest('[data-share-challenge]');
    if (challengeShare) shareChallengeFile(challengeShare.dataset.shareChallenge, challengeShare.dataset.shareKind);
    const goalDelete = event.target.closest('[data-delete-goal]');
    if (goalDelete) { db.syncTombstones = [...(db.syncTombstones || []), `goal:${goalDelete.dataset.deleteGoal}`]; profile.data.goals = profile.data.goals.filter((g) => g.id !== goalDelete.dataset.deleteGoal); persist(); renderGoals(); }
    const challengeDelete = event.target.closest('[data-delete-challenge]');
    if (challengeDelete) { const id = challengeDelete.dataset.deleteChallenge; db.syncTombstones = [...(db.syncTombstones || []), `challenge:${id}`]; db.profiles.forEach((p) => { p.data.challenges = (p.data.challenges || []).filter((c) => c.id !== id); }); persist(); renderChallenges(); }
  });
  document.addEventListener('change', (event) => { if (event.target.id === 'exercise-favorites-only') renderExercises();
    if (['accessibility-font-scale','accessibility-contrast','accessibility-motion','accessibility-targets'].includes(event.target.id)) saveAccessibilitySettings();
    if (event.target.id === 'goal-type') { $('#goal-exercise-wrap').hidden = event.target.value !== 'exercise'; $('#goal-exercise').innerHTML = EXERCISES.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join(''); }
    if (['photo-compare-a', 'photo-compare-b'].includes(event.target.id)) renderProgressPhotos(); });
  document.addEventListener('input', (event) => {
    if (event.target.id !== 'photo-compare-slider') return;
    const value = Number(event.target.value), after = $('#photo-after-clip'), divider = $('#photo-compare-divider');
    if (after) after.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    if (divider) divider.style.left = `${value}%`;
  });
}

async function cacheExerciseMediaOffline(kind='images'){
  const status=$('#catalog-cache-status');
  if(mediaDownloadJob){mediaDownloadJob.cancelled=true;mediaDownloadJob.button.textContent='Cancelando…';status.textContent='Deteniendo la descarga después de los archivos en curso…';return;}
  if(!('caches'in window)){status.textContent='Este navegador no permite guardar contenido sin conexión.';return;}
  const animations=kind==='animations',button=$(animations?'#cache-exercise-gifs':'#cache-exercise-images');
  if(animations){
    const connection=navigator.connection,saveData=connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType);
    let estimate=null;try{estimate=await navigator.storage?.estimate?.();}catch{}const free=estimate?.quota?estimate.quota-(estimate.usage||0):null;
    if(saveData&&!confirm('El navegador indica una conexión limitada o ahorro de datos. Las animaciones ocupan alrededor de 123 MB. ¿Continuar?'))return;
    if(free!=null&&free<115*1024*1024&&!confirm('El espacio disponible del navegador parece menor que el catálogo de animaciones (~123 MB). ¿Intentar de todos modos?'))return;
    if(!confirm('Descargar 1.324 animaciones (~123 MB) para usarlas sin conexión. Se recomienda Wi-Fi. ¿Continuar?'))return;
  }
  const urls=[...new Set(EXERCISES.flatMap((exercise)=>animations?(exercise.datasetGif?[exercise.datasetGif]:[]):(exercise.datasetImage?[exercise.datasetImage]:[])))];
  const job={cancelled:false,button};mediaDownloadJob=job;button.textContent='Cancelar descarga';$('#cache-exercise-images').disabled=animations;$('#cache-exercise-gifs').disabled=!animations;status.textContent=`Preparando ${urls.length.toLocaleString('es-CO')} ${animations?'animaciones':'imágenes'}…`;
  let saved=0,failed=0,processed=0,next=0;
  try{
    const cache=await caches.open('forja-media-v2');
    const worker=async()=>{while(!job.cancelled){const index=next++;if(index>=urls.length)return;const url=urls[index];try{const existing=await cache.match(url);if(existing)saved++;else{const response=await fetch(url);if(!response.ok)throw new Error('HTTP');await cache.put(url,response);saved++;}}catch{failed++;}processed++;if(processed%12===0||processed===urls.length){status.textContent=`${processed.toLocaleString('es-CO')} de ${urls.length.toLocaleString('es-CO')} · ${saved.toLocaleString('es-CO')} listas · ${failed} fallidas`;await new Promise((resolve)=>setTimeout(resolve,0));}}};
    await Promise.all(Array.from({length:4},worker));
    status.textContent=job.cancelled?`Descarga detenida: ${saved} archivos guardados; puedes continuar cuando quieras.`:failed?`Listo: ${saved} guardados; ${failed} no se pudieron descargar. Puedes reintentar.`:`Listo: ${saved.toLocaleString('es-CO')} ${animations?'animaciones':'imágenes'} disponibles sin conexión.`;
  }catch{status.textContent='No hay espacio suficiente o el navegador no permitió guardar el catálogo. Libera espacio e inténtalo de nuevo.';}
  finally{mediaDownloadJob=null;button.textContent=animations?'↓ Guardar animaciones · ~123 MB · Wi-Fi':'↓ Guardar imágenes · ~9 MB';$('#cache-exercise-images').disabled=false;$('#cache-exercise-gifs').disabled=false;}
}

function exerciseAlternatives(id) {
  const source = byId(id); if (!source) return [];
  return EXERCISES.filter((candidate) => candidate.id !== id && movementPattern(candidate) === movementPattern(source) && (candidate.muscle === source.muscle || candidate.secondary.includes(source.muscle) || source.secondary.includes(candidate.muscle)))
    .map((candidate) => ({ candidate, score: (candidate.muscle === source.muscle ? 4 : 0) + (getPreferences().equipment.includes(candidate.equip) ? 2 : 0) + (candidate.equip === source.equip ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name, 'es')).map((entry) => entry.candidate);
}
function openExerciseAlternatives(index) {
  const session = profile.data.activeWorkout, item = session?.exercises[index]; if (!item) return;
  const current = byId(item.exerciseId), completed = item.sets.some((set) => set.done);
  $('#alternative-title').textContent = `Alternativas para ${current?.name || 'el ejercicio'}`;
  $('#alternative-copy').textContent = completed ? 'Este ejercicio ya tiene series hechas. Termina el registro para conservar correctamente su historial.' : 'Elige un movimiento parecido. Los ejercicios disponibles según tu equipo aparecen primero.';
  const choices = exerciseAlternatives(item.exerciseId);
  $('#alternative-options').innerHTML = choices.length ? choices.map((x) => `<button class="alternative-choice" type="button" data-select-alternative="${x.id}" ${completed ? 'disabled' : ''}><span><b>${escapeHtml(x.name)}</b><small>${escapeHtml(MUSCLES[x.muscle])} · ${escapeHtml(x.equip)} · ${escapeHtml(x.focus)}</small></span><i>${getPreferences().equipment.includes(x.equip) ? 'Disponible' : 'Sin equipo marcado'}</i></button>`).join('') : '<div class="empty-inline">No encontré una variante cercana en la biblioteca.</div>';
  $('#alternative-dialog').dataset.exerciseIndex = String(index); $('#alternative-dialog').showModal();
}
function selectExerciseAlternative(id) {
  const dialog = $('#alternative-dialog'), index = Number(dialog.dataset.exerciseIndex), session = profile.data.activeWorkout, item = session?.exercises[index], next = byId(id);
  if (!item || !next || item.sets.some((set) => set.done)) { dialog.close(); toast('No se puede cambiar este ejercicio después de registrar una serie.'); return; }
  const previous = byId(item.exerciseId); item.exerciseId = next.id; item.replacedExerciseId = previous?.id || null; item.replacedExerciseName = previous?.name || '';
  item.reps = next.reps; item.rest = next.rest; item.unit = /s$/.test(next.reps) ? 'seconds' : 'reps'; item.sets = Array.from({ length: item.targetSets }, () => ({ weight: '', reps: defaultReps(next.reps), rpe: 8, done: false }));
  item.notes = ''; item.discomfort = 'none'; session.updatedAt = new Date().toISOString(); persist(); dialog.close(); renderWorkout(); toast(`Ahora harás ${next.name}.`);
}

function toggleWorkoutSuperset(index) {
  const session = profile.data.activeWorkout, item = session?.exercises[index], next = session?.exercises[index + 1];
  if (!item || !next) return;
  if (item.supersetId && item.supersetId === next.supersetId) { item.supersetId = null; next.supersetId = null; }
  else {
    const oldId = item.supersetId;
    if (oldId) session.exercises.forEach((entry) => { if (entry.supersetId === oldId) entry.supersetId = null; });
    const nextOld = next.supersetId;
    if (nextOld) session.exercises.forEach((entry) => { if (entry.supersetId === nextOld) entry.supersetId = null; });
    const group = `superset-${Date.now()}-${index}`; item.supersetId = group; next.supersetId = group;
  }
  session.updatedAt = new Date().toISOString(); persist(); renderWorkout();
}
function workoutPair(session, index) {
  const item = session?.exercises[index]; if (!item?.supersetId) return null;
  const partnerIndex = session.exercises.findIndex((entry, i) => i !== index && entry.supersetId === item.supersetId);
  return partnerIndex < 0 ? null : { partnerIndex, partner: session.exercises[partnerIndex] };
}
function toggleFontScale() {
  db.accessibility ||= {};
  const current = Number(db.accessibility.fontScale) || (db.accessibility.largeText ? 112 : 100);
  db.accessibility.fontScale = current === 100 ? 112 : current === 112 ? 125 : 100;
  db.accessibility.largeText = db.accessibility.fontScale > 100;
  applyAccessibilitySettings(); persist();
}
function applyAccessibilitySettings() {
  const settings = db.accessibility || {}, scale = [100,112,125].includes(Number(settings.fontScale)) ? Number(settings.fontScale) : (settings.largeText ? 112 : 100);
  settings.fontScale = scale; settings.largeText = scale > 100;
  document.body.dataset.fontScale = String(scale);
  document.body.classList.toggle('large-text', settings.largeText);
  document.body.classList.toggle('high-contrast', Boolean(settings.highContrast));
  document.body.classList.toggle('reduce-motion', Boolean(settings.reduceMotion));
  document.body.classList.toggle('large-targets', Boolean(settings.largeTargets));
  const scaleInput = $('#accessibility-font-scale'); if (scaleInput) scaleInput.value = String(scale);
  const toggles = [['accessibility-contrast','highContrast'],['accessibility-motion','reduceMotion'],['accessibility-targets','largeTargets']];
  toggles.forEach(([id,key]) => { const input = $(`#${id}`); if (input) input.checked = Boolean(settings[key]); });
  const button = $('#font-toggle'); if (button) { button.setAttribute('aria-pressed', String(settings.largeText)); button.title = scale === 100 ? 'Aumentar tamaño de texto' : 'Cambiar tamaño de texto'; button.setAttribute('aria-label', button.title); }
}
function saveAccessibilitySettings() {
  db.accessibility ||= {};
  const scale = Number($('#accessibility-font-scale')?.value);
  db.accessibility.fontScale = [100,112,125].includes(scale) ? scale : 100;
  db.accessibility.largeText = db.accessibility.fontScale > 100;
  db.accessibility.highContrast = Boolean($('#accessibility-contrast')?.checked);
  db.accessibility.reduceMotion = Boolean($('#accessibility-motion')?.checked);
  db.accessibility.largeTargets = Boolean($('#accessibility-targets')?.checked);
  applyAccessibilitySettings(); persist();
}
function toggleVibration() {
  if (typeof navigator.vibrate !== 'function') {
    updateVibrationControl();
    toast('Este navegador no permite vibración web. El aviso sonoro del temporizador sigue funcionando.');
    return;
  }
  db.accessibility ||= {}; db.accessibility.vibration = db.accessibility.vibration === false;
  updateVibrationControl();
  const result = db.accessibility.vibration ? navigator.vibrate(45) : true;
  persist();
  toast(!db.accessibility.vibration ? 'Vibración desactivada.' : result === false ? 'El navegador rechazó la prueba. Revisa los ajustes de vibración del teléfono.' : 'Prueba de vibración enviada. Si no la sientes, revisa los ajustes de vibración y No molestar.');
}
async function installApp() {
  if (!installPromptEvent) { toast('Usa el menú del navegador y elige “Añadir a pantalla de inicio”.'); return; }
  installPromptEvent.prompt(); await installPromptEvent.userChoice; installPromptEvent = null; $('#install-app').hidden = true;
}
function exerciseDifficulty(x) {
  if (/barbell|smith|rdl|dead-bug|pike|walking|split-squat/.test(x.id)) return 'Intermedio';
  if (/push-up|plank|goblet/.test(x.id)) return 'Inicial';
  return x.level || (x.equip === 'Barra' ? 'Intermedio' : 'Inicial');
}
function exerciseMovement(x) {
  const p = movementPattern(x);
  if (p === 'core') return 'Core y estabilidad';
  if (p === 'lower') return /squat|press|lunge/.test(x.id) ? 'Sentadilla' : 'Aislamiento';
  if (p === 'hinge') return 'Bisagra de cadera';
  if (p === 'pull' || p === 'curl') return 'Tracción';
  if (p === 'push') return 'Empuje';
  return 'Aislamiento';
}
function exerciseVideoPanel(x) {
  if (x.datasetGif) return `<section class="exercise-media"><div class="demo-heading"><b>Demostración del movimiento</b><small>${x.datasetMediaVariant?'Animación de una variante cercana · GIF':'Animación del ejercicio · GIF'}</small></div><div class="exercise-media-content"><img src="${escapeHtml(x.datasetGif)}" alt="Demostración animada de ${escapeHtml(x.name)}" loading="lazy" decoding="async"></div>${x.datasetMediaVariant?`<p class="media-attribution">Variante ilustrada: ${escapeHtml(x.datasetMediaName||'movimiento similar')}.</p>`:''}<p class="media-attribution">${escapeHtml(x.datasetAttribution||'© Gym visual — https://gymvisual.com/')}</p></section>`;
  const direct=EXERCISE_VIDEO_IDS[x.id],animation=exerciseMediaIndex[x.id],fallback=`https://www.youtube.com/results?search_query=${encodeURIComponent(`${x.name} ejercicio técnica`)}`,demoName=animation?.match||x.name;
  const media=direct?`<iframe src="https://www.youtube-nocookie.com/embed/${direct}?rel=0&playsinline=1" title="Video: ${escapeHtml(x.name)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`:animation?`<img src="${escapeHtml(animation.gifUrl)}" alt="Demostración animada: ${escapeHtml(demoName)}" loading="lazy" decoding="async">`:`<div class="media-placeholder">Pulsa para cargar una demostración animada.<button class="button secondary" type="button" data-load-exercise-demo="${x.id}">Cargar demostración</button></div>`;
  const caption=direct?'Video guiado':animation?.approvedVariant?`Variante cercana · ${escapeHtml(demoName)}`:animation?'Demostración animada':'Guía animada',credit=direct?'Video externo de YouTube':`<a href="https://exercisedb.dev/" target="_blank" rel="noreferrer">Animaciones ExerciseDB / AscendAPI</a>`;
  return `<section class="exercise-media"><div class="demo-heading"><b>Demostración del movimiento</b><small>${caption}</small></div><div class="exercise-media-content" id="exercise-media-${x.id}">${media}</div><p class="media-attribution">${credit} · <a href="${fallback}" target="_blank" rel="noreferrer">Buscar otra demostración</a></p></section>`;
}
async function loadExerciseMediaIndex() {
  try {
    const response = await fetch('./exercise-media.json', { headers: { Accept: 'application/json' }, cache: 'no-cache' });
    if (!response.ok) return;
    const payload = await response.json();
    exerciseMediaIndex = Object.fromEntries((payload.exercises || []).filter((item) => item.gifUrl && (item.score >= 0.82 || item.approvedVariant === true)).map((item) => [item.id, item]));
  } catch { exerciseMediaIndex = {}; }
}
async function loadExerciseDemo(id) {
  const x = byId(id), root = $(`#exercise-media-${CSS.escape(id)}`);
  if (!x || !root) return;
  root.innerHTML = '<div class="media-placeholder">Buscando una demostración…</div>';
  try {
    let matches = exerciseDemoCache.get(id);
    if (!matches) {
      const query = EXERCISE_SEARCH_TERMS[id] || x.name;
      const response = await fetch(`https://oss.exercisedb.dev/api/v1/exercises?name=${encodeURIComponent(query)}&limit=25`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Servicio de demostraciones no disponible');
      const body = await response.json();
      const resultSet = body.data || body.exercises || body.results || body.items || [];
      matches = Array.isArray(body) ? body : Array.isArray(resultSet) ? resultSet : resultSet.exercises || resultSet.items || [];
      exerciseDemoCache.set(id, matches);
    }
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const wanted = norm(EXERCISE_SEARCH_TERMS[id] || x.name);
    const aliases = { 'Mancuernas':['dumbbell'], 'Máquina':['machine','sled'], 'Polea':['cable'], 'Barra':['barbell','smith'], 'Peso corporal':['bodyweight','body weight'] };
    const expectedMuscles = { chest:['chest','pectorals'], back:['back','lats'], shoulders:['shoulders','deltoids'], biceps:['biceps'], triceps:['triceps'], core:['abs','abdominals','core'], quads:['quadriceps','quads','upper legs'], hamstrings:['hamstrings'], glutes:['glutes','gluteal'], calves:['calves'], forearms:['forearms'] }[x.muscle] || [];
    const tokens = wanted.split(' ').filter((t) => t.length > 2 && !['machine','lever','dumbbell','barbell','cable','exercise'].includes(t));
    const ranked = matches.map((item) => {
      const name = norm(item.name || item.exerciseName || item.title), nameTokens = name.split(' '), equipmentValue = item.equipments || item.equipment || [], equipment = (Array.isArray(equipmentValue) ? equipmentValue.map(norm).join(' ') : norm(equipmentValue)), muscleValue = item.targetMuscles || item.targetMuscle || [], targets = (Array.isArray(muscleValue) ? muscleValue.map(norm).join(' ') : norm(muscleValue));
      const overlap = tokens.filter((t) => nameTokens.includes(t)).length / Math.max(tokens.length, 1), exact = name === wanted ? 0.55 : 0;
      const equipMatch = (aliases[x.equip] || []).some((t) => equipment.includes(t));
      const muscleMatch = expectedMuscles.some((t) => targets.includes(t));
      const wrongEquipment = (x.equip === 'Mancuernas' && /barbell|machine|cable/.test(equipment)) || (x.equip === 'Barra' && /dumbbell/.test(equipment)) || (x.equip === 'Polea' && /dumbbell|barbell/.test(equipment)) || (x.equip === 'Peso corporal' && /machine|dumbbell|barbell|cable/.test(equipment));
      return { item, score: exact + overlap * 0.42 + (equipMatch ? 0.18 : 0) + (muscleMatch ? 0.2 : 0) - (wrongEquipment ? 0.35 : 0) };
    }).sort((a, b) => b.score - a.score);
    const best = ranked[0]?.score >= 0.56 ? ranked[0].item : null;
    const gif = best?.gifUrl || best?.gifURL || best?.gif_url || best?.videoUrl;
    if (!gif) throw new Error('No encontré una animación confiable para esta variante');
    const img = document.createElement('img'); img.loading = 'lazy'; img.alt = `Demostración animada: ${x.name}`; img.src = gif;
    img.onerror = () => { root.innerHTML = `<div class="media-error">No se pudo cargar el GIF. <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(`${x.name} ejercicio técnica`)}" target="_blank" rel="noreferrer">Buscar un video</a></div>`; };
    root.replaceChildren(img);
  } catch (error) {
    root.innerHTML = `<div class="media-error">No encontré la animación ahora. Puedes <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(`${x.name} ejercicio técnica`)}" target="_blank" rel="noreferrer">buscar un video de ${escapeHtml(x.name)}</a>.</div>`;
  }
}
function renderExercises() {
  populateMuscleFilter();
  const q=$('#exercise-search').value.trim().toLocaleLowerCase('es'),equip=$('#equipment-filter').value,muscle=$('#muscle-filter').value,difficulty=$('#difficulty-filter').value,movement=$('#movement-filter').value,favoritesOnly=$('#exercise-favorites-only')?.value==='favorites';
  const list=EXERCISES.filter((x)=>{const text=`${x.name} ${x.datasetOriginalName||''} ${x.focus} ${MUSCLES[x.muscle]} ${x.secondary.map((m)=>MUSCLES[m]).join(' ')} ${x.equip} ${x.datasetTarget||''} ${x.datasetMuscleGroup||''}`.toLocaleLowerCase('es');return(!q||text.includes(q))&&(!favoritesOnly||profile.data.favorites.includes(x.id))&&(equip==='Todos'||x.equip===equip)&&(muscle==='Todos'||x.muscle===muscle||x.secondary.includes(muscle))&&(difficulty==='Todos'||exerciseDifficulty(x)===difficulty)&&(movement==='Todos'||exerciseMovement(x)===movement);});
  const visible=list.slice(0,exerciseCatalogPage*EXERCISE_CATALOG_PAGE_SIZE);$('#exercise-count').textContent=`${list.length.toLocaleString('es-CO')} ejercicios${list.some((x)=>x.datasetImage)?' · JPG + GIF':''}`;$('#exercise-empty').hidden=!!list.length;
  $('#exercise-grid').innerHTML=visible.map((x)=>`<article class="exercise-card"><div class="exercise-illustration">${x.datasetImage?`<img class="exercise-thumb" src="${escapeHtml(x.datasetImage)}" alt="Esquema: ${escapeHtml(x.name)}" width="180" height="180" loading="lazy" decoding="async" fetchpriority="low">`:`<span class="exercise-glyph">${x.glyph}</span>`}<span class="exercise-equip">${escapeHtml(x.equip)}</span><button class="exercise-fav ${profile.data.favorites.includes(x.id)?'on':''}" data-favorite="${x.id}" aria-label="${profile.data.favorites.includes(x.id)?'Quitar de':'Añadir a'} favoritos">${profile.data.favorites.includes(x.id)?'★':'☆'}</button></div><h3>${escapeHtml(x.name)}</h3>${x.datasetImage?`<p class="exercise-credit">${escapeHtml(x.datasetAttribution||'© Gym visual — https://gymvisual.com/')}</p>`:`<p>${escapeHtml(MUSCLES[x.muscle])}</p>`}<div class="muscle-chips"><span class="muscle-chip">${escapeHtml(x.focus)}</span><span class="muscle-chip">${x.sets} × ${escapeHtml(x.reps)}</span><span class="exercise-level">${exerciseDifficulty(x)} · ${escapeHtml(exerciseMovement(x))}</span></div><div class="exercise-card-footer"><span>◷ ${x.rest} s descanso</span>${profile.data.activeWorkout?`<button data-add-to-session="${x.id}">＋ Añadir</button>`:`<button data-open-exercise="${x.id}">Ver detalles →</button>`}</div></article>`).join('');
  const more=$('#exercise-load-more');more.hidden=visible.length>=list.length;more.textContent=`Mostrar más (${(list.length-visible.length).toLocaleString('es-CO')} restantes)`;
}
function renderRoutines() {
  if ($('#weekly-schedule-grid')) renderWeeklyScheduleEditor();
  const customs = profile.data.customRoutines || [], customIds = new Set(customs.map((routine) => routine.id));
  $('#routine-prebuilt-count').textContent = ROUTINES.length.toLocaleString('es-CO');
  $('#routine-custom-count').textContent = customs.length.toLocaleString('es-CO');
  $$('[data-routine-collection]').forEach((tab) => { const active = tab.dataset.routineCollection === routineCollection; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); });
  const source = routineCollection === 'custom' ? customs : ROUTINES;
  const routines = source.filter((r) => routineFilter === 'Todas' || (routineFilter === 'Favoritas' && profile.data.favoriteRoutines.includes(r.id)) || (routineFilter === 'En casa' && r.exercises.every(([id]) => ['Mancuernas', 'Peso corporal', 'Barra'].includes(byId(id)?.equip))) || r.split === routineFilter);
  const root = $('#routine-grid');
  if (!routines.length) {
    root.innerHTML = routineCollection === 'custom' && routineFilter === 'Todas'
      ? '<div class="routine-empty"><span>✳</span><h3>Todavía no has creado rutinas</h3><p>Empieza con una plantilla, elige los ejercicios y guarda tu plan.</p><button type="button" class="button primary" data-create-routine>＋ Crear mi primera rutina</button></div>'
      : '<div class="routine-empty"><h3>No hay rutinas con este filtro</h3><p>Prueba otra categoría o vuelve a mostrar todas.</p></div>';
    return;
  }
  root.innerHTML = routines.map((r) => {
    const adapted = adaptRoutine(r), groups = [...new Set(adapted.exercises.map(([id]) => MUSCLES[byId(id)?.muscle]).filter(Boolean))], custom = customIds.has(r.id), favorite = profile.data.favoriteRoutines.includes(r.id);
    return `<article class="routine-card"><div class="routine-top"><span class="routine-icon">${escapeHtml(r.icon || '✳')}</span><span class="routine-tag">${custom ? 'MI RUTINA' : escapeHtml(r.level || 'PLANTILLA')} · ${escapeHtml(r.split)}</span></div><h3>${escapeHtml(r.name)}</h3><p>${escapeHtml(r.desc || 'Rutina personalizada.')}</p><div class="routine-meta"><span>◷ Estimado ${escapeHtml(adapted.time || `${adapted.exercises.length * 7}–${adapted.exercises.length * 9} min`)}</span><span>Tu sesión: ${adapted.targetMinutes} min</span><span>▤ ${adapted.exercises.length} ejercicios</span></div>${adapted.equipmentWarning ? '<small class="equipment-warning">Incluye equipo adicional</small>' : ''}<div class="routine-card-footer"><div class="routine-muscles">${groups.slice(0, 5).map((g) => `<i title="${escapeHtml(g)}">${muscleEmoji(g)}</i>`).join('')}</div><div class="routine-actions"><button class="routine-favorite ${favorite ? 'on' : ''}" data-favorite-routine="${escapeHtml(r.id)}" aria-label="${favorite ? 'Quitar de' : 'Añadir a'} favoritas">${favorite ? '★' : '☆'}</button><button class="routine-share" data-share-routine="${escapeHtml(r.id)}" aria-label="Exportar rutina para compartir" title="Exportar para compartir">↥</button>${custom ? `<button class="routine-edit" data-edit-routine="${escapeHtml(r.id)}" aria-label="Editar rutina">✎</button>` : ''}<button class="routine-clone" data-clone-routine="${escapeHtml(r.id)}" aria-label="Duplicar rutina">⧉</button>${custom ? `<button class="routine-delete" data-delete-routine="${escapeHtml(r.id)}" aria-label="Eliminar rutina">×</button>` : ''}<button class="button primary" data-start-routine="${escapeHtml(r.id)}">Empezar →</button></div></div></article>`;
  }).join('');
}
function renderMeasurementChart() {
  const root = $('#measurement-chart'); if (!root) return;
  const field = $('#measure-chart-field').value, days = $('#measure-chart-range').value, cutoff = days === 'all' ? 0 : Date.now() - Number(days) * 86400000;
  const data = (profile.data.measurements || []).filter((m) => m[field] != null && new Date(`${m.date}T23:59:59`).getTime() >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) { root.innerHTML = '<div class="chart-empty">Guarda un registro de esta medida para ver su tendencia.</div>'; return; }
  const unit = field === 'weight' ? getPreferences().weightUnit : 'cm', points = data.map((m) => ({ date: m.date, value: field === 'weight' ? convertWeight(m[field], m.weightUnit || 'kg') : Number(m[field]) }));
  const width = 680, height = 170, left = 42, right = 16, top = 12, bottom = 30, min = Math.min(...points.map((p) => p.value)), max = Math.max(...points.map((p) => p.value)), span = Math.max(max - min, Math.abs(max) * .04, .5), x = (i) => points.length === 1 ? width / 2 : left + i * (width - left - right) / (points.length - 1), y = (v) => top + (height - top - bottom) * (1 - (v - (min - span * .1)) / (span * 1.2)), path = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.value)}`).join(' '), fmt = (v) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v);
  root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfica de ${escapeHtml($('#measure-chart-field').selectedOptions[0].textContent)} en ${points.length} registros">${[0, .5, 1].map((f) => `<line class="chart-gridline" x1="${left}" x2="${width - right}" y1="${top + f * (height - top - bottom)}" y2="${top + f * (height - top - bottom)}"/>`).join('')}<path class="measure-line" d="${path}"/>${points.map((p, i) => `<circle class="measure-point" cx="${x(i)}" cy="${y(p.value)}" r="4"><title>${escapeHtml(fmtDate(`${p.date}T12:00:00`, { day: 'numeric', month: 'long', year: 'numeric' }))}: ${fmt(p.value)} ${unit}</title></circle>`).join('')}${points.map((p, i) => i === 0 || i === points.length - 1 ? `<text class="chart-axis" x="${x(i)}" y="${height - 8}" text-anchor="middle">${escapeHtml(fmtDate(`${p.date}T12:00:00`, { day: 'numeric', month: 'short' }))}</text>` : '').join('')}</svg><div class="chart-caption">${escapeHtml($('#measure-chart-field').selectedOptions[0].textContent)} · ${unit} · ${points.length} registros</div>`;
}
function goalCurrentValue(goal) {
  if (goal.type === 'sessions') return validWorkoutHistory().filter((w) => new Date(w.finishedAt||w.startedAt) >= new Date(goal.createdAt)).length;
  if (goal.type === 'weight') { const latest = profile.data.measurements.filter((m) => m.weight != null).at(-1); return latest ? convertWeight(latest.weight, latest.weightUnit || 'kg') : 0; }
  if (goal.type === 'exercise') return Math.max(0, ...validWorkoutHistory().flatMap((w) => w.exercises.filter((e) => e.exerciseId === goal.exerciseId).flatMap((e) => e.sets.filter((s) => s.done).map((s) => convertWeight(s.weight || 0, s.weightUnit || 'kg')))));
  if (goal.type === 'streak') { const dates = new Set(validWorkoutHistory().map((w) => localDay(w.finishedAt||w.startedAt))); let n = 0, date = new Date(); date.setHours(0, 0, 0, 0); if (!dates.has(localDay(date))) date.setDate(date.getDate() - 1); while (dates.has(localDay(date)) && n < 365) { n++; date.setDate(date.getDate() - 1); } return n; }
  return 0;
}
function renderGoals() {
  const root = $('#goal-list'); if (!root) return;
  root.innerHTML = profile.data.goals.length ? profile.data.goals.map((g) => {
    const value = goalCurrentValue(g), rawTarget = Number(g.target) || 1, target = g.type === 'weight' ? convertWeight(rawTarget, g.weightUnit || 'kg') : rawTarget, unit = g.type === 'weight' || g.type === 'exercise' ? ` ${getPreferences().weightUnit}` : '';
    let pct = value / target * 100;
    if (g.type === 'weight' && Number.isFinite(g.baseline) && g.baseline !== target) pct = target > g.baseline ? (value - g.baseline) / (target - g.baseline) * 100 : (g.baseline - value) / (g.baseline - target) * 100;
    pct = Math.min(100, Math.max(0, Math.round(pct)));
    const name = g.type === 'exercise' ? byId(g.exerciseId)?.name || 'ejercicio' : '';
    return `<article class="goal-card"><div class="goal-card-top"><div><h3>${escapeHtml(g.title)}</h3><small>${g.due ? `Fecha límite: ${escapeHtml(fmtDate(`${g.due}T12:00:00`, { day: 'numeric', month: 'short', year: 'numeric' }))}` : 'Meta personal'} · ${g.type === 'sessions' ? 'sesiones' : g.type === 'weight' ? 'peso corporal' : g.type === 'exercise' ? `carga · ${escapeHtml(name)}` : 'días seguidos'}</small></div><button class="goal-delete" data-delete-goal="${escapeHtml(g.id)}" aria-label="Eliminar meta">×</button></div><div class="goal-progress"><i style="width:${pct}%"></i></div><p>${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(value)} / ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(target)}${unit} · ${pct >= 100 ? 'Meta cumplida' : `${pct}%`}</p></article>`;
  }).join('') : '<div class="empty-inline">Crea una meta para seguir tus sesiones, peso o marcas.</div>';
}
function saveGoal() {
  const title = $('#goal-title').value.trim(), target = Number($('#goal-target').value), type = $('#goal-type').value, due = $('#goal-due').value, exerciseId = type === 'exercise' ? $('#goal-exercise').value : null;
  if (!title || !Number.isFinite(target) || target <= 0) { toast('Escribe una meta y un valor objetivo válido.'); return; }
  const latestWeight = profile.data.measurements.filter((m) => m.weight != null).at(-1);
  profile.data.goals.push({ id: `goal-${crypto.randomUUID?.() || Date.now()}`, title: title.slice(0, 60), target, type, exerciseId, weightUnit: getPreferences().weightUnit, baseline: type === 'weight' && latestWeight ? convertWeight(latestWeight.weight, latestWeight.weightUnit || 'kg') : null, due, createdAt: new Date().toISOString() });
  $('#goal-title').value = ''; $('#goal-form').hidden = true; persist(); renderGoals(); toast('Meta guardada.');
}
function renderReadiness() {
  const root = $('#readiness-summary'); if (!root) return;
  const logs = (profile.data.readiness || []).slice().sort((a, b) => a.date.localeCompare(b.date)), today = localDay(), current = logs.find((x) => x.date === today);
  if (current) { $('#readiness-sleep').value = current.sleep ?? ''; $('#readiness-energy').value = String(current.energy); $('#readiness-soreness').value = String(current.soreness); }
  const recent = logs.slice(-7), score = current ? Math.round((Number(current.energy) + (6 - Number(current.soreness))) / 2 * 10) / 10 : null;
  const summary = current ? `<b>Hoy: ${score}/5 de disposición general</b> · ${current.sleep == null ? 'sueño sin registrar' : `${escapeHtml(Number(current.sleep))} h de sueño`} · ${['', 'energía muy baja', 'energía baja', 'energía normal', 'buena energía', 'energía excelente'][current.energy]} · ${['', 'sin molestias', 'molestias leves', 'molestias moderadas', 'molestias altas', 'molestias muy altas'][current.soreness]}${score <= 2 ? '<br><b>Considera bajar la carga o descansar; no entrenes a través del dolor.</b>' : ''}` : `<span>${recent.length ? 'Todavía no has registrado cómo te sientes hoy.' : 'Registra hoy cómo dormiste y cómo te sientes.'} Forja muestra una tendencia de los últimos días; es una orientación personal.</span>`;
  const wellness = ForjaCore.wellnessPerformanceCorrelation(validWorkoutHistory(), profile.data.readiness);
  root.innerHTML = `${summary}<p class="wellness-correlation">${escapeHtml(wellness.summary)}${wellness.samples ? ` · ${wellness.samples} días con ambos registros` : ''}</p>${recent.length ? `<div class="readiness-bars" aria-label="Registro de disposición de los últimos días">${recent.map((r) => `<span style="height:${Math.max(8, (Number(r.energy) + (6 - Number(r.soreness))) / 10 * 100)}%" title="${escapeHtml(r.date)} · energía ${r.energy}/5"><small>${escapeHtml(fmtDate(`${r.date}T12:00:00`, { day: 'numeric', month: 'short' }))}</small></span>`).join('')}</div>` : ''}`;
}
function saveReadiness(event) {
  event.preventDefault(); const sleep = $('#readiness-sleep').value, entry = { date: localDay(), updatedAt: new Date().toISOString(), sleep: sleep === '' ? null : Number(sleep), energy: Number($('#readiness-energy').value), soreness: Number($('#readiness-soreness').value) };
  profile.data.readiness = (profile.data.readiness || []).filter((r) => r.date !== entry.date); profile.data.readiness.push(entry); profile.data.readiness.sort((a, b) => a.date.localeCompare(b.date)); persist(); renderReadiness(); toast('Registro de bienestar guardado.');
}
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function exportCsv() {
  const rows = [['Fecha', 'Rutina', 'Duración (min)', 'Ejercicio', 'Músculo', 'Equipo', 'Serie', 'Peso', 'Unidad', 'Repeticiones', 'RPE', 'Molestia', 'Nota']];
  validWorkoutHistory().slice().sort((a, b) => new Date(a.finishedAt) - new Date(b.finishedAt)).forEach((w) => w.exercises.forEach((entry) => {
    const ex = byId(entry.exerciseId);
    entry.sets.forEach((set, i) => rows.push([localDay(w.finishedAt), w.name, Math.round(w.durationMinutes || 0), ex?.name || entry.exerciseId, ex ? MUSCLES[ex.muscle] : '', ex?.equip || '', i + 1, set.weight || '', set.weightUnit || getPreferences().weightUnit, set.reps || '', set.rpe || '', entry.discomfort || '', entry.notes || '']));
  }));
  const blob = new Blob(['\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `forja-entrenamientos-${localDay()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('CSV de sesiones descargado.');
}
function reminderPack() {
  const defaults = defaultReminders();
  profile.data.reminders ||= {};
  for (const key of ['workout','hydration','sleep','nutrition']) {
    const stored = profile.data.reminders[key] || (key === 'workout' ? profile.data.reminder : null);
    const reminder = { ...defaults[key], ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) };
    reminder.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time) ? reminder.time : defaults[key].time;
    reminder.days = Array.isArray(reminder.days) ? [...new Set(reminder.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))] : defaults[key].days.slice();
    reminder.enabled = Boolean(reminder.enabled); reminder.lastSent = typeof reminder.lastSent === 'string' ? reminder.lastSent : '';
    profile.data.reminders[key] = reminder;
  }
  profile.data.reminders.quietHours = { ...defaults.quietHours, ...(profile.data.reminders.quietHours || {}) };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(profile.data.reminders.quietHours.start)) profile.data.reminders.quietHours.start = defaults.quietHours.start;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(profile.data.reminders.quietHours.end)) profile.data.reminders.quietHours.end = defaults.quietHours.end;
  profile.data.reminders.quietHours.enabled = Boolean(profile.data.reminders.quietHours.enabled);
  if (!Number.isFinite(Date.parse(profile.data.reminders.snoozedUntil || ''))) profile.data.reminders.snoozedUntil = '';
  return profile.data.reminders;
}
function renderReminder() {
  const pack = reminderPack(), r = pack.workout;
  if ($('#reminder-time')) $('#reminder-time').value = r.time || '18:00';
  $$('.reminder-days input').forEach((i) => { i.checked = (r.days || []).includes(Number(i.value)); });
  const fill = (id, item) => { const time = $(`#${id}-time`), enabled = $(`#${id}-enabled`); if (time) time.value = item.time; if (enabled) enabled.checked = !!item.enabled; };
  fill('hydration', pack.hydration); fill('sleep', pack.sleep); fill('nutrition', pack.nutrition);
  $('#quiet-hours-enabled').checked = Boolean(pack.quietHours.enabled);
  $('#quiet-hours-start').value = pack.quietHours.start; $('#quiet-hours-end').value = pack.quietHours.end;
  const names = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const mode = db.push?.enabled ? 'Push de entrenamiento activo.' : 'Los avisos locales se comprueban con Forja abierta.';
  const pill = (key, label) => `<span class="reminder-pill ${pack[key].enabled ? 'on' : ''}">${label} · ${pack[key].enabled ? escapeHtml(pack[key].time) : 'apagado'}</span>`;
  const status = $('#reminder-status');
  const snooze = Date.parse(pack.snoozedUntil || ''), snoozeText = Number.isFinite(snooze) && snooze > Date.now() ? ` Avisos pospuestos hasta ${escapeHtml(new Intl.DateTimeFormat('es-CO',{hour:'2-digit',minute:'2-digit'}).format(snooze))}.` : '';
  if (status) status.innerHTML = `${r.enabled ? `Entrenar ${escapeHtml(r.time)} · ${(r.days || []).map((d) => names[d]).filter(Boolean).join(', ')}.` : 'Entrenamiento sin aviso.'} ${mode}${pack.quietHours.enabled ? ` Silencio ${escapeHtml(pack.quietHours.start)}–${escapeHtml(pack.quietHours.end)}.` : ''}${snoozeText}<div class="reminder-pills">${pill('workout', 'Entrenar')}${pill('hydration', 'Hidratación')}${pill('sleep', 'Sueño')}${pill('nutrition', 'Alimentación')}</div>`;
  if ($('#save-reminder')) $('#save-reminder').textContent = r.enabled ? 'Actualizar recordatorios' : 'Guardar recordatorios';
}
async function saveReminder() {
  const days = $$('.reminder-days input:checked').map((i) => Number(i.value)); if (!days.length) { toast('Elige al menos un día de entrenamiento.'); return; }
  const pack = reminderPack();
  const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
  const workoutTime = $('#reminder-time').value, quietStart = $('#quiet-hours-start').value, quietEnd = $('#quiet-hours-end').value, quietEnabled = !!$('#quiet-hours-enabled')?.checked;
  if (!validTime(workoutTime) || !validTime(quietStart) || !validTime(quietEnd) || (quietEnabled && quietStart === quietEnd)) { toast('Revisa las horas; el inicio y el fin del silencio deben ser distintos.'); return; }
  pack.workout = { ...pack.workout, enabled: true, time: workoutTime, days };
  pack.hydration = { ...pack.hydration, enabled: !!$('#hydration-enabled')?.checked, time: $('#hydration-time')?.value || '11:00', days: [0, 1, 2, 3, 4, 5, 6] };
  pack.sleep = { ...pack.sleep, enabled: !!$('#sleep-enabled')?.checked, time: $('#sleep-time')?.value || '22:00', days: [0, 1, 2, 3, 4, 5, 6] };
  pack.nutrition = { ...pack.nutrition, enabled: !!$('#nutrition-enabled')?.checked, time: $('#nutrition-time')?.value || '13:00', days: [0, 1, 2, 3, 4, 5, 6] };
  pack.quietHours = { enabled: quietEnabled, start: quietStart, end: quietEnd };
  profile.data.reminder = pack.workout; persist(); renderReminder(); await syncReminderSchedule();
  toast(db.push?.enabled ? 'Recordatorios guardados. El entrenamiento también usa avisos push.' : 'Recordatorios guardados. Activa push para el aviso de entrenar con Forja cerrada.');
}
async function snoozeReminders() {
  const pack = reminderPack(); pack.snoozedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  if (!await persist()) { toast('No pude guardar la pausa de avisos.'); return; }
  await syncReminderSchedule(); renderReminder(); toast('Avisos pospuestos durante una hora.');
}
function checkReminder() {
  if (!profile?.data) return;
  const pack = reminderPack();
  const now = new Date(), { due, claimed } = ForjaCore.claimDueReminders(pack, now, Boolean(db.push?.enabled));
  if (!claimed.length) return;
  profile.data.reminder = pack.workout;
  persist();
  const copy = {
    workout: { title: 'Hora de entrenar · Forja', body: 'Tu sesión te espera. Abre Forja cuando estés listo.' },
    hydration: { title: 'Hidratación · Forja', body: 'Un vaso de agua ahora ayuda a sostener el entrenamiento y la recuperación.' },
    sleep: { title: 'Sueño · Forja', body: 'Empieza a bajar el ritmo. El sueño de esta noche alimenta el rendimiento de mañana.' },
    nutrition: { title: 'Alimentación · Forja', body: 'Si entrenas hoy, prioriza proteína y una comida que puedas digerir bien.' }
  };
  const today = localDay(now);
  for (const key of due) {
    const payload = copy[key] || copy.workout;
    if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) navigator.serviceWorker.ready.then((reg) => reg.showNotification(payload.title, { body: payload.body, icon: './icon.svg', tag: `forja-${key}-${today}`, data: { url: './' } })).catch(() => toast(payload.body));
    else toast(payload.body);
  }
}
function base64UrlToBytes(value) {
  const padded = (value + '='.repeat((4 - value.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
async function enablePushNotifications() {
  try {
    if (!$('#sync-url').value.trim() || !$('#sync-anon-key').value.trim()) {
      $('#sync-dialog').showModal(); updateSyncStatus('Para recibir avisos con Forja cerrada, configura primero tu proyecto Supabase y tu cuenta.');
      toast('Abre la configuración de sincronización para preparar los avisos push.'); return;
    }
    const c = getSyncConfigFromForm(); saveSyncConfig(c);
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Este navegador no permite avisos push. Instala Forja desde una dirección HTTPS y prueba en Chrome o Safari actualizado.');
    if (!syncCloudSession?.access_token) { updateSyncStatus('Inicia sesión en Supabase y luego vuelve a pulsar “Activar avisos aunque cierres Forja”.'); toast('Inicia sesión primero y vuelve a activar los avisos.'); return; }
    if (!c.vapidPublicKey) throw new Error('Añade la clave pública VAPID del servidor. La guía explica cómo generarla y configurarla.');
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('El navegador no permitió las notificaciones. Actívalas en la configuración del sitio.');
    const registration = await navigator.serviceWorker.ready, applicationServerKey = base64UrlToBytes(c.vapidPublicKey), existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    await ensureCloudSession();
    const user = await supabaseRequest('/auth/v1/user', {}, c); if (!user?.id) throw new Error('No pude identificar la cuenta. Inicia sesión de nuevo.');
    db.push ||= {}; db.push.enabled = true; db.push.endpoint = subscription.endpoint;
     const reminderSettings = reminderPack();
     await supabaseRequest('/rest/v1/push_subscriptions?on_conflict=endpoint', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ endpoint: subscription.endpoint, user_id: user.id, subscription: subscription.toJSON(), schedule: { time: reminderSettings.workout?.time || '18:00', days: reminderSettings.workout?.days || [1, 3, 5], quiet_hours: reminderSettings.quietHours, snoozed_until: reminderSettings.snoozedUntil || null }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', enabled: true, last_sent: null }) }, c);
    persist(); await syncReminderSchedule(); renderReminder(); updateSyncStatus('Push conectado. El servidor enviará avisos en la hora y los días configurados.'); toast('Avisos push activados en este dispositivo.');
  } catch (error) { updateSyncStatus(error.message); toast(error.message); }
}
async function syncReminderSchedule() {
  if (!db.push?.enabled || !db.push?.endpoint || !syncCloudSession?.access_token || !db.syncConfig?.url) return;
  try {
    const c = db.syncConfig; await ensureCloudSession();
     const reminderSettings = reminderPack();
     await supabaseRequest(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(db.push.endpoint)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ schedule: { time: reminderSettings.workout?.time || '18:00', days: reminderSettings.workout?.days || [1, 3, 5], quiet_hours: reminderSettings.quietHours, snoozed_until: reminderSettings.snoozedUntil || null }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', enabled: true }) }, c);
  } catch (error) { console.warn('No se pudo actualizar el horario push:', error.message); }
}

async function exportData() {
  await flushWorkoutPersist(); await persistQueue;
  const validProfileIds = new Set(db.profiles.map((person) => person.id)), candidates = [];
  let estimatedSize = 0, skipped = 0, photosUnavailable = false;
  try {
    const records = (await readPhotoRecords()).filter((photo) => validProfileIds.has(photo.profileId)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    skipped += Math.max(0, records.length - 500);
    for (const photo of records.slice(0, 500)) {
      const projectedSize = Math.ceil((photo.blob?.size || 0) * 4 / 3);
      if (!photo.blob || projectedSize > 16 * 1024 * 1024 || estimatedSize + projectedSize > 32 * 1024 * 1024) { skipped++; continue; }
      estimatedSize += projectedSize;
      candidates.push(photo);
    }
  } catch (error) { console.error('No pude leer las fotos para el respaldo:', error); photosUnavailable = true; }
  const photos = [];
  for (const photo of candidates) {
    try { photos.push({ id: photo.id, profileId: photo.profileId, date: photo.date, dataUrl: await blobAsDataUrl(photo.blob) }); }
    catch (error) { console.error('No pude incluir una foto en el respaldo:', error); skipped++; }
  }
  const payload = ForjaCore.createBackup(db, photos, new Date());
  skipped += photos.length - payload.photos.length;
  const serialized = JSON.stringify(payload);
  if (serialized.length > 50 * 1024 * 1024 && !confirm('Esta copia supera 50 MB y puede tardar en abrirse en un celular. ¿Descargarla de todos modos?')) return;
  const blob = new Blob([serialized], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `forja-respaldo-${localDay()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(photosUnavailable ? 'Respaldo descargado sin fotos locales; no pude leer el almacenamiento de imágenes.' : skipped ? `Respaldo descargado con ${payload.photos.length} fotos; omití ${skipped} fotos para mantenerlo válido y ligero.` : `Respaldo completo descargado${payload.photos.length ? ` con ${payload.photos.length} fotos` : ''}. Guárdalo en un lugar seguro.`);
}
async function readPhotoRecords() {
  const media = await openMediaDb();
  return new Promise((resolve, reject) => { const request = media.transaction('photos', 'readonly').objectStore('photos').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function prepareBackupPhotos(photos = []) {
  return photos.map((photo) => {
    const match = photo.dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) throw new Error('Fotos');
    const binary = atob(match[2]), bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return { id: photo.id, profileId: photo.profileId, date: photo.date, blob: new Blob([bytes], { type: photo.mime }) };
  });
}
async function replacePhotoRecords(records) {
  const media = await openMediaDb();
  await new Promise((resolve, reject) => {
    const transaction = media.transaction('photos', 'readwrite'), store = transaction.objectStore('photos');
    store.clear(); records.forEach((record) => store.put(record));
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('No pude restaurar las fotos.'));
  });
}
async function importData(event) {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 50 * 1024 * 1024 && !confirm('Esta copia supera 50 MB y puede usar bastante memoria en el celular. ¿Continuar?')) return;
    const payload = ForjaCore.normalizeBackup(JSON.parse(await file.text()));
    if (!confirm('¿Reemplazar perfiles, entrenamientos y fotos de este dispositivo con esta copia?')) return;
    const importedDb = payload.data, importedPhotos = Array.isArray(payload.photos) ? prepareBackupPhotos(payload.photos) : null;
    const previousDb = db, previousProfile = profile, previousPhotos = importedPhotos ? await readPhotoRecords() : null;
    if (importedPhotos) await replacePhotoRecords(importedPhotos);
    const config = db.syncConfig, accessibility = importedDb.accessibility || db.accessibility;
    db = importedDb; db.syncConfig = config || {}; db.accessibility = accessibility || {}; db.updatedAt = new Date().toISOString();
    profile = db.profiles.find((person) => person.id === db.currentProfile) || db.profiles[0];
    if (!await persist()) {
      db = previousDb; profile = previousProfile;
      if (previousPhotos) await replacePhotoRecords(previousPhotos);
      throw new Error('Almacenamiento');
    }
    await persistQueue; populateProfileSelect(); renderAll();
    toast(`Copia importada${importedPhotos?.length ? ` con ${importedPhotos.length} fotos` : ''}.`);
  } catch (error) { toast(error.message === 'Formato' ? 'Ese archivo no parece una copia válida de Forja.' : error.message === 'Fotos' ? 'La copia contiene fotos dañadas o demasiado grandes para restaurar en este dispositivo.' : 'No pude completar la importación. Los datos anteriores se conservaron.'); }
  finally { event.target.value = ''; }
}

function startWarmup() {
  startTimer(300, 'Calentamiento guiado');
  tickTimer();
}
function startCooldown() { startTimer(240, 'Enfriamiento guiado'); }
function saveRestTimerSnapshot() {
  try {
    if (!timerState) { localStorage.removeItem(REST_TIMER_STORAGE_KEY); return; }
    localStorage.setItem(REST_TIMER_STORAGE_KEY, JSON.stringify(timerState));
  } catch { /* El cronómetro sigue funcionando si el almacenamiento está lleno. */ }
}
function restoreTimerState() {
  let snapshot;
  try { snapshot = JSON.parse(localStorage.getItem(REST_TIMER_STORAGE_KEY) || 'null'); } catch {}
  const restored = ForjaCore.normalizeTimerSnapshot(snapshot, Date.now());
  if (!restored) { try { localStorage.removeItem(REST_TIMER_STORAGE_KEY); } catch {} return; }
  timerState = restored;
  const eyebrow = $('#timer-overlay .eyebrow');
  if (eyebrow) eyebrow.textContent = restored.label === 'Calentamiento guiado' ? 'CALENTAMIENTO' : restored.label === 'Enfriamiento guiado' ? 'ENFRIAMIENTO' : 'DESCANSO ENTRE SERIES';
  $('#timer-exercise').textContent = restored.label;
  $('#timer-overlay').hidden = false;
  if (restored.remaining === 0 && !restored.alerted) {
    restored.alerted = true;
    saveRestTimerSnapshot();
    if (Date.now() - Number(snapshot.deadline) <= 120000) timerAlert();
  }
  tickTimer();
}
function startTimer(seconds, label) {
  primeTimerAudio();
  if (voiceEnabled) voiceSpeak(`Descansa ${seconds} segundos después de ${label}.`);
  timerState = { duration: seconds * 1000, deadline: Date.now() + seconds * 1000, remaining: seconds * 1000, paused: false, label, alerted: false };
  const eyebrow = $('#timer-overlay .eyebrow'); if (eyebrow) eyebrow.textContent = label === 'Calentamiento guiado' ? 'CALENTAMIENTO' : label === 'Enfriamiento guiado' ? 'ENFRIAMIENTO' : 'DESCANSO ENTRE SERIES';
  $('#timer-exercise').textContent = label; $('#timer-overlay').hidden = false; $('#timer-pause').textContent = 'Pausar'; saveRestTimerSnapshot(); tickTimer();
}
function tickTimer() {
  if (!timerState) return;
  if (!timerState.paused) {
    timerState.remaining = Math.max(0, timerState.deadline - Date.now());
    if (timerState.remaining === 0) { timerAlert(); timerState.paused = true; timerState.alerted = true; saveRestTimerSnapshot(); }
  }
  const ms = timerState.remaining;
  $('#timer-display').textContent = clock(ms);
  if (ms === 0 && db.accessibility?.vibration !== false && navigator.vibrate && Date.now() - (timerState.lastPulse || 0) > 2800) {
    timerState.lastPulse = Date.now();
    navigator.vibrate([220, 90, 220, 90, 360]);
  }
  const progress = Math.max(0, Math.min(100, ms / Math.max(timerState.duration, 1) * 100));
  $('#timer-ring').style.setProperty('--progress', `${progress}%`);
  let caption = ms === 0 ? 'Tiempo terminado. Sigue cuando te sientas listo.' : timerState.paused ? 'Temporizador en pausa.' : 'Tómate tu tiempo. El siguiente set espera.';
  if (timerState.label === 'Calentamiento guiado' && ms > 0) caption = ms > 240000 ? 'Minuto 1 · Eleva poco a poco la temperatura con una caminata o bicicleta suave.' : ms > 120000 ? 'Minutos 2–3 · Movilidad dinámica y cómoda de hombros, cadera y tobillos.' : 'Minutos 4–5 · Practica el primer movimiento con poco peso y aumenta gradualmente.';
  if (timerState.label === 'Enfriamiento guiado' && ms > 0) caption = ms > 180000 ? 'Minuto 1 · Baja el ritmo caminando despacio y deja que la respiración se calme.' : ms > 60000 ? 'Minutos 2–3 · Respira tranquilo y haz movilidad suave, sin forzar estiramientos.' : 'Último minuto · Relaja hombros y mandíbula; termina con respiraciones lentas.';
  $('#timer-caption').textContent = caption;
  $('#timer-pause').textContent = ms === 0 ? 'Listo' : timerState.paused ? 'Continuar' : 'Pausar';
}

function challengeSessionCount(challenge, personId) {
  const person = db.profiles.find((entry) => entry.id === personId);
  return ForjaCore.countChallengeSessions(person?.data.workouts || [], challenge.startedAt || challenge.createdAt, challenge.due, new Date());
}
function renderChallenges() {
  const root = $('#challenge-list'); if (!root) return;
  const challenges = profile.data.challenges || [];
  root.innerHTML = challenges.length ? challenges.map((challenge) => {
    const ids = challenge.participants || db.profiles.map((person) => person.id), localRows = ids.map((id) => { const person = db.profiles.find((entry) => entry.id === id); return person ? { name: person.name, count: challengeSessionCount(challenge, id), local: true } : null; }).filter(Boolean);
    const invited = challenge.sharedResults || [], rows = [...localRows, ...invited.map((entry) => ({ name: entry.name, count: Number(entry.count) || 0, local: false }))];
    return `<article class="challenge-card"><div class="challenge-card-top"><div><h3>${escapeHtml(challenge.title)}</h3><small>${challenge.due ? `Hasta ${escapeHtml(fmtDate(`${challenge.due}T12:00:00`, { day: 'numeric', month: 'short' }))}` : 'Sin fecha de cierre'} · ${rows.length} participante${rows.length === 1 ? '' : 's'}</small></div><button class="challenge-delete" data-delete-challenge="${escapeHtml(challenge.id)}" aria-label="Eliminar reto">×</button></div>${rows.map((row) => `<p><b>${escapeHtml(row.name)}</b>${row.local ? '' : ' · avance compartido'} · ${row.count}/${challenge.target} sesiones<div class="challenge-progress"><i style="width:${Math.min(100, row.count / challenge.target * 100)}%"></i></div></p>`).join('')}<div class="challenge-share-actions"><button class="text-button" data-share-challenge="${escapeHtml(challenge.id)}" data-share-kind="invite">Compartir invitación ↗</button><button class="text-button" data-share-challenge="${escapeHtml(challenge.id)}" data-share-kind="progress">Compartir mi avance ↗</button></div></article>`;
  }).join('') : '<div class="empty-inline">Crea un reto o importa una invitación. Para mantenerlo privado, los avances se comparten con un archivo cuando tú lo decidas.</div>';
}
function saveChallenge() {
  const title = $('#challenge-title').value.trim(), target = Number($('#challenge-target').value), due = $('#challenge-due').value;
  if (!title || !Number.isInteger(target) || target < 1 || target > 365) { toast('Escribe un nombre y una meta de sesiones válida.'); return; }
  const challenge = { id: `challenge-${crypto.randomUUID?.() || Date.now()}`, title: title.slice(0, 60), target, due, createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), participants: db.profiles.map((person) => person.id), sharedResults: [] };
  db.profiles.forEach((person) => { person.data.challenges ||= []; person.data.challenges.push(structuredClone(challenge)); });
  $('#challenge-title').value = ''; $('#challenge-form').hidden = true; persist(); renderChallenges(); toast('Reto creado. Comparte la invitación con quien quieras.');
}
async function shareChallengeFile(id, kind) {
  const challenge = (profile.data.challenges || []).find((entry) => entry.id === id); if (!challenge) return;
  let payload, filename;
  if (kind === 'progress') {
    payload = { app: 'Forja', type: 'challenge-progress', version: 1, challengeId: challenge.id, participant: { id: profile.id, name: profile.name, count: challengeSessionCount(challenge, profile.id), updatedAt: new Date().toISOString() } };
    filename = `forja-avance-${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  } else {
    payload = { app: 'Forja', type: 'challenge-invite', version: 1, challenge: { id: challenge.id, title: challenge.title, target: challenge.target, due: challenge.due || '', createdAt: challenge.createdAt, startedAt: challenge.startedAt } };
    filename = `forja-invitacion-${challenge.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), file = new File([blob], filename, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] }) && navigator.share) await navigator.share({ title: kind === 'progress' ? 'Mi avance en Forja' : `Invitación: ${challenge.title}`, files: [file] });
    else { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); toast(kind === 'progress' ? 'Archivo de avance descargado para compartir.' : 'Invitación descargada para compartir.'); }
  } catch (error) { if (error.name !== 'AbortError') toast('No pude compartir el archivo.'); }
}
async function importSharedChallenge(event) {
  const file = event.target.files?.[0]; if (!file) return; event.target.value = '';if (file.size > 131072) { toast('Ese archivo es demasiado grande para ser un reto.'); return; }
  try {
    const payload = JSON.parse(await file.text()); if (payload.app !== 'Forja' || !['challenge-invite', 'challenge-progress'].includes(payload.type)) throw new Error('Archivo inválido');
    if (payload.type === 'challenge-invite') {
      const incoming = payload.challenge;
      if (!incoming?.id || !String(incoming.title || '').trim() || !Number.isInteger(Number(incoming.target)) || Number(incoming.target) < 1 || Number(incoming.target) > 365) throw new Error('Invitación inválida');
      profile.data.challenges ||= [];
      const prior = profile.data.challenges.find((challenge) => challenge.id === incoming.id);
      if (!prior) profile.data.challenges.push({ ...incoming, target: Number(incoming.target), updatedAt: new Date().toISOString(), participants: [profile.id], sharedResults: [], importedAt: new Date().toISOString() });
      else toast('Ya tenías esta invitación.');
    } else {
      const participant = payload.participant, challenge = (profile.data.challenges || []).find((entry) => entry.id === payload.challengeId);
      if (!challenge || !participant?.id || !String(participant.name || '').trim() || !Number.isInteger(Number(participant.count)) || Number(participant.count) < 0 || Number(participant.count) > 3650) throw new Error('Progreso inválido o invitación no importada');
      challenge.sharedResults ||= []; challenge.sharedResults = challenge.sharedResults.filter((entry) => entry.id !== participant.id); challenge.sharedResults.push({ id: String(participant.id).slice(0, 80), name: String(participant.name).slice(0, 40), count: Number(participant.count), updatedAt: new Date().toISOString() }); challenge.updatedAt = new Date().toISOString();
    }
    persist(); renderChallenges(); toast(payload.type === 'challenge-invite' ? 'Invitación de reto importada.' : 'Avance del participante agregado.');
  } catch (error) { toast(error.message === 'Archivo inválido' ? 'Ese archivo no parece un reto de Forja.' : error.message === 'Progreso inválido o invitación no importada' ? 'Importa primero la invitación correspondiente y vuelve a probar.' : 'La invitación o el avance no son válidos.'); }
}

async function renderProgressPhotos() {
  const gallery = $('#progress-photos'), compare = $('#photo-compare'); if (!gallery || !compare) return;
  photoUrls.forEach((url) => URL.revokeObjectURL(url)); photoUrls = [];
  try {
    const media = await openMediaDb(), records = await new Promise((resolve, reject) => { const request = media.transaction('photos', 'readonly').objectStore('photos').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const mine = records.filter((record) => record.profileId === profile.id).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const recent = mine.slice(-8).reverse(), urls = new Map();
    const makeUrl = (record) => { if (!urls.has(record.id)) { const url = URL.createObjectURL(record.blob); urls.set(record.id, url); photoUrls.push(url); } return urls.get(record.id); };
    gallery.innerHTML = recent.length ? recent.map((record) => `<figure class="progress-photo"><img src="${makeUrl(record)}" alt="Foto privada de progreso del ${escapeHtml(record.date)}" loading="lazy"><figcaption>${escapeHtml(fmtDate(`${record.date}T12:00:00`, { day: 'numeric', month: 'short', year: 'numeric' }))}<button type="button" data-delete-photo="${escapeHtml(record.id)}" aria-label="Eliminar foto">×</button></figcaption></figure>`).join('') : '<div class="empty-inline">Tus fotos privadas aparecerán aquí, solo en este dispositivo.</div>';
    compare.hidden = mine.length < 2;
    if (mine.length < 2) { compare.innerHTML = ''; return; }
    const options = mine.map((record) => `<option value="${escapeHtml(record.id)}">${escapeHtml(fmtDate(`${record.date}T12:00:00`, { day: 'numeric', month: 'short', year: 'numeric' }))}</option>`).join('');
    const priorA = $('#photo-compare-a')?.value, priorB = $('#photo-compare-b')?.value, aId = mine.some((record) => record.id === priorA) ? priorA : mine[0].id, bId = mine.some((record) => record.id === priorB) && priorB !== aId ? priorB : mine.at(-1).id, before = mine.find((record) => record.id === aId), after = mine.find((record) => record.id === bId);
    compare.innerHTML = `<div class="photo-compare-head"><div><p class="eyebrow">COMPARA TU PROGRESO</p><h3>Antes y ahora</h3></div><span>Solo tú ves estas fotos</span></div><div class="photo-compare-controls"><label>Antes<select id="photo-compare-a">${options}</select></label><label>Ahora<select id="photo-compare-b">${options}</select></label></div><div class="photo-compare-stage"><img class="photo-before" src="${makeUrl(before)}" alt="Foto inicial de comparación"><img class="photo-after" id="photo-after-clip" src="${makeUrl(after)}" alt="Foto actual de comparación" style="clip-path:inset(0 50% 0 0)"><span class="photo-compare-divider" id="photo-compare-divider" style="left:50%"></span><span class="photo-compare-label before">Antes</span><span class="photo-compare-label after">Ahora</span></div><label class="photo-compare-slider">Desliza para comparar<input id="photo-compare-slider" type="range" min="5" max="95" value="50" aria-label="Deslizador para comparar las fotos"></label><small>Alinea la postura y la distancia al tomar las fotos. No se sincronizan ni se comparten automáticamente.</small>`;
  } catch { gallery.innerHTML = '<div class="empty-inline">Este navegador no permite guardar fotos locales.</div>'; compare.hidden = true; }
}
