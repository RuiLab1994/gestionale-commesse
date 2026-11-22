-- ════════════════════════════════════════════════════════════════
--  Gestionale RuiLab — passo 5: avvio manuale e statue già stampate
--  Da incollare in Supabase → SQL Editor → New query → Run.
--  Si può rieseguire senza danni.
-- ════════════════════════════════════════════════════════════════
-- Stati: 'preparazione' (dati in inserimento) → 'produzione' (in coda: nel Gantt,
-- non ancora sui tablet) → 'avviata' (avviata a mano: compare sui tablet).
alter table public.commesse_produzione drop constraint if exists commesse_produzione_stato_check;
alter table public.commesse_produzione add constraint commesse_produzione_stato_check
  check (stato in ('preparazione','produzione','avviata'));
alter table public.commesse_produzione add column if not exists avviata_il timestamptz;

-- Statue già stampate (es. prese dal magazzino): saltano la stampa,
-- ma passano ancora da carteggiatura, decorazione, montaggio e imballaggio.
alter table public.produzione_righe add column if not exists gia_stampate smallint not null default 0;
