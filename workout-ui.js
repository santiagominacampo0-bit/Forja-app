// Pantalla y acciones de entrenamiento; la lógica pura vive en forja-core.js.

function previousExercisePerformance(id) {
  return validWorkoutHistory().slice().sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt))
    .map((workout) => ({ workout, exercise: workout.exercises.find((entry) => entry.exerciseId === id) }))
    .find((entry) => entry.exercise?.sets?.some((set) => set.done));
}

function progressionAdvice(item) {
  if (item.unit === 'seconds') return null;
  const targets = String(item.reps).match(/\d+/g) || [], low = Number(targets[0]) || 8, high = Number(targets.at(-1)) || 12;
  const sessions = validWorkoutHistory().slice().sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt)).map((workout) => ({ workout, exercise: workout.exercises.find((entry) => entry.exerciseId === item.exerciseId) })).filter((entry) => entry.exercise?.sets?.some((set) => set.done)).slice(0, 4);
  const latest = sessions[0]; if (!latest) return null;
  const sets = latest.exercise.sets.filter((set) => set.done), weighted = sets.filter((set) => Number(set.weight) > 0), top = weighted.length ? weighted.reduce((best, set) => convertWeight(set.weight, set.weightUnit || 'kg') > convertWeight(best.weight, best.weightUnit || 'kg') ? set : best) : sets.at(-1);
  const reps = Math.round(sets.reduce((sum, set) => sum + (Number(set.reps) || 0), 0) / Math.max(sets.length, 1)), rpe = Math.round(sets.reduce((sum, set) => sum + (Number(set.rpe) || 8), 0) / Math.max(sets.length, 1) * 10) / 10;
  const prediction = ForjaCore.predictLoad(sessions.map((entry) => {
    const done = entry.exercise.sets.filter((set) => set.done && Number(set.weight) > 0);
    const load = done.reduce((best, set) => Math.max(best, convertWeight(set.weight, set.weightUnit || 'kg')), 0);
    const avgRpe = done.reduce((sum, set) => sum + (Number(set.rpe) || 8), 0) / Math.max(done.length, 1);
    const volume = done.reduce((sum, set) => sum + convertWeight(set.weight, set.weightUnit || 'kg') * (Number(set.reps) || 0), 0);
    return { weight: load, reps: Number(done.at(-1)?.reps) || reps, rpe: avgRpe, volume };
  }).reverse(), getPreferences().weightUnit);
  const unit = getPreferences().weightUnit;
  const progression = ForjaCore.recommendProgression({ sessions: sessions.slice().reverse().map((entry) => ({ finishedAt: entry.workout.finishedAt, sets: entry.exercise.sets.filter((set) => set.done).map((set) => ({ done: true, weight: convertWeight(set.weight, set.weightUnit || 'kg', unit), reps: Number(set.reps), rpe: Number(set.rpe) || 8 })) })), repRange: item.reps, unit, targetSets: item.targetSets });
  const canIncrease = progression.action === 'increase' && weighted.length > 0;
  const currentWeight = top?.weight ? convertWeight(top.weight, top.weightUnit || 'kg') : 0;
  const suggested = canIncrease ? progression.suggested : currentWeight;
  const targetReps = progression.targetReps;
  prediction.reason = progression.reason; prediction.canIncrease = canIncrease; prediction.suggested = suggested;
  const stagnation = ForjaCore.detectStagnation(sessions.map((entry) => {
    const done = entry.exercise.sets.filter((set) => set.done && Number(set.weight) > 0);
    return { value: Math.max(0, ...done.map((set) => ForjaCore.estimated1RM(convertWeight(set.weight, set.weightUnit || 'kg'), set.reps))) };
  }).reverse(), 3, 0.02);
  return { workout: latest.workout, weight: currentWeight, suggested, reps, rpe, targetReps, canIncrease, high, sessions: sessions.length, top, sets: sets.length, prediction, progression, stagnation };
}
function applyProgression(index) {
  const item = profile.data.activeWorkout?.exercises[index], advice = item && progressionAdvice(item); if (!item || !advice) return;
  item.sets.filter((set) => !set.done).forEach((set) => { if (advice.canIncrease) set.weight = String(advice.suggested); else if (advice.weight > 0 && !set.weight) set.weight = String(advice.weight); set.reps = String(advice.targetReps); set.rpe = 8; });
  persist(); renderWorkout(); toast(advice.canIncrease ? `Progresión conservadora preparada: ${formatWeight(advice.suggested)} × ${advice.targetReps}.` : `Objetivo de repeticiones preparado: ${advice.targetReps}.`);
}
function progressionHint(item, index) {
  const advice = progressionAdvice(item);
  if (!advice) return '<div class="progression-hint" role="note"><span>Sin historial para este ejercicio. Registra sesiones para comparar repeticiones y esfuerzo; Forja necesita al menos dos sesiones antes de sugerir subir la carga.</span></div>';
  const lastWeight = advice.weight ? formatWeight(advice.weight) : 'peso corporal / sin carga registrada';
  const sample = advice.progression.sessions, basis = `${sample} ${sample === 1 ? 'sesión válida' : 'sesiones válidas'} · ${advice.sets} series · RPE medio ${advice.rpe}`;
  if (sample < 2) return `<div class="progression-hint" role="note"><span>Referencia inicial: ${escapeHtml(lastWeight)} × ${advice.reps} · ${escapeHtml(basis)}. Es pronto para cambiar la carga; vuelve a registrar este ejercicio para comparar.</span></div>`;
  const stall = advice.stagnation?.stalled && advice.stagnation.sample >= 6 ? ' Posible estancamiento (6 o más sesiones comparables): revisa recuperación y técnica.' : '';
  const text = advice.canIncrease ? `Predicción conservadora: ${formatWeight(advice.suggested)} × ${advice.targetReps}. ${advice.progression.reason}` : advice.rpe >= 9 ? `La última sesión fue exigente (RPE ${advice.rpe} · RIR ${ForjaCore.rirFromRpe(advice.rpe)}). Mantén ${lastWeight} y consolida ${advice.targetReps} repeticiones. ${advice.progression.reason}` : `Última sesión: ${lastWeight} × ${advice.reps} · ${advice.progression.reason}${stall}`;
  return `<div class="progression-hint"><span>${escapeHtml(text)}<small class="progression-evidence">Base: ${escapeHtml(basis)} · confianza ${escapeHtml(advice.progression.confidence)}${advice.progression.volumeTrend ? ` · cambio de volumen ${(advice.progression.volumeTrend * 100).toFixed(0)}%` : ''}</small></span><button class="text-button" data-apply-progression="${index}">Preparar objetivo</button></div>`;
}
function renderWorkoutExercise(item, index) {
  const ex = byId(item.exerciseId); if (!ex) return '';
  const session = profile.data.activeWorkout, pair = workoutPair(session, index), unit = item.unit === 'seconds' ? 'Seg' : 'Reps', label = item.unit === 'seconds' ? 'Segundos' : 'Repeticiones', weightUnit = getPreferences().weightUnit, completed = item.sets.some((set) => set.done);
  const pairLabel = pair ? `Superset · ${index < pair.partnerIndex ? 'A' : 'B'} / ${escapeHtml(byId(pair.partner.exerciseId)?.name || 'compañero')}` : '';
  const pairButton = index < session.exercises.length - 1 ? `<button class="text-button" data-pair-exercise="${index}">${pair ? 'Quitar superset' : 'Emparejar con siguiente'}</button>` : '';
  const rpeChip = (set, value) => `<button type="button" class="rpe-chip ${(Number(set.rpe) || 8) === value ? 'active' : ''}" data-set-rpe="${value}" ${set.done ? 'disabled' : ''} aria-pressed="${String((Number(set.rpe) || 8) === value)}">${value}<small>RIR ${ForjaCore.rirFromRpe(value)}</small></button>`;
  const stepper = (field, value, labelText, step, done) => `<div class="set-stepper" data-stepper-label="${escapeHtml(labelText)}"><button type="button" class="stepper-btn" data-step-field="${field}" data-step="-1" aria-label="Bajar ${labelText}" ${done ? 'disabled' : ''}>−</button><input type="number" min="${field === 'weight' ? 0 : 1}" max="${field === 'weight' ? 999 : 100}" step="${step}" inputmode="${field === 'weight' ? 'decimal' : 'numeric'}" aria-label="${labelText}" data-set-field="${field}" value="${escapeHtml(value ?? '')}" placeholder="${field === 'weight' ? '—' : ''}" ${done ? 'disabled' : ''}><button type="button" class="stepper-btn" data-step-field="${field}" data-step="1" aria-label="Subir ${labelText}" ${done ? 'disabled' : ''}>＋</button></div>`;
  return `<article class="workout-exercise fatigue-friendly ${item.sets.every((s) => s.done) ? 'done' : ''} ${pair ? 'superset-card' : ''}" data-exercise-index="${index}"><div class="workout-exercise-head"><div>${pair ? `<span class="superset-badge">${pairLabel}</span>` : ''}<h3>${index + 1}. ${escapeHtml(ex.name)}</h3><small>${escapeHtml(MUSCLES[ex.muscle])} · ${escapeHtml(ex.equip)} · objetivo ${item.targetSets} × ${escapeHtml(item.reps)}</small></div><div class="workout-head-actions"><button class="text-button" data-exercise-alternatives="${index}" ${completed ? 'disabled title="Ya hay series registradas"' : ''}>Cambiar</button><button class="text-button" data-open-exercise="${ex.id}">Guía →</button></div></div>${progressionHint(item, index)}<div class="set-table"><div class="set-row header fatigue-header"><span>Serie</span><span>Peso ${weightUnit}</span><span>${unit}</span><span>RPE / RIR</span><span></span></div>${item.sets.map((set, setIndex) => `<div class="set-row fatigue-row ${set.done ? 'done' : ''}" data-set-index="${setIndex}"><span class="set-index">${String(setIndex + 1).padStart(2, '0')}</span>${stepper('weight', set.weight ?? '', `Peso en ${weightUnit}`, weightUnit === 'kg' ? 0.5 : 2.5, set.done)}${stepper('reps', set.reps ?? defaultReps(item.reps), label, 1, set.done)}<div class="rpe-strip" role="group" aria-label="Esfuerzo percibido">${[6, 7, 8, 9, 10].map((value) => rpeChip(set, value)).join('')}<input class="rpe-input" type="hidden" data-set-field="rpe" value="${escapeHtml(set.rpe ?? 8)}"></div><button class="set-check ${set.done ? 'done' : ''}" data-complete-set title="${set.done ? 'Serie hecha' : 'Marcar serie como hecha'}">${set.done ? '✓' : '○'}</button></div>`).join('')}</div><div class="exercise-note">RPE 6–10 · RIR = repeticiones que te quedan. ${escapeHtml(ex.cues[0])}</div><div class="workout-exercise-note"><textarea data-exercise-notes maxlength="280" aria-label="Nota privada de ${escapeHtml(ex.name)}" placeholder="Nota técnica (opcional)">${escapeHtml(item.notes || '')}</textarea><label class="exercise-note">Molestia<select data-discomfort aria-label="Molestia durante ${escapeHtml(ex.name)}"><option value="none" ${!item.discomfort || item.discomfort === 'none' ? 'selected' : ''}>Ninguna</option><option value="mild" ${item.discomfort === 'mild' ? 'selected' : ''}>Leve</option><option value="moderate" ${item.discomfort === 'moderate' ? 'selected' : ''}>Moderada</option><option value="high" ${item.discomfort === 'high' ? 'selected' : ''}>Alta</option></select></label></div><div class="workout-exercise-actions"><button data-add-set>＋ Añadir serie</button>${pairButton}<label class="exercise-note">Descanso <select data-rest-select>${[45, 60, 75, 90, 120, 150, 180].map((n) => `<option value="${n}" ${item.rest === n ? 'selected' : ''}>${n} s</option>`).join('')}</select></label></div></article>`;
}
function renderWorkout() {
  const session = profile.data.activeWorkout, root = $('#workout-content'), voiceButton = $('#voice-mode-toggle'); voiceButton.disabled = !session; voiceButton.setAttribute('aria-pressed', String(voiceEnabled)); voiceButton.textContent = voiceEnabled ? '◉ Desactivar guía de voz' : '◉ Activar guía de voz'; $('#voice-status').textContent = voiceEnabled ? 'Escuchando. Di “siguiente serie”, “descanso”, “completar serie” o “peso 20, 12 repeticiones”.' : '';
  if (!session && voiceEnabled) stopVoiceMode(false);
  if (!session) { $('#workout-heading').textContent = 'Vamos a entrenar'; $('#workout-subheading').textContent = 'Elige una rutina y registra cada serie aquí.'; root.innerHTML = `<div class="panel workout-empty"><p class="eyebrow">LISTA CUANDO TÚ LO ESTÉS</p><h2>Tu próxima sesión empieza aquí</h2><p class="subheading">Elige una rutina de la biblioteca o crea una que se adapte a tu día.</p><button class="button primary" data-open-view="rutinas">Elegir rutina →</button></div>`; return; }
  $('#workout-heading').textContent = session.name; $('#workout-subheading').textContent = `Empezó ${fmtDate(session.startedAt, { hour: 'numeric', minute: '2-digit' })} · Tus series se guardan automáticamente.`;
  const total = session.exercises.reduce((n, x) => n + x.targetSets, 0), done = sumSets(session), pct = total ? Math.round(done / total * 100) : 0, readiness = profile.data.readiness?.find((r) => r.date === localDay()), hint = readiness && (Number(readiness.energy) <= 2 || Number(readiness.soreness) >= 4) ? '<div class="session-reminder"><span>◎</span><p>Tu registro de hoy indica baja energía o molestias altas. Reduce la carga o el volumen y detente si aparece dolor.</p></div>' : '';
  root.innerHTML = `${hint}<div class="active-workout"><div class="workout-main"><div class="panel workout-progress"><div><b>Sesión en curso</b><small> · ${done} de ${total} series completadas</small><div class="progress-track"><i style="width:${pct}%"></i></div></div><span>${pct}%</span><button class="button secondary next-set-button" data-next-set>Próxima serie ↓</button>${session.lastSetAction ? '<button class="button secondary undo-set-button" data-undo-last-set>↶ Deshacer última serie</button>' : ''}</div>${session.exercises.map((item, i) => renderWorkoutExercise(item, i)).join('')}</div><aside class="workout-aside"><div class="panel aside-timer"><p class="eyebrow">TIEMPO DE SESIÓN</p><strong id="session-duration">${clock(Date.now() - new Date(session.startedAt).getTime())}</strong><small>hh:mm · mantenemos la pantalla activa durante la sesión si el dispositivo lo permite</small></div><div class="panel workout-actions"><button class="button secondary" id="add-session-exercise">＋ Añadir ejercicio</button><p class="finish-note">Peso, repeticiones y descanso se guardan automáticamente. Las notas de técnica y molestias quedan en el historial.</p><button class="button primary" id="finish-session">Terminar sesión</button><button class="text-button" id="cancel-session">Descartar sesión</button></div></aside></div>`; updateSessionClock();
}
function handleWorkoutInput(event) {
  const session = profile.data.activeWorkout; if (!session) return; const row = event.target.closest('.workout-exercise'); if (!row) return; const item = session.exercises[Number(row.dataset.exerciseIndex)];
  if (event.target.matches('[data-rest-select]')) item.rest = Number(event.target.value);
  else if (event.target.matches('[data-exercise-notes]')) item.notes = event.target.value;
  else if (event.target.matches('[data-discomfort]')) item.discomfort = event.target.value;
  else if (event.target.matches('[data-set-field]')) { const set = item.sets[Number(event.target.closest('.set-row').dataset.setIndex)]; set[event.target.dataset.setField] = event.target.value; }
  session.updatedAt = new Date().toISOString(); queueWorkoutPersist();
}
function adjustSetStepper(row, field, direction) {
  const session = profile.data.activeWorkout; if (!session) return;
  const card = row.closest('.workout-exercise'), item = session.exercises[Number(card.dataset.exerciseIndex)], set = item.sets[Number(row.dataset.setIndex)];
  if (!set || set.done) return;
  const unit = getPreferences().weightUnit, step = field === 'weight' ? (unit === 'kg' ? 0.5 : 2.5) : 1;
  const current = Number(set[field] || (field === 'reps' ? defaultReps(item.reps) : 0)) || 0;
  const next = Math.max(field === 'weight' ? 0 : 1, Math.round((current + direction * step) * 10) / 10);
  set[field] = String(next);
  const input = row.querySelector(`[data-set-field="${field}"]`);
  if (input) input.value = set[field];
  session.updatedAt = new Date().toISOString(); queueWorkoutPersist();
}
function handleWorkoutClick(event) {
  const session = profile.data.activeWorkout;
  const stepper = event.target.closest('[data-step-field]');
  if (stepper) { event.preventDefault(); adjustSetStepper(stepper.closest('.set-row'), stepper.dataset.stepField, Number(stepper.dataset.step)); return; }
  const rpeChip = event.target.closest('[data-set-rpe]');
  if (rpeChip) {
    const row = rpeChip.closest('.set-row'), card = rpeChip.closest('.workout-exercise'), item = session?.exercises[Number(card.dataset.exerciseIndex)], set = item?.sets[Number(row.dataset.setIndex)];
    if (!set || set.done) return;
    set.rpe = Number(rpeChip.dataset.setRpe);
    row.querySelector('[data-set-field="rpe"]').value = String(set.rpe);
    row.querySelectorAll('[data-set-rpe]').forEach((chip) => { chip.classList.toggle('active', Number(chip.dataset.setRpe) === set.rpe); chip.setAttribute('aria-pressed', String(Number(chip.dataset.setRpe) === set.rpe)); });
    session.updatedAt = new Date().toISOString(); queueWorkoutPersist();
    return;
  }
  if (event.target.closest('[data-undo-last-set]')) { undoLastSetCompletion(); return; }
  if (event.target.closest('[data-next-set]')) { focusNextSet(); return; }
  if (event.target.closest('[data-apply-progression]')) { applyProgression(Number(event.target.closest('[data-apply-progression]').dataset.applyProgression)); return; }
  if (event.target.closest('[data-exercise-alternatives]')) { openExerciseAlternatives(Number(event.target.closest('[data-exercise-alternatives]').dataset.exerciseAlternatives)); return; }
  if (event.target.closest('[data-pair-exercise]')) { toggleWorkoutSuperset(Number(event.target.closest('[data-pair-exercise]').dataset.pairExercise)); return; }
  if (event.target.closest('[data-open-exercise]')) { openExercise(event.target.closest('[data-open-exercise]').dataset.openExercise); return; }
  if (event.target.closest('[data-complete-set]')) { completeSet(event.target.closest('.workout-exercise'), event.target.closest('.set-row')); return; }
  if (event.target.closest('[data-add-set]')) { const idx = Number(event.target.closest('.workout-exercise').dataset.exerciseIndex), item = session.exercises[idx]; item.targetSets++; item.sets.push({ weight: item.sets.at(-1)?.weight || '', reps: defaultReps(item.reps), rpe: 8, done: false }); session.updatedAt = new Date().toISOString(); persist(); renderWorkout(); return; }
  if (event.target.closest('#finish-session')) { finishWorkout(); return; }
  if (event.target.closest('#cancel-session')) { if (confirm('¿Descartar esta sesión? Las series aún no completadas se perderán.')) { profile.data.activeWorkout = null; stopVoiceMode(false); releaseScreenWakeLock(); persist(); renderAll(); toast('Sesión descartada.'); } return; }
  if (event.target.closest('#add-session-exercise')) { showView('ejercicios'); toast('Elige un ejercicio y usa “Añadir a la sesión”.'); return; }
  if (event.target.closest('[data-add-to-session]')) addExerciseToSession(event.target.closest('[data-add-to-session]').dataset.addToSession);
}
function completeSet(card, row) {
  const session = profile.data.activeWorkout, index = Number(card.dataset.exerciseIndex), item = session.exercises[index], set = item.sets[Number(row.dataset.setIndex)]; if (set.done) return;
  const weight = $('[data-set-field="weight"]', row).value, reps = Number($('[data-set-field="reps"]', row).value), rpe = Math.min(10, Math.max(1, Number($('[data-set-field="rpe"]', row).value) || 8));
  if (!reps) { toast('Añade las repeticiones de esta serie.'); return; }
  const setIndex = Number(row.dataset.setIndex), completedAt = new Date().toISOString();
  session.lastSetAction = { exerciseIndex: index, setIndex, completedAt, previousSet: structuredClone(set), previousNextExerciseIndex: session.nextExerciseIndex ?? null };
  set.weight = weight; set.weightUnit = getPreferences().weightUnit; set.reps = reps; set.rpe = rpe; set.done = true; set.completedAt = completedAt; session.updatedAt = completedAt; persist();
  if (db.accessibility?.vibration !== false && navigator.vibrate) navigator.vibrate([25, 35, 25]);
  const pair = workoutPair(session, index); let seconds = item.rest || 90, label = 'Descanso entre series';
  if (pair) {
    const firstIndex = Math.min(index, pair.partnerIndex), secondIndex = Math.max(index, pair.partnerIndex);
    if (index === firstIndex) { session.nextExerciseIndex = secondIndex; seconds = 20; label = `Cambio a ${byId(session.exercises[secondIndex].exerciseId)?.name || 'ejercicio B'}`; }
    else if (session.exercises[firstIndex].sets.some((entry) => !entry.done)) { session.nextExerciseIndex = firstIndex; label = 'Descanso del superset · siguiente vuelta'; }
    else { session.nextExerciseIndex = secondIndex; label = 'Termina el ejercicio B'; }
  } else {
    session.nextExerciseIndex = item.sets.some((entry) => !entry.done) ? index : null;
    label = byId(item.exerciseId)?.name || 'Descanso';
  }
  persist(); renderWorkout(); startTimer(seconds, label);
}

