#!/usr/bin/env python3
"""
Cruza los CUITs de funcionarios de BIME_estructura_autoridades_APN_20260309.xls
contra los datos de deudas del BCRA (Central de Deudores) por entidad.

Muestra funcionarios con deudas superiores a 140 millones de pesos.
Los montos están en miles de pesos con 1 decimal (formato argentino: coma decimal).
"""

import xlrd
import os
import glob
import json
import sys


def parse_amount(s):
    """Parsea montos en formato argentino (coma como decimal)."""
    s = s.strip()
    if not s:
        return 0.0
    s = s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return 0.0


def load_authorities(xls_path):
    """Carga CUITs y datos de funcionarios del archivo XLS."""
    wb = xlrd.open_workbook(xls_path, ignore_workbook_corruption=True)
    sh = wb.sheet_by_index(0)

    cuits = {}
    for r in range(1, sh.nrows):
        cuil_val = sh.cell_value(r, 22)  # aut_cuil
        nombre = str(sh.cell_value(r, 19)).strip()
        apellido = str(sh.cell_value(r, 20)).strip()
        cargo = str(sh.cell_value(r, 11)).strip()
        jurisdiccion = str(sh.cell_value(r, 0)).strip()
        unidad = str(sh.cell_value(r, 3)).strip()

        if cuil_val:
            try:
                cuit = str(int(float(cuil_val)))
                if len(cuit) == 11:
                    if cuit not in cuits:
                        cuits[cuit] = {
                            'nombre': f'{nombre} {apellido}'.strip(),
                            'cargo': cargo,
                            'jurisdiccion': jurisdiccion,
                            'unidad': unidad
                        }
            except (ValueError, OverflowError):
                pass

    return cuits


def load_entities(maeent_path):
    """Carga el maestro de entidades financieras."""
    entities = {}
    with open(maeent_path, 'r', encoding='latin-1') as f:
        for line in f:
            code = line[:5].strip()
            name = line[5:].strip()
            entities[code] = name
    return entities


def search_debts(data_dir, cuit_set, entities):
    """Busca deudas de los CUITs en todos los archivos de entidades."""
    results = {}
    txt_files = sorted(glob.glob(os.path.join(data_dir, '*.txt')))
    txt_files = [f for f in txt_files
                 if os.path.basename(f) not in ('Maeent.txt', 'Nomdeu.txt')]

    for filepath in txt_files:
        try:
            with open(filepath, 'r', encoding='latin-1') as f:
                for line in f:
                    if len(line) < 76:
                        continue
                    cuit = line[13:24]
                    if cuit in cuit_set:
                        entity_code = line[0:5]
                        situation = line[27:28]
                        c7 = parse_amount(line[28:40])
                        c9 = parse_amount(line[52:64])
                        c10 = parse_amount(line[64:76])
                        total = c7 + c9 + c10

                        entity_name = entities.get(entity_code, 'DESCONOCIDA')

                        if cuit not in results:
                            results[cuit] = []
                        results[cuit].append({
                            'entity_code': entity_code,
                            'entity_name': entity_name,
                            'situation': situation,
                            'total_thousands': total,
                            'c7': c7, 'c9': c9, 'c10': c10
                        })
        except Exception:
            pass

    return results


