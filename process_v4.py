#!/usr/bin/env python3
"""
Process Central de Deudores v4.
- Separate familias (CUIT 20/23/24/27) vs empresas (30/33/34)
- Irregularity = situations 3, 4, 5, 11 (=mora >90 dias por norma BCRA)
- % aggregates use ALL entities; table filters small/debt-buyer entities
- Monto = Campo 7 (Préstamos) + Campo 9 (Garantías otorgadas) + Campo 10 (Otros conceptos)
  = "Financiaciones y Otros conceptos (puntos 2 y 3 del T.O.)"
  Esto coincide con la definición del monto en el archivo 24DSF.
"""

import json
from collections import defaultdict

import sys
import os

# Default paths (override via argv)
INPUT_FILE = "/sessions/practical-upbeat-ride/mnt/202601DEUDORES/deudores.txt"
MAEENT_FILE = "/sessions/practical-upbeat-ride/mnt/202601DEUDORES/Maeent.txt"
OUTPUT_FILE = "/sessions/practical-upbeat-ride/data_v4.json"

if len(sys.argv) >= 3:
    INPUT_FILE = os.path.join(sys.argv[1], 'deudores.txt')
    MAEENT_FILE = os.path.join(sys.argv[1], 'Maeent.txt')
    OUTPUT_FILE = sys.argv[2]

FAMILIA_PREFIXES = {'20','23','24','27'}
EMPRESA_PREFIXES = {'30','33','34'}

# Age cutoffs: DNI thresholds for "younger than X years" (in 2026)
# Based on Argentine DNI-birth year correlation
AGE_CUTS = {
    '25': 42_000_000,  # DNI >= 42M ≈ nacidos 2001+ ≈ <=25 en 2026
    '30': 38_000_000,  # DNI >= 38M ≈ nacidos 1996+ ≈ <=30 en 2026
    '35': 34_000_000,  # DNI >= 34M ≈ nacidos 1991+ ≈ <=35 en 2026
    '40': 30_000_000,  # DNI >= 30M ≈ nacidos 1986+ ≈ <=40 en 2026
}
DNI_EXTRANJERO = 90_000_000

def load_entities():
    entities = {}
    with open(MAEENT_FILE, 'r', encoding='latin-1') as f:
        for line in f:
            line = line.rstrip('\r\n')
            if len(line) < 6: continue
            entities[line[:5].strip()] = line[5:].strip()
    return entities

def classify_entity(code_str):
    code = int(code_str)
    if code < 1000: return "financiero"
    elif 44000 <= code <= 45999: return "financiero"
    elif 65000 <= code <= 65999: return "financiero"
    return "no_financiero"

def parse_amount(s):
    s = s.strip()
    if not s or s in (',0','0'): return 0.0
    try: return float(s.replace(',','.'))
    except: return 0.0

