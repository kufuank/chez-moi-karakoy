-- Chez Moi Karaköy — database for the static site (GitHub Pages + Supabase).
-- Applied to the Supabase project as migrations "chezmoi_init" and "chezmoi_rate_limit_real_ip"; this file is the
-- combined result, for reference and for setting the site up in another project. Every object is prefixed
-- chezmoi_ so it can live beside another app in the same project.
--
-- Who can do what:
--   visitors (anon key)  read the menu and published events; send reservations / guest-list sign-ups only through
--                        chezmoi_reserve / chezmoi_guestlist_signup (validated, rate-limited); read nothing personal
--   admins               auth users listed in chezmoi_admins: everything on these tables and the poster bucket

create table public.chezmoi_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.chezmoi_admins enable row level security;
create policy chezmoi_admins_self on public.chezmoi_admins for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.chezmoi_is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.chezmoi_admins where user_id = (select auth.uid())) $$;

-- Menu
create table public.chezmoi_categories (
  id text primary key,
  name text not null check (length(trim(name)) between 1 and 60),
  position int not null default 0
);
create table public.chezmoi_items (
  id text primary key,
  category_id text not null references public.chezmoi_categories (id) on update cascade on delete restrict,
  name text not null check (length(trim(name)) between 1 and 90),
  description text not null default '' check (length(description) <= 300),
  price numeric(10, 2) not null check (price >= 0 and price < 1000000),
  position int not null default 0
);
create index chezmoi_items_category_idx on public.chezmoi_items (category_id, position);

-- Club nights
create table public.chezmoi_events (
  id text primary key default ('e' || substr(md5(gen_random_uuid()::text), 1, 8)),
  created_at timestamptz not null default now(),
  title text not null check (length(trim(title)) between 1 and 90),
  date date not null,
  time text not null default '22:00' check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  floor text not null default 'ikisi' check (floor in ('zemin', 'roof', 'ikisi')),
  genres text[] not null default '{}',
  lineup text[] not null default '{}',
  description text not null default '' check (length(description) <= 600),
  ticket_url text not null default '' check (ticket_url = '' or ticket_url ~ '^https://\S+$'),
  guestlist boolean not null default true,
  capacity int check (capacity between 1 and 5000),
  poster text,
  published boolean not null default true
);
create index chezmoi_events_date_idx on public.chezmoi_events (date);

-- Personal data (written only through the functions below; deleted 90 days after the date)
create table public.chezmoi_reservations (
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
  status text not null default 'yeni' check (status in ('yeni', 'onaylandi', 'iptal')),
  ip_hash text
);
create index chezmoi_reservations_date_idx on public.chezmoi_reservations (date);
create index chezmoi_reservations_ip_idx on public.chezmoi_reservations (ip_hash, created_at);

create table public.chezmoi_guestlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id text not null,
  event_title text not null,
  event_date date not null,
  name text not null,
  phone text not null,
  email text,
  people int not null check (people between 1 and 6),
  status text not null default 'bekliyor' check (status in ('bekliyor', 'onaylandi', 'geldi', 'iptal')),
  ip_hash text
);
create index chezmoi_guestlist_event_idx on public.chezmoi_guestlist (event_id);
create index chezmoi_guestlist_ip_idx on public.chezmoi_guestlist (ip_hash, created_at);

alter table public.chezmoi_categories enable row level security;
alter table public.chezmoi_items enable row level security;
alter table public.chezmoi_events enable row level security;
alter table public.chezmoi_reservations enable row level security;
alter table public.chezmoi_guestlist enable row level security;

