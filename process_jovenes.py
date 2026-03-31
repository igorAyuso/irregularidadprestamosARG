#!/usr/bin/env python3
"""
Análisis de morosidad crediticia de menores de 24 años vs. población general.

Criterio: DNI >= 40.000.000 (nacidos ~2002 en adelante → menores de 24 a Ene 2026)
Solo familias (personas humanas): CUIT prefijo 20/23/24/27

Procesa deudores.txt y compara:
  - Menores de 24 años (DNI >= 40M)
  - Población general (todos)
Desglosado por sector financiero vs no financiero.
"""

import json
import sys
from collections import defaultdict

INPUT_FILE = "deudores.txt"
MAEENT_FILE = "Maeent.txt"
OUTPUT_FILE = "data_jovenes.json"

FAMILIA_PREFIXES = {'20', '23', '24', '27'}
DNI_THRESHOLD = 40_000_000  # DNI >= esto = menor de 24 años aprox.

IRREG_SITS = {'3', '4', '5', '11'}


def load_entities():
    entities = {}
    with open(MAEENT_FILE, 'r', encoding='latin-1') as f:
        for line in f:
            line = line.rstrip('\r\n')
            if len(line) < 6:
                continue
            entities[line[:5].strip()] = line[5:].strip()
    return entities


def classify_entity(code_str):
    code = int(code_str)
    if code < 1000:
        return "financiero"
    elif 44000 <= code <= 45999:
        return "financiero"
    elif 65000 <= code <= 65999:
        return "financiero"
    return "no_financiero"


def parse_amount(s):
    s = s.strip()
    if not s or s in (',0', '0'):
        return 0.0
    try:
        return float(s.replace(',', '.'))
    except:
        return 0.0


def extract_dni(line):
    """Extrae el DNI (8 dígitos centrales del CUIT) del registro."""
    cuit = line[13:24]  # 11 dígitos del CUIT
    try:
        dni = int(cuit[2:10])  # dígitos 3-10 del CUIT = DNI
        return dni
    except:
        return 0