def main():
    print("Loading entities...", flush=True)
    entities = load_entities()
    entity_sector = {c: classify_entity(c) for c in entities}

    # Aggregate by (entity_code, tipo_persona)
    # tipo_persona = 'familia' or 'empresa'
    agg = defaultdict(lambda: {'tc':0.0,'ic':0.0,'tr':0,'ir':0})
    irreg = {'3','4','5','11'}

    # Age-segmented aggregation: agg_age[(ec, age_label, 'young'|'rest')] = {tc,ic,tr,ir}
    agg_age = defaultdict(lambda: {'tc':0.0,'ic':0.0,'tr':0,'ir':0})

    print("Processing...", flush=True)
    n = 0
    with open(INPUT_FILE, 'r', encoding='latin-1') as f:
        for line in f:
            n += 1
            if n % 5000000 == 0: print(f"  {n:,}...", flush=True)
            if len(line) < 41: continue

            ec = line[0:5]
            cuit_prefix = line[13:15]
            sit = line[27:29].strip()
            c7 = parse_amount(line[29:41])
            c9 = parse_amount(line[53:65]) if len(line) >= 65 else 0.0
            c10 = parse_amount(line[65:77]) if len(line) >= 77 else 0.0
            amt = c7 + c9 + c10

            if cuit_prefix in FAMILIA_PREFIXES:
                tipo = 'familia'
            elif cuit_prefix in EMPRESA_PREFIXES:
                tipo = 'empresa'
            else:
                continue  # skip unknown

            key = (ec, tipo)
            d = agg[key]
            d['tc'] += amt
            d['tr'] += 1
            is_irreg = sit in irreg
            if is_irreg:
                d['ic'] += amt
                d['ir'] += 1

            # Age segmentation (only for familias)
            if tipo == 'familia':
                try:
                    dni = int(line[15:23])
                except ValueError:
                    continue
                if dni >= DNI_EXTRANJERO:
                    continue  # skip foreigners for age analysis
                for age_label, threshold in AGE_CUTS.items():
                    bucket = 'young' if dni >= threshold else 'rest'
                    age_key = (ec, age_label, bucket)
                    da = agg_age[age_key]
                    da['tc'] += amt
                    da['tr'] += 1
                    if is_irreg:
                        da['ic'] += amt
                        da['ir'] += 1

    print(f"  Done: {n:,} lines", flush=True)

    # Build results for each combination of sector x tipo_persona
    MIN_CREDIT = 100_000
    MAX_IRREG = 95.0

    results = {}

    for tipo in ('familia', 'empresa'):
        for sector_name in ('financiero', 'no_financiero'):
            # Totals across ALL entities (for aggregate %)
            tot = {'tc':0,'ic':0,'tr':0,'ir':0}
            entity_list = []

            for (ec, tp), d in agg.items():
                if tp != tipo: continue
                s = entity_sector.get(ec, classify_entity(ec))
                if s != sector_name: continue

                tot['tc'] += d['tc']
                tot['ic'] += d['ic']
                tot['tr'] += d['tr']
                tot['ir'] += d['ir']

                name = entities.get(ec, f"Entidad {ec}")
                pct_amt = (d['ic']/d['tc']*100) if d['tc']>0 else 0
                pct_qty = (d['ir']/d['tr']*100) if d['tr']>0 else 0

                entry = {
                    'code': ec, 'name': name,
                    'total_credit': round(d['tc'],1),
                    'irregular_credit': round(d['ic'],1),
                    'pct_irregular_amt': round(pct_amt,2),
                    'total_records': d['tr'],
                    'irregular_records': d['ir'],
                    'pct_irregular_qty': round(pct_qty,2),
                    '_raw_tc': d['tc'], '_raw_pct': pct_amt
                }

                # Add age data for familias
                if tipo == 'familia':
                    age_data = {}
                    for age_label in AGE_CUTS:
                        young = agg_age.get((ec, age_label, 'young'), {'tc':0,'ic':0,'tr':0,'ir':0})
                        rest = agg_age.get((ec, age_label, 'rest'), {'tc':0,'ic':0,'tr':0,'ir':0})
                        age_data[age_label] = {
                            'young': {
                                'tc': round(young['tc'],1), 'ic': round(young['ic'],1),
                                'tr': young['tr'], 'ir': young['ir'],
                                'pct_amt': round(young['ic']/young['tc']*100,2) if young['tc']>0 else 0,
                                'pct_qty': round(young['ir']/young['tr']*100,2) if young['tr']>0 else 0,
                            },
                            'rest': {
                                'tc': round(rest['tc'],1), 'ic': round(rest['ic'],1),
                                'tr': rest['tr'], 'ir': rest['ir'],
                                'pct_amt': round(rest['ic']/rest['tc']*100,2) if rest['tc']>0 else 0,
                                'pct_qty': round(rest['ir']/rest['tr']*100,2) if rest['tr']>0 else 0,
                            }
                        }
                    entry['age_data'] = age_data

                entity_list.append(entry)

            # Include ALL entities (filtering done in frontend via toggle)
            for e in entity_list:
                e['pct_of_sector'] = round(e['_raw_tc']/tot['tc']*100, 2) if tot['tc']>0 else 0
                del e['_raw_tc']
                del e['_raw_pct']

            entity_list.sort(key=lambda x: x['total_credit'], reverse=True)
            shown = entity_list

            pct_amt = (tot['ic']/tot['tc']*100) if tot['tc']>0 else 0
            pct_qty = (tot['ir']/tot['tr']*100) if tot['tr']>0 else 0

            key = f"{tipo}_{sector_name}"
            results[key] = {
                'summary': {
                    'total_credit': round(tot['tc'],1),
                    'irregular_credit': round(tot['ic'],1),
                    'pct_irregular_amt': round(pct_amt,2),
                    'total_records': tot['tr'],
                    'irregular_records': tot['ir'],
                    'pct_irregular_qty': round(pct_qty,2),
                    'num_entities_total': len(entity_list),
                    'num_entities_shown': len(shown)
                },
                'entities': shown
            }

    # Build series data for charts
    series_entry = {
        'periodo': '2026-01', 'label': 'Ene 2026',
        'fam_fin_amt': results['familia_financiero']['summary']['pct_irregular_amt'],
        'fam_fin_qty': results['familia_financiero']['summary']['pct_irregular_qty'],
        'fam_nofin_amt': results['familia_no_financiero']['summary']['pct_irregular_amt'],
        'fam_nofin_qty': results['familia_no_financiero']['summary']['pct_irregular_qty'],
        'emp_fin_amt': results['empresa_financiero']['summary']['pct_irregular_amt'],
        'emp_fin_qty': results['empresa_financiero']['summary']['pct_irregular_qty'],
        'emp_nofin_amt': results['empresa_no_financiero']['summary']['pct_irregular_amt'],
        'emp_nofin_qty': results['empresa_no_financiero']['summary']['pct_irregular_qty'],
    }

    output = {
        'periodo': '2026-01',
        'periodo_label': 'Enero 2026',
        'series': [series_entry],
        'familia_financiero': results['familia_financiero'],
        'familia_no_financiero': results['familia_no_financiero'],
        'empresa_financiero': results['empresa_financiero'],
        'empresa_no_financiero': results['empresa_no_financiero'],
        'filter_rules': f'Mora >90 días (situaciones 3,4,5,11). Tabla excluye entidades < 100K miles o >= 95% irregularidad.'
    }

    print(f"\n=== RESULTADOS ===")
    for key in ['familia_financiero','familia_no_financiero','empresa_financiero','empresa_no_financiero']:
        s = results[key]['summary']
        print(f"{key:30s}: {s['pct_irregular_amt']:>6.2f}% (monto) | {s['pct_irregular_qty']:>6.2f}% (cant) | ${s['total_credit']:>18,.0f} | {s['num_entities_total']} ent")

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\nSaved to {OUTPUT_FILE}")

if __name__ == '__main__':
    main()
