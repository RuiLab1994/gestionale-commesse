-- ════════════════════════════════════════════════════════════════
--  Gestionale RuiLab — passo 2: risorse, catalogo modelli, file di stampa
--  Da incollare in Supabase → SQL Editor → New query → Run.
--  Si può rieseguire senza danni.
-- ════════════════════════════════════════════════════════════════

-- ── PERSONALE ────────────────────────────────────────────────────
-- ruoli: 'post_produzione', 'decorazione', 'montaggio', 'imballaggio'
create table if not exists public.personale (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  ruoli            text[] not null default '{}',
  ore_settimanali  numeric(5,2) not null default 40,
  giorni           smallint[] not null default '{1,2,3,4,5}',   -- 1 = lunedì … 7 = domenica
  attivo           boolean not null default true,
  note             text not null default '',
  creato_il        timestamptz not null default now(),
  aggiornato_il    timestamptz not null default now()
);

-- ── MACCHINE E STAMPATORI ESTERNI ────────────────────────────────
create table if not exists public.macchine (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  tecnologie       text[] not null default '{fdm}',   -- 'resina', 'fdm'
  esterno          boolean not null default false,     -- stampatore esterno: conta i giorni, non le ore
  ore_giorno       numeric(5,2) not null default 20,   -- ore di stampa al giorno (macchine interne)
  giorni_consegna  smallint not null default 7,        -- giorni promessi (stampatore esterno)
  attiva           boolean not null default true,
  note             text not null default '',
  creato_il        timestamptz not null default now(),
  aggiornato_il    timestamptz not null default now()
);

-- ── MODELLI (catalogo del negozio e statue personalizzate) ───────
-- commessa_id vuoto = modello del catalogo; pieno = statua personalizzata di quella commessa
create table if not exists public.modelli (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null,
  altezza_cm           numeric(6,1),
  minuti_montaggio     integer not null default 0,     -- incollaggio, ritocco, controllo finale
  minuti_imballaggio   integer not null default 0,
  commessa_id          uuid references public.commesse(id) on delete set null,
  shopify_product_id   text,
  attivo               boolean not null default true,
  note                 text not null default '',
  creato_il            timestamptz not null default now(),
  aggiornato_il        timestamptz not null default now()
);
create index if not exists modelli_commessa on public.modelli (commessa_id);

create table if not exists public.modelli_pezzi (
  id                    uuid primary key default gen_random_uuid(),
  modello_id            uuid not null references public.modelli(id) on delete cascade,
  ordine                smallint not null default 0,
  nome                  text not null,
  tipo                  text not null default 'pezzo' check (tipo in ('pezzo','accessorio')),
  tecnologia            text not null default 'fdm' check (tecnologia in ('resina','fdm')),
  quantita              smallint not null default 1 check (quantita > 0),   -- per una statua
  minuti_carteggiatura  integer not null default 0,
  minuti_decorazione    integer not null default 0
);
create index if not exists modelli_pezzi_modello on public.modelli_pezzi (modello_id, ordine);

-- ── FILE DI STAMPA ───────────────────────────────────────────────
-- Un file gira su una macchina e produce pezzi anche di modelli diversi.
-- Ogni pezzo esce da UN SOLO file (vincolo unico su pezzo_id).
create table if not exists public.file_stampa (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  macchina_id      uuid references public.macchine(id) on delete set null,
  minuti_durata    integer not null default 0,
  attivo           boolean not null default true,
  note             text not null default '',
  creato_il        timestamptz not null default now(),
  aggiornato_il    timestamptz not null default now()
);
create unique index if not exists file_stampa_nome_unico on public.file_stampa (lower(nome));

create table if not exists public.file_stampa_contenuto (
  file_id    uuid not null references public.file_stampa(id) on delete cascade,
  pezzo_id   uuid not null references public.modelli_pezzi(id) on delete cascade,
  quantita   smallint not null default 1 check (quantita > 0),   -- quanti ne escono da un lancio
  primary key (file_id, pezzo_id)
);
create unique index if not exists file_stampa_un_file_per_pezzo on public.file_stampa_contenuto (pezzo_id);

-- ── DATA DI AGGIORNAMENTO ────────────────────────────────────────
create or replace function public.tocca_aggiornato()
returns trigger language plpgsql as $$
begin new.aggiornato_il := now(); return new; end $$;

drop trigger if exists personale_tocca on public.personale;
create trigger personale_tocca before update on public.personale for each row execute function public.tocca_aggiornato();
drop trigger if exists macchine_tocca on public.macchine;
create trigger macchine_tocca before update on public.macchine for each row execute function public.tocca_aggiornato();
drop trigger if exists modelli_tocca on public.modelli;
create trigger modelli_tocca before update on public.modelli for each row execute function public.tocca_aggiornato();
drop trigger if exists file_stampa_tocca on public.file_stampa;
create trigger file_stampa_tocca before update on public.file_stampa for each row execute function public.tocca_aggiornato();

-- ── SICUREZZA E PERMESSI: solo utenti con accesso ────────────────
do $$
declare t text;
begin
  foreach t in array array['personale','macchine','modelli','modelli_pezzi','file_stampa','file_stampa_contenuto'] loop
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

-- ── MACCHINE DI PARTENZA (solo se la tabella è vuota) ────────────
insert into public.macchine (nome, tecnologie, esterno, ore_giorno)
select * from (values
  ('Resina',    array['resina'], false, 20::numeric),
  ('Bambu Lab', array['fdm'],    false, 20::numeric),
  ('Orange',    array['fdm'],    false, 16::numeric)
) as v(nome, tecnologie, esterno, ore_giorno)
where not exists (select 1 from public.macchine);

insert into public.macchine (nome, tecnologie, esterno, giorni_consegna)
select 'Stampatore esterno', array['resina','fdm'], true, 7
where not exists (select 1 from public.macchine where esterno);
