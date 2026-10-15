'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ForjaCore = require('../forja-core.js');

function database(workouts = [], readiness = [], favorites = [], favoriteState = {}) {
  return {
    version: 2,
    currentProfile: 'profile-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    profiles: [{
      id: 'profile-1', name: 'Atleta', data: {
        workouts, readiness, favorites, favoriteState,
        favoriteRoutines: [], favoriteRoutineState: {}, customRoutines: [], goals: [], challenges: [], measurements: []
      }
    }]
  };
}

test('merge keeps workouts added on either device and chooses the newer edit', () => {
  const local = database([
    { id: 'local', name: 'Local', finishedAt: '2026-01-01T10:00:00Z' },
    { id: 'same', name: 'Edición local', updatedAt: '2026-01-03T10:00:00Z' }
  ]);
  const remote = database([
    { id: 'remote', name: 'Nube', finishedAt: '2026-01-02T10:00:00Z' },
    { id: 'same', name: 'Edición nube', updatedAt: '2026-01-04T10:00:00Z' }
  ]);
  const merged = ForjaCore.mergeCloudDatabases(local, remote).profiles[0].data.workouts;
  assert.deepEqual(new Set(merged.map((workout) => workout.id)), new Set(['local', 'remote', 'same']));
  assert.equal(merged.find((workout) => workout.id === 'same').name, 'Edición nube');
});

test('merge carries a favorite removal to another device', () => {
  const local = database([], [], [], { 'db-bench': { active: false, updatedAt: '2026-01-03T10:00:00Z' } });
  const remote = database([], [], ['db-bench'], {});
  const result = ForjaCore.mergeCloudDatabases(local, remote).profiles[0].data;
  assert.deepEqual(result.favorites, []);
  assert.equal(result.favoriteState['db-bench'].active, false);
});

test('same-day readiness records resolve by last edit', () => {
  const local = database([], [{ date: '2026-01-03', sleep: 6, energy: 2, soreness: 4, updatedAt: '2026-01-03T08:00:00Z' }]);
  const remote = database([], [{ date: '2026-01-03', sleep: 8, energy: 4, soreness: 1, updatedAt: '2026-01-03T09:00:00Z' }]);
  const result = ForjaCore.mergeCloudDatabases(local, remote).profiles[0].data.readiness;
  assert.equal(result.length, 1);
  assert.equal(result[0].sleep, 8);
});

test('backup normalization rejects malformed data and sanitizes imported routine content', () => {
  assert.throws(() => ForjaCore.normalizeBackup({ app: 'Forja', data: { profiles: [] } }), /Formato/);
  const maliciousState = JSON.parse('{"__proto__":{"active":true}}');
  const result = ForjaCore.normalizeBackup({
    app: 'Forja', version: 2,
    data: { currentProfile: 'profile-1', profiles: [{
      id: 'profile-1', name: 'Atleta', data: {
        customRoutines: [{ id: 'custom-one', name: 'Rutina', icon: '<img src=x onerror=alert(1)>', exercises: [['db-bench', 3, '8–12']] }],
        favorites: [], favoriteState: maliciousState
      }
    }] }
  });
  const profile = result.data.profiles[0];
  assert.equal(profile.data.customRoutines[0].icon, '✳');
  assert.equal(Object.hasOwn(profile.data.favoriteState, '__proto__'), false);
});

test('backup accepts only bounded local image data URLs', () => {
  const base = { app: 'Forja', data: { profiles: [{ id: 'profile-1', name: 'Atleta', data: {} }] } };
  assert.throws(() => ForjaCore.normalizeBackup({ ...base, photos: [{ profileId: 'profile-1', dataUrl: 'https://example.test/photo.jpg' }] }), /Fotos/);
  const result = ForjaCore.normalizeBackup({ ...base, photos: [{ id: 'p1', profileId: 'profile-1', date: '2026-01-01', dataUrl: 'data:image/jpeg;base64,AA==' }] });
  assert.equal(result.photos[0].mime, 'image/jpeg');
});

