#!/usr/bin/env bash
# Render the film at 2x supersampling, add the soundtrack, and encode for X (< 512 MB).
set -euo pipefail
cd "$(dirname "$0")/.."
start=$(date +%s)
# Resumable: rerunning this script skips segments that already finished.
node film/render.mjs --video --fps 30 --w 1920 --h 1080 --q "&ss=2" --segdir seg-ss2 --out film-ss2-silent.mp4
ffmpeg -hide_banner -loglevel error -y -i film/out/film-ss2-silent.mp4 -i film/out/sound.wav -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 19 -maxrate 24M -bufsize 48M -profile:v high -pix_fmt yuv420p \
  -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart film/out/harvest-gambit-1.mp4
echo "done in $(( ($(date +%s) - start) / 60 )) min: $(ls -la film/out/harvest-gambit-1.mp4)"