function undoLastSetCompletion() {
  const session = profile.data.activeWorkout;
  if (!ForjaCore.undoLastSetCompletion(session)) { toast('Ya no se puede deshacer esa serie.'); return; }
  closeTimer(); persist(); renderWorkout(); toast('Serie deshecha. Tus repeticiones y carga se conservaron.');
}

function repeatPreviousWorkout(id) {
  if (profile.data.activeWorkout) { showView('entrenar'); toast('Termina o descarta la sesión actual antes de repetir otra.'); return; }
  const previous = validWorkoutHistory().find((workout) => workout.id === id);
  if (!previous) { toast('No encontré esa sesión en el historial.'); return; }
  const startedAt = new Date().toISOString(), sessionId = `session-${crypto.randomUUID?.() || Date.now()}`;
  const session = ForjaCore.repeatWorkoutSession(previous, sessionId, startedAt, getPreferences().weightUnit);
  if (!session) { toast('Esta sesión no tiene ejercicios que se puedan repetir.'); return; }
  profile.data.activeWorkout = session; profile.data.lastRoutineId = session.routineId || profile.data.lastRoutineId;
  persist(); requestScreenWakeLock(); showView('entrenar'); toast('Sesión preparada con tus últimas cargas y repeticiones.');
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-repeat-workout]');
  if (button) repeatPreviousWorkout(button.dataset.repeatWorkout);
});