create policy chezmoi_categories_read on public.chezmoi_categories for select to anon, authenticated using (true);
create policy chezmoi_categories_admin on public.chezmoi_categories for all to authenticated using ((select public.chezmoi_is_admin())) with check ((select public.chezmoi_is_admin()));
create policy chezmoi_items_read on public.chezmoi_items for select to anon, authenticated using (true);
create policy chezmoi_items_admin on public.chezmoi_items for all to authenticated using ((select public.chezmoi_is_admin())) with check ((select public.chezmoi_is_admin()));
create policy chezmoi_events_read on public.chezmoi_events for select to anon, authenticated using (published or (select public.chezmoi_is_admin()));
create policy chezmoi_events_admin on public.chezmoi_events for all to authenticated using ((select public.chezmoi_is_admin())) with check ((select public.chezmoi_is_admin()));
create policy chezmoi_reservations_admin on public.chezmoi_reservations for all to authenticated using ((select public.chezmoi_is_admin())) with check ((select public.chezmoi_is_admin()));
create policy chezmoi_guestlist_admin on public.chezmoi_guestlist for all to authenticated using ((select public.chezmoi_is_admin())) with check ((select public.chezmoi_is_admin()));

create or replace function public.chezmoi_today() returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'Europe/Istanbul')::date $$;

-- Turkish numbers in any common spelling become +90XXXXXXXXXX; foreign numbers are kept as typed.
create or replace function public.chezmoi_phone(p text) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g');
  bare text := ltrim(digits, '+');
begin
  if bare ~ '^(90)?0?[2-5][0-9]{9}$' then return '+90' || right(bare, 10); end if;
  if digits like '+%' and length(bare) between 8 and 15 then return '+' || bare; end if;
  return null;
end $$;

-- Name/phone/email/consent checks, six sends per address per 10 minutes (on the address the edge saw, which a
-- client cannot forge), and the 90-day clean-up. Internal: callable only from the two functions below.
create or replace function public.chezmoi_check_person(p_name text, p_phone text, p_email text, p_consent boolean, out name text, out phone text, out email text, out ip_hash text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  headers json := coalesce(current_setting('request.headers', true), '{}')::json;
  ip text := coalesce(nullif(headers ->> 'cf-connecting-ip', ''), nullif(headers ->> 'x-real-ip', ''), trim(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)));
  recent int;
begin
  name := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 80);
  phone := public.chezmoi_phone(p_phone);
  email := nullif(lower(left(trim(coalesce(p_email, '')), 120)), '');
  if length(name) < 2 then raise exception using message = 'Adınızı ve soyadınızı yazın.', hint = 'name'; end if;
  if phone is null then raise exception using message = 'Telefon numaranızı 05XX XXX XX XX biçiminde yazın.', hint = 'phone'; end if;
  if email is not null and email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception using message = 'E-posta adresi geçerli görünmüyor.', hint = 'email'; end if;
  if coalesce(p_consent, false) is not true then raise exception using message = 'Devam etmek için bilgilerinizin kullanımına onay verin.', hint = 'consent'; end if;
  ip_hash := case when coalesce(ip, '') = '' then null else md5(ip || ':chezmoi') end;
  if ip_hash is not null then
    select (select count(*) from public.chezmoi_reservations r where r.ip_hash = chezmoi_check_person.ip_hash and r.created_at > now() - interval '10 minutes')
         + (select count(*) from public.chezmoi_guestlist g where g.ip_hash = chezmoi_check_person.ip_hash and g.created_at > now() - interval '10 minutes')
      into recent;
    if recent >= 6 then raise exception using message = 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin ya da bizi arayın.', hint = 'rate'; end if;
  end if;
  delete from public.chezmoi_reservations where date < public.chezmoi_today() - 90;
  delete from public.chezmoi_guestlist where event_date < public.chezmoi_today() - 90;
end $$;
revoke all on function public.chezmoi_check_person(text, text, text, boolean) from public, anon, authenticated;

-- Restaurant reservation request
create or replace function public.chezmoi_reserve(
  p_name text, p_phone text, p_email text, p_date date, p_time text, p_people int, p_area text, p_note text,
  p_consent boolean, p_website text default ''
) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
  person record;
  new_id uuid;
