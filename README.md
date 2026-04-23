# Kicau Mania Cam 🐦

Web app open-source — game gestural berbasis kamera yang sinkron ke lagu **Kicau Mania** (Ndarboy Genk x Banditoz Yaow 86) viral di TikTok. Goyangkan tangan kiri↔kanan ikut beat, dapat poin, animasi kucing joget greenscreen + lirik karaoke real-time.

## Fitur
- **Face & hand tracking di browser** (face-api.js + MediaPipe Hands, no server).
- **Lirik karaoke** sync ke `audio.currentTime` via parser LRC standar.
- **Beat-aware visuals** — kucing joget (chroma-key greenscreen), JJ shake/flash effect.
- **Skor `+1` per swing** kiri↔kanan.
- **Leaderboard 2 mode**:
  - 📁 Local (localStorage)
  - 🌐 Global (Supabase realtime, 1 row per IP, highest score saja)
- **Toggle fitur** (lirik / kucing / JJ / musik / debug) — tersimpan di localStorage.
- **Seamless audio loop** via Web Audio API `AudioBufferSourceNode`.
- **Mobile-responsive**.

## Quick start (local dev)

### 1. Clone & install dependency runtime
```bash
git clone <repo>
cd kicau-mania-cam
bash download-faceapi.sh   # download face-api.js library
bash download-models.sh    # download model weights
```

### 2. Setup audio
File audio TIDAK ter-bundle (hak cipta). Download sekali via:
```bash
bash download-audio.sh
```
Script akan: download YouTube Shorts → trim 23.4s → save ke `audio/kicau-mania.mp3`. File `audio/kicau-mania.lrc` sudah ada di repo (timing lirik authored sendiri).

> Butuh `yt-dlp` + `ffmpeg`. Install: `brew install yt-dlp ffmpeg` (macOS).

### 3. Setup Supabase (opsional — kalau mau global leaderboard)
- Lihat **MAINTENANCE.md** untuk SQL migration + ambil credentials.
- Copy `js/config.example.js` → `js/config.js`, isi `SUPABASE_URL` + `SUPABASE_ANON_KEY`.
- File `config.js` sudah di `.gitignore`, **jangan commit**.

### 4. Jalankan server lokal
HTTP server yang support Range request (untuk audio seek):
```bash
node server.js 8080
```
Atau pakai `python3 -m http.server` (TIDAK support Range — audio seek bermasalah).

### 5. Buka browser
http://localhost:8080 → klik MULAI → izinkan kamera.

## Cara main
1. Tunjukkan **tangan ✋** ke kamera (wajib).
2. **Tutup mulut 🤐** + goyang tangan kiri↔kanan ikut beat.
3. Tiap swing kiri↔kanan = **+1 poin**.
4. Klik STOP → skor tersimpan ke leaderboard.

## Struktur file
```
kicau-mania-cam/
├── index.html
├── server.js                       # Node HTTP server dengan Range support
├── css/style.css
├── js/
│   ├── app.js                      # main app
│   ├── face-api.min.js             # vendored face-api.js
│   ├── config.js                   # Supabase creds (gitignored)
│   └── config.example.js           # template
├── models/                         # face-api weight files
├── audio/
│   ├── kicau-mania.mp3             # short loop
│   └── kicau-mania.lrc             # synced lyrics
├── assets/cat-dance.mp4            # greenscreen kucing joget
├── download-faceapi.sh
├── download-models.sh
├── MAINTENANCE.md                  # Supabase setup + admin guide
├── LICENSE
└── README.md
```

## Security & privacy

### Yang TIDAK di-store
- ❌ Tidak ada video/foto dari kamera (semua processing di-browser, tidak upload).
- ❌ IP address asli (di-hash SHA-256 + salt sebelum disimpan ke DB).

### Yang di-store di Supabase (kalau global LB aktif)
- ✅ Nama user (validated regex `^[A-Za-z0-9_\- .]{1,20}$`)
- ✅ Skor (validated 0–5000)
- ✅ Hash IP (untuk identifikasi unique pemain, untuk de-dup)
- ✅ Timestamp

### Validasi server-side (di SQL function)
- Score range check
- Name regex check (anti-XSS, anti-SQL injection by design)
- Rate limit 10 submit/menit/IP
- Hanya update kalau skor baru > existing

### Validasi client-side (defense in depth)
- Throttle submit 1 per 3 detik per session
- Sanitize HTML rendering (escape on display)
- Cap score 5000 sebelum kirim

### Anon key paparan publik
Supabase **anon key** dirancang untuk dipublic. Yang membatasi akses adalah **Row Level Security policies** + **RPC `security definer` function**. Anon role hanya bisa:
- SELECT dari `leaderboard` (read-only)
- CALL `submit_score()` RPC

Tidak bisa: INSERT/UPDATE/DELETE direct, atau SELECT dari `submit_attempts` (rate-limit table).

## Deployment

### Static hosting
Project ini 100% client-side static. Bisa deploy di:
- **Cloudflare Pages** — drag-drop folder
- **Netlify** — `netlify deploy --prod --dir .`
- **Vercel** — `vercel --prod`
- **GitHub Pages** — push branch ke `gh-pages`

### Penting saat deploy
1. **`js/config.js`** harus di-upload (atau gunakan environment variable + build step)
2. Audio HTTP `Range` request perlu di-support — semua hosting modern OK secara default
3. HTTPS wajib (kamera & MediaDevices API butuh secure context)

## Tech stack
- **Vanilla JS** (no build step, no framework)
- **face-api.js** — face detection + landmarks + expressions
- **MediaPipe Hands** — 21-point hand landmarks (akurasi tinggi)
- **Web Audio API** — seamless loop + beat detection (FFT analyser)
- **Supabase** — realtime DB + RPC (opsional)

## Lisensi
- **Code**: MIT (lihat LICENSE)
- **Audio "Kicau Mania"**: hak cipta Ndarboy Genk x Banditoz Yaow 86 — bundle di repo cuma untuk demo lokal.

## Kontribusi
Issue & PR welcome. Untuk perubahan besar, buka issue dulu untuk diskusi.
