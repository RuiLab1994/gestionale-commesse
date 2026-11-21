-- ════════════════════════════════════════════════════════════════
--  Gestionale RuiLab — schema Supabase (passo 1: gestionale commesse)
--  Da incollare in Supabase → SQL Editor → New query → Run.
--  Si può rieseguire senza danni.
-- ════════════════════════════════════════════════════════════════

-- ── COMMESSE ─────────────────────────────────────────────────────
-- Una riga per commessa. 'id' è il codice fisso (non cambia se la
-- commessa viene rinominata); 'dati' contiene la scheda come oggi.
create table if not exists public.commesse (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  dati           jsonb not null default '{}'::jsonb,
  eliminata      boolean not null default false,   -- eliminazione "morbida": si propaga a tutti i dispositivi
  versione       integer not null default 1,       -- cresce a ogni salvataggio: serve a scoprire i conflitti
  creata_il      timestamptz not null default now(),
  aggiornata_il  timestamptz not null default now(),
  aggiornata_da  uuid references auth.users(id)
);
create unique index if not exists commesse_nome_attive
  on public.commesse (lower(nome)) where not eliminata;

-- ── IMPOSTAZIONI ─────────────────────────────────────────────────
-- Fasi / tecniche / persone, dati negozio, Google Calendar.
create table if not exists public.impostazioni (
  chiave         text primary key,
  dati           jsonb not null default '{}'::jsonb,
  versione       integer not null default 1,
  aggiornata_il  timestamptz not null default now(),
  aggiornata_da  uuid references auth.users(id)
);

-- ── STORICO ──────────────────────────────────────────────────────
-- Copia automatica di ogni versione precedente: il piano gratuito non
-- ha backup, così ogni modifica o eliminazione resta recuperabile.
create table if not exists public.storico (
  id           bigint generated always as identity primary key,
  tabella      text not null,
  chiave       text not null,
  versione     integer,
  dati         jsonb,
  nome         text,
  operazione   text not null,
  fatta_il     timestamptz not null default now(),
  fatta_da     uuid
);
create index if not exists storico_chiave on public.storico (tabella, chiave, fatta_il desc);

-- ── TRIGGER: versione, data, autore, storico ─────────────────────
create or replace function public.prima_di_salvare()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.versione := old.versione + 1;
  end if;
  new.aggiornata_il := now();
  new.aggiornata_da := auth.uid();
  return new;
end $$;

create or replace function public.salva_storico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'commesse' then
    insert into public.storico (tabella, chiave, versione, dati, nome, operazione, fatta_da)
    values ('commesse', old.id::text, old.versione, old.dati, old.nome, tg_op, auth.uid());
  else
    insert into public.storico (tabella, chiave, versione, dati, operazione, fatta_da)
    values (tg_table_name, old.chiave, old.versione, old.dati, tg_op, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists commesse_prima on public.commesse;
create trigger commesse_prima before insert or update on public.commesse
  for each row execute function public.prima_di_salvare();
drop trigger if exists commesse_storico on public.commesse;
create trigger commesse_storico after update or delete on public.commesse
  for each row execute function public.salva_storico();

drop trigger if exists impostazioni_prima on public.impostazioni;
create trigger impostazioni_prima before insert or update on public.impostazioni
  for each row execute function public.prima_di_salvare();
drop trigger if exists impostazioni_storico on public.impostazioni;
create trigger impostazioni_storico after update or delete on public.impostazioni
  for each row execute function public.salva_storico();

-- ── SICUREZZA: solo utenti con accesso ───────────────────────────
alter table public.commesse     enable row level security;
alter table public.impostazioni enable row level security;
alter table public.storico      enable row level security;

drop policy if exists "utenti leggono commesse"   on public.commesse;
drop policy if exists "utenti scrivono commesse"  on public.commesse;
drop policy if exists "utenti leggono impostazioni"  on public.impostazioni;
drop policy if exists "utenti scrivono impostazioni" on public.impostazioni;
drop policy if exists "utenti leggono storico"    on public.storico;

create policy "utenti leggono commesse"  on public.commesse for select to authenticated using (true);
create policy "utenti scrivono commesse" on public.commesse for all    to authenticated using (true) with check (true);
create policy "utenti leggono impostazioni"  on public.impostazioni for select to authenticated using (true);
create policy "utenti scrivono impostazioni" on public.impostazioni for all    to authenticated using (true) with check (true);
create policy "utenti leggono storico"   on public.storico  for select to authenticated using (true);
-- lo storico si scrive solo tramite i trigger: nessuno può modificarlo o cancellarlo dall'app

revoke all on public.commesse, public.impostazioni, public.storico from anon;

-- permessi di base per gli utenti collegati (nei progetti nuovi non sono automatici)
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.commesse, public.impostazioni to authenticated;
grant select on public.storico to authenticated;

-- ── TEMPO REALE: le modifiche arrivano subito agli altri dispositivi ─
do $$
begin
  begin alter publication supabase_realtime add table public.commesse;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.impostazioni; exception when duplicate_object then null; end;
end $$;
