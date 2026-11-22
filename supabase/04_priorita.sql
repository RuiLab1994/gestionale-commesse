-- ════════════════════════════════════════════════════════════════
--  Gestionale RuiLab — passo 4: priorità delle commesse in produzione
--  Da incollare in Supabase → SQL Editor → New query → Run.
--  Si può rieseguire senza danni.
-- ════════════════════════════════════════════════════════════════
-- Ordine della coda di produzione: numero più basso = lavorata prima.
-- Vuoto = in fondo, in ordine di invio in produzione.
alter table public.commesse_produzione add column if not exists priorita integer;
