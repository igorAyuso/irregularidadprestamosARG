#!/usr/bin/env node
/*
 * Construye un índice por CUIT para el buscador del dashboard.
 * Parte los registros de deudores.txt en 1000 shards (por CUIT % 1000 = últimos 3
 * dígitos), para que el buscador baje solo el shard necesario (~1.5MB) y encuentre
 * al deudor al instante, sin cargar los 6.6GB.
 *
 * Salida (local, NO se versiona):
 *   cuit_index/000.tsv ... 999.tsv   -> líneas: cuit \t entidad \t sit \t monto \t dias
 *   cuit_index/meta.json             -> { periodo, generado, total }
 *   entidades.json                   -> { "7": "BANCO ...", ... }  (code -> nombre)
 *
 * Uso: node scripts_nodejs/construir_indice_cuit.js <CARPETA_DEUDORES> [OUT_DIR]
 */
'use strict';
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const DIR = process.argv[2] || '202604DEUDORES';
const OUT = process.argv[3] || 'cuit_index';
const REPO = process.cwd();

const DEUDORES = path.join(DIR, 'deudores.txt');
const MAEENT = path.join(DIR, 'Maeent.txt');
const SHARDS = 1000;
const FLUSH_EVERY = 2_000_000;

function parseAmount(s) { s = s.trim(); if (!s || s === '0' || s === ',0') return 0; const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : 0; }

(async () => {
  const t0 = Date.now();

  // entidades.json (code sin ceros -> nombre)
  const ent = {};
  for (const l of fs.readFileSync(MAEENT, 'latin1').split(/\r?\n/)) {
    if (l.length < 6) continue;
    ent[String(parseInt(l.slice(0, 5), 10))] = l.slice(5).trim();
  }
  fs.writeFileSync(path.join(REPO, 'entidades.json'), JSON.stringify(ent));
  console.error(`entidades.json: ${Object.keys(ent).length} entidades`);

  // preparar carpeta de shards
  if (fs.existsSync(OUT)) {
    for (const f of fs.readdirSync(OUT)) if (f.endsWith('.tsv') || f.endsWith('.json')) fs.unlinkSync(path.join(OUT, f));
  } else fs.mkdirSync(OUT, { recursive: true });

  const buf = Array.from({ length: SHARDS }, () => []);
  let n = 0, kept = 0;
  let periodo = null;

  function flush() {
    for (let s = 0; s < SHARDS; s++) {
      if (buf[s].length === 0) continue;
      fs.appendFileSync(path.join(OUT, String(s).padStart(3, '0') + '.tsv'), buf[s].join(''));
      buf[s].length = 0;
    }
  }

  const rl = readline.createInterface({ input: fs.createReadStream(DEUDORES, { encoding: 'latin1', highWaterMark: 1 << 22 }), crlfDelay: Infinity });
  for await (const line of rl) {
    n++;
    if ((n % 5_000_000) === 0) console.error(`  ${n.toLocaleString()}... (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    if (line.length < 41) continue;
    if (!periodo) periodo = line.slice(5, 11); // AAAAMM del primer registro
    const ec = parseInt(line.slice(0, 5), 10);
    const cuit = line.slice(13, 24);
    if (!/^\d{11}$/.test(cuit)) continue;
    const sit = line.slice(27, 29).trim();
    const c7 = parseAmount(line.slice(29, 41));
    const c9 = line.length >= 65 ? parseAmount(line.slice(53, 65)) : 0;
    const c10 = line.length >= 77 ? parseAmount(line.slice(65, 77)) : 0;
    const monto = c7 + c9 + c10;
    const dias = line.length >= 171 ? parseInt(line.slice(167, 171), 10) || 0 : 0;
    const shard = Number(cuit) % SHARDS;
    buf[shard].push(`${cuit}\t${ec}\t${sit}\t${Math.round(monto * 10) / 10}\t${dias}\n`);
    kept++;
    if ((n % FLUSH_EVERY) === 0) flush();
  }
  flush();

  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ periodo, generado: DIR, shards: SHARDS, registros: kept }));
  console.error(`\nÍndice listo: ${kept.toLocaleString()} registros en ${SHARDS} shards (período ${periodo})`);
  console.error(`Tiempo: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
