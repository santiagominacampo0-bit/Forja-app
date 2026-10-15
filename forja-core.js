(function exposeForjaCore(root) {
  'use strict';

  const SAFE_ROUTINE_ICONS = new Set(['✳', '↗', '◈', '↶', '⇧', '↓', '↑', '◇', '⬡', '▰', '⌁', '⇅', '⇆', '◒', '◷']);
  const SAFE_SPLITS = new Set(['Objetivo personal', 'Cuerpo completo', 'Torso / pierna', 'Push / Pull / Legs']);
  const SAFE_GOAL_TYPES = new Set(['sessions', 'weight', 'exercise', 'streak']);
  const SAFE_EXERCISE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/i;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  function timestamp(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeTimerSnapshot(snapshot, now = Date.now()) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const duration = Number(snapshot.duration), deadline = Number(snapshot.deadline), remaining = Number(snapshot.remaining);
    const currentTime = now instanceof Date ? now.getTime() : Number(now);
    const maxDuration = 8 * 60 * 60 * 1000;
    if (!Number.isFinite(duration) || duration < 1000 || duration > maxDuration || !Number.isFinite(currentTime)) return null;
    const paused = Boolean(snapshot.paused);
    if (paused && !Number.isFinite(remaining)) return null;
    if (!paused && !Number.isFinite(deadline)) return null;
    const timeLeft = Math.max(0, Math.min(duration, paused ? remaining : deadline - currentTime));
    const label = String(snapshot.label || 'Descanso').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || 'Descanso';
    return {
      duration,
      deadline: paused ? currentTime + timeLeft : deadline,
      remaining: timeLeft,
      paused: paused || timeLeft === 0,
      label,
      alerted: Boolean(snapshot.alerted)
    };
  }

  function localDayKey(value) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function validDayKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function workoutTimestamp(workout) {
    const finished = Date.parse(workout?.finishedAt || '');
    if (Number.isFinite(finished)) return finished;
    const started = Date.parse(workout?.startedAt || '');
    return Number.isFinite(started) ? started : NaN;
  }

  function completedWorkouts(workouts = [], now = new Date()) {
    const limit = now instanceof Date ? now.getTime() : timestamp(now, NaN);
    if (!Number.isFinite(limit)) return [];
    return (Array.isArray(workouts) ? workouts : []).filter((workout) => {
      const at = workoutTimestamp(workout);
      return Number.isFinite(at) && at <= limit;
    });
  }

  function calendarWeekStart(value = new Date()) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date;
  }

  function workoutsInCalendarWeek(workouts = [], now = new Date()) {
    const reference = now instanceof Date ? now : new Date(now);
    const weekStart = calendarWeekStart(reference);
    if (!weekStart || !Number.isFinite(reference.getTime())) return [];
    const from = weekStart.getTime(), until = reference.getTime();
    return completedWorkouts(workouts, reference).filter((workout) => {
      const at = workoutTimestamp(workout);
      return at >= from && at <= until;
    });
  }

  function countChallengeSessions(workouts = [], startedAt, dueDate, now = new Date()) {
    const reference = now instanceof Date ? now : new Date(now), nowTime = reference.getTime();
    if (!Number.isFinite(nowTime)) return 0;
    const startText = String(startedAt || '');
    const startMatch = startText.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
    const startDate = startMatch ? new Date(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3])) : null;
    const started = startDate ? startDate.getTime() : Date.parse(startText), startTime = Number.isFinite(started) ? started : 0;
    let endExclusive = nowTime + 1;
    const due = String(dueDate || '');
    if (DAY.test(due)) {
      const [year, month, day] = due.split('-').map(Number);
      const dueStart = new Date(year, month - 1, day);
      if (dueStart.getFullYear() === year && dueStart.getMonth() === month - 1 && dueStart.getDate() === day) {
        endExclusive = Math.min(endExclusive, new Date(year, month - 1, day + 1).getTime());
      }
    }
    return completedWorkouts(workouts, reference).filter((workout) => {
      const at = workoutTimestamp(workout);
      return at >= startTime && at < endExclusive;
    }).length;
  }

  function trainingBlockState(block = {}, configuredWeeks = 4, today = new Date()) {
    const weeks = [4, 6, 8].includes(Number(block?.weeks)) ? Number(block.weeks)
      : [4, 6, 8].includes(Number(configuredWeeks)) ? Number(configuredWeeks) : 4;
    const reference = today instanceof Date ? today : new Date(today);
    if (!Number.isFinite(reference.getTime())) return { weeks, week: 1, deload: false, phase: 'Construcción' };
    const startMatch = String(block?.startedAt || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const start = startMatch ? new Date(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3])) : new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const currentDay = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate());
    const elapsed = Math.max(0, Math.floor((currentDay - startDay) / 86400000 / 7));
    const week = elapsed % weeks + 1;
    const deload = week === weeks;
    return { weeks, week, deload, phase: deload ? 'Descarga' : 'Construcción' };
  }

  function claimDueReminders(reminders = {}, now = new Date(), pushWorkoutEnabled = false) {
    const reference = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(reference.getTime())) return { due: [], claimed: [] };
    const snoozedUntil = Date.parse(reminders?.snoozedUntil || '');
    if (Number.isFinite(snoozedUntil) && snoozedUntil > reference.getTime()) return { due: [], claimed: [] };
    if (isQuietHours(reminders?.quietHours, reference)) return { due: [], claimed: [] };
    const today = localDayKey(reference), day = reference.getDay();
    const hm = `${String(reference.getHours()).padStart(2, '0')}:${String(reference.getMinutes()).padStart(2, '0')}`;
    const due = [], claimed = [];
    for (const [key, reminder] of Object.entries(reminders || {})) {
      if (!reminder?.enabled || !(reminder.days || []).includes(day) || hm < (reminder.time || '18:00') || reminder.lastSent === today) continue;
      reminder.lastSent = today;
      claimed.push(key);
      if (key !== 'workout' || !pushWorkoutEnabled) due.push(key);
    }
    return { due, claimed };
  }

  function isQuietHours(config = {}, now = new Date()) {
    if (!config?.enabled) return false;
    const parse = (value) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value || ''))
      ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null;
    const start = parse(config.start), end = parse(config.end);
    if (start == null || end == null || start === end) return false;
    const date = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(date.getTime())) return false;
    const minute = date.getHours() * 60 + date.getMinutes();
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }

  function retainDailyBackups(backups = [], date, snapshot, limit = 7) {
    if (!validDayKey(date) || !snapshot || typeof snapshot !== 'object') return [];
    const byDate = new Map();
    for (const entry of Array.isArray(backups) ? backups : []) {
      if (validDayKey(entry?.date) && entry?.snapshot && typeof entry.snapshot === 'object') byDate.set(entry.date, entry);
    }
    if (!byDate.has(date)) byDate.set(date, { date, snapshot });
    const keep = Math.max(1, Math.min(30, Math.floor(Number(limit) || 7)));
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, keep);
  }

  function suggestRoutineIds(goal = 'general', days = 3) {
    const count = Math.max(1, Math.min(7, Math.floor(Number(days) || 3)));
    if (count <= 2) return goal === 'strength' ? ['strength-base', 'fb-machine'] : ['fb-starter', 'fb-dumbbell'];
    if (count === 3) return goal === 'strength' ? ['strength-base', 'fb-starter', 'strength-base'] : ['fb-starter', 'fb-machine', 'fb-dumbbell'];
    if (count === 4) return ['upper-a', 'lower-a', 'upper-b', 'lower-b'];
    if (count === 5) return ['ppl-push', 'ppl-pull', 'ppl-legs', 'upper-b', 'lower-b'];
    return ['ppl-push', 'ppl-pull', 'ppl-legs', 'ppl-push', 'ppl-pull', 'ppl-legs'];
  }

  function sanitizeWeeklySchedule(value) {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return Object.fromEntries(Object.entries(value)
      .filter(([day, routineId]) => /^[0-6]$/.test(day) && SAFE_EXERCISE_ID.test(String(routineId || '')))
      .slice(0, 7)
      .map(([day, routineId]) => [day, String(routineId)]));
  }

  function recordTime(record, fallback = 0) {
    return timestamp(record?.updatedAt || record?.finishedAt || record?.createdAt || record?.date, fallback);
  }

  function unionBy(listA = [], listB = [], key = 'id', timeA = 0, timeB = 0) {
    const map = new Map();
    for (const [list, fallback] of [[listA, timeA], [listB, timeB]]) {
      for (const item of Array.isArray(list) ? list : []) {
        const id = item?.[key];
        if (id == null || id === '') continue;
        const prior = map.get(id);
        if (!prior || recordTime(item, fallback) > recordTime(prior.item, prior.fallback)) map.set(id, { item, fallback });
      }
    }
    return [...map.values()].map((entry) => entry.item);
  }

  function mergeStateMap(local = {}, remote = {}) {
    const merged = {};
    for (const key of new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])) {
      const a = local?.[key], b = remote?.[key];
      merged[key] = !a ? b : !b ? a : timestamp(b.updatedAt) > timestamp(a.updatedAt) ? b : a;
    }
    return merged;
  }

  function mergeFavoriteLists(localList, remoteList, states) {
    const ids = new Set([...(Array.isArray(localList) ? localList : []), ...(Array.isArray(remoteList) ? remoteList : [])]);
    return [...ids].filter((id) => states?.[id] ? states[id].active !== false : true);
  }

  function mergeCloudDatabases(local, remote) {
    const localProfiles = Array.isArray(local?.profiles) ? local.profiles : [];
    const remoteProfiles = Array.isArray(remote?.profiles) ? remote.profiles : [];
    const result = [];
    const unusedRemote = new Set(remoteProfiles.map((profile) => profile.id));
    const profileIdMap = new Map();
    const localTime = timestamp(local?.updatedAt);
    const remoteTime = timestamp(remote?.updatedAt);

    for (const lp of localProfiles) {
      const normalized = String(lp.name || '').trim().toLocaleLowerCase('es');
      const rp = remoteProfiles.find((profile) => profile.id === lp.id)
        || remoteProfiles.find((profile) => String(profile.name || '').trim().toLocaleLowerCase('es') === normalized);
      if (!rp) {
        result.push(structuredClone(lp));
        continue;
      }

      unusedRemote.delete(rp.id);
      profileIdMap.set(rp.id, lp.id || rp.id);
      const a = lp.data || {}, b = rp.data || {}, data = { ...b, ...a };
      for (const field of ['workouts', 'customRoutines', 'goals', 'challenges']) {
        data[field] = unionBy(a[field], b[field], 'id', localTime, remoteTime);
      }
      data.readiness = unionBy(a.readiness, b.readiness, 'date', localTime, remoteTime).sort((x, y) => String(x.date).localeCompare(String(y.date)));
      data.measurements = unionBy(a.measurements, b.measurements, 'date', localTime, remoteTime).sort((x, y) => String(x.date).localeCompare(String(y.date)));

      data.favoriteState = mergeStateMap(a.favoriteState, b.favoriteState);
      data.favoriteRoutineState = mergeStateMap(a.favoriteRoutineState, b.favoriteRoutineState);
      data.favorites = mergeFavoriteLists(a.favorites, b.favorites, data.favoriteState);
      data.favoriteRoutines = mergeFavoriteLists(a.favoriteRoutines, b.favoriteRoutines, data.favoriteRoutineState);

      const localPreferencesTime = timestamp(a.preferencesUpdatedAt, localTime);
      const remotePreferencesTime = timestamp(b.preferencesUpdatedAt, remoteTime);
      data.preferences = remotePreferencesTime > localPreferencesTime ? b.preferences : a.preferences || b.preferences;
      data.preferencesUpdatedAt = Math.max(localPreferencesTime, remotePreferencesTime) || undefined;
      const localScheduleTime = timestamp(a.weeklyScheduleUpdatedAt, localPreferencesTime);
      const remoteScheduleTime = timestamp(b.weeklyScheduleUpdatedAt, remotePreferencesTime);
      const newerSchedule = remoteScheduleTime > localScheduleTime ? b : a;
      const olderSchedule = newerSchedule === a ? b : a;
      data.weeklySchedule = newerSchedule.weeklySchedule !== undefined ? newerSchedule.weeklySchedule : olderSchedule.weeklySchedule;
      data.weeklyScheduleUpdatedAt = Math.max(localScheduleTime, remoteScheduleTime) || undefined;

      const active = [a.activeWorkout, b.activeWorkout].filter(Boolean)
        .sort((x, y) => recordTime(y, timestamp(y.startedAt)) - recordTime(x, timestamp(x.startedAt)))[0];
      data.activeWorkout = active || null;

      const deleted = new Set([...(local.syncTombstones || []), ...(remote.syncTombstones || [])]
        .filter((entry) => typeof entry === 'string'));
      data.goals = data.goals.filter((entry) => !deleted.has(`goal:${entry.id}`));
      data.customRoutines = data.customRoutines.filter((entry) => !deleted.has(`routine:${entry.id}`));
      data.challenges = data.challenges.filter((entry) => !deleted.has(`challenge:${entry.id}`));
      result.push({ ...rp, ...lp, id: lp.id || rp.id, data });
    }

    remoteProfiles.filter((profile) => unusedRemote.has(profile.id)).forEach((profile) => {
      profileIdMap.set(profile.id, profile.id);
      result.push(structuredClone(profile));
    });
    result.forEach((profile) => {
      (profile.data?.challenges || []).forEach((challenge) => {
        challenge.participants = (challenge.participants || []).map((id) => profileIdMap.get(id) || id);
      });
    });
    const current = result.find((profile) => profile.id === local?.currentProfile)
      || result.find((profile) => profile.name === localProfiles[0]?.name)
      || result[0];
    return {
      version: 2,
      currentProfile: current?.id,
      profiles: result,
      syncTombstones: [...new Set([...(local.syncTombstones || []), ...(remote.syncTombstones || [])])],
      updatedAt: new Date().toISOString()
    };
  }

  function text(value, max, fallback = '') {
    return String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
  }

  function numeric(value, min, max, fallback = null) {
    if (value === '' || value == null) return fallback;
    const result = Number(value);
    return Number.isFinite(result) && result >= min && result <= max ? result : fallback;
  }

  function safeDate(value, fallback = '') {
    const valueText = text(value, 40);
    return valueText && Number.isFinite(Date.parse(valueText)) ? valueText : fallback;
  }

  function safeId(value) {
    const id = text(value, 120);
    return SAFE_EXERCISE_ID.test(id) ? id : '';
  }

  function sanitizeRoutine(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.exercises) || value.exercises.length > 20) return null;
    const exercises = value.exercises.map((row) => {
      if (!Array.isArray(row) || !safeId(row[0])) return null;
      const sets = numeric(row[1], 1, 10);
      if (sets == null) return null;
      return [safeId(row[0]), sets, text(row[2], 20, '8–12') || '8–12'];
    }).filter(Boolean);
    if (!exercises.length) return null;
    const id = safeId(value.id) || `custom-${Date.now()}`;
    return {
      id,
      name: text(value.name, 42).trim() || 'Rutina importada',
      split: SAFE_SPLITS.has(value.split) ? value.split : 'Objetivo personal',
      goal: text(value.goal, 40, 'Personal'),
      level: text(value.level, 40, 'Personal'),
      days: text(value.days, 40, 'A tu ritmo'),
      time: text(value.time, 40),
      icon: SAFE_ROUTINE_ICONS.has(value.icon) ? value.icon : '✳',
      desc: text(value.desc, 180, 'Rutina importada para personalizar.'),
      updatedAt: safeDate(value.updatedAt),
      exercises
    };
  }

  function sanitizeStateMap(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [rawId, state] of Object.entries(value).slice(0, 5000)) {
      const id = safeId(rawId);
      if (!id || !state || typeof state !== 'object') continue;
      result[id] = { active: Boolean(state.active), updatedAt: safeDate(state.updatedAt) };
    }
    return result;
  }

  function sanitizeReminder(value, fallback) {
    const base = fallback || { enabled: false, time: '18:00', days: [1, 3, 5], lastSent: '' };
    if (!value || typeof value !== 'object') return { ...base };
    return {
      enabled: Boolean(value.enabled),
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? value.time : base.time,
      days: Array.isArray(value.days) ? value.days.map((day) => numeric(day, 0, 6)).filter((day) => day != null) : base.days.slice(),
      lastSent: DAY.test(String(value.lastSent || '')) ? String(value.lastSent) : ''
    };
  }

  function sanitizeReminders(value, workoutFallback) {
    const source = value && typeof value === 'object' ? value : {};
    const quiet = source.quietHours && typeof source.quietHours === 'object' ? source.quietHours : {};
    return {
      workout: sanitizeReminder(source.workout || workoutFallback, { enabled: false, time: '18:00', days: [1, 3, 5], lastSent: '' }),
      hydration: sanitizeReminder(source.hydration, { enabled: false, time: '11:00', days: [0, 1, 2, 3, 4, 5, 6], lastSent: '' }),
      sleep: sanitizeReminder(source.sleep, { enabled: false, time: '22:00', days: [0, 1, 2, 3, 4, 5, 6], lastSent: '' }),
      nutrition: sanitizeReminder(source.nutrition, { enabled: false, time: '13:00', days: [0, 1, 2, 3, 4, 5, 6], lastSent: '' }),
      quietHours: {
        enabled: Boolean(quiet.enabled),
        start: /^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.start) ? quiet.start : '22:00',
        end: /^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.end) ? quiet.end : '07:00'
      },
      snoozedUntil: safeDate(source.snoozedUntil)
    };
  }

  function sanitizeMuscleRecovery(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [rawMuscle, recovery] of Object.entries(value).slice(0, 100)) {
      const muscle = safeId(rawMuscle);
      if (!muscle || !recovery || typeof recovery !== 'object') continue;
      result[muscle] = {
        trainedAt: safeDate(recovery.trainedAt),
        until: safeDate(recovery.until),
        recoveryHours: numeric(recovery.recoveryHours, 0, 1000, 0),
        effectiveSets: numeric(recovery.effectiveSets, 0, 10000, 0),
        avgRpe: numeric(recovery.avgRpe, 0, 10, 0)
      };
    }
    return result;
  }
  function sanitizeWorkout(value, active = false) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.exercises) || value.exercises.length > 60) return null;
    const exercises = value.exercises.map((entry) => {
      if (!entry || typeof entry !== 'object' || !safeId(entry.exerciseId)) return null;
      const sets = Array.isArray(entry.sets) ? entry.sets.slice(0, 100).map((set) => ({
        weight: text(set?.weight, 16),
        weightUnit: set?.weightUnit === 'lb' ? 'lb' : 'kg',
        reps: numeric(set?.reps, 0, 1000, 0),
        rpe: numeric(set?.rpe, 1, 10, 8),
        done: Boolean(set?.done),
        completedAt: safeDate(set?.completedAt)
      })) : [];
      return {
        exerciseId: safeId(entry.exerciseId),
        targetSets: numeric(entry.targetSets, 1, 100, Math.max(1, sets.length)),
        reps: text(entry.reps, 20, '8–12'),
        unit: entry.unit === 'seconds' ? 'seconds' : 'reps',
        rest: numeric(entry.rest, 0, 3600, 90),
        sets,
        notes: text(entry.notes, 1200),
        discomfort: text(entry.discomfort, 40, 'none'),
        supersetId: safeId(entry.supersetId) || null,
        replacedExerciseId: safeId(entry.replacedExerciseId) || null,
        replacedExerciseName: text(entry.replacedExerciseName, 80),
      };
    }).filter(Boolean);
    return {
      id: safeId(value.id) || `workout-${Date.now()}`,
      name: text(value.name, 80, 'Sesión de fuerza'),
      routineId: safeId(value.routineId) || '',
      startedAt: safeDate(value.startedAt, new Date().toISOString()),
      finishedAt: safeDate(value.finishedAt),
      updatedAt: safeDate(value.updatedAt),
      durationMinutes: numeric(value.durationMinutes, 0, 10000, 0),
      targetSets: numeric(value.targetSets, 0, 10000, 0),
      nextExerciseIndex: numeric(value.nextExerciseIndex, 0, exercises.length, null),
      exercises,
      muscleRecovery: sanitizeMuscleRecovery(value.muscleRecovery),
      active: Boolean(active)
    };
  }

  function sanitizeProfile(profile) {
    if (!profile || typeof profile !== 'object' || !profile.data || typeof profile.data !== 'object') return null;
    const data = profile.data;
    const routines = Array.isArray(data.customRoutines) ? data.customRoutines.slice(0, 300).map(sanitizeRoutine).filter(Boolean) : [];
    const workouts = Array.isArray(data.workouts) ? data.workouts.slice(-20000).map((workout) => sanitizeWorkout(workout)).filter(Boolean) : [];
    const activeWorkout = sanitizeWorkout(data.activeWorkout, true);
    const measurements = Array.isArray(data.measurements) ? data.measurements.slice(-5000).map((entry) => {
      if (!entry || !DAY.test(String(entry.date || ''))) return null;
      const clean = { date: String(entry.date), updatedAt: safeDate(entry.updatedAt), weightUnit: entry.weightUnit === 'lb' ? 'lb' : 'kg' };
      for (const key of ['weight', 'waist', 'chest', 'hips', 'arm', 'thigh']) {
        const value = numeric(entry[key], 0, 1000);
        if (value != null) clean[key] = value;
      }
      return clean;
    }).filter(Boolean) : [];
    const readiness = Array.isArray(data.readiness) ? data.readiness.slice(-1000).map((entry) => {
      if (!entry || !DAY.test(String(entry.date || ''))) return null;
      return { date: String(entry.date), updatedAt: safeDate(entry.updatedAt), sleep: numeric(entry.sleep, 0, 24), energy: numeric(entry.energy, 1, 5, 3), soreness: numeric(entry.soreness, 1, 5, 1) };
    }).filter(Boolean) : [];
    const goals = Array.isArray(data.goals) ? data.goals.slice(0, 300).map((goal) => {
      if (!goal || typeof goal !== 'object') return null;
      return { id: safeId(goal.id) || `goal-${Date.now()}`, title: text(goal.title, 60), type: SAFE_GOAL_TYPES.has(goal.type) ? goal.type : 'sessions', target: numeric(goal.target, 0.01, 100000, 1), exerciseId: safeId(goal.exerciseId), weightUnit: goal.weightUnit === 'lb' ? 'lb' : 'kg', baseline: numeric(goal.baseline, 0, 100000), due: DAY.test(String(goal.due || '')) ? String(goal.due) : '', createdAt: safeDate(goal.createdAt), updatedAt: safeDate(goal.updatedAt) };
    }).filter(Boolean) : [];
    const challenges = Array.isArray(data.challenges) ? data.challenges.slice(0, 300).map((challenge) => {
      if (!challenge || typeof challenge !== 'object') return null;
      return { id: safeId(challenge.id) || `challenge-${Date.now()}`, title: text(challenge.title, 60), target: numeric(challenge.target, 1, 365, 1), due: DAY.test(String(challenge.due || '')) ? String(challenge.due) : '', createdAt: safeDate(challenge.createdAt), startedAt: safeDate(challenge.startedAt), updatedAt: safeDate(challenge.updatedAt), participants: Array.isArray(challenge.participants) ? challenge.participants.map((id) => text(id, 120)).filter(Boolean).slice(0, 100) : [], sharedResults: Array.isArray(challenge.sharedResults) ? challenge.sharedResults.slice(0, 100).map((row) => ({ id: text(row?.id, 120), name: text(row?.name, 40), count: numeric(row?.count, 0, 3650, 0), updatedAt: safeDate(row?.updatedAt) })) : [] };
    }).filter(Boolean) : [];

    const preferences = data.preferences && typeof data.preferences === 'object' ? data.preferences : {};
    const safeData = {
      theme: data.theme === 'light' ? 'light' : 'dark',
      workouts,
      activeWorkout,
      customRoutines: routines,
      favorites: Array.isArray(data.favorites) ? [...new Set(data.favorites.map(safeId).filter(Boolean))].slice(0, 5000) : [],
      favoriteRoutines: Array.isArray(data.favoriteRoutines) ? [...new Set(data.favoriteRoutines.map(safeId).filter(Boolean))].slice(0, 500) : [],
      favoriteState: sanitizeStateMap(data.favoriteState),
      favoriteRoutineState: sanitizeStateMap(data.favoriteRoutineState),
      measurements,
      goals,
      readiness,
      challenges,
      preferences: {
        goal: text(preferences.goal, 40, 'general'),
        level: text(preferences.level, 40, 'Inicial'),
        daysPerWeek: numeric(preferences.daysPerWeek, 1, 7, 3),
        sessionMinutes: numeric(preferences.sessionMinutes, 15, 180, 45),
        weightUnit: preferences.weightUnit === 'lb' ? 'lb' : 'kg',
        trainingDays: Array.isArray(preferences.trainingDays) ? [...new Set(preferences.trainingDays.map((day) => numeric(day, 0, 6)).filter((day) => day != null))].slice(0, 7) : [1, 3, 5],
        equipment: Array.isArray(preferences.equipment) ? preferences.equipment.map((item) => text(item, 40)).filter(Boolean).slice(0, 20) : ['Máquina', 'Mancuernas', 'Polea', 'Peso corporal', 'Barra'],
        blockWeeks: [4, 6, 8].includes(Number(preferences.blockWeeks)) ? Number(preferences.blockWeeks) : 4
      },
      preferencesUpdatedAt: safeDate(data.preferencesUpdatedAt),
      weeklySchedule: sanitizeWeeklySchedule(data.weeklySchedule),
      weeklyScheduleUpdatedAt: safeDate(data.weeklyScheduleUpdatedAt),
      block: data.block && typeof data.block === 'object' ? { weeks: [4, 6, 8].includes(Number(data.block.weeks)) ? Number(data.block.weeks) : 4, startedAt: DAY.test(String(data.block.startedAt || '')) ? String(data.block.startedAt) : new Date().toISOString().slice(0, 10) } : undefined,
      reminder: sanitizeReminder(data.reminder, { enabled: false, time: '18:00', days: [1, 3, 5], lastSent: '' }),
      reminders: sanitizeReminders(data.reminders, data.reminder),
      accent: ['lemon', 'blue', 'violet', 'orange', 'red'].includes(data.accent) ? data.accent : 'lemon',
      lastRoutineId: safeId(data.lastRoutineId) || ''
    };
    return { id: text(profile.id, 120) || `profile-${Date.now()}`, name: text(profile.name, 24).trim() || 'Atleta', updatedAt: safeDate(profile.updatedAt), data: safeData };
  }

  function normalizeBackup(payload) {
    if (!payload || payload.app !== 'Forja' || !payload.data || !Array.isArray(payload.data.profiles) || payload.data.profiles.length < 1 || payload.data.profiles.length > 50) throw new Error('Formato');
    const profiles = payload.data.profiles.map(sanitizeProfile);
    if (profiles.some((profile) => !profile)) throw new Error('Formato');
    const currentProfile = text(payload.data.currentProfile, 120);
    const data = { version: 2, currentProfile: profiles.some((profile) => profile.id === currentProfile) ? currentProfile : profiles[0].id, profiles };
    if (Array.isArray(payload.data.syncTombstones)) data.syncTombstones = payload.data.syncTombstones.filter((entry) => typeof entry === 'string').map((entry) => text(entry, 240)).slice(-5000);
    if (payload.data.accessibility && typeof payload.data.accessibility === 'object') {
      const accessibility = payload.data.accessibility;
      data.accessibility = {
        largeText: Boolean(accessibility.largeText),
        fontScale: [100, 112, 125].includes(Number(accessibility.fontScale)) ? Number(accessibility.fontScale) : (accessibility.largeText ? 112 : 100),
        highContrast: Boolean(accessibility.highContrast),
        reduceMotion: Boolean(accessibility.reduceMotion),
        largeTargets: Boolean(accessibility.largeTargets),
        vibration: accessibility.vibration !== false
      };
    }
    let photos;
    if (Array.isArray(payload.photos)) {
      if (payload.photos.length > 500) throw new Error('Fotos');
      const validProfileIds = new Set(profiles.map((profile) => profile.id));
      photos = payload.photos.map((photo) => {
        const dataUrl = String(photo?.dataUrl || '');
        const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
        if (!match || match[2].length > 16 * 1024 * 1024) throw new Error('Fotos');
        const profileId = text(photo.profileId, 120);
        if (!validProfileIds.has(profileId)) throw new Error('Fotos');
        return { id: text(photo.id, 160) || `photo-${Date.now()}`, profileId, date: DAY.test(String(photo.date || '')) ? String(photo.date) : new Date().toISOString().slice(0, 10), mime: `image/${match[1].toLowerCase()}`, dataUrl };
      });
      if (photos.reduce((total, photo) => total + photo.dataUrl.length, 0) > 96 * 1024 * 1024) throw new Error('Fotos');
    }
    return { app: 'Forja', version: Number(payload.version) || 1, data, photos };
  }

  function limitBackupPhotos(photos = [], validProfileIds = null, limits = {}) {
    const allowedProfiles = validProfileIds ? new Set(validProfileIds) : null;
    const maxCount = Math.max(0, Number(limits.maxCount) || 500);
    const maxPhotoChars = Math.max(0, Number(limits.maxPhotoChars) || 16 * 1024 * 1024);
    const maxTotalChars = Math.max(0, Number(limits.maxTotalChars) || 32 * 1024 * 1024);
    const result = [];
    let totalChars = 0, skipped = 0;
    for (const photo of Array.isArray(photos) ? photos : []) {
      const dataUrl = String(photo?.dataUrl || ''), match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
      const profileId = text(photo?.profileId, 120);
      if (!match || dataUrl.length > maxPhotoChars || (allowedProfiles && !allowedProfiles.has(profileId)) || result.length >= maxCount || totalChars + dataUrl.length > maxTotalChars) { skipped++; continue; }
      result.push({ id: text(photo.id, 160) || `photo-${Date.now()}`, profileId, date: DAY.test(String(photo.date || '')) ? String(photo.date) : new Date().toISOString().slice(0, 10), mime: `image/${match[1].toLowerCase()}`, dataUrl });
      totalChars += dataUrl.length;
    }
    return { photos: result, skipped };
  }

  function createBackup(data, photos = [], exportedAt = new Date()) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Formato');
    const cleanData = structuredClone(data);
    for (const key of ['syncConfig', 'syncSession', 'push', 'localDeviceId']) delete cleanData[key];
    const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
    const validProfileIds = new Set(Array.isArray(cleanData.profiles) ? cleanData.profiles.map((profile) => profile.id) : []);
    const boundedPhotos = limitBackupPhotos(photos, validProfileIds);
    return { app: 'Forja', version: 2, exportedAt: (Number.isFinite(date.getTime()) ? date : new Date()).toISOString(), data: cleanData, photos: boundedPhotos.photos };
  }

  function toggleSyncedFavorite(data, field, stateField, id, now = new Date().toISOString()) {
    const items = Array.isArray(data[field]) ? data[field] : [];
    const active = !items.includes(id);
    data[field] = active ? [...items, id] : items.filter((entry) => entry !== id);
    data[stateField] ||= {};
    data[stateField][id] = { active, updatedAt: now };
    return active;
  }

  function estimated1RM(weight, reps) {
    const load = Number(weight) || 0;
    const count = Math.min(Math.max(Number(reps) || 0, 0), 15);
    if (load <= 0 || count <= 0) return 0;
    if (count === 1) return load;
    return load * (1 + count / 30);
  }

  function convertLoad(weight, fromUnit = 'kg', toUnit = 'kg') {
    const load = Number(weight) || 0;
    const kilograms = fromUnit === 'lb' ? load / 2.2046226218 : load;
    return toUnit === 'lb' ? kilograms * 2.2046226218 : kilograms;
  }

  function seedWorkoutSets(previousSets = [], count = 1, repTarget = 10, unit = 'kg') {
    const usable = (Array.isArray(previousSets) ? previousSets : []).filter((set) => set && set.done !== false && Number.isFinite(Number(set.reps)) && Number(set.reps) > 0);
    const targets = String(repTarget ?? '').match(/\d+/g) || [];
    const fallbackReps = Math.max(1, Math.min(100, targets.length ? Math.round(targets.map(Number).reduce((sum, value) => sum + value, 0) / targets.length) : 10));
    const total = Math.max(1, Math.min(50, Math.floor(Number(count) || 1)));
    return Array.from({ length: total }, (_, index) => {
      const previous = usable.length ? usable[Math.min(index, usable.length - 1)] : null;
      const previousWeight = Number(previous?.weight);
      const convertedWeight = Number.isFinite(previousWeight) && previousWeight > 0
        ? convertLoad(previousWeight, previous.weightUnit || 'kg', unit)
        : 0;
      const load = convertedWeight > 0 ? String(Number(Math.min(999, convertedWeight).toFixed(2))) : '';
      const rpe = Number(previous?.rpe) || 8;
      const reps = Number(previous?.reps);
      return {
        weight: load,
        reps: String(Number.isFinite(reps) && reps > 0 ? Math.min(100, reps) : fallbackReps),
        rpe: Math.max(1, Math.min(10, rpe)),
        done: false
      };
    });
  }

  function repeatWorkoutSession(workout, id, startedAt = new Date().toISOString(), unit = 'kg') {
    if (!workout || !Array.isArray(workout.exercises)) return null;
    const exercises = workout.exercises.filter((entry) => entry && typeof entry.exerciseId === 'string').map((entry) => {
      const history = Array.isArray(entry.sets) ? entry.sets : [];
      const targetSets = Math.max(1, Math.min(50, Math.floor(Number(entry.targetSets) || history.length || 1)));
      const reps = String(entry.reps || '10');
      return {
        exerciseId: entry.exerciseId,
        targetSets,
        reps,
        unit: entry.unit === 'seconds' || /s$/.test(reps) ? 'seconds' : 'reps',
        rest: Math.max(0, Math.min(600, Number(entry.rest) || 90)),
        sets: seedWorkoutSets(history, targetSets, reps, unit),
        ...(entry.supersetId ? { supersetId: entry.supersetId } : {}),
        ...(entry.replacedExerciseId ? { replacedExerciseId: entry.replacedExerciseId } : {}),
        ...(entry.replacedExerciseName ? { replacedExerciseName: entry.replacedExerciseName } : {})
      };
    });
    if (!exercises.length) return null;
    return {
      id,
      routineId: typeof workout.routineId === 'string' ? workout.routineId : null,
      name: String(workout.name || 'Sesión repetida').slice(0, 80),
      startedAt,
      updatedAt: startedAt,
      exercises
    };
  }

  function undoLastSetCompletion(session) {
    const action = session?.lastSetAction;
    const set = session?.exercises?.[action?.exerciseIndex]?.sets?.[action?.setIndex];
    if (!action || !set || !set.done || set.completedAt !== action.completedAt || !action.previousSet || typeof action.previousSet !== 'object') return false;
    for (const key of Object.keys(set)) delete set[key];
    Object.assign(set, structuredClone(action.previousSet));
    session.nextExerciseIndex = action.previousNextExerciseIndex ?? null;
    delete session.lastSetAction;
    session.updatedAt = new Date().toISOString();
    return true;
  }

  function rirFromRpe(rpe) {
    const value = Number(rpe);
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(5, Math.round(10 - value)));
  }

  function predictLoad(sessions = [], unit = 'kg') {
    const usable = (Array.isArray(sessions) ? sessions : []).filter((session) => Number(session.weight) > 0);
    if (!usable.length) return { suggested: 0, reason: 'Sin cargas registradas', canIncrease: false, rpe: null, volumeTrend: 0 };
    const recent = usable.slice(-4);
    const avgRpe = recent.reduce((sum, session) => sum + (Number(session.rpe) || 8), 0) / recent.length;
    const avgWeight = recent.reduce((sum, session) => sum + Number(session.weight), 0) / recent.length;
    const last = recent.at(-1);
    const previous = recent.slice(0, -1);
    const lastVolume = Number(last.volume) || Number(last.weight) * (Number(last.reps) || 0);
    const prevVolume = previous.length ? previous.reduce((sum, session) => sum + (Number(session.volume) || Number(session.weight) * (Number(session.reps) || 0)), 0) / previous.length : lastVolume;
    const volumeTrend = prevVolume ? (lastVolume - prevVolume) / prevVolume : 0;
    const step = unit === 'lb' ? 2.5 : 0.5;
    let factor = 1;
    let reason = 'Mantén la carga y consolida repeticiones.';
    let canIncrease = false;
    if (avgRpe <= 7.5 && volumeTrend >= -0.05) {
      factor = 1.025;
      canIncrease = true;
      reason = 'RPE moderado y volumen estable: sube la carga de forma conservadora.';
    } else if (avgRpe >= 9 || volumeTrend <= -0.12) {
      factor = 0.975;
      reason = avgRpe >= 9 ? 'El esfuerzo percibido está alto: baja o mantén la carga.' : 'El volumen reciente bajó: prioriza técnica y recuperación.';
    } else if (avgRpe <= 8.2) {
      reason = 'Cerca del rango objetivo. Suma repeticiones antes de aumentar peso.';
    }
    const suggested = Math.round((avgWeight * factor) / step) * step;
    return { suggested: Math.max(step, suggested), reason, canIncrease, rpe: Math.round(avgRpe * 10) / 10, volumeTrend: Math.round(volumeTrend * 1000) / 1000 };
  }

  function recommendProgression({ sessions = [], repRange = '8-12', unit = 'kg', targetSets = 1 } = {}) {
    const range = String(repRange).match(/\d+/g) || [];
    const low = Math.max(1, Number(range[0]) || 8), high = Math.max(low, Number(range.at(-1)) || 12);
    const step = unit === 'lb' ? 2.5 : 0.5;
    const usable = (Array.isArray(sessions) ? sessions : []).map((session, index) => ({
      session,
      order: Date.parse(session?.finishedAt || session?.date || '') || index
    })).sort((a, b) => a.order - b.order).map(({ session }) => {
      const sets = (Array.isArray(session?.sets) ? session.sets : []).filter((set) => set?.done !== false && Number(set?.weight) > 0 && Number(set?.reps) > 0);
      if (!sets.length) return null;
      return {
        sets,
        load: Math.max(...sets.map((set) => Number(set.weight))),
        averageReps: sets.reduce((sum, set) => sum + Number(set.reps), 0) / sets.length,
        averageRpe: sets.reduce((sum, set) => sum + (Number(set.rpe) || 8), 0) / sets.length,
        volume: sets.reduce((sum, set) => sum + Number(set.weight) * Number(set.reps), 0),
        qualifies: sets.length >= Math.min(Math.max(1, Number(targetSets) || 1), 2) && sets.every((set) => Number(set.reps) >= high && (Number(set.rpe) || 8) <= 8)
      };
    }).filter(Boolean).slice(-4);
    if (!usable.length) return { action: 'record', suggested: 0, targetReps: low, reason: 'Registra una sesión con carga y repeticiones para recibir una sugerencia.', confidence: 'sin datos', sessions: 0 };
    const latest = usable.at(-1), previous = usable.at(-2), twoQualifying = Boolean(previous?.qualifies && latest.qualifies);
    const volumeTrend = previous?.volume ? (latest.volume - previous.volume) / previous.volume : 0;
    let action = 'reps', suggested = latest.load, targetReps = Math.min(high, Math.max(low, Math.floor(latest.averageReps) + 1));
    let reason = 'La sesión reciente deja margen: prueba una repetición más manteniendo la técnica.';
    if (latest.averageRpe >= 9) {
      action = 'hold'; targetReps = Math.max(low, Math.min(high, Math.floor(latest.averageReps)));
      reason = `El RPE medio fue ${latest.averageRpe.toFixed(1)}: mantén la carga y deja más repeticiones en reserva.`;
    } else if (twoQualifying && volumeTrend >= -0.1) {
      action = 'increase'; suggested = Math.ceil((latest.load * 1.025) / step) * step; targetReps = low;
      reason = 'Completaste el rango alto en dos sesiones con RPE ≤ 8: sube un paso pequeño y vuelve al rango bajo.';
    } else if (latest.averageReps >= high && latest.averageRpe > 8) {
      action = 'hold'; targetReps = high;
      reason = 'Llegaste al rango alto con esfuerzo elevado: repite la carga antes de aumentarla.';
    } else if (previous && volumeTrend < -0.15) {
      action = 'hold'; suggested = latest.load; targetReps = Math.max(low, Math.floor(latest.averageReps));
      reason = 'El volumen cayó respecto a la sesión anterior: consolida la carga y revisa tu recuperación.';
    }
    return { action, suggested, targetReps, reason, confidence: usable.length >= 2 ? 'moderada' : 'inicial', sessions: usable.length, averageRpe: Math.round(latest.averageRpe * 10) / 10, volumeTrend: Math.round(volumeTrend * 1000) / 1000 };
  }

  function detectStagnation(points = [], windowSize = 3, threshold = 0.02) {
    const values = (Array.isArray(points) ? points : []).map((point) => Number(point?.value ?? point)).filter((value) => Number.isFinite(value) && value > 0);
    if (values.length < windowSize * 2) return { stalled: false, change: 0, sample: values.length };
    const recent = values.slice(-windowSize);
    const previous = values.slice(-windowSize * 2, -windowSize);
    const recentAvg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const previousAvg = previous.reduce((sum, value) => sum + value, 0) / previous.length;
    const change = previousAvg ? (recentAvg - previousAvg) / previousAvg : 0;
    return { stalled: change < threshold, change: Math.round(change * 1000) / 1000, sample: values.length, recentAvg, previousAvg };
  }

  function pearson(pairs) {
    const n = pairs.length;
    if (n < 3) return null;
    const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / n;
    const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (const [x, y] of pairs) {
      const dx = x - meanX, dy = y - meanY;
      num += dx * dy; denX += dx * dx; denY += dy * dy;
    }
    if (!denX || !denY) return 0;
    return Math.round((num / Math.sqrt(denX * denY)) * 100) / 100;
  }

  function wellnessPerformanceCorrelation(workouts = [], readiness = [], now = new Date()) {
    const byDay = new Map();
    for (const workout of completedWorkouts(workouts, now)) {
      const day = localDayKey(workout.finishedAt || workout.startedAt);
      if (!DAY.test(day)) continue;
      const volume = (workout.exercises || []).reduce((total, entry) => total + (entry.sets || []).filter((set) => set.done).reduce((sum, set) => sum + convertLoad(set.weight, set.weightUnit, 'kg') * (Number(set.reps) || 0), 0), 0);
      if (volume > 0) byDay.set(day, (byDay.get(day) || 0) + volume);
    }
    const energyPairs = [], sleepPairs = [];
    for (const entry of Array.isArray(readiness) ? readiness : []) {
      const volume = byDay.get(entry.date);
      if (!volume) continue;
      if (entry.energy != null && Number.isFinite(Number(entry.energy))) energyPairs.push([Number(entry.energy), volume]);
      if (entry.sleep != null && entry.sleep !== '' && Number.isFinite(Number(entry.sleep))) sleepPairs.push([Number(entry.sleep), volume]);
    }
    const energy = pearson(energyPairs), sleep = pearson(sleepPairs);
    let summary = 'Registra bienestar y sesiones el mismo día para ver la correlación.';
    if (energy != null || sleep != null) {
      const parts = [];
      if (energy != null) parts.push(energy >= 0.35 ? 'más energía suele coincidir con más volumen' : energy <= -0.35 ? 'el volumen no sube cuando la energía es alta' : 'la energía y el volumen no muestran un patrón claro');
      if (sleep != null) parts.push(sleep >= 0.35 ? 'dormir más se asocia a mejor rendimiento' : sleep <= -0.35 ? 'el volumen no sigue al sueño registrado' : 'el sueño y el volumen apenas se relacionan aún');
      summary = parts.join('. ') + '.';
    }
    return { energy, sleep, samples: Math.max(energyPairs.length, sleepPairs.length), summary };
  }

  function muscleVolumeSeries(workouts = [], muscleOf, weeks = 8, unit = 'kg', now = new Date()) {
    const buckets = new Map();
    const reference = now instanceof Date ? now : new Date(now);
    const weekCount = Math.max(1, Math.min(52, Math.floor(Number(weeks) || 8)));
    const currentWeekStart = calendarWeekStart(now);
    if (!currentWeekStart) return [];
    const firstWeekStart = new Date(currentWeekStart);
    firstWeekStart.setDate(firstWeekStart.getDate() - (weekCount - 1) * 7);
    const from = firstWeekStart.getTime(), until = now.getTime();
    for (const workout of completedWorkouts(workouts, now)) {
      const finished = workoutTimestamp(workout);
      if (finished < from || finished > until) continue;
      const weekStart = new Date(finished);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const key = localDayKey(weekStart);
      const bucket = buckets.get(key) || {};
      for (const entry of workout.exercises || []) {
        const muscle = typeof muscleOf === 'function' ? muscleOf(entry.exerciseId) : entry.muscle;
        if (!muscle) continue;
        const volume = (entry.sets || []).filter((set) => set.done).reduce((sum, set) => sum + convertLoad(set.weight, set.weightUnit, unit) * (Number(set.reps) || 0), 0);
        bucket[muscle] = (bucket[muscle] || 0) + volume;
      }
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, groups]) => ({ date, groups }));
  }

  function exerciseProgressSeries(workouts = [], exerciseId, metric = 'volume', unit = 'kg', now = new Date()) {
    const values = [];
    const validMetrics = new Set(['load', 'volume', 'e1rm']);
    const selectedMetric = validMetrics.has(metric) ? metric : 'volume';
    for (const workout of completedWorkouts(workouts, now).slice().sort((a, b) => workoutTimestamp(a) - workoutTimestamp(b))) {
      const entry = (workout.exercises || []).find((item) => item.exerciseId === exerciseId);
      if (!entry) continue;
      const sets = (entry.sets || []).filter((set) => set.done && Number(set.weight) > 0).map((set) => ({
        load: convertLoad(set.weight, set.weightUnit || 'kg', unit),
        reps: Number(set.reps) || 0
      }));
      if (!sets.length) continue;
      const value = selectedMetric === 'load'
        ? Math.max(...sets.map((set) => set.load))
        : selectedMetric === 'e1rm'
          ? Math.max(...sets.map((set) => estimated1RM(set.load, set.reps)))
          : sets.reduce((sum, set) => sum + set.load * set.reps, 0);
      const date = workout.finishedAt || workout.startedAt;
      if (value > 0 && Number.isFinite(Date.parse(date || ''))) values.push({ date, value });
    }
    return values;
  }

  function trainingIntelligence({ workouts = [], preferences = {}, readiness = [], block = {}, now = new Date() } = {}) {
    const daysPerWeek = Number(preferences.daysPerWeek) || 3;
    const reference = now instanceof Date ? now : new Date(now);
    const currentWeekStart = calendarWeekStart(reference);
    if (!currentWeekStart) return { frequencyScore: 0, thisWeekSessions: 0, daysPerWeek, thisVolume: 0, lastVolume: 0, volumeTrend: 0, consistencyDays: 0, stagnation: { stalled: false, change: 0, sample: 0 }, stagnationByExercise: [], wellness: wellnessPerformanceCorrelation([], []), suggestions: [], deload: Boolean(block.deload) };
    const currentStart = currentWeekStart.getTime();
    const comparisonStartDate = new Date(currentWeekStart);
    comparisonStartDate.setDate(comparisonStartDate.getDate() - 7);
    const comparisonEndDate = new Date(reference);
    comparisonEndDate.setDate(comparisonEndDate.getDate() - 7);
    const fourWeekStartDate = new Date(currentWeekStart);
    fourWeekStartDate.setDate(fourWeekStartDate.getDate() - 21);
    const comparisonStart = comparisonStartDate.getTime();
    const comparisonEnd = comparisonEndDate.getTime();
    const fourWeekStart = fourWeekStartDate.getTime();
    const allCompleted = completedWorkouts(workouts, reference);
    const recent = allCompleted.filter((workout) => workoutTimestamp(workout) >= fourWeekStart);
    const thisWeek = recent.filter((workout) => workoutTimestamp(workout) >= currentStart);
    const lastWeek = allCompleted.filter((workout) => workoutTimestamp(workout) >= comparisonStart && workoutTimestamp(workout) < comparisonEnd);
    const volume = (list) => list.reduce((total, workout) => total + (workout.exercises || []).reduce((sum, entry) => sum + (entry.sets || []).filter((set) => set.done).reduce((inner, set) => inner + convertLoad(set.weight, set.weightUnit, 'kg') * (Number(set.reps) || 0), 0), 0), 0);
    const thisVolume = volume(thisWeek), lastVolume = volume(lastWeek);
    const frequencyScore = Math.min(1, thisWeek.length / Math.max(1, daysPerWeek));
    const consistencyDays = new Set(recent.map((workout) => localDayKey(workout.finishedAt)).filter(Boolean)).size;
    const volumeTrend = lastVolume ? (thisVolume - lastVolume) / lastVolume : 0;
    const pointsByExercise = new Map();
    for (const workout of allCompleted.slice().sort((a, b) => workoutTimestamp(a) - workoutTimestamp(b))) {
      for (const entry of workout.exercises || []) {
        const best = (entry.sets || []).filter((set) => set.done)
          .reduce((value, set) => Math.max(value, estimated1RM(convertLoad(set.weight, set.weightUnit, 'kg'), set.reps)), 0);
        if (!best) continue;
        const points = pointsByExercise.get(entry.exerciseId) || [];
        points.push({ date: workout.finishedAt, value: best });
        pointsByExercise.set(entry.exerciseId, points);
      }
    }
    const stagnationByExercise = [...pointsByExercise.entries()].map(([exerciseId, points]) => ({
      exerciseId, ...detectStagnation(points)
    }));
    const stalledExercises = stagnationByExercise.filter((entry) => entry.stalled)
      .sort((a, b) => a.change - b.change);
    const stagnation = stalledExercises[0] || {
      stalled: false,
      change: 0,
      sample: Math.max(0, ...stagnationByExercise.map((entry) => entry.sample))
    };
    const wellness = wellnessPerformanceCorrelation(allCompleted, readiness, reference);
    const suggestions = [];
    if (frequencyScore < 0.7) suggestions.push({ kind: 'frequency', text: `Llevas ${thisWeek.length} de ${daysPerWeek} sesiones esta semana. Un hueco corto hoy mantiene la frecuencia.` });
    else suggestions.push({ kind: 'frequency', text: `Frecuencia al día: ${thisWeek.length}/${daysPerWeek} sesiones esta semana.` });
    if (!lastVolume) suggestions.push({ kind: 'volume', text: 'Aún no hay una semana anterior con volumen registrado para comparar. Sigue registrando sesiones con carga para crear una referencia.' });
    else if (volumeTrend < -0.15) suggestions.push({ kind: 'volume', text: 'El volumen de este tramo bajó más de un 15% frente al mismo tramo anterior. Recupera series o reduce el RPE en vez de forzar la carga.' });
    else if (volumeTrend > 0.2) suggestions.push({ kind: 'volume', text: 'El volumen del tramo actual subió más de un 20% frente al tramo comparable anterior. Conserva técnica y deja repeticiones en reserva.' });
    else suggestions.push({ kind: 'volume', text: 'El volumen va estable frente al mismo tramo de la semana anterior. Sigue progresando por repeticiones o pequeños saltos de carga.' });
    if (stagnation.stalled) suggestions.push({ kind: 'stagnation', text: 'Posible estancamiento en la fuerza estimada. Cambia el rango de repeticiones o programa una descarga.' });
    if (block.deload) suggestions.push({ kind: 'deload', text: 'Semana de descarga automática: Forja ya redujo las series planificadas para facilitar la recuperación.' });
    const hourBuckets = recent.reduce((counts, workout) => {
      const hour = new Date(workout.finishedAt || workout.startedAt).getHours();
      if (Number.isFinite(hour)) {
        const bucket = hour < 12 ? 'mañana' : hour < 18 ? 'tarde' : 'noche';
        counts[bucket] = (counts[bucket] || 0) + 1;
      }
      return counts;
    }, {});
    const preferredTime = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0];
    if (recent.length >= 4 && preferredTime) suggestions.push({ kind: 'schedule', text: `Tu horario más frecuente en las últimas 4 semanas fue la ${preferredTime[0]} (${preferredTime[1]} de ${recent.length} sesiones).` });
    else suggestions.push({ kind: 'schedule', text: `Aún faltan sesiones con hora registrada (${recent.length}/4 en las últimas 4 semanas) para sugerir un horario propio.` });
    if (consistencyDays >= 8) suggestions.push({ kind: 'variation', text: 'Buena constancia de 4 semanas. Introduce una variante del movimiento principal para seguir progresando.' });
    return {
      frequencyScore, thisWeekSessions: thisWeek.length, daysPerWeek, thisVolume, lastVolume, volumeTrend,
      consistencyDays, stagnation, stagnationByExercise, wellness, suggestions, deload: Boolean(block.deload)
    };
  }

  const api = {
    mergeCloudDatabases, normalizeBackup, createBackup, normalizeTimerSnapshot, toggleSyncedFavorite, unionBy,
    estimated1RM, convertLoad, rirFromRpe, seedWorkoutSets, repeatWorkoutSession, undoLastSetCompletion, predictLoad, recommendProgression, detectStagnation, wellnessPerformanceCorrelation,
    workoutTimestamp, completedWorkouts, calendarWeekStart, workoutsInCalendarWeek, countChallengeSessions, trainingBlockState, claimDueReminders, isQuietHours, retainDailyBackups, suggestRoutineIds, limitBackupPhotos,
    exerciseProgressSeries, muscleVolumeSeries, trainingIntelligence
  };
  root.ForjaCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
