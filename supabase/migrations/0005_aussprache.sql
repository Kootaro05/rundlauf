-- Aussprache für den Kommentator: wie die Stimme den Spitznamen vorlesen soll (z. B. "Flobbob null neun").
-- Angezeigt wird weiterhin der Spitzname. Ändern darf es, wer auch den Spitznamen ändern darf
-- (die bestehende Regel "ändern: eigenes" auf public.players gilt für alle Spalten).

alter table public.players add column if not exists spoken_name text;

alter table public.players drop constraint if exists players_spoken_name_len;
alter table public.players add constraint players_spoken_name_len check (char_length(spoken_name) <= 60);
