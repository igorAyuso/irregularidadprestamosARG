#!/usr/bin/env node
/*
 * Procesa 24DSF.txt (23GB) y Maeent.txt
 * Equivalente Node.js de process_24dsf_v2.c
 * Genera:
 *   data_series.json        - serie agregada 24 meses por sector
 *   data_entity_series.json - serie por entidad por mes
 */
'use strict';

const fs = require('fs');
const path = require('path');

const INPUT_DIR = process.argv[2] || 'C:/Users/Igor/Downloads/Muni Pinamar/202601DEUDORES/24DSF202603';
const MAEENT_DIR = process.argv[3] || 'C:/Users/Igor/Downloads/Muni Pinamar/202601DEUDORES/202603DEUDORES';
const OUTPUT_DIR = process.argv[4] || 'C:/Users/Igor/Downloads/irregularidadprestamosARG';
const LATEST_YEAR = parseInt(process.argv[5] || '2026', 10);
const LATEST_MONTH = parseInt(process.argv[6] || '3', 10);  // March 2026 = block 0

const INPUT_FILE = path.join(INPUT_DIR, '24DSF.txt');
const MAEENT_FILE = path.join(MAEENT_DIR, 'Maeent.txt');

const N_MONTHS = 24;
const BLOCK_START = 18;
const BLOCK_SIZE = 15;

const IRREG_SITS = new Set(['3','4','5','11']);

function classifyEntity(code) {
  const c = parseInt(code, 10);
  if (c < 1000) return 0; // financiero
  if (c >= 44000 && c <= 45999) return 0;
  if (c >= 65000 && c <= 65999) return 0;
  return 1; // no_financiero
}

function loadEntities() {
  const entities = {}; // code (zero-padded) -> {sector, name}
  const data = fs.readFileSync(MAEENT_FILE, 'latin1');
  for (const line of data.split(/\r?\n/)) {
    if (line.length < 6) continue;
    const code = line.substring(0, 5).trim().padStart(5, '0');
    const name = line.substring(5).trim();
    entities[code] = { sector: classifyEntity(code), name };
  }
  return entities;
}

function parseAmount(buf) {
  // buf is a string of digits/spaces/comma. Replace comma with dot, parse.
  let tmp = '';
  let hasContent = false;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === ' ') continue;
    if (c === ',') { tmp += '.'; hasContent = true; }
    else if ((c >= '0' && c <= '9') || c === '-') { tmp += c; if (c !== '0') hasContent = true; }
  }
  if (!hasContent || tmp.length === 0) return 0;
  const v = parseFloat(tmp);
  return Number.isFinite(v) ? v : 0;
}

function isIrregular(sit) {
  const trimmed = sit.replace(/\s/g, '');
  return IRREG_SITS.has(trimmed);
}

// MonthData: tc, ic, tr, ir as flat arrays for performance
// agg_data[combo][month] -> {tc,ic,tr,ir}
// 4 combos: 0=fin_fam, 1=fin_emp, 2=nofin_fam, 3=nofin_emp
const N_COMBOS = 4;
const aggTC = new Float64Array(N_COMBOS * N_MONTHS);
const aggIC = new Float64Array(N_COMBOS * N_MONTHS);
const aggTR = new Int32Array(N_COMBOS * N_MONTHS);
const aggIR = new Int32Array(N_COMBOS * N_MONTHS);

// Per-entity per-tipo per-month
// key: ec (5-digit) + tipo (familia/empresa)
// value: array of N_MONTHS objects
const entData = new Map(); // key -> { sector, name, tipo, monthsTC, monthsIC, monthsTR, monthsIR }

function getOrAddEntKey(entities, ec, tipo) {
  const key = `${ec}_${tipo === 0 ? 'familia' : 'empresa'}`;
  let e = entData.get(key);
  if (!e) {
    const meta = entities[ec] || { sector: classifyEntity(ec), name: '' };
    e = {
      code: ec,
      name: meta.name || `Entidad ${ec}`,
      sector: meta.sector === 0 ? 'financiero' : 'no_financiero',
      tipo: tipo === 0 ? 'familia' : 'empresa',
      monthsTC: new Float64Array(N_MONTHS),
      monthsIC: new Float64Array(N_MONTHS),
      monthsTR: new Int32Array(N_MONTHS),
      monthsIR: new Int32Array(N_MONTHS),
    };
    entData.set(key, e);
  }
  return e;
}

