#!/usr/bin/env node
/*
 * Separa deudores.txt en archivos individuales por entidad financiera.
 * Cada archivo pesa menos de 95 MB. Si una entidad supera ese limite,
 * se divide en partes numeradas.
 * Equivalente Node.js de split_deudores.py
 */
'use strict';

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const INPUT_DIR = process.argv[2] || 'C:/Users/Igor/Downloads/Muni Pinamar/202601DEUDORES/202603DEUDORES';
const OUTPUT_DIR = process.argv[3] || 'C:/Users/Igor/Downloads/irregularidadprestamosARG/datos_por_entidad';

const MAX_BYTES = 95_000_000;

const DEUDORES = path.join(INPUT_DIR, 'deudores.txt');
const MAEENT = path.join(INPUT_DIR, 'Maeent.txt');

function sanitizeName(name) {
  let n = name.trim();
  n = n.replace(/[\/\\:*?"<>|]/g, '_');
  n = n.replace(/\s+/g, '_');
  n = n.replace(/_+/g, '_');
  n = n.replace(/^[_.]+|[_.]+$/g, '');
  if (n.length > 80) n = n.substring(0, 80);
  return n;
}

function loadEntities() {
  const entities = new Map();
  const data = fs.readFileSync(MAEENT, 'latin1');
  for (const line of data.split(/\r?\n/)) {
    if (line.length < 6) continue;
    const code = line.substring(0, 5);
    const name = line.substring(5).trim();
    entities.set(code, name);
  }
  return entities;
}

(async () => {
  const t0 = Date.now();
  const entities = loadEntities();
  console.error(`Entidades cargadas: ${entities.size}`);

  // Clean output dir or create
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  } else {
    // Remove existing .txt files to start fresh
    const files = fs.readdirSync(OUTPUT_DIR);
    for (const f of files) {
      if (f.endsWith('.txt')) fs.unlinkSync(path.join(OUTPUT_DIR, f));
    }
    console.error('Cleared old per-entity files');
  }

  function getFilename(code, part) {
    const name = entities.get(code) || `ENTIDAD_${code}`;
    const safe = sanitizeName(name);
    return part === 1 ? `${code}_${safe}.txt` : `${code}_${safe}_parte_${part}.txt`;
  }

  // state[code] = {part, bytes, lines, fd}
  const state = new Map();
  const buffers = new Map(); // code -> string buffer

  let totalLines = 0;

  const stream = fs.createReadStream(DEUDORES, { encoding: 'latin1', highWaterMark: 1 << 22 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  function flushBuffer(code) {
    const buf = buffers.get(code);
    if (!buf) return;
    const s = state.get(code);
    fs.writeSync(s.fd, buf);
    buffers.set(code, '');
  }

  function rotateIfNeeded(code, lineBytes) {
    const s = state.get(code);
    if (s.bytes + lineBytes > MAX_BYTES) {
      // Flush + close current
      flushBuffer(code);
      fs.closeSync(s.fd);
      s.part += 1;
      s.bytes = 0;
      const newPath = path.join(OUTPUT_DIR, getFilename(code, s.part));
      s.fd = fs.openSync(newPath, 'w');
    }
  }

  for await (const line of rl) {
    totalLines++;
    if (line.length < 5) continue;
    const code = line.substring(0, 5);

    let s = state.get(code);
    if (!s) {
      const fpath = path.join(OUTPUT_DIR, getFilename(code, 1));
      s = { part: 1, bytes: 0, fd: fs.openSync(fpath, 'w') };
      state.set(code, s);
      buffers.set(code, '');
    }

    const out = line + '\n';
    const lineBytes = Buffer.byteLength(out, 'latin1');
    rotateIfNeeded(code, lineBytes);

    let buf = buffers.get(code) + out;
    s.bytes += lineBytes;

    // Flush per-entity buffer when it's big enough
    if (buf.length > 256 * 1024) {
      fs.writeSync(s.fd, buf);
      buf = '';
    }
    buffers.set(code, buf);

    if ((totalLines % 5_000_000) === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      console.error(`  ${totalLines.toLocaleString()} lines (${elapsed.toFixed(0)}s)`);
    }
  }

  // Final flush + close
  for (const [code, buf] of buffers.entries()) {
    if (buf.length > 0) {
      const s = state.get(code);
      fs.writeSync(s.fd, buf);
    }
  }
  for (const [, s] of state.entries()) {
    fs.closeSync(s.fd);
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.error(`\nCompletado en ${elapsed.toFixed(0)} segundos`);
  console.error(`Total lineas: ${totalLines.toLocaleString()}`);
  console.error(`Entidades: ${state.size}`);

  let totalFiles = 0;
  let maxSize = 0;
  for (const [, s] of state.entries()) totalFiles += s.part;
  for (const f of fs.readdirSync(OUTPUT_DIR)) {
    const fp = path.join(OUTPUT_DIR, f);
    const sz = fs.statSync(fp).size;
    if (sz > maxSize) maxSize = sz;
    if (sz > 100_000_000) console.error(`  ALERTA: ${f} = ${(sz/1e6).toFixed(1)} MB`);
  }
  console.error(`Archivos: ${totalFiles}`);
  console.error(`Mas grande: ${(maxSize/1e6).toFixed(1)} MB`);
})();