begin
  if coalesce(p_website, '') <> '' then return json_build_object('ok', true); end if; -- honeypot
  select * into person from public.chezmoi_check_person(p_name, p_phone, p_email, p_consent);
  if p_date is null or p_date < public.chezmoi_today() or p_date > public.chezmoi_today() + 90 then
    raise exception using message = 'Bugünden itibaren 90 gün içinde bir tarih seçin.', hint = 'date';
  end if;
  if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception using message = 'Bir saat seçin.', hint = 'time'; end if;
  if p_people is null or p_people < 1 or p_people > 30 then
    raise exception using message = 'Kişi sayısı 1 ile 30 arasında olmalı. Daha kalabalık gruplar için bizi arayın.', hint = 'people';
  end if;
  insert into public.chezmoi_reservations (name, phone, email, date, time, people, area, note, ip_hash)
  values (person.name, person.phone, person.email, p_date, p_time, p_people,
          case when p_area in ('restoran', 'teras', 'farketmez') then p_area else 'farketmez' end,
          nullif(left(trim(coalesce(p_note, '')), 400), ''), person.ip_hash)
  returning id into new_id;
  return json_build_object('ok', true, 'id', new_id);
end $$;

-- Guest-list sign-up for a published, upcoming event without a ticket link
create or replace function public.chezmoi_guestlist_signup(
  p_event_id text, p_name text, p_phone text, p_email text, p_people int, p_consent boolean, p_website text default ''
) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
  ev public.chezmoi_events;
  person record;
  taken int;
  new_id uuid;
begin
  select * into ev from public.chezmoi_events where id = p_event_id and published for update; -- one sign-up at a time per night
  if not found or ev.date < public.chezmoi_today() then raise exception using message = 'Bu etkinlik artık kayda açık değil.'; end if;
  if not ev.guestlist or ev.ticket_url <> '' then raise exception using message = 'Bu etkinlik için ön kayıt yok; bilet linkini kullanın.'; end if;
  if coalesce(p_website, '') <> '' then return json_build_object('ok', true); end if; -- honeypot
  select * into person from public.chezmoi_check_person(p_name, p_phone, p_email, p_consent);
  if p_people is null or p_people < 1 or p_people > 6 then raise exception using message = 'Kişi sayısı 1 ile 6 arasında olmalı.', hint = 'people'; end if;
  if exists (select 1 from public.chezmoi_guestlist g where g.event_id = ev.id and g.phone = person.phone and g.status <> 'iptal') then
    raise exception using message = 'Bu telefon numarasıyla bu gece için zaten kaydınız var.', hint = 'phone';
  end if;
  select coalesce(sum(g.people), 0) into taken from public.chezmoi_guestlist g where g.event_id = ev.id and g.status <> 'iptal';
  if ev.capacity is not null and taken + p_people > ev.capacity then
    raise exception using message = case when ev.capacity - taken > 0 then format('Listede %s kişilik yer kaldı.', ev.capacity - taken) else 'Ön kayıt listesi doldu.' end, hint = 'people';
  end if;
  insert into public.chezmoi_guestlist (event_id, event_title, event_date, name, phone, email, people, ip_hash)
  values (ev.id, ev.title, ev.date, person.name, person.phone, person.email, p_people, person.ip_hash)
  returning id into new_id;
  return json_build_object('ok', true, 'id', new_id);
end $$;

grant execute on function public.chezmoi_reserve(text, text, text, date, text, int, text, text, boolean, text) to anon, authenticated;
grant execute on function public.chezmoi_guestlist_signup(text, text, text, text, int, boolean, text) to anon, authenticated;

-- Posters: public bucket, only admins write
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chezmoi-posters', 'chezmoi-posters', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy chezmoi_posters_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'chezmoi-posters' and (select public.chezmoi_is_admin()));
create policy chezmoi_posters_admin_update on storage.objects for update to authenticated using (bucket_id = 'chezmoi-posters' and (select public.chezmoi_is_admin()));
create policy chezmoi_posters_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'chezmoi-posters' and (select public.chezmoi_is_admin()));

-- Admins: add an existing auth user by e-mail
-- insert into public.chezmoi_admins (user_id) select id from auth.users where email = 'yonetici@ornek.com';
