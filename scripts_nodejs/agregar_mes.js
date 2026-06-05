#!/usr/bin/env node
/*
 * agregar_mes.js — Agrega un mes nuevo al dashboard (modo ACUMULAR).
 *
 * Toma la serie base directamente de los datos YA EMBEBIDOS en index.html
 * (la fuente de verdad que se muestra), le suma el mes nuevo calculado desde
 * el archivo mensual (data_v4_<periodo>.json), re-embebe todo y actualiza los
 * textos de período. También persiste data_series.json / data_entity_series.json.
 *
 * NO usa el 24DSF: la historia ya está, solo se le APPENDEA el mes nuevo.
 *
 * Uso:
 *   node scripts_nodejs/agregar_mes.js <REPO_DIR> <DATA_V4_JSON>
 * Ej:
 *   node scripts_nodejs/agregar_mes.js . data_v4_202604.json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_DIR = process.argv[2] || '.';
const DATA_V4 = process.argv[3] || 'data_v4_202604.json';
const HTML_PATH = path.join(REPO_DIR, 'index.html');

const MESES_FULL = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_ABBR = ['', 'Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const SECTIONS = {
  fam_fin: 'familia_financiero',
  emp_fin: 'empresa_financiero',
  fam_nofin: 'familia_no_financiero',
  emp_nofin: 'empresa_no_financiero',
};
const TIPO_OF = { familia_financiero: 'familia', familia_no_financiero: 'familia', empresa_financiero: 'empresa', empresa_no_financiero: 'empresa' };

function extractConst(html, name) {
  const prefix = `        const ${name} = `;
  const line = html.split('\n').find(l => l.startsWith(prefix));
  if (!line) throw new Error(`No se encontró la línea: const ${name}`);
  return JSON.parse(line.slice(prefix.length).replace(/;\s*$/, ''));
}

const html0 = fs.readFileSync(HTML_PATH, 'utf8');
const seriesData = extractConst(html0, 'seriesData');
const entitySeriesData = extractConst(html0, 'entitySeriesData');
const dataV4 = JSON.parse(fs.readFileSync(path.join(REPO_DIR, DATA_V4), 'utf8'));

// --- Período nuevo (desde data_v4) ---
const periodo = dataV4.periodo;                 // "2026-04"
const [yy, mm] = periodo.split('-').map(Number);
const labelShort = `${MESES_ABBR[mm]} ${String(yy % 100).padStart(2, '0')}`; // "Abr 26"
const labelFull = `${MESES_FULL[mm]} ${yy}`;     // "Abril 2026"

// Período anterior (último de la serie actual) — para reemplazar textos
const prevPeriodo = seriesData.months[seriesData.months.length - 1];
const [pyy, pmm] = prevPeriodo.split('-').map(Number);
const prevFull = `${MESES_FULL[pmm]} ${pyy}`;    // "Marzo 2026"
const prevShort = `${MESES_ABBR[pmm]} ${pyy}`;   // "Mar 2026"

if (seriesData.months.includes(periodo)) {
  console.error(`AVISO: el período ${periodo} ya está en la serie. Abortando para no duplicar.`);
  process.exit(1);
}

const baseLen = seriesData.months.length; // largo previo (p.ej. 24)

// --- 1) Serie agregada: construir la entrada del mes nuevo desde data_v4 ---
const entry = { periodo, label: labelShort };
for (const [k, section] of Object.entries(SECTIONS)) {
  const s = dataV4[section].summary;
  entry[`${k}_amt`] = s.pct_irregular_amt;
  entry[`${k}_qty`] = s.pct_irregular_qty;
  entry[`${k}_tc`] = s.total_credit;
  entry[`${k}_ic`] = s.irregular_credit;
  entry[`${k}_tr`] = s.total_records;
  entry[`${k}_ir`] = s.irregular_records;
}
seriesData.months.push(periodo);
seriesData.month_labels.push(labelShort);
seriesData.series.push(entry);

// --- 2) Serie por entidad: append del mes nuevo (alineado por índice) ---
const r1 = x => Math.round(x * 10) / 10;
const seenKeys = new Set();
let appended = 0, created = 0;

for (const [k, section] of Object.entries(SECTIONS)) {
  const tipo = TIPO_OF[section];
  const sector = section.endsWith('_financiero') && !section.includes('no_financiero') ? 'financiero' : 'no_financiero';
  for (const e of (dataV4[section].entities || [])) {
    const code = String(e.code).padStart(5, '0');
    const key = `${code}_${tipo}`;
    seenKeys.add(key);
    const m = [e.total_credit, e.irregular_credit, e.total_records, e.irregular_records, e.pct_irregular_amt, e.pct_irregular_qty];
    if (entitySeriesData[key]) {
      const arr = entitySeriesData[key].months;
      while (arr.length < baseLen) arr.push([0, 0, 0, 0, 0, 0]); // por si venía corta
      arr.push(m);
      appended++;
    } else {
      const months = [];
      for (let i = 0; i < baseLen; i++) months.push([0, 0, 0, 0, 0, 0]);
      months.push(m);
      entitySeriesData[key] = { code, name: e.name, sector, tipo, months };
      created++;
    }
  }
}
// Entidades que estaban en la serie pero NO reportaron este mes -> mes en cero
let zeroed = 0;
for (const [key, ent] of Object.entries(entitySeriesData)) {
  if (key.endsWith('_sistema')) continue; // el sistema se deriva en el browser
  if (!seenKeys.has(key)) {
    while (ent.months.length < baseLen) ent.months.push([0, 0, 0, 0, 0, 0]);
    ent.months.push([0, 0, 0, 0, 0, 0]);
    zeroed++;
  }
}

// --- 3) Persistir los JSON en disco (consistentes con lo embebido) ---
fs.writeFileSync(path.join(REPO_DIR, 'data_series.json'), JSON.stringify(seriesData));
fs.writeFileSync(path.join(REPO_DIR, 'data_entity_series.json'), JSON.stringify(entitySeriesData));

// --- 4) Re-embeber en index.html ---
// entityData = data_v4 del mes nuevo (con período actualizado)
dataV4.periodo = periodo;
dataV4.periodo_label = labelFull;
if (dataV4.series && dataV4.series[0]) { dataV4.series[0].periodo = periodo; dataV4.series[0].label = labelShort; }

const lines = html0.split('\n');
let f1 = false, f2 = false, f3 = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('        const seriesData = ')) { lines[i] = `        const seriesData = ${JSON.stringify(seriesData)};`; f1 = true; }
  else if (lines[i].startsWith('        const entitySeriesData = ')) { lines[i] = `        const entitySeriesData = ${JSON.stringify(entitySeriesData)};`; f2 = true; }
  else if (lines[i].startsWith('        const entityData = ')) { lines[i] = `        const entityData = ${JSON.stringify(dataV4)};`; f3 = true; }
}
if (!f1 || !f2 || !f3) { console.error(`ERROR: no se encontraron las 3 const (seriesData=${f1}, entitySeriesData=${f2}, entityData=${f3})`); process.exit(1); }
let html = lines.join('\n');

// --- 5) Textos de período (títulos de tabla, etc.) ---
html = html.split(prevFull).join(labelFull);
html = html.split(prevShort).join(labelShort.replace(/(\d{2})$/, m => `20${m}`)); // "Mar 2026" -> "Abr 2026"

fs.writeFileSync(HTML_PATH, html);

console.error('=== agregar_mes OK ===');
console.error(`Período agregado: ${labelFull} (${periodo})  [serie ahora: ${seriesData.months.length} meses]`);
console.error(`Entidades: ${appended} append, ${created} nuevas, ${zeroed} sin reportar (mes en cero)`);
console.error('KPIs del mes nuevo:');
for (const [k, section] of Object.entries(SECTIONS)) {
  const s = dataV4[section].summary;
  console.error(`  ${k.padEnd(10)}: ${String(s.pct_irregular_amt).padStart(6)}% monto | ${String(s.pct_irregular_qty).padStart(6)}% cant`);
}
