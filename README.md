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
Die Datenbank prüft dieselben Regeln beim Speichern noch einmal ([`0002_regeln.sql`](supabase/migrations/0002_regeln.sql)).

## Was die App kann

- **Live:** Pause und Runden starten, Fehler antippen (Schwimmer, Krone setzen oder raus), Finale mit Aufschlagregel,
  Rückgängig und Wiederholen für die laufende Pause (Wiederholen auf dem eigenen Gerät, bis jemand etwas Neues einträgt).
  Neue Spieler lassen sich spontan mit Spitzname anlegen.
- **Tisch-Modus** (`#/tisch`, Knopf in Live, nur auf Laptop/Tablet im Querformat): Vollbild mit großen Spielerkacheln
  für einen Touch-Laptop am Tischrand. Antippen = Fehler (Schwimmer, raus oder große Wahl Krone/Raus), Finale mit
  Aufschlagregel und Siegesanzeige. Beim Öffnen und nach jedem Finale startet automatisch eine Runde mit denselben
  Spielern. Schließen (✕) bricht eine noch leere Runde ab; eine Runde mit Einträgen läuft normal weiter.
  Pause starten/beenden und Spieler ändern bleiben in der normalen Ansicht.
  **Kommentator** (Knopf „Kommentar“, standardmäßig aus): sagt Schwimmer, Kronen, Finale samt Aufschläger und Sieg
  an, mit ElevenLabs (falls eingerichtet) oder der eingebauten Browser-Stimme. Die Sprüche stehen in
  `src/domain/commentary.ts`.
  Mit eingeschaltetem Kommentator ertönt um 9:58, 11:58, 13:58 und 15:43 ein Signalhorn als Zeichen für die letzte
  Runde (Uhrzeiten in `src/lib/horn.ts`). Es beendet nichts. Oben mittig steht die aktuelle Uhrzeit.
- **Offline:** Ohne Netz landen Einträge in einer Warteschlange auf dem Gerät und werden nachgereicht.
  Runden und Pausen starten geht nur online. Die App startet auch ohne Netz mit dem zuletzt geladenen Stand.
- **Dashboard:** Rekorde pro Tag, Woche, Semester und insgesamt, Tabelle mit Quoten, Kronen-Kurve, Duelle (Finalbilanz
  jeder gegen jeden) und Auszeichnungen. Ein Klick auf einen Namen öffnet das Spielerprofil mit ELO-Verlauf,
  Lieblings- und Angstgegner und längster Siegesserie.
- **ELO:** Jede Runde zählt nach Platzierung: Finalsieger, Finalverlierer, dann rückwärts in der Raus-Reihenfolge.
  Jeder wird mit jedem anderen der Runde verglichen, als hätten sie ein Duell gespielt. Wer vor einem Stärkeren landet,
  gewinnt mehr. Pro Runde sind höchstens ±32 drin ([`elo.ts`](src/domain/elo.ts)).
  Die **ELO** läuft seit dem ersten Spiel. Die **Semester-ELO** startet zu jedem Semesterbeginn für alle wieder bei 1000
  und bestimmt die Platzierung im Profil; beide stehen in der Tabelle und im Profil.
- **Semester:** wechseln automatisch nach Datum (SoSe 1. April – 30. September, WiSe 1. Oktober – 31. März).
  Nichts zu tun; „Dieses Semester“, Semester-Rekorde und Semester-ELO beginnen von selbst neu, alle Daten bleiben.
- **Spieler:** Liste mit Profilbildern. Ein Klick (hier oder auf einen Namen in der Tabelle) öffnet die Profilseite
  als eigene Unterseite (`#/spieler/<id>`): Kopf im E-Sport-Look mit freigestelltem Bild, ELO, Statistik, Rivalen.
  Jeder pflegt sein eigenes Profil: Spitzname, Vor- und Nachname, Bild; alle anderen Profile pflegt der Admin.
  Beim Hochladen wählt man den Ausschnitt selbst (verschieben, zoomen mit zwei Fingern, Regler oder Mausrad).
  Alle Bilder haben dasselbe Hochformat 4:5 (512 × 640 px); ein durchsichtiger Rand wird vorher entfernt.
- **Verlauf:** Jede Pause mit Kronen-Diagramm und allen Einträgen.
- **Admin-Panel** (Reiter *Admin*, nur für den einen Admin):
  - *Spieler:* anlegen mit Einladungslink, Einladungslink für spontan angelegte Spieler, Profil bearbeiten, ausblenden,
    Login trennen, doppelt angelegte Spieler zusammenführen (alle Runden gehen an den anderen; nicht möglich, wenn
    beide in derselben Runde waren).
  - *Pausen:* vergangene Pausen korrigieren: Einträge und Runden löschen, Finalsieger tauschen, Aufschläger ändern,
    ganze Pausen löschen. Vorher wird die Pause nachgespielt; würde eine Änderung spätere Einträge ungültig machen
    (z. B. eine Krone, die es ohne den gelöschten Sieg nicht gäbe), wird sie abgelehnt.
  - *Einladungen:* alle Links mit Status, offene zurückziehen.
  - *Protokoll:* wer wann was eingetragen, gelöscht oder geändert hat.
  - *Daten:* Export aller Daten als JSON (Datensicherung, der Gratis-Tarif hat keine abrufbaren Backups).
- **Einladungen:** Ein Einladungslink (`#/einladung/<code>`) gilt einmal und 7 Tage. Der Eingeladene gibt E-Mail,
  Spitzname, Vor- und Nachnamen ein, bestätigt mit dem Code aus der Mail und ist mit seinem Spieler verknüpft;
  bisherige Runden unter diesem Spieler gehören dann ihm. In der Datenbank liegt nur ein Hash des Links.

## Lokal starten

