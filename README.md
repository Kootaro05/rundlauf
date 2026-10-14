# Rundlauf-Analytics

Live-Erfassung und Dashboard für Rundlauf-Tischtennis mit Schwimmer, Kronen, Pot und Finale.
Vite + React + TypeScript, Daten und Login über Supabase.

## Regeln (so wie die App sie umsetzt)

- Wer einen Fehler macht, fliegt raus. Der **erste** Fehler einer Runde gibt automatisch den **Schwimmer**: Der Spieler bleibt drin.
- Statt rauszufliegen kann man eine **Krone setzen**: höchstens eine pro Runde. Der **König** (allein die meisten Kronen) darf beliebig viele setzen, solange er König ist und Kronen hat.
- Bleiben zwei übrig, gibt es das **Finale** um einen Punkt. Im Finale werden keine Kronen gesetzt; bei drei Spielern kann eine Krone das Finale verhindern.
- Wer weniger Kronen hat, schlägt im Finale auf. Bei Gleichstand wird die Angabe ausgespielt (einwerfen), der Gewinner schlägt auf.
- Der Pot startet jede Runde bei 1 Krone, gesetzte Kronen kommen dazu. Der Finalsieger bekommt den ganzen Pot.
- Jede Pause startet für alle bei 0 Kronen.

Die Logik steht in [`src/domain/game.ts`](src/domain/game.ts) und ist in [`game.test.ts`](src/domain/game.test.ts) getestet.

## Lokal starten

```bash
npm install
npm run dev
```

Ohne `.env` läuft die App im **Demo-Modus** mit erfundenen Beispieldaten im Speicher.

```bash
npm test
```

## Betrieb

| Was | Wo | Wozu |
|---|---|---|
| App | **https://rundlauf.timberborn.de** (Vercel, Projekt `rundlauf`) | Wird bei jedem Push auf `main` automatisch neu gebaut |
| Datenbank & Login | Supabase, Projekt `rundlauf` (Region Frankfurt) | Daten, Zugriffsregeln, Login per Mail-Code |
| Mailversand | Resend, Domain `rundlauf.timberborn.de` (Region Irland) | Login-Mails von `auth@rundlauf.timberborn.de` |
| DNS | Strato, Domain `timberborn.de` | Subdomain für App und Mailversand |
| Code | https://github.com/Kootaro05/rundlauf | |

`https://rundlauf.vercel.app` funktioniert weiterhin, gilt auf dem Handy aber als eigene App mit eigener Anmeldung.

## Einrichtung von Grund auf

So ist das laufende System aufgesetzt. Die Schritte braucht man nur für ein neues Projekt oder zum Nachvollziehen.

### 1. Supabase

