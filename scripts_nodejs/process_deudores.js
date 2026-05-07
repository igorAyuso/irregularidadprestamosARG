#!/usr/bin/env node
/*
 * Procesa deudores.txt (Marzo 2026) y Maeent.txt
 * Equivalente Node.js de process_v4.py
 * Salida: data_v4.json (entidad-level, agregados por familia/empresa x financiero/no_financiero)
 */
'use strict';

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const INPUT_DIR = process.argv[2] || 'C:/Users/Igor/Downloads/Muni Pinamar/202601DEUDORES/202603DEUDORES';
const OUTPUT_FILE = process.argv[3] || 'C:/Users/Igor/Downloads/irregularidadprestamosARG/data_v4_202603.json';
const PERIODO = process.argv[4] || '2026-03';
const PERIODO_LABEL = process.argv[5] || 'Marzo 2026';

const DEUDORES = path.join(INPUT_DIR, 'deudores.txt');
const MAEENT = path.join(INPUT_DIR, 'Maeent.txt');

const FAMILIA_PREFIXES = new Set(['20','23','24','27']);
const EMPRESA_PREFIXES = new Set(['30','33','34']);
const IRREG_SITS = new Set(['3','4','5','11']);

// DNI cutoffs for age segmentation (2026)
const AGE_CUTS = {
  '25': 42_000_000,
  '30': 38_000_000,
  '35': 34_000_000,
  '40': 30_000_000,
};
const DNI_EXTRANJERO = 90_000_000;

function classifyEntity(code) {
  const c = parseInt(code, 10);
  if (c < 1000) return 'financiero';
  if (c >= 44000 && c <= 45999) return 'financiero';
  if (c >= 65000 && c <= 65999) return 'financiero';
  return 'no_financiero';
}

function parseAmount(s) {
  s = s.trim();
  if (!s || s === '0' || s === ',0') return 0;
  // Replace comma with dot for decimal
  const normalized = s.replace(',', '.');
  const v = parseFloat(normalized);
  return Number.isFinite(v) ? v : 0;
}

async function loadEntities() {
  const entities = new Map();
  const data = fs.readFileSync(MAEENT, 'latin1');
  for (const line of data.split(/\r?\n/)) {
    if (line.length < 6) continue;
    const code = line.substring(0, 5).trim().padStart(5, '0');
    const name = line.substring(5).trim();
    entities.set(code, name);
  }
  return entities;
}

function emptyAgg() {
  return { tc: 0, ic: 0, tr: 0, ir: 0 };
}