function pendingSetRow() {
  const session = profile?.data?.activeWorkout; if (!session) return null;
  const order = Number.isInteger(session.nextExerciseIndex) ? [session.nextExerciseIndex, ...session.exercises.map((_, i) => i).filter((i) => i !== session.nextExerciseIndex)] : session.exercises.map((_, i) => i);
  for (const i of order) { const item = session.exercises[i], j = item?.sets.findIndex((set) => !set.done); if (j == null || j < 0) continue; const row = $(`[data-exercise-index="${i}"] [data-set-index="${j}"]`); if (row) return { row, item, exercise: byId(item.exerciseId) }; }
  return null;
}
function focusNextSet() {
  const pending = pendingSetRow(); if (!pending) { toast('Todas las series de esta sesión están listas.'); return; }
  pending.row.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); pending.row.classList.add('next-set-focus'); setTimeout(() => pending.row.classList.remove('next-set-focus'), 1300);
}

function renderHistory() {
  if (!profile) return;
  const range = $('#history-range').value, cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 86400000;
  const workouts = validWorkoutHistory().filter((w) => new Date(w.finishedAt||w.startedAt).getTime() >= cutoff).sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
  $('#workout-history').innerHTML = workouts.length ? workouts.map((w) => {
    const muscles = [...new Set(Object.keys(w.muscleRecovery || {}).map((m) => MUSCLES[m]).filter(Boolean))];
    const items = w.exercises.map((entry) => { const ex = byId(entry.exerciseId); return `<div class="history-exercise"><b>${escapeHtml(ex?.name || entry.exerciseId)}</b>${entry.sets.map((set, index) => `<span>Serie ${index + 1}: ${set.weight ? `${escapeHtml(set.weight)} ${escapeHtml(set.weightUnit || getPreferences().weightUnit)} · ` : ''}${escapeHtml(set.reps || '')} reps${set.rpe ? ` · RPE ${escapeHtml(set.rpe)}` : ''}</span>`).join('')}${entry.notes ? `<small>Nota: ${escapeHtml(entry.notes)}</small>` : ''}${entry.discomfort && entry.discomfort !== 'none' ? `<small>Molestia registrada: ${escapeHtml(entry.discomfort)}</small>` : ''}</div>`; }).join('');
    return `<article class="history-item"><div class="history-item-top"><b>${escapeHtml(w.name)}</b><small>${escapeHtml(fmtDate(w.finishedAt, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }))}</small></div><div class="history-item-meta"><span>◷ ${Math.round(w.durationMinutes || 0)} min</span><span>▤ ${sumSets(w)} series</span><span>↗ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(sumVolume(w))} ${getPreferences().weightUnit} de volumen</span></div><div class="history-item-muscles">${muscles.join(' · ') || 'Sin grupos detectados'}</div><div class="history-actions"><button class="button secondary" type="button" data-repeat-workout="${escapeHtml(w.id)}">↻ Repetir sesión</button></div><details class="history-details"><summary>Ver ejercicios, series y notas</summary><div class="history-exercises">${items}</div></details></article>`;
  }).join('') : '<div class="empty-inline">Todavía no hay sesiones en este periodo. Termina una rutina y la encontrarás aquí.</div>';
}
