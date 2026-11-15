// NiKo: verschickt Push-Benachrichtigungen.
// Wird nur von der Datenbank aufgerufen (pg_net). Die Datenbank schickt die Empfänger
// und den Text mit, diese Funktion verschlüsselt und versendet nur.
//
// Geheimnisse (Edge Functions > Secrets):
//   VAPID_PRIVATE_KEY  privater Push-Schlüssel
//   NIKO_HOOK_SECRET   gleiches Geheimnis wie in der Tabelle niko_config (push_secret)

import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = 'BM6DbjbfibqyQfxiqVLd4jMCaguQcADzycOXU5Fcz19dAczJdg58j7r-S5zf-lVoGFkRqeU7Xp1bAp-mIDhbgkw';
const VAPID_SUBJECT = 'https://dynamikeb7.github.io/niko/';

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };
type Payload = {
  secret?: string;
  subscriptions?: Sub[];
  notification?: { title: string; body: string; url: string; tag?: string };
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('nur POST', { status: 405 });

  const secret = Deno.env.get('NIKO_HOOK_SECRET');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!secret || !privateKey) return new Response('Geheimnisse fehlen', { status: 500 });

  let data: Payload;
  try {
    data = await req.json();
  } catch {
    return new Response('kein JSON', { status: 400 });
  }
  if (data.secret !== secret) return new Response('nicht erlaubt', { status: 401 });

  const subs = data.subscriptions ?? [];
  const n = data.notification;
  if (!n || subs.length === 0) return Response.json({ sent: 0, gone: [] });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, privateKey);
  const body = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag });

  const gone: string[] = [];
  const errors: string[] = [];
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s, body, { TTL: 6 * 3600, urgency: 'high' });
      sent += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(s.endpoint);
      else errors.push(`${status ?? ''} ${(e as Error).message}`.trim());
    }
  }));

  // Abgelaufene Abos aus der Datenbank entfernen.
  if (gone.length) {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    if (url && key) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: key };
      if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
      await fetch(`${url}/rest/v1/rpc/niko_push_gone`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_secret: secret, p_endpoints: gone }),
      }).catch(() => undefined);
    }
  }

  return Response.json({ sent, gone, errors });
});
