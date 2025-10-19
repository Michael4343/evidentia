-- Supabase setup for Evidentia persistence.
-- Creates the private papers bucket, applies RLS policies, and defines the user_papers table.

-- Ensure pgcrypto is available for gen_random_uuid().
create extension if not exists pgcrypto;

-- Create private storage bucket for uploaded PDFs.
insert into storage.buckets (id, name, public)
values ('papers', 'papers', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users upload PDFs'
  ) then
    create policy "Users upload PDFs" on storage.objects
      for insert
      with check (
        bucket_id = 'papers'
        and auth.uid()::text = split_part(name, '/', 1)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users read own PDFs'
  ) then
    create policy "Users read own PDFs" on storage.objects
      for select using (
        bucket_id = 'papers'
        and auth.uid()::text = split_part(name, '/', 1)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users update own PDFs'
  ) then
    create policy "Users update own PDFs" on storage.objects
      for update using (
        bucket_id = 'papers'
        and auth.uid()::text = split_part(name, '/', 1)
      )
      with check (
        bucket_id = 'papers'
        and auth.uid()::text = split_part(name, '/', 1)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users delete own PDFs'
  ) then
    create policy "Users delete own PDFs" on storage.objects
      for delete using (
        bucket_id = 'papers'
        and auth.uid()::text = split_part(name, '/', 1)
      );
  end if;
end
$$;

-- Metadata table tying PDFs to users and enabling RLS.
create table if not exists public.user_papers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  doi text,
  title text not null,
  file_name text not null,
  file_size bigint not null,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

alter table public.user_papers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_papers'
      and policyname = 'Users read their papers'
  ) then
    create policy "Users read their papers" on public.user_papers
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_papers'
      and policyname = 'Users insert their papers'
  ) then
    create policy "Users insert their papers" on public.user_papers
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_papers'
      and policyname = 'Users update their papers'
  ) then
    create policy "Users update their papers" on public.user_papers
      for update using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_papers'
      and policyname = 'Users delete their papers'
  ) then
    create policy "Users delete their papers" on public.user_papers
      for delete using (auth.uid() = user_id);
  end if;
end
$$;