def main():
    threshold_millions = 140
    if len(sys.argv) > 1:
        try:
            threshold_millions = float(sys.argv[1])
        except ValueError:
            pass

    threshold_thousands = threshold_millions * 1000
    sit_map = {
        '1': 'Normal', '2': 'Riesgo bajo', '3': 'Con problemas',
        '4': 'Alto riesgo', '5': 'Irrecuperable', '6': 'Irrecuperable por disposicion tecnica'
    }

    xls_path = 'BIME_estructura_autoridades_APN_20260309.xls'
    data_dir = 'datos_por_entidad'
    maeent_path = os.path.join(data_dir, 'Maeent.txt')

    print("Cargando funcionarios...")
    cuits = load_authorities(xls_path)
    print(f"  CUITs unicos: {len(cuits)}")

    print("Cargando entidades...")
    entities = load_entities(maeent_path)

    print("Buscando deudas en archivos por entidad...")
    results = search_debts(data_dir, set(cuits.keys()), entities)
    print(f"  Funcionarios con deudas encontradas: {len(results)}")

    # Funcionarios con deuda individual en una entidad > threshold
    print(f"\n{'='*100}")
    print(f"FUNCIONARIOS CON DEUDA > {threshold_millions}M EN UNA SOLA ENTIDAD")
    print(f"{'='*100}")

    individual = []
    for cuit, debts in results.items():
        for d in debts:
            if d['total_thousands'] > threshold_thousands:
                info = cuits[cuit]
                individual.append({
                    'cuit': cuit,
                    'nombre': info['nombre'],
                    'cargo': info['cargo'],
                    'jurisdiccion': info['jurisdiccion'],
                    'unidad': info['unidad'],
                    'entity': f"[{d['entity_code']}] {d['entity_name']}",
                    'situation': f"{d['situation']} ({sit_map.get(d['situation'], '?')})",
                    'debt_m': d['total_thousands'] / 1000,
                })

    individual.sort(key=lambda x: x['debt_m'], reverse=True)
    for i, item in enumerate(individual, 1):
        print(f"\n{i}. {item['nombre']} - ${item['debt_m']:,.2f}M")
        print(f"   CUIT: {item['cuit']} | Cargo: {item['cargo']}")
        print(f"   Jurisdiccion: {item['jurisdiccion']}")
        print(f"   Unidad: {item['unidad']}")
        print(f"   Entidad: {item['entity']}")
        print(f"   Situacion: {item['situation']}")

    # Funcionarios con deuda acumulada > threshold
    print(f"\n{'='*100}")
    print(f"FUNCIONARIOS CON DEUDA TOTAL ACUMULADA > {threshold_millions}M (todas las entidades)")
    print(f"{'='*100}")

    accumulated = []
    for cuit, debts in results.items():
        total = sum(d['total_thousands'] for d in debts)
        if total > threshold_thousands:
            info = cuits[cuit]
            accumulated.append({
                'cuit': cuit,
                'nombre': info['nombre'],
                'cargo': info['cargo'],
                'jurisdiccion': info['jurisdiccion'],
                'unidad': info['unidad'],
                'total_m': total / 1000,
                'debts': debts
            })

    accumulated.sort(key=lambda x: x['total_m'], reverse=True)
    for i, item in enumerate(accumulated, 1):
        print(f"\n{i}. {item['nombre']} - TOTAL: ${item['total_m']:,.2f}M")
        print(f"   CUIT: {item['cuit']} | Cargo: {item['cargo']}")
        print(f"   Jurisdiccion: {item['jurisdiccion']} | Unidad: {item['unidad']}")
        for d in sorted(item['debts'], key=lambda x: x['total_thousands'], reverse=True):
            if d['total_thousands'] > 0:
                sit = sit_map.get(d['situation'], '?')
                print(f"     [{d['entity_code']}] {d['entity_name']}: "
                      f"${d['total_thousands']/1000:,.2f}M - {d['situation']} ({sit})")

    # Save JSON
    output = {
        'threshold_millions': threshold_millions,
        'total_cuits_checked': len(cuits),
        'cuits_with_debts': len(results),
        'above_threshold_individual': len(individual),
        'above_threshold_accumulated': len(accumulated),
        'funcionarios': [
            {
                'nombre': item['nombre'],
                'cuit': item['cuit'],
                'cargo': item['cargo'],
                'jurisdiccion': item['jurisdiccion'],
                'unidad': item['unidad'],
                'deuda_total_millones': round(item['total_m'], 2),
                'deudas': [
                    {
                        'entidad': f"[{d['entity_code']}] {d['entity_name']}",
                        'situacion': d['situation'],
                        'monto_millones': round(d['total_thousands'] / 1000, 2)
                    }
                    for d in sorted(item['debts'], key=lambda x: x['total_thousands'], reverse=True)
                    if d['total_thousands'] > 0
                ]
            }
            for item in accumulated
        ]
    }

    with open('funcionarios_deudas_140m.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nResultados guardados en funcionarios_deudas_140m.json")
    print(f"Total funcionarios con deuda acumulada > {threshold_millions}M: {len(accumulated)}")


if __name__ == '__main__':
    main()