```bash
npm install
npm run dev
```

Ohne `.env` läuft die App im **Demo-Modus** mit erfundenen Beispieldaten im Speicher.
Zum gefahrlosen Ausprobieren trotz `.env`:

```bash
npm run demo
```

Das startet die App unter http://localhost:5174 garantiert ohne Supabase (siehe `.env.demo`). Im Demo-Modus bist du
Admin und Spieler „Countess“; alles geht beim Neuladen verloren.

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
| Code | https://github.com/Kootaro05/rundlauf | GitHub Actions prüft bei jedem Push Typen, Tests und Build |
| Kommentator-Stimme | ElevenLabs (optional, Prepaid) → [`/api/tts`](api/tts.ts) | Bessere Stimme im Tisch-Modus; ohne Schlüssel spricht die Browser-Stimme |
| Wachhalten | Vercel-Cron, täglich 06:00 UTC → [`/api/ping`](api/ping.ts) | Liest eine Zeile aus Supabase, damit das Gratis-Projekt nicht nach 7 Tagen pausiert |

`https://rundlauf.vercel.app` funktioniert weiterhin, gilt auf dem Handy aber als eigene App mit eigener Anmeldung.

## Einrichtung von Grund auf

So ist das laufende System aufgesetzt. Die Schritte braucht man nur für ein neues Projekt oder zum Nachvollziehen.

### 1. Supabase

1. Auf [supabase.com](https://supabase.com) ein Projekt anlegen (Free, Region *Central EU (Frankfurt)*). Beim Anlegen:
   - **Enable Data API**: an
   - **Automatically expose new tables**: aus (die Rechte vergibt das Schema selbst)
   - **Enable automatic RLS**: an
2. Im **SQL Editor** nacheinander [`0001_init.sql`](supabase/migrations/0001_init.sql),
   [`0002_regeln.sql`](supabase/migrations/0002_regeln.sql), [`0003_profile.sql`](supabase/migrations/0003_profile.sql)
   und [`0004_admin.sql`](supabase/migrations/0004_admin.sql) ausführen. Danach den Admin festlegen (letzte Zeile in 0004).
   0003 legt auch den privaten Bildspeicher `avatars` an.
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

### 5. Kommentator-Stimme über ElevenLabs (optional)

Ohne diesen Schritt spricht der Kommentator mit der Browser-Stimme (in Edge am besten). Mit ElevenLabs:

1. Bei [elevenlabs.io](https://elevenlabs.io) unter **ElevenAPI** einen API-Schlüssel anlegen. Rechte: nur *Text to Speech*.
   Prepaid bzw. ein Ausgabenlimit setzen.
2. In der Voice Library eine Stimme aussuchen (Deutsch oder mehrsprachig) und deren **Voice ID** kopieren.
3. In Vercel unter **Settings → Environment Variables** (Production) anlegen:
   - `ELEVENLABS_API_KEY`: der Schlüssel
   - `ELEVENLABS_VOICE_ID`: die Voice ID
   - `ELEVENLABS_MODEL` (optional): Modell-ID aus der ElevenLabs-Doku, Standard ist `eleven_v4_turbo`
4. **Deployments → Redeploy**, damit die Variablen greifen.
5. Im Tisch-Modus den Kommentar aus- und wieder einschalten. Steht am Knopf nicht mehr „Browser-Stimme“, spricht ElevenLabs.

So verhält sich die App:
- Nur angemeldete Mitglieder können über [`/api/tts`](api/tts.ts) Audio erzeugen; Texte sind auf 240 Zeichen begrenzt.
- Jeder fertige Satz wird auf dem Gerät gespeichert und danach ohne Guthaben abgespielt.
- Höchstens 15.000 neue Zeichen pro Gerät und Tag, danach Browser-Stimme.
- Guthaben leer, Schlüssel fehlt oder kein Zugriff: eine Stunde lang Browser-Stimme, dann neuer Versuch.
  Kommentar aus- und einschalten probiert es sofort wieder (z. B. nach dem Aufladen).
- Antwortet ElevenLabs nicht innerhalb von 2 Sekunden, spricht für diesen Satz die Browser-Stimme; die Anfrage läuft
  aber weiter und der Satz kommt beim nächsten Mal aus dem Speicher. Mit Kommentar hält die App die Funktion wach.
- Neben „Browser-Stimme“ steht am Knopf der Grund, z. B. „zu langsam“, „Guthaben leer“ oder „nicht eingerichtet“.
- Stimme wechseln: nur `ELEVENLABS_VOICE_ID` ändern und neu deployen. Beim nächsten Einschalten des Kommentars
  verwirft die App die gespeicherten Audios der alten Stimme; jeder Satz wird einmal neu erzeugt.

### Wer darf was?

| | ohne Login | Spieler | Admin |
|---|---|---|---|
| Spitznamen, Live-Stand, Dashboard, Verlauf | ✓ | ✓ | ✓ |
| Echte Namen, Profilseiten, Profilbilder | – | ✓ | ✓ |
| Eintragen, Spieler schnell anlegen | – | ✓ | ✓ |
| Laufende Pause korrigieren (Rückgängig/Wiederholen) | – | ✓ | ✓ |
| Profil (Spitzname, Name, Bild) ändern | – | das eigene | alle |
| Ausblenden, vergangene Pausen korrigieren, Einladungen, Logins, Protokoll, Export | – | – | ✓ |

„Spieler“ heißt: angemeldet **und** der Login ist mit einem Spieler verknüpft, über einen Einladungslink.
Wer sich mit einer fremden E-Mail anmeldet, sieht nur, was auch ohne Login sichtbar ist. Es gibt genau einen Admin;
festgelegt wird er per SQL (siehe 0004). Durchgesetzt wird alles in der Datenbank (RLS), nicht nur in der App.

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
