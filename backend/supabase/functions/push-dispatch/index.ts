import { createClient } from 'npm:@supabase/supabase-js@2';
import webPush from 'npm:web-push@3.6.7';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const cronSecret = Deno.env.get('FORJA_CRON_SECRET');
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!cronSecret || request.headers.get('x-forja-cron-secret') !== cronSecret) return new Response('Unauthorized', { status: 401 });
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) return new Response('Push service configuration is incomplete', { status: 503 });

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: rows, error } = await supabase.from('push_subscriptions').select('endpoint,subscription,schedule,timezone,last_sent').eq('enabled', true).limit(1000);
  if (error) return new Response('Could not load subscriptions', { status: 500 });

  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>;
  let sent = 0, skipped = 0, expired = 0;
  for (const row of rows || []) {
    try {
      const timezone = row.timezone || 'UTC';
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
      const part = (type: string) => parts.find((p) => p.type === type)?.value || '';
      const day = weekday[part('weekday')], time = `${part('hour')}:${part('minute')}`;
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      const days: number[] = Array.isArray(row.schedule?.days) ? row.schedule.days.map(Number) : [];
      const snoozedUntil = Date.parse(row.schedule?.snoozed_until || '');
      const quiet: { enabled?: boolean; start?: string; end?: string } = row.schedule?.quiet_hours || {};
      const minuteOfDay = Number(part('hour')) * 60 + Number(part('minute'));
      const parseMinute = (value: unknown) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
        ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null;
      const quietStart = parseMinute(quiet.start), quietEnd = parseMinute(quiet.end);
      const inQuietHours = Boolean(quiet.enabled && quietStart !== null && quietEnd !== null && quietStart !== quietEnd
        && (quietStart < quietEnd ? minuteOfDay >= quietStart && minuteOfDay < quietEnd : minuteOfDay >= quietStart || minuteOfDay < quietEnd));
      // A minute miss from pg_cron or a snooze should defer delivery, not lose the reminder.
      const scheduledTime = typeof row.schedule?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.schedule.time) ? row.schedule.time : '18:00';
      if (!days.includes(day) || time < scheduledTime || row.last_sent === localDate
        || (Number.isFinite(snoozedUntil) && snoozedUntil > now.getTime()) || inQuietHours) { skipped++; continue; }
      await webPush.sendNotification(row.subscription, JSON.stringify({ title: 'Hora de entrenar · Forja', body: 'Tu sesión te espera. Abre Forja cuando estés listo.', url: './' }), { TTL: 120, urgency: 'normal' });
      await supabase.from('push_subscriptions').update({ last_sent: localDate, updated_at: new Date().toISOString() }).eq('endpoint', row.endpoint);
      sent++;
    } catch (error) {
      const status = Number((error as { statusCode?: number })?.statusCode || 0);
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').update({ enabled: false, updated_at: new Date().toISOString() }).eq('endpoint', row.endpoint);
        expired++;
      } else {
        console.error('Forja push delivery failed', status || 'unknown');
      }
    }
  }
  return Response.json({ sent, skipped, expired });
});