def main():
    print("=" * 70)
    print("ANÁLISIS DE MOROSIDAD: MENORES DE 24 AÑOS vs GENERAL")
    print(f"Criterio joven: DNI >= {DNI_THRESHOLD:,} (nacidos ~2002+)")
    print("Solo personas humanas (familias): CUIT 20/23/24/27")
    print("=" * 70)

    print("\nLoading entities...", flush=True)
    entities = load_entities()
    entity_sector = {c: classify_entity(c) for c in entities}

    # Aggregados: [sector] -> {general/joven} -> {tc, ic, tr, ir}
    stats = {}
    for sector in ('financiero', 'no_financiero'):
        stats[sector] = {
            'general': {'tc': 0.0, 'ic': 0.0, 'tr': 0, 'ir': 0},
            'joven': {'tc': 0.0, 'ic': 0.0, 'tr': 0, 'ir': 0},
        }

    # También por entidad para el detalle
    entity_stats = defaultdict(lambda: {
        'gen': {'tc': 0.0, 'ic': 0.0, 'tr': 0, 'ir': 0},
        'jov': {'tc': 0.0, 'ic': 0.0, 'tr': 0, 'ir': 0},
    })

    print("Processing deudores.txt...", flush=True)
    n = 0
    n_fam = 0
    n_jov = 0

    with open(INPUT_FILE, 'r', encoding='latin-1') as f:
        for line in f:
            n += 1
            if n % 5_000_000 == 0:
                print(f"  {n:>12,} líneas... (familias: {n_fam:,}, jóvenes: {n_jov:,})", flush=True)
            if len(line) < 41:
                continue

            cuit_prefix = line[13:15]
            if cuit_prefix not in FAMILIA_PREFIXES:
                continue
            n_fam += 1

            ec = line[0:5]
            sit = line[27:29].strip()
            c7 = parse_amount(line[29:41])
            c9 = parse_amount(line[53:65]) if len(line) >= 65 else 0.0
            c10 = parse_amount(line[65:77]) if len(line) >= 77 else 0.0
            amt = c7 + c9 + c10

            sector = entity_sector.get(ec, classify_entity(ec))
            is_irreg = sit in IRREG_SITS
            dni = extract_dni(line)
            is_joven = dni >= DNI_THRESHOLD

            if is_joven:
                n_jov += 1

            # General (todas las familias)
            s = stats[sector]['general']
            s['tc'] += amt
            s['tr'] += 1
            if is_irreg:
                s['ic'] += amt
                s['ir'] += 1

            # Jóvenes (<24)
            if is_joven:
                s = stats[sector]['joven']
                s['tc'] += amt
                s['tr'] += 1
                if is_irreg:
                    s['ic'] += amt
                    s['ir'] += 1

            # Por entidad (solo las grandes para tabla)
            ek = (ec, sector)
            ed = entity_stats[ek]
            ed['gen']['tc'] += amt
            ed['gen']['tr'] += 1
            if is_irreg:
                ed['gen']['ic'] += amt
                ed['gen']['ir'] += 1
            if is_joven:
                ed['jov']['tc'] += amt
                ed['jov']['tr'] += 1
                if is_irreg:
                    ed['jov']['ic'] += amt
                    ed['jov']['ir'] += 1

    print(f"\n  Total líneas: {n:,}")
    print(f"  Familias: {n_fam:,}")
    print(f"  Jóvenes (<24): {n_jov:,} ({n_jov/n_fam*100:.1f}% de familias)")

    # Calcular porcentajes
    def pct(num, den):
        return round(num / den * 100, 2) if den > 0 else 0.0

    print("\n" + "=" * 70)
    print(f"{'SECTOR':<20} {'GRUPO':<12} {'% MONTO':>10} {'% CANT':>10} {'CRÉDITO TOTAL':>20} {'DEUDORES':>12}")
    print("-" * 84)

    output = {}
    for sector in ('financiero', 'no_financiero'):
        output[sector] = {}
        for grupo in ('general', 'joven'):
            s = stats[sector][grupo]
            pa = pct(s['ic'], s['tc'])
            pq = pct(s['ir'], s['tr'])
            label = f"{'Financiero' if sector == 'financiero' else 'No Financiero'}"
            glabel = f"{'General' if grupo == 'general' else '<24 años'}"
            print(f"{label:<20} {glabel:<12} {pa:>9.2f}% {pq:>9.2f}% {s['tc']:>20,.0f} {s['tr']:>12,}")

            output[sector][grupo] = {
                'total_credit': round(s['tc'], 1),
                'irregular_credit': round(s['ic'], 1),
                'pct_irregular_amt': pa,
                'total_records': s['tr'],
                'irregular_records': s['ir'],
                'pct_irregular_qty': pq,
            }
        print()

    # Diferencia jóvenes vs general
    print("=" * 70)
    print("DIFERENCIA (Jóvenes - General):")
    print("-" * 50)
    for sector in ('financiero', 'no_financiero'):
        g = output[sector]['general']
        j = output[sector]['joven']
        label = f"{'Financiero' if sector == 'financiero' else 'No Financiero'}"
        diff_amt = j['pct_irregular_amt'] - g['pct_irregular_amt']
        diff_qty = j['pct_irregular_qty'] - g['pct_irregular_qty']
        sign_a = "+" if diff_amt >= 0 else ""
        sign_q = "+" if diff_qty >= 0 else ""
        print(f"  {label:<20} Monto: {sign_a}{diff_amt:.2f} pp  |  Cantidad: {sign_q}{diff_qty:.2f} pp")

    # Top entidades con más jóvenes
    print("\n" + "=" * 70)
    print("TOP 20 ENTIDADES CON MÁS JÓVENES DEUDORES (Financiero)")
    print(f"{'#':>3} {'ENTIDAD':<40} {'JÓVENES':>10} {'% IRREG JOV':>13} {'% IRREG GEN':>13} {'DIFF':>8}")
    print("-" * 90)

    fin_entities = [(k, v) for k, v in entity_stats.items() if k[1] == 'financiero']
    fin_entities.sort(key=lambda x: x[1]['jov']['tr'], reverse=True)
    for i, ((ec, _), ed) in enumerate(fin_entities[:20]):
        name = entities.get(ec, f"Entidad {ec}")[:38]
        jtr = ed['jov']['tr']
        jpct = pct(ed['jov']['ic'], ed['jov']['tc'])
        gpct = pct(ed['gen']['ic'], ed['gen']['tc'])
        diff = jpct - gpct
        sign = "+" if diff >= 0 else ""
        print(f"{i+1:>3} {name:<40} {jtr:>10,} {jpct:>12.2f}% {gpct:>12.2f}% {sign}{diff:>6.2f}pp")

    print("\n" + "=" * 70)
    print("TOP 20 ENTIDADES CON MÁS JÓVENES DEUDORES (No Financiero)")
    print(f"{'#':>3} {'ENTIDAD':<40} {'JÓVENES':>10} {'% IRREG JOV':>13} {'% IRREG GEN':>13} {'DIFF':>8}")
    print("-" * 90)

    nofin_entities = [(k, v) for k, v in entity_stats.items() if k[1] == 'no_financiero']
    nofin_entities.sort(key=lambda x: x[1]['jov']['tr'], reverse=True)
    for i, ((ec, _), ed) in enumerate(nofin_entities[:20]):
        name = entities.get(ec, f"Entidad {ec}")[:38]
        jtr = ed['jov']['tr']
        jpct = pct(ed['jov']['ic'], ed['jov']['tc'])
        gpct = pct(ed['gen']['ic'], ed['gen']['tc'])
        diff = jpct - gpct
        sign = "+" if diff >= 0 else ""
        print(f"{i+1:>3} {name:<40} {jtr:>10,} {jpct:>12.2f}% {gpct:>12.2f}% {sign}{diff:>6.2f}pp")

    # Guardar JSON
    # Entidades con al menos 100 jóvenes deudores
    entity_output = []
    for (ec, sector), ed in entity_stats.items():
        if ed['jov']['tr'] < 100:
            continue
        name = entities.get(ec, f"Entidad {ec}")
        entity_output.append({
            'code': ec,
            'name': name,
            'sector': sector,
            'general': {
                'total_credit': round(ed['gen']['tc'], 1),
                'irregular_credit': round(ed['gen']['ic'], 1),
                'pct_irregular_amt': pct(ed['gen']['ic'], ed['gen']['tc']),
                'total_records': ed['gen']['tr'],
                'irregular_records': ed['gen']['ir'],
                'pct_irregular_qty': pct(ed['gen']['ir'], ed['gen']['tr']),
            },
            'joven': {
                'total_credit': round(ed['jov']['tc'], 1),
                'irregular_credit': round(ed['jov']['ic'], 1),
                'pct_irregular_amt': pct(ed['jov']['ic'], ed['jov']['tc']),
                'total_records': ed['jov']['tr'],
                'irregular_records': ed['jov']['ir'],
                'pct_irregular_qty': pct(ed['jov']['ir'], ed['jov']['tr']),
            },
        })

    entity_output.sort(key=lambda x: x['joven']['total_records'], reverse=True)

    full_output = {
        'criterio': f'DNI >= {DNI_THRESHOLD} (menores de 24 años aprox.)',
        'periodo': '2026-01',
        'agregados': output,
        'entidades': entity_output,
    }

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(full_output, f, ensure_ascii=False, indent=2)
    print(f"\nDatos guardados en {OUTPUT_FILE}")


if __name__ == '__main__':
    main()
