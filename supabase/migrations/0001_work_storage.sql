create extension if not exists pgcrypto;

create type public.item_type as enum ('prompt','login','note','file','account','custom');

create table public.vault_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type public.item_type not null,
  title text not null,
  subtitle text,
  content_encrypted text,
  metadata jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  favorite boolean not null default false,
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vault_items_user_id_idx on public.vault_items(user_id);
create index vault_items_type_idx on public.vault_items(type);
create index vault_items_tags_idx on public.vault_items using gin(tags);

alter table public.vault_items enable row level security;
revoke all on table public.vault_items from anon, authenticated;
grant select, insert, update, delete on table public.vault_items to authenticated;

create policy "vault_select_own" on public.vault_items for select to authenticated using ((select auth.uid()) = user_id);
create policy "vault_insert_own" on public.vault_items for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "vault_update_own" on public.vault_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "vault_delete_own" on public.vault_items for delete to authenticated using ((select auth.uid()) = user_id);
