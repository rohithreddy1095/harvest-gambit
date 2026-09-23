#!/usr/bin/env bash
# Stream the Lichess puzzle database (CC0, ~300 MB compressed) and keep easy, popular mate-in-3
# puzzles where White solves: rating 900-1450, popularity >= 90, >= 1500 plays. Sorted by popularity.
set -euo pipefail
cd "$(dirname "$0")"
curl -sL https://database.lichess.org/lichess_db_puzzle.csv.zst | zstdcat \
  | awk -F, 'NR==1 || ($8 ~ /mateIn3/ && $4 >= 900 && $4 <= 1450 && $6 >= 90 && $7 >= 1500 && $2 ~ / b /)' > raw.csv
(head -1 raw.csv; tail -n +2 raw.csv | sort -t, -k6,6nr -k7,7nr) > mate3-easy.csv && rm raw.csv
echo "$(($(wc -l < mate3-easy.csv) - 1)) candidates in puzzles/mate3-easy.csv; next: node puzzles/verify.mjs 500"
