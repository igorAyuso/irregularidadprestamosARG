#!/usr/bin/env node
/*
 * Actualiza el dashboard HTML embebiendo los datos JSON nuevos.
 * Reemplaza:
 *   - const seriesData = {...}
 *   - const entitySeriesData = {...}
 *   - const entityData = {...}
 * Tambien reemplaza referencias textuales del periodo.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_DIR = process.argv[2] || 'C:/Users/Igor/Downloads/irregularidadprestamosARG';

const HTML_PATH = path.join(REPO_DIR, 'index.html');
const DATA_V4 = path.join(REPO_DIR, 'data_v4_202603.json');
const DATA_SERIES = path.join(REPO_DIR, 'data_series.json');
const DATA_ENT_SERIES = path.join(REPO_DIR, 'data_entity_series.json');

// Period labels for the new data
const NEW_PERIODO = '2026-03';
const NEW_PERIODO_LABEL = 'Marzo 2026';
const NEW_PERIODO_SHORT = 'Mar 2026';
const OLD_PERIODO_LABEL = 'Enero 2026';
const OLD_PERIODO_SHORT = 'Ene 2026';

console.error('Loading data files...');
const dataV4 = JSON.parse(fs.readFileSync(DATA_V4, 'utf8'));
const dataSeries = JSON.parse(fs.readFileSync(DATA_SERIES, 'utf8'));
const dataEntSeries = JSON.parse(fs.readFileSync(DATA_ENT_SERIES, 'utf8'));

// === Override most recent month (March 2026) with deudores.txt data ===
// data_v4_202603.json has authoritative values for the latest month.
// data_series.json has the latest month at the END of the series array (newest last).
const lastIdx = dataSeries.series.length - 1;
const lastEntry = dataSeries.series[lastIdx];

if (lastEntry.periodo !== NEW_PERIODO) {
  console.error(`WARNING: last series periodo=${lastEntry.periodo}, expected ${NEW_PERIODO}`);
}

// Pull authoritative %s from deudores.txt
const ff = dataV4.familia_financiero.summary;
const fn = dataV4.familia_no_financiero.summary;
const ef = dataV4.empresa_financiero.summary;
const en = dataV4.empresa_no_financiero.summary;

lastEntry.fam_fin_amt = ff.pct_irregular_amt;
lastEntry.fam_fin_qty = ff.pct_irregular_qty;
lastEntry.fam_fin_tc = ff.total_credit;
lastEntry.fam_fin_ic = ff.irregular_credit;
lastEntry.fam_fin_tr = ff.total_records;
lastEntry.fam_fin_ir = ff.irregular_records;

lastEntry.fam_nofin_amt = fn.pct_irregular_amt;
lastEntry.fam_nofin_qty = fn.pct_irregular_qty;
lastEntry.fam_nofin_tc = fn.total_credit;
lastEntry.fam_nofin_ic = fn.irregular_credit;
lastEntry.fam_nofin_tr = fn.total_records;
lastEntry.fam_nofin_ir = fn.irregular_records;

lastEntry.emp_fin_amt = ef.pct_irregular_amt;
lastEntry.emp_fin_qty = ef.pct_irregular_qty;
lastEntry.emp_fin_tc = ef.total_credit;
lastEntry.emp_fin_ic = ef.irregular_credit;
lastEntry.emp_fin_tr = ef.total_records;
lastEntry.emp_fin_ir = ef.irregular_records;

lastEntry.emp_nofin_amt = en.pct_irregular_amt;
lastEntry.emp_nofin_qty = en.pct_irregular_qty;
lastEntry.emp_nofin_tc = en.total_credit;
lastEntry.emp_nofin_ic = en.irregular_credit;
lastEntry.emp_nofin_tr = en.total_records;
lastEntry.emp_nofin_ir = en.irregular_records;

console.error(`Overrode last series entry (${lastEntry.label}) with monthly data`);

// === Override last month per entity in entitySeriesData with deudores.txt data ===
// data_v4 has authoritative per-entity data for the latest month.
// Some entities are late reporters (data dated as previous month) but their record
// is included in deudores.txt as the "current snapshot". The 24DSF leaves block 0
// empty for these entities. Fill the gap.
const TIPOS_MAP = {
  'familia_financiero': 'familia',
  'familia_no_financiero': 'familia',
  'empresa_financiero': 'empresa',
  'empresa_no_financiero': 'empresa',
};
let overrideHits = 0, overrideAdds = 0, overrideMisses = 0;
for (const section of Object.keys(TIPOS_MAP)) {
  const tipo = TIPOS_MAP[section];
  for (const ent of (dataV4[section].entities || [])) {
    const key = `${ent.code}_${tipo}`;
    const seriesEnt = dataEntSeries[key];
    const lastIdxEnt = seriesEnt ? seriesEnt.months.length - 1 : -1;
    const newLast = [
      ent.total_credit,
      ent.irregular_credit,
      ent.total_records,
      ent.irregular_records,
      ent.pct_irregular_amt,
      ent.pct_irregular_qty,
    ];
    if (seriesEnt) {
      // Replace last month
      seriesEnt.months[lastIdxEnt] = newLast;
      overrideHits++;
    } else {
      // Entity missing from 24DSF entirely. Add with one trailing month of data.
      const sector = (section.endsWith('_financiero')) ? 'financiero' : 'no_financiero';
      const months = [];
      for (let i = 0; i < 23; i++) months.push([0, 0, 0, 0, 0, 0]);
      months.push(newLast);
      dataEntSeries[key] = {
        code: ent.code,
        name: ent.name,
        sector,
        tipo,
        months,
      };
      overrideAdds++;
    }
  }
}
console.error(`Overrode ${overrideHits} entity-series last months; added ${overrideAdds} new entries`);

// Also update the periodo metadata in entityData
dataV4.periodo = NEW_PERIODO;
dataV4.periodo_label = NEW_PERIODO_LABEL;
if (dataV4.series && dataV4.series.length > 0) {
  dataV4.series[0].periodo = NEW_PERIODO;
  dataV4.series[0].label = NEW_PERIODO_SHORT;
}

// === Read HTML ===
console.error('Reading HTML...');
let html = fs.readFileSync(HTML_PATH, 'utf8');

// Use line-based replacement for the const declarations
const lines = html.split('\n');

let foundSeries = false, foundEntSeries = false, foundEntData = false;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.startsWith('        const seriesData = ')) {
    lines[i] = `        const seriesData = ${JSON.stringify(dataSeries)};`;
    foundSeries = true;
  } else if (l.startsWith('        const entitySeriesData = ')) {
    lines[i] = `        const entitySeriesData = ${JSON.stringify(dataEntSeries)};`;
    foundEntSeries = true;
  } else if (l.startsWith('        const entityData = ')) {
    lines[i] = `        const entityData = ${JSON.stringify(dataV4)};`;
    foundEntData = true;
  }
}

if (!foundSeries) console.error('WARNING: did not find seriesData line');
if (!foundEntSeries) console.error('WARNING: did not find entitySeriesData line');
if (!foundEntData) console.error('WARNING: did not find entityData line');

// Update comment for entityData
html = lines.join('\n');
html = html.replace(/\/\/ Embedded entity data \(January 2026\)/g, '// Embedded entity data (March 2026)');
html = html.replace(/\/\/ Embedded entity data \(Enero 2026\)/g, '// Embedded entity data (Marzo 2026)');

// Replace text references
const replacements = [
  ['Enero 2026', NEW_PERIODO_LABEL],
  ['Ene 2026', NEW_PERIODO_SHORT],
];
for (const [from, to] of replacements) {
  // Only replace in NON-script text (i.e., outside of const data lines).
  // But our const data is now JSON.stringified and shouldn't contain those strings (we updated periodo_label).
  // So a global replace is safe.
  const before = html.length;
  html = html.split(from).join(to);
  console.error(`Replaced "${from}" -> "${to}"`);
}

// Save
fs.writeFileSync(HTML_PATH, html);
console.error(`Updated ${HTML_PATH} (size=${(html.length/1024).toFixed(1)} KB)`);
