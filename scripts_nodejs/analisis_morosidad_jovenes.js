#!/usr/bin/env node
/*
 * Analisis de morosidad en personas jovenes (DNI >= 40M, ~ <=25 anos en 2026).
 * Equivalente Node.js de analisis_morosidad_jovenes.py
 */
'use strict';

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const INPUT_DIR = process.argv[2] || 'C:/Users/Igor/Downloads/Muni Pinamar/202601DEUDORES/202603DEUDORES';
const OUTPUT_FILE = process.argv[3] || 'C:/Users/Igor/Downloads/irregularidadprestamosARG/analisis_morosidad_jovenes.json';
const PERIODO_LABEL = process.argv[4] || 'Marzo 2026';

const DEUDORES = path.join(INPUT_DIR, 'deudores.txt');
const MAEENT = path.join(INPUT_DIR, 'Maeent.txt');

const DNI_JOVEN_MIN = 40_000_000;
const DNI_EXTRANJERO = 90_000_000;
const PREFIJOS_PERSONAS = new Set(['20','23','24','27']);
const IRREG_SITS = new Set([3, 4, 5, 11]);

function loadEntities() {
  const entities = new Map();
  const data = fs.readFileSync(MAEENT, 'latin1');
  for (const line of data.split(/\r?\n/)) {
    if (line.length < 6) continue;
    entities.set(line.substring(0, 5), line.substring(5).trim());
  }
  return entities;
}

function parseAmount(s) {
  s = s.trim();
  if (!s) return 0;
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
}

