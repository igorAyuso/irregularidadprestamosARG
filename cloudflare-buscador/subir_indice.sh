#!/usr/bin/env bash
# Sube el índice por CUIT (cuit_index/*.tsv + meta.json) al bucket R2 "cuit-index".
# Requiere: wrangler autenticado (wrangler login) y el bucket creado.
# Uso:  bash cloudflare-buscador/subir_indice.sh [CARPETA_INDICE]
set -euo pipefail

IDX="${1:-cuit_index}"
BUCKET="cuit-index"
WR="${WRANGLER:-wrangler}"

if [ ! -d "$IDX" ]; then echo "No existe la carpeta $IDX"; exit 1; fi

n=0; total=$(ls "$IDX"/*.tsv "$IDX"/meta.json 2>/dev/null | wc -l)
for f in "$IDX"/*.tsv "$IDX"/meta.json; do
  key=$(basename "$f")
  "$WR" r2 object put "$BUCKET/$key" --file="$f" --remote >/dev/null
  n=$((n+1))
  if (( n % 50 == 0 )); then echo "  subidos $n / $total"; fi
done
echo "Listo: $n objetos subidos a r2://$BUCKET"
echo "NOTA: para más velocidad se puede usar rclone con las credenciales S3 de R2 (ver DEPLOY.md)."
