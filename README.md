# NiKo

Bring- und Abholplan für den Kindergartenweg zweier Familien. Eine Web-App ohne Build-Schritt, gehostet auf GitHub Pages, mit Supabase als Datenbank.

## Aufbau

- `index.html`, `app.css`, `app.js`: die App
- `config.js`: Supabase-Adresse und publishable Key (öffentlich gedacht)
- `supabase/schema.sql`: Tabellen und Funktionen
- `supabase/push.sql`: Push-Benachrichtigungen und Erinnerung am Morgen (nach schema.sql)
- `supabase/absences.sql`: Kind bleibt zuhause (nach push.sql)
- `supabase/functions/niko-push`: Supabase-Funktion, die Benachrichtigungen verschickt
- `sw.js`: Service Worker für Benachrichtigungen

## Sicherheit

Die Tabellen sind für die öffentliche API gesperrt. Lesen und Schreiben geht nur über die `niko_*`-Funktionen, und jede verlangt den Token aus dem persönlichen Link. Namen, Pläne und Links stehen nur in der Datenbank, nicht in diesem Repository.

## Einrichten

1. `supabase/schema.sql` im SQL Editor von Supabase ausführen.
2. Personen, Standardplan und Links per SQL anlegen (nicht Teil dieses Repositorys).
3. GitHub Pages auf den Branch `main` stellen.
4. Für Benachrichtigungen: `supabase/push.sql` ausführen, `niko_config` mit Funktionsadresse, Geheimnis und App-Adresse füllen, die Funktion `niko-push` ohne JWT-Prüfung anlegen und die Geheimnisse `VAPID_PRIVATE_KEY` und `NIKO_HOOK_SECRET` setzen.