const localIso = (year, month, day, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();
const workout = (id, finishedAt, { exerciseId = 'db-bench', weight = 50, reps = 8, unit = 'kg', done = true } = {}) => ({
  id, startedAt: finishedAt, finishedAt, exercises: [{ exerciseId, sets: [{ weight, reps, weightUnit: unit, done }] }]
});

test('calendar week starts Monday and includes only sessions up to the supplied moment', () => {
  const now = new Date(2026, 9, 15, 12);
  const sessions = [
    workout('sunday', localIso(2026, 10, 11, 23, 59)),
    workout('monday', localIso(2026, 10, 12, 0, 0)),
    workout('today', localIso(2026, 10, 15, 11, 59)),
    workout('later', localIso(2026, 10, 15, 12, 1)),
    workout('tomorrow', localIso(2026, 10, 16))
  ];
  assert.equal(ForjaCore.calendarWeekStart(now).getDay(), 1);
  assert.deepEqual(ForjaCore.workoutsInCalendarWeek(sessions, now).map((session) => session.id), ['monday', 'today']);
});

test('intelligence compares calendar weeks consistently and ignores future workouts', () => {
  const now = new Date(2026, 9, 15, 12);
  const sessions = [
    workout('last-monday', localIso(2026, 10, 5)),
    workout('last-wednesday', localIso(2026, 10, 7)),
    workout('this-monday', localIso(2026, 10, 12)),
    workout('future-friday', localIso(2026, 10, 16))
  ];
  const intel = ForjaCore.trainingIntelligence({ workouts: sessions, preferences: { daysPerWeek: 3 }, now });
  assert.equal(intel.thisWeekSessions, 1);
  assert.equal(intel.thisVolume, 400);
  assert.equal(intel.lastVolume, 800);
  assert.equal(intel.volumeTrend, -0.5);
  assert.equal(intel.consistencyDays, 3);
  assert.equal(ForjaCore.workoutsInCalendarWeek(sessions, now).length, intel.thisWeekSessions);
});

test('volume suggestions ask for a baseline until a prior week has recorded volume', () => {
  const now = new Date(2026, 9, 15, 12);
  const volumeSuggestion = (workouts) => ForjaCore.trainingIntelligence({ workouts, now }).suggestions.find((item) => item.kind === 'volume').text;
  assert.match(volumeSuggestion([]), /semana anterior con volumen registrado/);
  assert.match(volumeSuggestion([workout('this-week', localIso(2026, 10, 12))]), /semana anterior con volumen registrado/);
  assert.match(volumeSuggestion([
    workout('last-week', localIso(2026, 10, 5)),
    workout('this-week', localIso(2026, 10, 12))
  ]), /volumen va estable frente al mismo tramo/);
});

test('completed workout filters reject invalid and future dates but preserve legacy start dates', () => {
  const now = new Date(2026, 9, 15, 12);
  const result = ForjaCore.completedWorkouts([
    { id: 'legacy', startedAt: localIso(2026, 10, 14) },
    { id: 'future', finishedAt: localIso(2026, 10, 16) },
    { id: 'invalid', finishedAt: 'not-a-date' }
  ], now);
  assert.deepEqual(result.map((session) => session.id), ['legacy']);
  assert.deepEqual(ForjaCore.completedWorkouts([{ id: 'legacy', startedAt: localIso(2026, 10, 14) }], now.getTime()).map((session) => session.id), ['legacy']);
});

test('challenge deadline includes the full due date, honors its start and excludes future sessions', () => {
  const sessions = [
    workout('before-start', localIso(2026, 10, 12)),
    workout('start', localIso(2026, 10, 13)),
    workout('last-millisecond', new Date(2026, 9, 15, 23, 59, 59, 999).toISOString()),
    { id: 'legacy', startedAt: localIso(2026, 10, 14), exercises: [] },
    workout('after-deadline', localIso(2026, 10, 16, 0, 1)),
    workout('future', localIso(2026, 10, 16, 18))
  ];
  assert.equal(ForjaCore.countChallengeSessions(sessions, localIso(2026, 10, 13), '2026-10-15', new Date(2026, 9, 16, 12)), 3);
  assert.equal(ForjaCore.countChallengeSessions([...sessions, workout('later-today', localIso(2026, 10, 15, 18))], '2026-10-13', '2026-10-15', new Date(2026, 9, 15, 12)), 2);
});

test('muscle-volume chart uses eight Monday-based weeks and excludes future or older sessions', () => {
  const now = new Date(2026, 9, 15, 12);
  const sessions = [
    workout('inside', localIso(2026, 9, 1), { weight: 20, reps: 10 }),
    workout('older', localIso(2026, 8, 23), { weight: 100, reps: 10 }),
    workout('future', localIso(2026, 10, 16), { weight: 1000, reps: 10 })
  ];
  const series = ForjaCore.muscleVolumeSeries(sessions, () => 'chest', 8, 'kg', now);
  assert.deepEqual(series.map((week) => week.date), ['2026-08-31']);
  assert.equal(series[0].groups.chest, 200);
});

test('exercise charts calculate load, volume and estimated 1RM from completed sets only', () => {
  const now = new Date(2026, 9, 15, 12);
  const sessions = [
    workout('first', localIso(2026, 10, 12), { weight: 100, reps: 5, unit: 'lb' }),
    workout('second', localIso(2026, 10, 14), { weight: 50, reps: 6 }),
    workout('future', localIso(2026, 10, 16), { weight: 1000, reps: 10 })
  ];
  sessions[0].exercises[0].sets.push({ weight: 500, reps: 10, weightUnit: 'kg', done: false });
  const load = ForjaCore.exerciseProgressSeries(sessions, 'db-bench', 'load', 'kg', now);
  const volume = ForjaCore.exerciseProgressSeries(sessions, 'db-bench', 'volume', 'kg', now);
  const e1rm = ForjaCore.exerciseProgressSeries(sessions, 'db-bench', 'e1rm', 'kg', now);
  assert.equal(load.length, 2);
  assert.ok(Math.abs(load[0].value - 45.359) < 0.01);
  assert.equal(volume[1].value, 300);
  assert.equal(e1rm[1].value, 60);
});

test('training-block deload starts on the configured final week and rolls over safely', () => {
  const block = { weeks: 4, startedAt: '2026-01-05' };
  assert.deepEqual(ForjaCore.trainingBlockState(block, 4, new Date(2026, 0, 25)), { weeks: 4, week: 3, deload: false, phase: 'Construcción' });
  assert.deepEqual(ForjaCore.trainingBlockState(block, 4, new Date(2026, 0, 26)), { weeks: 4, week: 4, deload: true, phase: 'Descarga' });
  assert.equal(ForjaCore.trainingBlockState(block, 4, new Date(2026, 1, 2)).week, 1);
  assert.equal(ForjaCore.trainingBlockState({ weeks: 6, startedAt: '2026-03-01' }, 4, new Date(2026, 0, 1)).week, 1);
});

test('reminders respect local weekday/time, fire once daily and suppress local workout toast when push is active', () => {
  const now = new Date(2026, 9, 15, 18, 5);
  const reminders = {
    workout: { enabled: true, time: '18:00', days: [now.getDay()], lastSent: '' },
    hydration: { enabled: true, time: '18:00', days: [now.getDay()], lastSent: '' },
    sleep: { enabled: true, time: '22:00', days: [now.getDay()], lastSent: '' },
    nutrition: { enabled: true, time: '17:00', days: [(now.getDay() + 1) % 7], lastSent: '' }
  };
  assert.deepEqual(ForjaCore.claimDueReminders(reminders, now, true), { due: ['hydration'], claimed: ['workout', 'hydration'] });
  assert.deepEqual(ForjaCore.claimDueReminders(reminders, now, true), { due: [], claimed: [] });
  const beforeTime = { sleep: { enabled: true, time: '22:00', days: [now.getDay()], lastSent: '' } };
  assert.deepEqual(ForjaCore.claimDueReminders(beforeTime, now), { due: [], claimed: [] });
});

test('backup export strips sync credentials and round-trips profiles, reminders, workouts and photos', () => {
  const source = database([workout('session-one', localIso(2026, 10, 12))]);
  source.syncConfig = { url: 'https://private.supabase.co', key: 'secret' };
  source.syncSession = { access_token: 'token' };
  source.push = { endpoint: 'private-endpoint' };
  source.localDeviceId = 'device-secret';
  source.profiles[0].data.reminders = { hydration: { enabled: true, time: '11:00', days: [1] } };
  const backup = ForjaCore.createBackup(source, [{ id: 'photo-1', profileId: 'profile-1', date: '2026-10-12', dataUrl: 'data:image/png;base64,AA==' }], new Date(2026, 9, 15));
  assert.equal(source.syncConfig.key, 'secret');
  assert.equal(Object.hasOwn(backup.data, 'syncConfig'), false);
  assert.equal(Object.hasOwn(backup.data, 'syncSession'), false);
  assert.equal(Object.hasOwn(backup.data, 'push'), false);
  const restored = ForjaCore.normalizeBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(restored.data.profiles[0].data.workouts[0].id, 'session-one');
  assert.equal(restored.data.profiles[0].data.reminders.hydration.enabled, true);
  assert.equal(restored.photos[0].id, 'photo-1');
});

test('backup photo export filters orphaned, unsupported, oversized and excess photos', () => {
  const bounded = ForjaCore.limitBackupPhotos([
    { id: 'valid', profileId: 'p1', date: '2026-10-12', dataUrl: 'data:image/png;base64,AA==' },
    { id: 'orphan', profileId: 'deleted-profile', dataUrl: 'data:image/png;base64,AA==' },
    { id: 'unsupported', profileId: 'p1', dataUrl: 'data:image/svg+xml;base64,AA==' },
    { id: 'large', profileId: 'p1', dataUrl: 'data:image/jpeg;base64,AAAAAAAA' },
    { id: 'over-count', profileId: 'p1', dataUrl: 'data:image/jpeg;base64,AA==' }
  ], new Set(['p1']), { maxCount: 1, maxPhotoChars: 30, maxTotalChars: 30 });
  assert.deepEqual(bounded.photos.map((photo) => photo.id), ['valid']);
  assert.equal(bounded.skipped, 4);
  const exported = ForjaCore.createBackup({ profiles: [{ id: 'p1' }] }, [
    { id: 'valid', profileId: 'p1', dataUrl: 'data:image/png;base64,AA==' },
    { id: 'orphan', profileId: 'p2', dataUrl: 'data:image/png;base64,AA==' }
  ]);
  assert.deepEqual(exported.photos.map((photo) => photo.id), ['valid']);
});

test('backup restore rejects unsupported photo payloads without mutating the original backup', () => {
  const payload = { app: 'Forja', data: { profiles: [{ id: 'p1', name: 'Atleta', data: {} }] }, photos: [{ id: 'p', profileId: 'p1', dataUrl: 'data:image/png;base64,AA==' }] };
  const serialized = JSON.stringify(payload);
  assert.throws(() => ForjaCore.normalizeBackup({ ...payload, photos: [{ ...payload.photos[0], dataUrl: 'data:image/svg+xml;base64,AA==' }] }), /Fotos/);
  assert.equal(JSON.stringify(payload), serialized);
});

test('quiet hours handle overnight ranges and ignore invalid or equal boundaries', () => {
  const insideLate = new Date(2026, 0, 5, 23, 30);
  const insideEarly = new Date(2026, 0, 6, 6, 59);
  const outside = new Date(2026, 0, 6, 7, 0);
  const quiet = { enabled: true, start: '22:00', end: '07:00' };
  assert.equal(ForjaCore.isQuietHours(quiet, insideLate), true);
  assert.equal(ForjaCore.isQuietHours(quiet, insideEarly), true);
  assert.equal(ForjaCore.isQuietHours(quiet, outside), false);
  assert.equal(ForjaCore.isQuietHours({ enabled: true, start: '07:00', end: '07:00' }, insideLate), false);
  assert.equal(ForjaCore.isQuietHours({ enabled: true, start: '25:00', end: '07:00' }, insideLate), false);
});

test('reminder claims honor quiet hours and defer a snoozed reminder until the pause expires', () => {
  const now = new Date(2026, 0, 5, 18, 15);
  const workout = { workout: { enabled: true, time: '18:00', days: [now.getDay()], lastSent: '' } };
  workout.quietHours = { enabled: true, start: '18:00', end: '19:00' };
  assert.deepEqual(ForjaCore.claimDueReminders(workout, now), { due: [], claimed: [] });
  workout.quietHours.enabled = false;
  workout.snoozedUntil = new Date(now.getTime() + 30 * 60000).toISOString();
  assert.deepEqual(ForjaCore.claimDueReminders(workout, now), { due: [], claimed: [] });
  const resumed = new Date(now.getTime() + 31 * 60000);
  assert.deepEqual(ForjaCore.claimDueReminders(workout, resumed), { due: ['workout'], claimed: ['workout'] });
});

test('progression needs two complete easy top-range sessions before raising the load', () => {
  const makeSession = (finishedAt, rpe = 8, reps = 12, weight = 40) => ({ finishedAt, sets: [1,2,3].map(() => ({ weight, reps, rpe, done: true })) });
  const safe = ForjaCore.recommendProgression({ sessions: [makeSession('2026-01-01'), makeSession('2026-01-08')], repRange: '8–12', unit: 'kg', targetSets: 3 });
  assert.equal(safe.action, 'increase');
  assert.equal(safe.suggested, 41);
  assert.match(safe.reason, /dos sesiones/);
  const single = ForjaCore.recommendProgression({ sessions: [makeSession('2026-01-08')], repRange: '8-12', unit: 'kg', targetSets: 3 });
  assert.equal(single.action, 'reps');
  const hard = ForjaCore.recommendProgression({ sessions: [makeSession('2026-01-01'), makeSession('2026-01-08', 9.5)], repRange: '8-12', unit: 'kg', targetSets: 3 });
  assert.equal(hard.action, 'hold');
  assert.equal(hard.suggested, 40);
  assert.match(hard.reason, /RPE medio/);
  assert.equal(ForjaCore.recommendProgression({ sessions: [{ sets: [{ weight: 'bad', reps: 0 }] }] }).action, 'record');
});

test('workout set seeding carries the previous session across units and resets completion', () => {
  const sets = ForjaCore.seedWorkoutSets([
    { weight: 100, weightUnit: 'lb', reps: 10, rpe: 7, done: true },
    { weight: 105, weightUnit: 'lb', reps: 8, rpe: 9, done: true },
    { weight: 200, weightUnit: 'lb', reps: 2, done: false }
  ], 3, '8–12', 'kg');
  assert.equal(sets.length, 3);
  assert.ok(Math.abs(Number(sets[0].weight) - 45.36) < 0.01);
  assert.equal(sets[0].reps, '10');
  assert.equal(sets[1].reps, '8');
  assert.equal(sets[2].reps, '8');
  assert.deepEqual(sets.map((set) => set.done), [false, false, false]);
  assert.equal(sets[1].rpe, 9);
  assert.equal(ForjaCore.seedWorkoutSets([], 2, '8–12', 'kg')[0].reps, '10');
  assert.deepEqual(ForjaCore.seedWorkoutSets([{ weight: 'Infinity', reps: 'Infinity', done: true }], 1, '999', 'kg'), [
    { weight: '', reps: '100', rpe: 8, done: false }
  ]);
});

test('repeating a workout resets finished state while preserving exercise structure', () => {
  const previous = {
    id: 'old', routineId: 'custom', name: 'Torso', finishedAt: '2026-01-01T10:00:00Z',
    exercises: [{ exerciseId: 'db-bench', reps: '8–12', targetSets: 2, rest: 90, supersetId: 'pair-1', notes: 'pausa', sets: [
      { weight: 40, weightUnit: 'kg', reps: 12, rpe: 8, done: true, completedAt: '2026-01-01T10:10:00Z' },
      { weight: 40, weightUnit: 'kg', reps: 10, rpe: 9, done: true }
    ] }]
  };
  const repeated = ForjaCore.repeatWorkoutSession(previous, 'new', '2026-01-08T10:00:00Z', 'lb');
  assert.equal(repeated.id, 'new');
  assert.equal(repeated.name, 'Torso');
  assert.equal(repeated.exercises[0].supersetId, 'pair-1');
  assert.equal(repeated.exercises[0].sets[0].reps, '12');
  assert.ok(Math.abs(Number(repeated.exercises[0].sets[0].weight) - 88.18) < 0.02);
  assert.ok(repeated.exercises[0].sets.every((set) => !set.done && !set.completedAt));
  assert.equal(ForjaCore.repeatWorkoutSession({ exercises: [] }, 'empty'), null);
});

test('undo reverts only the last unchanged set completion and restores next exercise', () => {
  const session = {
    nextExerciseIndex: 1,
    exercises: [{ sets: [{ weight: '60', weightUnit: 'kg', reps: 8, rpe: 8, done: true, completedAt: 'now' }] }],
    lastSetAction: { exerciseIndex: 0, setIndex: 0, completedAt: 'now', previousSet: { weight: '55', reps: '10', rpe: 7, done: false }, previousNextExerciseIndex: 0 }
  };
  assert.equal(ForjaCore.undoLastSetCompletion(session), true);
  assert.deepEqual(session.exercises[0].sets[0], { weight: '55', reps: '10', rpe: 7, done: false });
  assert.equal(session.nextExerciseIndex, 0);
  assert.equal(Object.hasOwn(session, 'lastSetAction'), false);
  const stale = { exercises: [{ sets: [{ done: true, completedAt: 'later' }] }], lastSetAction: { exerciseIndex: 0, setIndex: 0, completedAt: 'before', previousSet: {} } };
  assert.equal(ForjaCore.undoLastSetCompletion(stale), false);
});

test('personal schedule suggestions wait for four recent completed sessions', () => {
  const now = new Date(2026, 9, 15, 12);
  const sessions = [
    workout('a', localIso(2026, 10, 1, 8)), workout('b', localIso(2026, 10, 4, 9)),
    workout('c', localIso(2026, 10, 8, 8)), workout('d', localIso(2026, 10, 12, 9)),
    workout('future', localIso(2026, 10, 16, 8))
  ];
  const schedule = (items) => ForjaCore.trainingIntelligence({ workouts: items, now }).suggestions.find((item) => item.kind === 'schedule').text;
  assert.match(schedule(sessions.slice(0, 3)), /3\/4/);
  assert.match(schedule(sessions), /mañana/);
  assert.doesNotMatch(schedule(sessions), /future/);
});

test('routine suggestions return stable templates for supported training frequencies', () => {
  assert.deepEqual(ForjaCore.suggestRoutineIds('strength', 2), ['strength-base', 'fb-machine']);
  assert.deepEqual(ForjaCore.suggestRoutineIds('general', 3), ['fb-starter', 'fb-machine', 'fb-dumbbell']);
  assert.deepEqual(ForjaCore.suggestRoutineIds('hypertrophy', 4), ['upper-a', 'lower-a', 'upper-b', 'lower-b']);
  assert.deepEqual(ForjaCore.suggestRoutineIds('general', 5), ['ppl-push', 'ppl-pull', 'ppl-legs', 'upper-b', 'lower-b']);
  assert.equal(ForjaCore.suggestRoutineIds('general', 99).length, 6);
});

test('daily backup retention keeps the newest seven days and never overwrites an existing day', () => {
  const older = Array.from({ length: 9 }, (_, index) => ({ date: `2026-01-${String(index + 1).padStart(2,'0')}`, snapshot: { value: index } }));
  const retained = ForjaCore.retainDailyBackups(older, '2026-01-10', { value: 10 }, 7);
  assert.deepEqual(retained.map((entry) => entry.date), ['2026-01-10','2026-01-09','2026-01-08','2026-01-07','2026-01-06','2026-01-05','2026-01-04']);
  assert.equal(ForjaCore.retainDailyBackups([{ date: '2026-01-10', snapshot: { value: 1 } }], '2026-01-10', { value: 2 })[0].snapshot.value, 1);
  assert.deepEqual(ForjaCore.retainDailyBackups([], 'bad-date', { value: 1 }), []);
  assert.deepEqual(ForjaCore.retainDailyBackups([], '2026-02-30', { value: 1 }), []);
});

test('backup normalization preserves safe accessibility preferences and quiet reminder settings', () => {
  const payload = ForjaCore.createBackup(database());
  payload.data.accessibility = { fontScale: 125, highContrast: true, reduceMotion: true, largeTargets: true };
  payload.data.profiles[0].data.reminders = { workout: { enabled: true, time: '18:00', days: [1,3,5] }, quietHours: { enabled: true, start: '21:30', end: '06:30' }, snoozedUntil: '2026-01-01T20:00:00.000Z' };
  const restored = ForjaCore.normalizeBackup(payload);
  assert.equal(restored.data.accessibility.fontScale, 125);
  assert.equal(restored.data.accessibility.highContrast, true);
  assert.deepEqual(restored.data.profiles[0].data.reminders.quietHours, { enabled: true, start: '21:30', end: '06:30' });
  assert.equal(restored.data.profiles[0].data.reminders.snoozedUntil, '2026-01-01T20:00:00.000Z');
});

test('rest timer restores elapsed time, preserves a pause and rejects unsafe snapshots', () => {
  const now = 10_000_000;
  const running = ForjaCore.normalizeTimerSnapshot({ duration: 90_000, deadline: now + 45_000, remaining: 90_000, paused: false, label: 'Descanso <serie>' }, now);
  assert.equal(running.remaining, 45_000);
  assert.equal(running.paused, false);
  assert.equal(running.label, 'Descanso serie');

  const paused = ForjaCore.normalizeTimerSnapshot({ duration: 90_000, deadline: now - 50_000, remaining: 30_000, paused: true, label: 'Pausa' }, now);
  assert.equal(paused.remaining, 30_000);
  assert.equal(paused.deadline, now + 30_000);
  assert.equal(paused.paused, true);

  const expired = ForjaCore.normalizeTimerSnapshot({ duration: 90_000, deadline: now - 5_000, paused: false, label: 'Descanso' }, now);
  assert.equal(expired.remaining, 0);
  assert.equal(expired.paused, true);
  assert.equal(ForjaCore.normalizeTimerSnapshot({ duration: 0, deadline: now + 1000, paused: false }, now), null);
  assert.equal(ForjaCore.normalizeTimerSnapshot({ duration: 60_000, remaining: 'bad', paused: true }, now), null);
});
