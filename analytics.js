// Gráficas, marcas e inteligencia de entrenamiento.

function exercisePoints(id,metric){return ForjaCore.exerciseProgressSeries(validWorkoutHistory(),id,metric,getPreferences().weightUnit,new Date());}
function renderProgressChart() {
  const id = $('#progress-exercise').value, metric = $('#progress-metric').value, points = exercisePoints(id, metric), root = $('#progress-chart');
  if (!points.length) { root.innerHTML = '<div class="chart-empty">Registra series con peso para ver tu evolución por ejercicio.</div>'; renderMuscleVolumeChart(); return; }
  const width = 680, height = 230, left = 48, right = 18, top = 18, bottom = 42, max = Math.max(...points.map((point) => point.value), 1), ceil = max * 1.15, plotW = width - left - right, plotH = height - top - bottom, x = (index) => points.length === 1 ? left + plotW / 2 : left + index * plotW / (points.length - 1), y = (value) => top + plotH - value / ceil * plotH, fmt = (value) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1, notation: value > 9999 ? 'compact' : 'standard' }).format(value), path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.value)}`).join(' '), label = metric === 'load' ? 'carga máxima' : metric === 'volume' ? 'volumen por sesión' : 'fuerza estimada (1RM)';
  const stall = ForjaCore.detectStagnation(points);
  root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfica de ${label} para ${escapeHtml(byId(id)?.name || 'ejercicio')}">${[0, .5, 1].map((fraction) => `<g><line class="chart-gridline" x1="${left}" x2="${width - right}" y1="${top + plotH * fraction}" y2="${top + plotH * fraction}"/><text class="chart-axis" x="${left - 9}" y="${top + plotH * fraction + 4}" text-anchor="end">${fmt(ceil * (1 - fraction))}</text></g>`).join('')}<path class="chart-line" d="${path}"/>${points.map((point, index) => `<circle class="chart-point" cx="${x(index)}" cy="${y(point.value)}" r="4"><title>${escapeHtml(fmtDate(point.date, { day: 'numeric', month: 'short' }))}: ${fmt(point.value)} ${metric === 'volume' ? `${getPreferences().weightUnit}·reps` : getPreferences().weightUnit}</title></circle>`).join('')}${points.map((point, index) => index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2) ? `<text class="chart-axis" x="${x(index)}" y="${height - 12}" text-anchor="middle">${escapeHtml(fmtDate(point.date, { day: 'numeric', month: 'short' }))}</text>` : '').join('')}</svg><div class="chart-caption">${metric === 'load' ? 'Mayor peso registrado en cada sesión' : metric === 'volume' ? 'Carga × repeticiones por sesión' : 'Estimación Epley a partir de una serie registrada'} · ${metric === 'volume' ? `${getPreferences().weightUnit} × repeticiones` : getPreferences().weightUnit}${stall.stalled ? ' · Estancamiento detectado en las últimas sesiones' : ''}</div>`;
  renderPersonalRecords(); updateHealthStatus(); renderMuscleVolumeChart();
}
function renderPersonalRecords() {
  const root = $('#personal-records'); if (!root) return;
  const workouts = validWorkoutHistory();
  const rows = EXERCISES.map((exercise) => {
    const sets = workouts.flatMap((workout) => workout.exercises.filter((entry) => entry.exerciseId === exercise.id).flatMap((entry) => entry.sets.filter((set) => set.done && Number(set.weight) > 0).map((set) => ({ ...set, date: workout.finishedAt }))));
    if (!sets.length) return null;
    const bestLoad = sets.reduce((best, set) => convertWeight(set.weight, set.weightUnit || 'kg') > convertWeight(best.weight, best.weightUnit || 'kg') ? set : best), best1RM = sets.reduce((best, set) => convertWeight(set.weight, set.weightUnit || 'kg') * (1 + Math.min(Number(set.reps) || 0, 15) / 30) > convertWeight(best.weight, best.weightUnit || 'kg') * (1 + Math.min(Number(best.reps) || 0, 15) / 30) ? set : best), sessions = workouts.filter((workout) => workout.exercises.some((entry) => entry.exerciseId === exercise.id)).map((workout) => ({ workout, entry: workout.exercises.find((entry) => entry.exerciseId === exercise.id) })), bestVolume = sessions.reduce((best, item) => { const total = item.entry.sets.filter((set) => set.done).reduce((sum, set) => sum + convertWeight(set.weight || 0, set.weightUnit || 'kg') * (Number(set.reps) || 0), 0); return total > best.value ? { value: total, date: item.workout.finishedAt } : best; }, { value: 0, date: bestLoad.date });
    return { exercise, bestLoad, best1RM, bestVolume };
  }).filter(Boolean).sort((a, b) => convertWeight(b.best1RM.weight, b.best1RM.weightUnit || 'kg') * (1 + Math.min(Number(b.best1RM.reps) || 0, 15) / 30) - convertWeight(a.best1RM.weight, a.best1RM.weightUnit || 'kg') * (1 + Math.min(Number(a.best1RM.reps) || 0, 15) / 30));
  root.innerHTML = rows.length ? `<div class="records-heading">Récords personales · la fuerza estimada no equivale a una prueba máxima</div><div class="records-grid">${rows.slice(0, 8).map((row) => { const oneRM = convertWeight(row.best1RM.weight, row.best1RM.weightUnit || 'kg') * (1 + Math.min(Number(row.best1RM.reps) || 0, 15) / 30); return `<article class="record-card"><small>${escapeHtml(MUSCLES[row.exercise.muscle])}</small><b>${escapeHtml(row.exercise.name)}</b><strong>${formatWeight(convertWeight(row.bestLoad.weight, row.bestLoad.weightUnit || 'kg'))} <span>× ${escapeHtml(row.bestLoad.reps || '')} reps</span></strong><span class="record-detail">1RM estimado: ${formatWeight(oneRM)} · Mejor volumen/sesión: ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(row.bestVolume.value)} ${getPreferences().weightUnit}·reps</span><time>${escapeHtml(fmtDate(row.bestLoad.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</time></article>`; }).join('')}</div>` : '<div class="empty-inline">Tus marcas aparecerán cuando registres series con peso.</div>';
}
function latestHealthWorkout() { return validWorkoutHistory().slice().sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt))[0] || null; }
function healthWorkoutPayload(workout) {
  return { format: 'forja-health-workout-v1', title: workout.name, activityType: 'strength_training', startDate: workout.startedAt, endDate: workout.finishedAt, durationSeconds: Math.max(0, Math.round((new Date(workout.finishedAt) - new Date(workout.startedAt)) / 1000)), exercises: workout.exercises.map((entry) => { const exercise = byId(entry.exerciseId); return { name: exercise?.name || entry.exerciseId, primaryMuscle: exercise ? MUSCLES[exercise.muscle] : '', equipment: exercise?.equip || '', sets: entry.sets.filter((set) => set.done).map((set) => ({ weight: Number(set.weight) || null, weightUnit: set.weightUnit || getPreferences().weightUnit, repetitions: Number(set.reps) || null, effortRpe: Number(set.rpe) || null })) }; }), source: 'Forja' };
}
function updateHealthStatus() {
  const status = $('#health-status'); if (!status) return;
  status.textContent = window.FORJA_HEALTH_BRIDGE ? 'Puente nativo detectado. Forja puede enviar sesiones cuando el sistema lo autorice.' : 'Forja web: exporta o comparte sesiones. La escritura directa requiere instalar un contenedor nativo con permisos de Salud.';
}
function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
async function exportHealthSession() {
  const workout = latestHealthWorkout(); if (!workout) { toast('Termina una sesión para exportarla.'); return; }
  downloadJson(healthWorkoutPayload(workout), `forja-salud-${localDay(workout.finishedAt)}.json`); toast('Sesión portable descargada.');
}
async function shareHealthSession() {
  const workout = latestHealthWorkout(); if (!workout) { toast('Termina una sesión para compartirla.'); return; }
  const payload = healthWorkoutPayload(workout), file = new File([JSON.stringify(payload, null, 2)], `forja-salud-${localDay(workout.finishedAt)}.json`, { type: 'application/json' });
  try { if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ title: 'Sesión de Forja', files: [file] }); else { downloadJson(payload, file.name); toast('No está disponible el menú nativo; descargué el archivo.'); } }
  catch (error) { if (error.name !== 'AbortError') toast('No pude abrir el menú para compartir.'); }
}