async function processFile(entities) {
  // agg[entityCode|tipo] -> {tc,ic,tr,ir}
  const agg = new Map();
  // aggAge[entityCode|ageLabel|bucket] -> {tc,ic,tr,ir}
  const aggAge = new Map();

  console.error('Processing deudores.txt...');
  const stream = fs.createReadStream(DEUDORES, { encoding: 'latin1', highWaterMark: 1 << 20 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let n = 0;
  for await (const line of rl) {
    n++;
    if ((n % 5_000_000) === 0) console.error(`  ${n.toLocaleString()}...`);
    if (line.length < 41) continue;

    const ec = line.substring(0, 5);
    const cuitPrefix = line.substring(13, 15);
    const sit = line.substring(27, 29).trim();
    const c7 = parseAmount(line.substring(29, 41));
    const c9 = line.length >= 65 ? parseAmount(line.substring(53, 65)) : 0;
    const c10 = line.length >= 77 ? parseAmount(line.substring(65, 77)) : 0;
    const amt = c7 + c9 + c10;

    let tipo;
    if (FAMILIA_PREFIXES.has(cuitPrefix)) tipo = 'familia';
    else if (EMPRESA_PREFIXES.has(cuitPrefix)) tipo = 'empresa';
    else continue;

    const key = `${ec}|${tipo}`;
    let d = agg.get(key);
    if (!d) { d = emptyAgg(); agg.set(key, d); }
    d.tc += amt;
    d.tr += 1;
    const isIrreg = IRREG_SITS.has(sit);
    if (isIrreg) {
      d.ic += amt;
      d.ir += 1;
    }

    // Age segmentation (familias only)
    if (tipo === 'familia') {
      const dniStr = line.substring(15, 23);
      const dni = parseInt(dniStr, 10);
      if (Number.isFinite(dni) && dni < DNI_EXTRANJERO) {
        for (const ageLabel of Object.keys(AGE_CUTS)) {
          const threshold = AGE_CUTS[ageLabel];
          const bucket = dni >= threshold ? 'young' : 'rest';
          const ageKey = `${ec}|${ageLabel}|${bucket}`;
          let da = aggAge.get(ageKey);
          if (!da) { da = emptyAgg(); aggAge.set(ageKey, da); }
          da.tc += amt;
          da.tr += 1;
          if (isIrreg) {
            da.ic += amt;
            da.ir += 1;
          }
        }
      }
    }
  }
  console.error(`  Done: ${n.toLocaleString()} lines`);
  return { agg, aggAge };
}

function buildResults(entities, agg, aggAge) {
  const results = {};
  const TIPOS = ['familia', 'empresa'];
  const SECTORS = ['financiero', 'no_financiero'];

  for (const tipo of TIPOS) {
    for (const sectorName of SECTORS) {
      const tot = emptyAgg();
      const entityList = [];

      for (const [k, d] of agg.entries()) {
        const [ec, tp] = k.split('|');
        if (tp !== tipo) continue;
        const s = classifyEntity(ec);
        if (s !== sectorName) continue;

        tot.tc += d.tc;
        tot.ic += d.ic;
        tot.tr += d.tr;
        tot.ir += d.ir;

        const name = entities.get(ec) || `Entidad ${ec}`;
        const pctAmt = d.tc > 0 ? (d.ic / d.tc * 100) : 0;
        const pctQty = d.tr > 0 ? (d.ir / d.tr * 100) : 0;

        const entry = {
          code: ec,
          name,
          total_credit: round1(d.tc),
          irregular_credit: round1(d.ic),
          pct_irregular_amt: round2(pctAmt),
          total_records: d.tr,
          irregular_records: d.ir,
          pct_irregular_qty: round2(pctQty),
          _raw_tc: d.tc,
        };

        if (tipo === 'familia') {
          const ageData = {};
          for (const ageLabel of Object.keys(AGE_CUTS)) {
            const young = aggAge.get(`${ec}|${ageLabel}|young`) || emptyAgg();
            const rest = aggAge.get(`${ec}|${ageLabel}|rest`) || emptyAgg();
            ageData[ageLabel] = {
              young: ageBlock(young),
              rest: ageBlock(rest),
            };
          }
          entry.age_data = ageData;
        }

        entityList.push(entry);
      }

      for (const e of entityList) {
        e.pct_of_sector = tot.tc > 0 ? round2(e._raw_tc / tot.tc * 100) : 0;
        delete e._raw_tc;
      }
      entityList.sort((a, b) => b.total_credit - a.total_credit);

      const pctAmt = tot.tc > 0 ? (tot.ic / tot.tc * 100) : 0;
      const pctQty = tot.tr > 0 ? (tot.ir / tot.tr * 100) : 0;

      results[`${tipo}_${sectorName}`] = {
        summary: {
          total_credit: round1(tot.tc),
          irregular_credit: round1(tot.ic),
          pct_irregular_amt: round2(pctAmt),
          total_records: tot.tr,
          irregular_records: tot.ir,
          pct_irregular_qty: round2(pctQty),
          num_entities_total: entityList.length,
          num_entities_shown: entityList.length,
        },
        entities: entityList,
      };
    }
  }
  return results;
}

function ageBlock(d) {
  return {
    tc: round1(d.tc),
    ic: round1(d.ic),
    tr: d.tr,
    ir: d.ir,
    pct_amt: d.tc > 0 ? round2(d.ic / d.tc * 100) : 0,
    pct_qty: d.tr > 0 ? round2(d.ir / d.tr * 100) : 0,
  };
}

function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }

(async () => {
  const t0 = Date.now();
  const entities = await loadEntities();
  console.error(`Loaded ${entities.size} entities`);

  const { agg, aggAge } = await processFile(entities);
  const results = buildResults(entities, agg, aggAge);

  const seriesEntry = {
    periodo: PERIODO,
    label: PERIODO_LABEL.replace('Marzo 2026', 'Mar 2026').replace('Febrero 2026', 'Feb 2026'),
    fam_fin_amt: results.familia_financiero.summary.pct_irregular_amt,
    fam_fin_qty: results.familia_financiero.summary.pct_irregular_qty,
    fam_nofin_amt: results.familia_no_financiero.summary.pct_irregular_amt,
    fam_nofin_qty: results.familia_no_financiero.summary.pct_irregular_qty,
    emp_fin_amt: results.empresa_financiero.summary.pct_irregular_amt,
    emp_fin_qty: results.empresa_financiero.summary.pct_irregular_qty,
    emp_nofin_amt: results.empresa_no_financiero.summary.pct_irregular_amt,
    emp_nofin_qty: results.empresa_no_financiero.summary.pct_irregular_qty,
  };

  const output = {
    periodo: PERIODO,
    periodo_label: PERIODO_LABEL,
    series: [seriesEntry],
    familia_financiero: results.familia_financiero,
    familia_no_financiero: results.familia_no_financiero,
    empresa_financiero: results.empresa_financiero,
    empresa_no_financiero: results.empresa_no_financiero,
    filter_rules: 'Mora >90 dias (situaciones 3,4,5,11). Tabla excluye entidades < 100K miles o >= 95% irregularidad.',
  };

  console.error('\n=== RESULTADOS ===');
  for (const k of ['familia_financiero','familia_no_financiero','empresa_financiero','empresa_no_financiero']) {
    const s = results[k].summary;
    console.error(`${k.padEnd(30)}: ${s.pct_irregular_amt.toFixed(2).padStart(6)}% (monto) | ${s.pct_irregular_qty.toFixed(2).padStart(6)}% (cant) | $${Math.round(s.total_credit).toLocaleString().padStart(20)} | ${s.num_entities_total} ent`);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));
  console.error(`\nSaved to ${OUTPUT_FILE}`);
  console.error(`Total time: ${((Date.now() - t0)/1000).toFixed(1)}s`);
})();