(async () => {
  const t0 = Date.now();
  const entities = loadEntities();
  console.error(`Entidades cargadas: ${entities.size}`);

  const stats = {
    total_personas: 0,
    total_personas_monto: 0,
    morosos_total: 0,
    morosos_total_monto: 0,
    jovenes_total: 0,
    jovenes_monto: 0,
    jovenes_morosos: 0,
    jovenes_morosos_monto: 0,
    adultos_total: 0,
    adultos_monto: 0,
    adultos_morosos: 0,
    adultos_morosos_monto: 0,
    jovenes_por_situacion: {1:{count:0,monto:0},2:{count:0,monto:0},3:{count:0,monto:0},4:{count:0,monto:0},5:{count:0,monto:0},11:{count:0,monto:0}},
    jovenes_por_entidad: new Map(),
    dni_ranges: new Map(),
  };

  console.error('Procesando deudores.txt...');
  const stream = fs.createReadStream(DEUDORES, { encoding: 'latin1', highWaterMark: 1 << 22 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let n = 0;
  for await (const line of rl) {
    n++;
    if ((n % 5_000_000) === 0) console.error(`  ${n.toLocaleString()}...`);
    if (line.length < 50) continue;

    const tipoId = line.substring(11, 13);
    if (tipoId !== '11') continue;

    const cuit = line.substring(13, 24);
    const prefijo = cuit.substring(0, 2);
    if (!PREFIJOS_PERSONAS.has(prefijo)) continue;

    const dni = parseInt(cuit.substring(2, 10), 10);
    if (!Number.isFinite(dni) || dni >= DNI_EXTRANJERO) continue;

    const sit2 = line.substring(27, 29).trim();
    let situacion;
    if (sit2 === '11') situacion = 11;
    else {
      const c = parseInt(sit2, 10);
      if (!Number.isFinite(c)) continue;
      situacion = c;
    }

    // Match the original Python behavior: monto_str = line[28:40]
    const monto = parseAmount(line.substring(28, 40));

    const esMoroso = IRREG_SITS.has(situacion);
    const esJoven = dni >= DNI_JOVEN_MIN && dni < DNI_EXTRANJERO;
    const code = line.substring(0, 5);

    stats.total_personas++;
    stats.total_personas_monto += monto;
    if (esMoroso) {
      stats.morosos_total++;
      stats.morosos_total_monto += monto;
    }

    if (esJoven) {
      stats.jovenes_total++;
      stats.jovenes_monto += monto;
      const sk = situacion;
      if (stats.jovenes_por_situacion[sk]) {
        stats.jovenes_por_situacion[sk].count++;
        stats.jovenes_por_situacion[sk].monto += monto;
      }
      if (esMoroso) {
        stats.jovenes_morosos++;
        stats.jovenes_morosos_monto += monto;
      }
      let ent = stats.jovenes_por_entidad.get(code);
      if (!ent) {
        ent = { nombre: entities.get(code) || `ENTIDAD_${code}`, total: 0, morosos: 0, monto_total: 0, monto_moroso: 0 };
        stats.jovenes_por_entidad.set(code, ent);
      }
      ent.total++;
      ent.monto_total += monto;
      if (esMoroso) {
        ent.morosos++;
        ent.monto_moroso += monto;
      }
    } else {
      stats.adultos_total++;
      stats.adultos_monto += monto;
      if (esMoroso) {
        stats.adultos_morosos++;
        stats.adultos_morosos_monto += monto;
      }
    }

    const rango = Math.floor(dni / 5_000_000) * 5;
    const key = `${rango}M-${rango+5}M`;
    stats.dni_ranges.set(key, (stats.dni_ranges.get(key) || 0) + 1);
  }
  console.error(`Procesado en ${((Date.now()-t0)/1000).toFixed(0)}s, ${n.toLocaleString()} lineas`);

  // Sort top entities
  const topEnt = [...stats.jovenes_por_entidad.entries()]
    .sort((a, b) => b[1].morosos - a[1].morosos)
    .slice(0, 20);

  const round1 = (x) => Math.round(x * 10) / 10;
  const round2 = (x) => Math.round(x * 100) / 100;

  const output = {
    metadata: {
      fuente: `Central de Deudores BCRA - ${PERIODO_LABEL}`,
      proxy_edad: 'DNI >= 40.000.000 aprox menores 25 anios',
      exclusiones: 'DNI >= 90M (extranjeros), empresas (CUIT 30/33/34)',
      situaciones_morosas: [3, 4, 5, 11],
    },
    resumen: {
      total_personas: stats.total_personas,
      morosos_total: stats.morosos_total,
      tasa_morosidad_general: round2(stats.morosos_total / Math.max(stats.total_personas, 1) * 100),
      jovenes_total: stats.jovenes_total,
      jovenes_morosos: stats.jovenes_morosos,
      tasa_morosidad_jovenes: round2(stats.jovenes_morosos / Math.max(stats.jovenes_total, 1) * 100),
      adultos_total: stats.adultos_total,
      adultos_morosos: stats.adultos_morosos,
      tasa_morosidad_adultos: round2(stats.adultos_morosos / Math.max(stats.adultos_total, 1) * 100),
    },
    jovenes_por_situacion: Object.fromEntries(
      Object.entries(stats.jovenes_por_situacion).map(([k, v]) => [k, { count: v.count, monto: round1(v.monto) }])
    ),
    top_entidades_jovenes_morosos: topEnt.map(([code, d]) => ({
      codigo: code,
      nombre: d.nombre,
      total: d.total,
      morosos: d.morosos,
      tasa: round2(d.morosos / Math.max(d.total, 1) * 100),
      monto_total: round1(d.monto_total),
      monto_moroso: round1(d.monto_moroso),
    })),
    distribucion_dni: Object.fromEntries(stats.dni_ranges),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.error(`Saved ${OUTPUT_FILE}`);
  console.error(`\n=== RESUMEN ===`);
  console.error(`Personas: ${stats.total_personas.toLocaleString()}`);
  console.error(`Tasa morosidad general: ${output.resumen.tasa_morosidad_general}%`);
  console.error(`Jovenes (DNI>=40M): ${stats.jovenes_total.toLocaleString()}`);
  console.error(`Tasa morosidad jovenes: ${output.resumen.tasa_morosidad_jovenes}%`);
  console.error(`Tasa morosidad adultos: ${output.resumen.tasa_morosidad_adultos}%`);
})();