async function processFile(entities) {
  console.error(`Processing 24DSF.txt: ${INPUT_FILE}`);
  const stream = fs.createReadStream(INPUT_FILE, { encoding: 'latin1', highWaterMark: 1 << 22 });

  let buffer = '';
  let n = 0;
  const t0 = Date.now();

  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        let line = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        n++;
        if ((n % 10_000_000) === 0) {
          const elapsed = (Date.now() - t0) / 1000;
          console.error(`  ${n.toLocaleString()} lines (${elapsed.toFixed(1)}s, ${(n/elapsed).toFixed(0)} l/s)`);
        }

        if (line.length < BLOCK_START + BLOCK_SIZE) continue;

        // CUIT prefix at pos 7-8
        const cp0 = line.charCodeAt(7);
        const cp1 = line.charCodeAt(8);
        let tipo;
        // '2' is 50, '0'=48, '3'=51, '4'=52, '7'=55
        if (cp0 === 50 && (cp1 === 48 || cp1 === 51 || cp1 === 52 || cp1 === 55)) {
          tipo = 0; // familia
        } else if (cp0 === 51 && (cp1 === 48 || cp1 === 51 || cp1 === 52)) {
          tipo = 1; // empresa
        } else {
          continue;
        }

        const ec = line.substring(0, 5).trim().padStart(5, '0');
        const meta = entities[ec];
        const sector = meta ? meta.sector : classifyEntity(ec);
        const combo = sector * 2 + tipo;

        const entObj = getOrAddEntKey(entities, ec, tipo);

        for (let mi = 0; mi < N_MONTHS; mi++) {
          const off = BLOCK_START + mi * BLOCK_SIZE;
          if (off + 14 > line.length) break;

          // Situation: 2 chars
          const c0 = line[off];
          const c1 = line[off + 1];
          // Skip if both space or zero
          if ((c0 === ' ' || c0 === '0') && (c1 === ' ' || c1 === '0')) continue;

          const sit = (c0 + c1).replace(/\s/g, '');
          const amt = parseAmount(line.substring(off + 2, off + 14));

          const idx2 = combo * N_MONTHS + mi;
          aggTC[idx2] += amt;
          aggTR[idx2]++;

          entObj.monthsTC[mi] += amt;
          entObj.monthsTR[mi]++;

          if (IRREG_SITS.has(sit)) {
            aggIC[idx2] += amt;
            aggIR[idx2]++;
            entObj.monthsIC[mi] += amt;
            entObj.monthsIR[mi]++;
          }
        }
      }
    });
    stream.on('end', () => {
      // Process any leftover
      if (buffer.length > 0) {
        // ignore last partial
      }
      console.error(`Done: ${n.toLocaleString()} lines, ${entData.size} entity-tipo combinations`);
      resolve();
    });
    stream.on('error', reject);
  });
}

function buildLabels() {
  const mnames = ['', 'Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const months = [];
  const labels = [];
  let y = LATEST_YEAR, m = LATEST_MONTH;
  for (let i = 0; i < N_MONTHS; i++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    labels.push(`${mnames[m]} ${String(y % 100).padStart(2, '0')}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return { months, labels };
}

function writeAggregateSeries(months, labels) {
  const keys = ['fam_fin', 'emp_fin', 'fam_nofin', 'emp_nofin'];
  // months/labels are in reverse chrono (block 0 = latest); we want oldest -> newest
  const out = {
    months: months.slice().reverse(),
    month_labels: labels.slice().reverse(),
    series: [],
  };
  // Build entries from oldest to newest (i = N_MONTHS-1 down to 0 means: we want to iterate from oldest to newest)
  for (let i = N_MONTHS - 1; i >= 0; i--) {
    const entry = {
      periodo: months[i],
      label: labels[i],
    };
    for (let c = 0; c < N_COMBOS; c++) {
      const idx = c * N_MONTHS + i;
      const tc = aggTC[idx], ic = aggIC[idx];
      const tr = aggTR[idx], ir = aggIR[idx];
      const pa = tc > 0 ? ic / tc * 100 : 0;
      const pq = tr > 0 ? ir / tr * 100 : 0;
      const k = keys[c];
      entry[`${k}_amt`] = round2(pa);
      entry[`${k}_qty`] = round2(pq);
      entry[`${k}_tc`] = round1(tc);
      entry[`${k}_ic`] = round1(ic);
      entry[`${k}_tr`] = tr;
      entry[`${k}_ir`] = ir;
    }
    out.series.push(entry);
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'data_series.json'), JSON.stringify(out));
  console.error(`Saved data_series.json`);
}

function writeEntitySeries() {
  // Output JSON: { "00007_familia": {code, name, sector, tipo, months: [[tc,ic,tr,ir,pa,pq], ...]} }
  // Months ordered from oldest to newest
  const out = {};
  for (const [key, e] of entData.entries()) {
    // Check if has any data
    let hasData = false;
    for (let i = 0; i < N_MONTHS; i++) {
      if (e.monthsTR[i] > 0) { hasData = true; break; }
    }
    if (!hasData) continue;

    const monthsArr = [];
    for (let i = N_MONTHS - 1; i >= 0; i--) {
      const tc = e.monthsTC[i], ic = e.monthsIC[i];
      const tr = e.monthsTR[i], ir = e.monthsIR[i];
      const pa = tc > 0 ? ic / tc * 100 : 0;
      const pq = tr > 0 ? ir / tr * 100 : 0;
      monthsArr.push([round1(tc), round1(ic), tr, ir, round2(pa), round2(pq)]);
    }
    out[key] = {
      code: e.code,
      name: e.name,
      sector: e.sector,
      tipo: e.tipo,
      months: monthsArr,
    };
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'data_entity_series.json'), JSON.stringify(out));
  console.error(`Saved data_entity_series.json (${Object.keys(out).length} entries)`);
}

function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }

(async () => {
  const t0 = Date.now();
  const entities = loadEntities();
  console.error(`Loaded ${Object.keys(entities).length} entities`);

  await processFile(entities);
  const { months, labels } = buildLabels();

  writeAggregateSeries(months, labels);
  writeEntitySeries();

  // Print last 6 months familias financiero summary
  console.error('\n=== Fam Fin (ultimos 6 meses) ===');
  for (let i = 5; i >= 0; i--) {
    const idx = 0 * N_MONTHS + i;
    const tc = aggTC[idx], ic = aggIC[idx];
    const p = tc > 0 ? ic/tc*100 : 0;
    console.error(`  ${labels[i]}: ${p.toFixed(2)}%`);
  }
  console.error(`\nTotal time: ${((Date.now() - t0)/1000).toFixed(1)}s`);
})();
