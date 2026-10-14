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

## Supabase einrichten

1. Auf [supabase.com](https://supabase.com) ein kostenloses Projekt anlegen.
2. Im Dashboard unter **SQL Editor** den Inhalt von [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) ausführen.
3. Dich selbst als ersten Spieler mit deiner E-Mail anlegen, siehe [`supabase/seed.example.sql`](supabase/seed.example.sql).
4. Unter **Project Settings → API** die Project URL und den `anon` Key in eine `.env` kopieren (Vorlage: `.env.example`).
5. Unter **Authentication → URL Configuration** die Adresse der App als *Site URL* und unter *Redirect URLs* eintragen
   (lokal `http://localhost:5173`, später die Produktions-URL).
6. `npm run dev`, oben rechts **Anmelden**, Login-Link aus der Mail öffnen.

### Login-Code in der Mail

In der installierten App auf dem iPhone öffnen sich Links aus Mails in Safari, nicht in der App.
Darum meldet man sich mit dem **Code aus der Mail** an. Dafür muss der Code in den Mail-Vorlagen stehen:
In Supabase unter **Authentication → Emails → Templates** bei **Magic Link** und bei **Confirm signup**
(die bekommt, wer sich zum ersten Mal anmeldet) z. B. diese Zeile ergänzen:

```html
<p>Dein Code: <strong>{{ .Token }}</strong></p>
```

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

## Deployment

`npm run build` erzeugt einen statischen Ordner `dist/`, der überall läuft (Vercel, Netlify, Cloudflare Pages, GitHub Pages).
Die beiden `VITE_SUPABASE_*`-Variablen beim Hoster hinterlegen und die Produktions-URL in Supabase als Redirect-URL eintragen.

## Aufbau

```
src/
  domain/     Spielregeln, Statistik, Zeiträume (reine Funktionen, getestet)
  lib/        Backend-Schnittstelle: Supabase und Demo-Speicher
  components/ Live, Dashboard, Verlauf, Spieler, Login
supabase/     Datenbankschema mit Zugriffsregeln (RLS)
```
