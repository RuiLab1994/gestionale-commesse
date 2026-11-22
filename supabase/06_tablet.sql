-- ════════════════════════════════════════════════════════════════
--  Gestionale RuiLab — passo 6: lavori per i tablet e magazzino
--  Da incollare in Supabase → SQL Editor → New query → Run.
--  Si può rieseguire senza danni.
-- ════════════════════════════════════════════════════════════════

-- Nome e consegna della commessa copiati qui: il tablet non legge la tabella
-- commesse (che contiene prezzi e clienti).
alter table public.commesse_produzione add column if not exists nome text;
alter table public.commesse_produzione add column if not exists consegna date;

-- ── LAVORI ───────────────────────────────────────────────────────
-- Creati quando una commessa viene avviata: un lancio di stampa per file,
-- carteggiatura e decorazione per ogni pezzo, montaggio e imballaggio per statua.
create table if not exists public.lavori (
  id                uuid primary key default gen_random_uuid(),
  commessa_id       uuid not null references public.commesse(id) on delete cascade,
  commessa_nome     text not null default '',
  tipo              text not null check (tipo in ('stampa','carteggiatura','decorazione','montaggio','imballaggio')),
  ordine            integer not null default 0,
  statua            smallint,                   -- numero della statua nella commessa (1, 2, …)
  statua_nome       text not null default '',
  pezzo_id          uuid references public.modelli_pezzi(id) on delete set null,
  pezzo_nome        text not null default '',
  accessorio        boolean not null default false,
  tecnologia        text,
  file_id           uuid references public.file_stampa(id) on delete set null,
  file_nome         text not null default '',
  macchina_id       uuid references public.macchine(id) on delete set null,
  contenuto         text not null default '',   -- cosa esce dal lancio (testo per il tablet)
  extra             jsonb not null default '{}'::jsonb,   -- {pezzo_id: quantità} che va a magazzino
  dipende_da        uuid references public.lavori(id) on delete set null,
  minuti_previsti   integer not null default 0,
  stato             text not null default 'da_fare' check (stato in ('da_fare','in_corso','in_pausa','fatto')),
  persona_id        uuid references public.personale(id) on delete set null,
  iniziato_il       timestamptz,
  ripreso_il        timestamptz,                -- inizio del tratto di lavoro in corso
  minuti_lavorati   numeric(8,2) not null default 0,
  finito_il         timestamptz,
  fallimenti        smallint not null default 0,
  creato_il         timestamptz not null default now()
);
create index if not exists lavori_commessa on public.lavori (commessa_id, ordine);
create index if not exists lavori_aperti on public.lavori (stato) where stato <> 'fatto';

-- ── MAGAZZINO PEZZI ──────────────────────────────────────────────
create table if not exists public.magazzino_pezzi (
  pezzo_id       uuid primary key references public.modelli_pezzi(id) on delete cascade,
  quantita       integer not null default 0 check (quantita >= 0),
  aggiornato_il  timestamptz not null default now()
);

-- Aggiunge (o toglie, con numero negativo) pezzi al magazzino in modo sicuro
create or replace function public.magazzino_aggiungi(p_pezzo uuid, p_n integer)
returns void language sql security invoker set search_path = public as $$
  insert into public.magazzino_pezzi (pezzo_id, quantita) values (p_pezzo, greatest(0, p_n))
  on conflict (pezzo_id) do update
    set quantita = greatest(0, public.magazzino_pezzi.quantita + p_n), aggiornato_il = now();
$$;
grant execute on function public.magazzino_aggiungi(uuid, integer) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['lavori','magazzino_pezzi'] loop
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

-- ── ACCOUNT TABLET: niente prezzi, clienti e impostazioni ────────
-- Un utente con app_metadata.ruolo = 'tablet' non vede commesse, impostazioni e storico.
drop policy if exists "utenti leggono commesse"      on public.commesse;
drop policy if exists "utenti scrivono commesse"     on public.commesse;
drop policy if exists "utenti leggono impostazioni"  on public.impostazioni;
drop policy if exists "utenti scrivono impostazioni" on public.impostazioni;
drop policy if exists "utenti leggono storico"       on public.storico;
create policy "utenti leggono commesse"      on public.commesse     for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'ruolo') is distinct from 'tablet');
create policy "utenti scrivono commesse"     on public.commesse     for all    to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'ruolo') is distinct from 'tablet') with check ((auth.jwt() -> 'app_metadata' ->> 'ruolo') is distinct from 'tablet');
create policy "utenti leggono impostazioni"  on public.impostazioni for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'ruolo') is distinct from 'tablet');
create policy "utenti scrivono impostazioni" on public.impostazioni for all    to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'ruolo') is distinct from 'tablet') with check ((auth.jwt() -> 'app_metadata' ->> 'ruolo') is distinct from 'tablet');
create policy "utenti leggono storico"       on public.storico      for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'ruolo') is distinct from 'tablet');

-- ════════════════════════════════════════════════════════════════
--  DOPO aver creato l'utente del tablet (Authentication → Users → Add user),
--  esegui questa riga con la sua email per dargli il ruolo "tablet":
--
--  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"ruolo":"tablet"}'
--  where email = 'tablet@ruilab.it';
-- ════════════════════════════════════════════════════════════════