1. Auf [supabase.com](https://supabase.com) ein Projekt anlegen (Free, Region *Central EU (Frankfurt)*). Beim Anlegen:
   - **Enable Data API**: an
   - **Automatically expose new tables**: aus (die Rechte vergibt das Schema selbst)
   - **Enable automatic RLS**: an
2. Im **SQL Editor** den Inhalt von [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) ausführen.
3. Dich selbst als ersten Spieler anlegen, siehe [`supabase/seed.example.sql`](supabase/seed.example.sql).
   Alle weiteren Spieler legt man danach in der App im Tab *Spieler* an.
4. **Project URL** und **anon Key** (Project Settings → API Keys → *Legacy anon, service_role API keys*)
   in eine `.env` kopieren, Vorlage: [`.env.example`](.env.example). Der `service_role`-/Secret-Key wird nicht gebraucht und gehört nirgends hin.
5. **Authentication → URL Configuration**
   - Site URL: `https://rundlauf.timberborn.de`
   - Redirect URLs: `https://rundlauf.timberborn.de/**`, `https://rundlauf.vercel.app/**`, `http://localhost:5173/**`

### 2. Mailversand über Resend

Supabase verschickt ohne eigenen Mailserver nur wenige Mails pro Stunde, und die Mail-Vorlagen lassen sich
dann nicht bearbeiten. Den Code in der Mail brauchen wir aber (siehe unten). Darum läuft der Versand über Resend.

1. Auf [resend.com](https://resend.com) unter **Domains** `rundlauf.timberborn.de` anlegen, Region *Ireland*. *Receiving* bleibt aus.
2. Bei Strato unter **Domainverwaltung → `timberborn.de` → DNS → TXT- und CNAME-Records** die drei Einträge aus Resend anlegen.
   Die Präfixe gehören zur **Hauptdomain** und brauchen darum das `.rundlauf`:

   | Präfix | Typ | Wert |
   |---|---|---|
   | `resend._domainkey.rundlauf` | TXT | DKIM-Schlüssel aus Resend (`p=MIGfMA…`) |
   | `rsend.rundlauf` | CNAME | `rsend-euw1.forge.rmta.net` |
   | `send.rundlauf` | CNAME | `send.forge.rmta.net` |

3. In Resend verifizieren lassen, dann **API Keys → Create API Key**: Name `supabase-auth`, Permission *Sending access*,
   Domain `rundlauf.timberborn.de`. Den Key direkt in Supabase eintragen, sonst nirgends speichern.
4. In Supabase unter **Authentication → Emails → SMTP Settings** *Enable custom SMTP*:

   | Feld | Wert |
   |---|---|
   | Sender email | `auth@rundlauf.timberborn.de` |
   | Sender name | `Rundlauf` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | der Resend-API-Key |

Ein Strato-Postfach geht nicht: `rundlauf@timberborn.de` ist nur ein Alias ohne eigenes Passwort, und das Masterpostfach
sollte Supabase nicht kennen. Fehler beim Versand stehen in Supabase unter **Logs → Auth** (nicht im API-Gateway-Log).

### 3. Login-Code in der Mail

In der installierten App auf dem iPhone öffnen sich Links aus Mails in Safari, nicht in der App, und die Anmeldung
käme dort nicht an. Darum meldet man sich mit dem **Code aus der Mail** an. In Supabase unter
**Authentication → Emails → Templates** bei **Magic link or OTP** und bei **Confirm sign up**
(die bekommt, wer sich zum ersten Mal anmeldet):

Subject:

```
Dein Rundlauf-Login: {{ .Token }}
```

Body (unter *Source*):

```html
<h2>Rundlauf-Analytics</h2>
<p>Dein Code zum Anmelden:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>Oder im selben Browser diesen Link öffnen: <a href="{{ .ConfirmationURL }}">Anmelden</a></p>
<p>Code und Link gelten nur kurz und nur einmal.</p>
```

Der Code steht mit Absicht im Betreff, so sieht man ihn schon in der Benachrichtigung.

### 4. Vercel und eigene Domain

1. Auf [vercel.com](https://vercel.com) das GitHub-Repo `rundlauf` importieren. Preset *Vite*, sonst nichts ändern.
2. Vor dem ersten Deploy unter **Environment Variables** `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` anlegen.
   Die Supabase-Integration von Vercel **nicht** hinzufügen, sie würde ein zweites Projekt anlegen.
3. **Settings → Domains**: `rundlauf.timberborn.de` für *Production* hinzufügen.
4. Bei Strato die Subdomain `rundlauf` anlegen und in deren DNS-Einstellungen den **CNAME** auf den Wert von Vercel setzen
   (aktuell `818709f23a2b98ab.vercel-dns-017.com`). Dadurch verschwinden die A- und AAAA-Einträge, die Strato
   automatisch anlegt. Sie müssen weg, sonst landen manche Geräte bei Strato statt bei Vercel.
   Die Resend-Einträge liegen auf eigenen Namen und bleiben unberührt.

### Wer darf was?

- **Lesen** (Dashboard, Verlauf, Live-Stand): jeder mit dem Link, ohne Login.
- **Eintragen**: nur wer angemeldet ist **und** dessen E-Mail bei einem Spieler hinterlegt ist.
  Neue Mitspieler trägst du im Tab *Spieler* mit E-Mail ein. Beim ersten Login werden sie automatisch verknüpft.
- E-Mails sind nur für eingeloggte Mitglieder sichtbar.

## Als App installieren

Die Seite ist eine PWA und lässt sich auf den Homescreen legen:

- **iPhone:** in Safari öffnen → Teilen → *Zum Home-Bildschirm*
- **Android / Chrome / Edge:** Button *Installieren* oben rechts oder im Browser-Menü *App installieren*

Neue Versionen werden beim nächsten Öffnen automatisch übernommen. Die App-Icons entstehen aus
`public/logo.svg` mit `npx pwa-assets-generator`.

Anmelden muss man sich **einmal pro Gerät und Browser**. Neu anmelden muss man sich nach Abmelden, gelöschten
Browserdaten, im privaten Modus oder in Safari auf dem iPhone, wenn die Seite (nicht die installierte App) gut eine Woche nicht geöffnet wurde.

## Änderungen ausrollen

Push auf `main` reicht, Vercel baut und veröffentlicht nach etwa einer Minute. Änderungen am Datenbankschema
müssen zusätzlich im Supabase **SQL Editor** ausgeführt werden; das Schema in `supabase/migrations/` ist die Referenz.

## Aufbau

```
src/
  domain/     Spielregeln, Statistik, Zeiträume (reine Funktionen, getestet)
  lib/        Backend-Schnittstelle: Supabase und Demo-Speicher
  components/ Live, Dashboard, Verlauf, Spieler, Login
supabase/     Datenbankschema mit Zugriffsregeln (RLS)
```
