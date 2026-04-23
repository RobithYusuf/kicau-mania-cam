# Maintenance — Supabase Leaderboard

> Project ini di-design **public-safe**: IP user di-hash sebelum disimpan, ada rate limit 10 submit/menit/IP, nama divalidasi pakai regex, dan skor di-cap 5000 (realistis). RPC `security definer` mencegah abuse direct table access.

## 1. Buat project Supabase
1. https://supabase.com → Sign up (free)
2. New project → pilih region terdekat (Singapore disarankan)
3. Tunggu provisioning ~2 menit

## 2. Schema migration (copy-paste ke SQL Editor)

```sql
-- Untuk hash IP (privacy)
create extension if not exists pgcrypto;

-- ===== Tabel leaderboard =====
create table if not exists leaderboard (
  ip_hash     text primary key,
  name        text not null check (
    length(name) between 1 and 20
    and name ~ '^[A-Za-z0-9_\- .]+$'
  ),
  score       integer not null check (score between 0 and 5000),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_leaderboard_score on leaderboard (score desc);

-- ===== Rate limit log =====
create table if not exists submit_attempts (
  ip_hash    text not null,
  attempt_at timestamptz default now()
);
create index if not exists idx_attempts on submit_attempts (ip_hash, attempt_at desc);

-- ===== Row Level Security =====
alter table leaderboard      enable row level security;
alter table submit_attempts  enable row level security;

drop policy if exists "anyone read" on leaderboard;
create policy "anyone read" on leaderboard for select using (true);

-- submit_attempts: TIDAK accessible dari anon (cuma function yang nulis)
-- (no policy = no access)

-- ===== Function: submit_score =====
create or replace function submit_score(p_ip text, p_name text, p_score int)
returns table (status text, current_score int) as $$
declare
  v_salt        text := 'kicau-mania-public-2026';
  v_hash        text := encode(digest(coalesce(p_ip, 'unknown') || v_salt, 'sha256'), 'hex');
  v_recent      int;
  v_existing    int;
  v_clean_name  text;
begin
  -- Validate score
  if p_score is null or p_score < 0 or p_score > 5000 then
    raise exception 'invalid score';
  end if;

  -- Clean & validate name (alphanumeric + space + dash + underscore + dot, 1–20 char)
  v_clean_name := substring(trim(coalesce(p_name, '')) from 1 for 20);
  if length(v_clean_name) < 1 then v_clean_name := 'Anonim'; end if;
  if v_clean_name !~ '^[A-Za-z0-9_\- .]+$' then
    raise exception 'invalid name characters';
  end if;

  -- Rate limit: max 10 submits per IP per menit
  select count(*) into v_recent from submit_attempts
    where ip_hash = v_hash and attempt_at > now() - interval '1 minute';
  if v_recent >= 10 then
    raise exception 'rate limit exceeded';
  end if;
  insert into submit_attempts (ip_hash) values (v_hash);

  -- Cleanup attempts > 5 menit (housekeeping)
  delete from submit_attempts where attempt_at < now() - interval '5 minutes';

  -- Upsert: hanya update kalau skor baru LEBIH TINGGI
  select score into v_existing from leaderboard where ip_hash = v_hash;
  if v_existing is null then
    insert into leaderboard (ip_hash, name, score) values (v_hash, v_clean_name, p_score);
    return query select 'inserted'::text, p_score;
  elsif p_score > v_existing then
    update leaderboard set score = p_score, name = v_clean_name, updated_at = now()
      where ip_hash = v_hash;
    return query select 'updated'::text, p_score;
  else
    return query select 'kept_higher'::text, v_existing;
  end if;
end;
$$ language plpgsql security definer;

-- Anon role bisa pangggil function, TIDAK bisa direct insert/update table
revoke all on function submit_score(text, text, int) from public;
grant execute on function submit_score(text, text, int) to anon;

-- ===== Realtime =====
alter publication supabase_realtime add table leaderboard;
```

## 3. Ambil credentials
**Settings → API**:
- **Project URL** (`https://xxxxx.supabase.co`)
- **anon public** key (JWT panjang)

Salin ke `js/config.js`:

```js
window.KICAU_CONFIG = {
  SUPABASE_URL:      "https://xxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
};
```

> ⚠️ `js/config.js` sudah di `.gitignore`. **Jangan commit file ini ke repo public**.

## 4. Verifikasi keamanan

### Cek anon hanya bisa SELECT + call function
```sql
-- Sebagai anon, ini harus FAILED (denied):
insert into leaderboard (ip_hash, name, score) values ('test', 'test', 9999);
-- expect: "new row violates row-level security policy"
```

### Test rate limit
```sql
select submit_score('1.2.3.4', 'spammer', 10);
-- panggil 11x cepat → call ke-11 dapat error "rate limit exceeded"
```

### Cek IP ter-hash di DB
```sql
select ip_hash, name, score from leaderboard limit 1;
-- ip_hash berupa hex 64-char, BUKAN IP asli
```

## 5. Maintenance umum

### Lihat top 20
```sql
select rank() over (order by score desc) as rank, name, score, updated_at
from leaderboard order by score desc limit 20;
```

### Hapus user nakal (pakai hash)
```sql
-- Cari hash dari IP tertentu (kamu butuh tahu IP asli + salt)
select encode(digest('180.214.123.45' || 'kicau-mania-public-2026', 'sha256'), 'hex');
-- Hapus pakai hash:
delete from leaderboard where ip_hash = '<hash-result-di-atas>';
```

### Reset semua
```sql
truncate leaderboard;
truncate submit_attempts;
```

### Cleanup table audit (cron)
```sql
-- Bisa dijalankan via Supabase Cron (Database → Extensions → pg_cron)
delete from submit_attempts where attempt_at < now() - interval '1 hour';
```

## 6. Production hardening (opsional, kalau abuse muncul)

### Restrict CORS ke domain produksi
Settings → API → JWT Settings: belum ada di Supabase free, gunakan **Edge Function proxy** sebagai gantinya.

### Tambah CAPTCHA (hCaptcha free)
1. Daftar [hCaptcha](https://hcaptcha.com)
2. Frontend: render widget, dapat token
3. Edge Function verify token sebelum panggil `submit_score`

### Block IP / Country
Buat trigger BEFORE INSERT ke `submit_attempts` yang reject IP tertentu.

### Stricter score validation
Tambah cek "skor mustahil per detik": time-since-last × max-score-per-second. Reject kalau melebihi.

## 7. Backup
```sql
copy (select * from leaderboard order by score desc) to '/tmp/leaderboard.csv' csv header;
```
Atau Dashboard → Database → Backups (auto daily di free tier).
