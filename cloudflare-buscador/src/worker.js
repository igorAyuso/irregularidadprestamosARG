/*
 * Worker del buscador por CUIT.
 * GET /?cuit=20143527744  ->  { cuit, periodo, registros: [{ec,sit,monto,dias}, ...] }
 *
 * Lee SOLO el shard correspondiente (cuit % 1000) del bucket R2 "cuit-index",
 * filtra el CUIT pedido y devuelve esa única persona. No expone el dump completo.
 */
const SHARDS = 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extraHeaders },
  });
}

let _periodoCache; // cache en memoria del Worker (vive lo que viva el isolate)

async function getPeriodo(env) {
  if (_periodoCache !== undefined) return _periodoCache;
  try {
    const m = await env.INDEX.get('meta.json');
    _periodoCache = m ? (JSON.parse(await m.text()).periodo || null) : null;
  } catch (e) { _periodoCache = null; }
  return _periodoCache;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    const raw = (url.searchParams.get('cuit') || '').replace(/\D/g, '');
    if (raw.length !== 11) return json({ error: 'cuit_invalido', mensaje: 'Se espera un CUIT/CUIL de 11 dígitos.' }, 400);

    const shard = String(Number(raw) % SHARDS).padStart(3, '0');
    const periodo = await getPeriodo(env);

    const obj = await env.INDEX.get(`${shard}.tsv`);
    if (!obj) return json({ cuit: raw, periodo, registros: [] });

    const txt = await obj.text();
    const registros = [];
    const needle = raw + '\t';
    for (const line of txt.split('\n')) {
      if (!line.startsWith(needle)) continue;
      const p = line.split('\t');
      registros.push({ ec: p[1], sit: p[2], monto: parseFloat(p[3]) || 0, dias: parseInt(p[4], 10) || 0 });
    }
    // cache en el borde 1h (el dato cambia 1 vez por mes)
    return json({ cuit: raw, periodo, registros }, 200, { 'Cache-Control': 'public, max-age=3600' });
  },
};
