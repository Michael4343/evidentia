# Supabase persistence

## Buckets
- `papers` storage bucket (private). Uploads land under `<user_id>/<slug>-<timestamp>.pdf`.
- Policies on `storage.objects`:
  ```sql
  create policy "Users upload PDFs" on storage.objects
    for insert
    with check (
      bucket_id = 'papers'
      and auth.uid()::text = split_part(name, '/', 1)
    );

  create policy "Users read own PDFs" on storage.objects
    for select using (
      bucket_id = 'papers'
      and auth.uid()::text = split_part(name, '/', 1)
    );

  create policy "Users update own PDFs" on storage.objects
    for update using (
      bucket_id = 'papers'
      and auth.uid()::text = split_part(name, '/', 1)
    )
    with check (
      bucket_id = 'papers'
      and auth.uid()::text = split_part(name, '/', 1)
    );

  create policy "Users delete own PDFs" on storage.objects
    for delete using (
      bucket_id = 'papers'
      and auth.uid()::text = split_part(name, '/', 1)
    );
  ```

## Tables
### `public.user_papers`
```sql
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

create policy "Users read their papers" on public.user_papers
  for select using (auth.uid() = user_id);

create policy "Users insert their papers" on public.user_papers
  for insert with check (auth.uid() = user_id);

create policy "Users update their papers" on public.user_papers
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete their papers" on public.user_papers
  for delete using (auth.uid() = user_id);
```

## Environment
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Notes
- PDFs save to Supabase Storage and metadata rows keep the DOI/title history for each user.
- Client requests a public URL first; falls back to a 24h signed URL when the bucket remains private.
- Extend with additional indexes or triggers once analytics/reporting needs grow.
