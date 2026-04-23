#!/usr/bin/env bash
# Download lagu Kicau Mania dari YouTube Shorts + trim ke 23.4 detik.
# Tidak di-bundle ke repo karena hak cipta. Jalankan sekali setelah clone.
#
# Dependency: yt-dlp + ffmpeg
#   macOS:  brew install yt-dlp ffmpeg
#   linux:  apt install yt-dlp ffmpeg
set -euo pipefail

cd "$(dirname "$0")/audio"

if [ -f "kicau-mania.mp3" ]; then
  echo "✓ kicau-mania.mp3 sudah ada (skip download)"
  exit 0
fi

# Cek dependency
command -v yt-dlp >/dev/null 2>&1 || { echo "❌ yt-dlp tidak terinstall. Install: brew install yt-dlp"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "❌ ffmpeg tidak terinstall. Install: brew install ffmpeg"; exit 1; }

SHORT_ID="EZ-htv0jY1g"
TMP="/tmp/kicau-dl-$$"
mkdir -p "$TMP"

echo "↓ download dari YouTube Shorts $SHORT_ID …"
yt-dlp -x --audio-format mp3 --audio-quality 0 \
  -o "$TMP/raw.%(ext)s" \
  "https://www.youtube.com/shorts/$SHORT_ID" 2>&1 | tail -3

echo "✂ trim mulai 3s, total 23.4 detik …"
ffmpeg -y -ss 3 -i "$TMP/raw.mp3" -t 23.4 \
  -codec:a libmp3lame -b:a 192k \
  kicau-mania.mp3 2>&1 | tail -1

rm -rf "$TMP"
echo "✓ Selesai → audio/kicau-mania.mp3"
echo "  Durasi: $(ffprobe -v error -show_entries format=duration -of csv=p=0 kicau-mania.mp3)s"
