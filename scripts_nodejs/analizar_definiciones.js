#!/usr/bin/env node
/*
 * Análisis de sensibilidad: irregularidad de FAMILIAS en el sector FINANCIERO
 * bajo distintas definiciones, para entender discrepancias con terceros (ej. 1816).
 *
 * Variables que mueven el número:
 *   - Monto: solo Campo 7 (Préstamos) vs C7+C9+C10 (financiaciones+otros, lo que usamos)
 *   - Situaciones consideradas "irregular": {3,4,5,11} (norma) vs {3,4,5} (sin sit 11) vs +sit2
 *   - Medición: por monto vs por cantidad
 *
 * Uso: node scripts_nodejs/analizar_definiciones.js <CARPETA_DEUDORES>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const INPUT_DIR = process.argv[2] || '202604DEUDORES';
const DEUDORES = path.join(INPUT_DIR, 'deudores.txt');

const FAMILIA = new Set(['20', '23', '24', '27']);
function esFinanciero(code) {
  const c = parseInt(code, 10);
  return c < 1000 || (c >= 44000 && c <= 45999) || (c >= 65000 && c <= 65999);
}
function amt(s) { s = s.trim(); if (!s || s === '0' || s === ',0') return 0; const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : 0; }

// Acumuladores: para cada combinación de (campoMonto, conjuntoSit) guardamos tc, ic, tr, ir
const acc = {};
function bump(key, total, irr, montoTotal, montoIrr) {
  let a = acc[key]; if (!a) { a = { tc: 0, ic: 0, tr: 0, ir: 0 }; acc[key] = a; }
  a.tc += montoTotal; a.tr += total;
  if (irr) { a.ic += montoIrr; a.ir += irr ? 1 : 0; }
}

const SET_NORMA = new Set(['3', '4', '5', '11']);
const SET_SIN11 = new Set(['3', '4', '5']);
const SET_CON2 = new Set(['2', '3', '4', '5', '11']);

(async () => {
  const t0 = Date.now();
  const rl = readline.createInterface({ input: fs.createReadStream(DEUDORES, { encoding: 'latin1', highWaterMark: 1 << 22 }), crlfDelay: Infinity });
  let n = 0;
  // estructura: acc[campo][setName] = {tc,ic,tr,ir}
  const A = {
    c7: { norma: o(), sin11: o(), con2: o() },
    c7910: { norma: o(), sin11: o(), con2: o() },
  };
  function o() { return { tc: 0, ic: 0, tr: 0, ir: 0 }; }

  for await (const line of rl) {
    n++;
    if ((n % 10000000) === 0) console.error(`  ${n.toLocaleString()}...`);
    if (line.length < 77) continue;
    const ec = line.substring(0, 5);
    if (!esFinanciero(ec)) continue;
    const pref = line.substring(13, 15);
    if (!FAMILIA.has(pref)) continue;
    const sit = line.substring(27, 29).trim();
    const c7 = amt(line.substring(29, 41));
    const c9 = amt(line.substring(53, 65));
    const c10 = amt(line.substring(65, 77));
    const m7 = c7;
    const m7910 = c7 + c9 + c10;

    for (const [campo, monto] of [['c7', m7], ['c7910', m7910]]) {
      for (const [setName, set] of [['norma', SET_NORMA], ['sin11', SET_SIN11], ['con2', SET_CON2]]) {
        const d = A[campo][setName];
        d.tc += monto; d.tr += 1;
        if (set.has(sit)) { d.ic += monto; d.ir += 1; }
      }
    }
  }

  const pct = (ic, tc) => tc > 0 ? (ic / tc * 100) : 0;
  console.error(`\nProcesadas ${n.toLocaleString()} líneas en ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  console.error('=== FAMILIAS · SECTOR FINANCIERO — % irregularidad bajo distintas definiciones ===\n');
  console.error('Monto         | Situaciones        | % por MONTO | % por CANTIDAD');
  console.error('--------------|--------------------|-------------|---------------');
  const rows = [
    ['Solo Campo 7', 'norma {3,4,5,11}', 'c7', 'norma'],
    ['Solo Campo 7', 'sin 11 {3,4,5}', 'c7', 'sin11'],
    ['Solo Campo 7', 'con 2 {2,3,4,5,11}', 'c7', 'con2'],
    ['C7+C9+C10 (ns)', 'norma {3,4,5,11}', 'c7910', 'norma'],
    ['C7+C9+C10 (ns)', 'sin 11 {3,4,5}', 'c7910', 'sin11'],
    ['C7+C9+C10 (ns)', 'con 2 {2,3,4,5,11}', 'c7910', 'con2'],
  ];
  for (const [mlabel, slabel, campo, setName] of rows) {
    const d = A[campo][setName];
    console.error(`${mlabel.padEnd(13)} | ${slabel.padEnd(18)} | ${pct(d.ic, d.tc).toFixed(2).padStart(9)}% | ${pct(d.ir, d.tr).toFixed(2).padStart(11)}%`);
  }
  console.error('\n(ns = nuestra definición actual del dashboard)');
})();
