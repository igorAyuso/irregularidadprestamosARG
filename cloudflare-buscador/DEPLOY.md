# Buscador por CUIT online — Cloudflare R2 + Worker

Arquitectura: el índice por CUIT (1000 shards `NNN.tsv`) vive en un bucket **R2**.
Un **Worker** recibe `?cuit=...`, lee solo el shard correspondiente y devuelve esa
persona en JSON. El dashboard (tab "Buscar CUIT") consume ese Worker cuando
`BUSCADOR_API` está seteado en `index.html`; si no, usa los archivos locales.

Por qué R2 y no una base SQL: recargar 40M filas/mes revienta los límites de
escritura gratuitos de D1/Turso. En R2 el refresh mensual son ~1000 PUTs (gratis),
sin medición por fila, y la lectura escala por CDN.

## Requisitos previos (los hace el usuario, 1 sola vez)
1. Crear cuenta gratuita en https://dash.cloudflare.com/sign-up
2. Autenticar la CLI:  `wrangler login`  (abre el navegador, aprobar)

## Deploy (se corre desde la raíz del repo)
```bash
# 0) generar el índice si no está (genera cuit_index/ + entidades.json)
node scripts_nodejs/construir_indice_cuit.js 202604DEUDORES cuit_index

# 1) crear el bucket R2
wrangler r2 bucket create cuit-index

# 2) subir el índice (1000 shards + meta.json)
bash cloudflare-buscador/subir_indice.sh cuit_index

# 3) desplegar el Worker
cd cloudflare-buscador && wrangler deploy && cd ..
# -> imprime la URL: https://cuit-buscador.<subdominio>.workers.dev

# 4) pegar esa URL en index.html:  const BUSCADOR_API = 'https://cuit-buscador.<subdominio>.workers.dev';
#    commit + push -> GitHub Pages queda con búsqueda online.
```

## Refresh mensual
Al cargar un mes nuevo, regenerar el índice y re-subir:
```bash
node scripts_nodejs/construir_indice_cuit.js <CARPETA_MES> cuit_index
bash cloudflare-buscador/subir_indice.sh cuit_index   # sobrescribe los shards
```
El Worker no se toca. (El cache del borde es de 1h.)

## Alternativa de subida más rápida (opcional)
`subir_indice.sh` usa `wrangler` en loop (simple pero ~20-30 min por los 1000 archivos).
Para subidas masivas más rápidas, usar **rclone** con las credenciales S3 de R2
(R2 → Manage R2 API Tokens → crear token S3): configurar un remote tipo `s3`
apuntando a `https://<accountid>.r2.cloudflarestorage.com` y `rclone copy cuit_index <remote>:cuit-index`.
