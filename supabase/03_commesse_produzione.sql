-- ════════════════════════════════════════════════════════════════
--  Gestionale RuiLab — passo 3: produzione delle singole commesse
--  Da incollare in Supabase → SQL Editor → New query → Run.
--  Si può rieseguire senza danni.
-- ════════════════════════════════════════════════════════════════

-- Stato di produzione di una commessa.
-- 'preparazione' = si stanno inserendo i dati (non entra in Gantt né tablet)
-- 'produzione'   = mandata in produzione
create table if not exists public.commesse_produzione (
  commessa_id    uuid primary key references public.commesse(id) on delete cascade,
  stato          text not null default 'preparazione' check (stato in ('preparazione','produzione')),
  mandata_il     timestamptz,
  note           text not null default '',
  creato_il      timestamptz not null default now(),
  aggiornato_il  timestamptz not null default now()
);

-- Le statue da produrre: ognuna rimanda a un modello
-- (del catalogo, oppure personalizzato con modelli.commessa_id = questa commessa).
create table if not exists public.produzione_righe (
  id             uuid primary key default gen_random_uuid(),
  commessa_id    uuid not null references public.commesse(id) on delete cascade,
  ordine         smallint not null default 0,
  descrizione    text not null default '',
  quantita       smallint not null default 1 check (quantita > 0),
  modello_id     uuid references public.modelli(id) on delete set null,
  creato_il      timestamptz not null default now()
);
create index if not exists produzione_righe_commessa on public.produzione_righe (commessa_id, ordine);

drop trigger if exists commesse_produzione_tocca on public.commesse_produzione;
create trigger commesse_produzione_tocca before update on public.commesse_produzione
  for each row execute function public.tocca_aggiornato();

do $$
declare t text;
begin
  foreach t in array array['commesse_produzione','produzione_righe'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "utenti collegati" on public.%I', t);
    execute format('create policy "utenti collegati" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