async function renderAutomaticBackups() {
  renderDeviceStorageStatus();
  const select = $('#auto-backup-select'), button = $('#restore-auto-backup'), status = $('#auto-backup-status');
  if (!select || !button || !status) return;
  try {
    const media = await openAppDb();
    const entries = await new Promise((resolve, reject) => {
      const request = media.transaction('autoBackups', 'readonly').objectStore('autoBackups').getAll();
      request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error);
    });
    const backups = entries.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.snapshot?.app === 'Forja').sort((a,b) => b.date.localeCompare(a.date));
    select.innerHTML = backups.length ? backups.map((entry) => `<option value="${escapeHtml(entry.date)}">${escapeHtml(fmtDate(`${entry.date}T12:00:00`,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}</option>`).join('') : '<option value="">Aún no hay copias automáticas</option>';
    button.disabled = !backups.length;
    status.textContent = backups.length ? `${backups.length} ${backups.length === 1 ? 'copia guardada' : 'copias guardadas'} · la más reciente es del ${backups[0].date}.` : 'La primera copia se crea al guardar datos cada día.';
  } catch (error) {
    select.innerHTML = '<option value="">Copias no disponibles</option>'; button.disabled = true;
    status.textContent = 'Este navegador no permite leer las copias automáticas; usa “Respaldo completo” para exportar una copia manual.';
    console.warn('No se pudieron leer las copias automáticas:', error);
  }
}

function formatStorageSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024, unit = units[0], index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; unit = units[++index]; }
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(size)} ${unit}`;
}

async function renderDeviceStorageStatus() {
  const node = $('#device-storage-status');
  if (!node) return;
  if (!navigator.storage?.estimate) { node.textContent = 'Este navegador no ofrece una estimación del espacio local.'; return; }
  try {
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false)
    ]);
    const used = formatStorageSize(estimate.usage), quota = formatStorageSize(estimate.quota);
    const amount = used ? `${used}${quota ? ` de ${quota}` : ''} usados en el dispositivo` : 'No se pudo estimar el uso local';
    node.textContent = `${amount} · ${persisted ? 'almacenamiento persistente' : 'el navegador puede liberar espacio poco usado'}. App, copias y medios comparten cuota.`;
  } catch {
    node.textContent = 'No se pudo consultar el espacio local. Exporta un respaldo si necesitas recuperar tus datos.';
  }
}

async function restoreAutomaticBackup() {
  const date = $('#auto-backup-select')?.value;
  if (!date || !confirm(`¿Restaurar los datos del ${date}? Se reemplazarán los registros actuales. Las fotos y la configuración de sincronización se conservarán.`)) return;
  const previousDb = db, previousProfile = profile;
  try {
    const media = await openAppDb();
    const entry = await new Promise((resolve, reject) => {
      const request = media.transaction('autoBackups', 'readonly').objectStore('autoBackups').get(date);
      request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
    });
    if (!entry?.snapshot) throw new Error('La copia seleccionada no existe.');
    const restored = ForjaCore.normalizeBackup(entry.snapshot).data;
    for (const key of ['syncConfig','syncSession','push','accessibility','localDeviceId']) if (previousDb[key] !== undefined) restored[key] = previousDb[key];
    db = restored; profile = db.profiles.find((item) => item.id === db.currentProfile) || db.profiles[0]; db.currentProfile = profile.id;
    if (!await persist()) throw new Error('No se pudo guardar la restauración.');
    populateProfileSelect(); renderAll(); await renderAutomaticBackups();
    toast('Copia restaurada. Tus fotos locales y la conexión se conservaron.');
  } catch (error) {
    db = previousDb; profile = previousProfile;
    try { await persist(); } catch {}
    console.error('No se pudo restaurar la copia automática:', error);
    toast('No pude restaurar esta copia. Se conservaron los datos actuales.');
  }
}

function renderTrainingIntelligence() {
  const root = $('#training-intelligence'); if (!root || !profile) return;
  const intel = ForjaCore.trainingIntelligence({ workouts: profile.data.workouts, preferences: getPreferences(), readiness: profile.data.readiness, block: trainingBlockState(), now: new Date() });
  const pct = Math.round(intel.frequencyScore * 100);
  const stalledExercise = intel.stagnation.stalled ? byId(intel.stagnation.exerciseId)?.name : '';
  const hasStagnationHistory = intel.stagnation.sample >= 6;
  const action = intel.suggestions[0]?.text || 'Sigue registrando tus sesiones para crear una referencia útil.';
  const wellness = intel.wellness.samples >= 3 ? `${intel.wellness.summary} (${intel.wellness.samples} registros comparables)` : `Aún faltan registros comparables de sueño y energía (${intel.wellness.samples}/3 mínimo) para mostrar una relación fiable.`;
  root.innerHTML = `<div class="intel-kpis"><article><small>FRECUENCIA</small><b>${intel.thisWeekSessions}/${intel.daysPerWeek}</b><span>${pct}% de tu referencia semanal</span></article><article><small>VOLUMEN</small><b>${intel.volumeTrend === 0 && !intel.lastVolume ? '—' : `${intel.volumeTrend > 0 ? '+' : ''}${Math.round(intel.volumeTrend * 100)}%`}</b><span>vs. el mismo tramo de la semana anterior</span></article><article><small>CONSTANCIA</small><b>${intel.consistencyDays}</b><span>días con sesión en 4 semanas</span></article><article class="${intel.stagnation.stalled ? 'warn' : ''}"><small>ESTANCAMIENTO</small><b>${intel.stagnation.stalled ? 'Posible' : hasStagnationHistory ? 'No' : 'Pendiente'}</b><span>${stalledExercise ? `Revisa ${escapeHtml(stalledExercise)}` : intel.stagnation.stalled ? 'La fuerza estimada no sube' : hasStagnationHistory ? 'La tendencia sigue activa' : 'Registra más sesiones por ejercicio'}</span></article></div><ul class="intel-suggestions">${intel.suggestions.map((item) => `<li data-kind="${escapeHtml(item.kind)}">${escapeHtml(item.text)}</li>`).join('')}</ul><div class="weekly-report" data-kind="${intel.wellness.samples >= 3 ? 'recovery' : 'summary'}"><b>Tu siguiente paso esta semana</b>${escapeHtml(action)}<b>Bienestar y rendimiento</b>${escapeHtml(wellness)}<br><small>Correlación orientativa; no determina la causa del rendimiento.</small></div>`;
}

function renderMuscleVolumeChart() {
  const root = $('#muscle-volume-chart'); if (!root) return;
  const series = ForjaCore.muscleVolumeSeries(profile.data.workouts, (id) => byId(id)?.muscle, 8, getPreferences().weightUnit);
  if (!series.length) { root.innerHTML = '<div class="chart-empty">El volumen por músculo aparecerá cuando registres series con peso.</div>'; return; }
  const latest = series.at(-1).groups, entries = Object.entries(latest).sort((a, b) => b[1] - a[1]).slice(0, 6), max = Math.max(...entries.map((entry) => entry[1]), 1);
  root.innerHTML = `<div class="muscle-volume-bars">${entries.map(([muscle, value]) => `<div class="muscle-volume-row"><span>${escapeHtml(MUSCLES[muscle] || muscle)}</span><div class="weekly-muscle-track"><i style="width:${Math.round(value / max * 100)}%"></i></div><b>${new Intl.NumberFormat('es-CO', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 0 }).format(value)}</b></div>`).join('')}</div><div class="chart-caption">Volumen (carga × repeticiones) de la semana más reciente con registros · ${getPreferences().weightUnit}</div>`;
}

const originalRenderDashboard = renderDashboard;
renderDashboard = function renderDashboardWithIntelligence() {
  originalRenderDashboard();
  renderTrainingIntelligence();
};

const originalRenderProgress = renderProgress;
renderProgress = function renderProgressWithIntelligence() {
  originalRenderProgress();
  renderMuscleVolumeChart();
  renderAutomaticBackups();
};
