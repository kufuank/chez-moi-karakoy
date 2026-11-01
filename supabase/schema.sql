-- Chez Moi Karaköy: personal data from the public forms.
-- Row level security is on with no policies, so only the server (service role key) can read or write;
-- the browser never talks to Supabase directly.

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  email text,
  date date not null,
  time text not null,
  people int not null check (people between 1 and 30),
  area text not null default 'farketmez' check (area in ('restoran', 'teras', 'farketmez')),
  note text,
  status text not null default 'yeni' check (status in ('yeni', 'onaylandi', 'iptal'))
);
create index if not exists reservations_date_idx on public.reservations (date);

create table if not exists public.guestlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id text not null,
  event_title text not null,
  event_date date not null,
  name text not null,
  phone text not null,
  email text,
  people int not null check (people between 1 and 6),
  status text not null default 'bekliyor' check (status in ('bekliyor', 'onaylandi', 'geldi', 'iptal'))
);
create index if not exists guestlist_event_idx on public.guestlist (event_id);
create index if not exists guestlist_date_idx on public.guestlist (event_date);

alter table public.reservations enable row level security;
alter table public.guestlist enable row level security;
