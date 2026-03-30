#!/usr/bin/env python3
"""
Analisis de morosidad en personas menores de 25 anios.
Usa el numero de DNI como proxy de edad.

En Argentina los DNI se asignan secuencialmente:
- DNI ~40.000.000 corresponde aprox. a nacidos en 2000-2001
- Para 2026, menores de 25 = nacidos desde 2001 = DNI >= 40.000.000
- DNI >= 90.000.000 son extranjeros (excluidos)

Formato deudores.txt (posiciones):
  0-4:   Codigo entidad (5 chars)
  5-10:  Fecha informacion AAAAMM (6 chars)
  11-12: Tipo identificacion (2 chars) -> 11 = CUIT/CUIL
  13-23: CUIT (11 chars) -> prefijo(2) + DNI(8) + verificador(1)
  24-26: Actividad (3 chars)
  27:    Situacion (1 char) -> o posicion 27-28 si es "11"

Situaciones morosas: 3 (con problemas), 4 (alto riesgo),
                     5 (irrecuperable), 11 (irrecuperable tecnica)

Solo personas humanas: CUIT prefijo 20, 23, 24, 27
Excluir empresas: prefijo 30, 33, 34

Uso:
    python3 analisis_morosidad_jovenes.py /ruta/a/202601DEUDORES
"""

import os
import sys
import time
import json

# --- Configuracion ---
DNI_JOVEN_MIN = 40_000_000   # Proxy: nacidos desde ~2001 (<=25 en 2026)
DNI_EXTRANJERO = 90_000_000  # Excluir extranjeros

PREFIJOS_PERSONAS = {'20', '23', '24', '27'}

def parse_line(line):
    """Extrae campos relevantes de una linea de deudores.txt.
    Retorna (es_persona, dni, situacion, monto) o None si no aplica."""
    if len(line) < 50:
        return None

    tipo_id = line[11:13]
    if tipo_id != '11':
        return None

    cuit = line[13:24]
    prefijo = cuit[:2]

    if prefijo not in PREFIJOS_PERSONAS:
        return None

    try:
        dni = int(cuit[2:10])
    except ValueError:
        return None

    if dni >= DNI_EXTRANJERO:
        return None

    # Situacion: 1 char en posicion 27, pero puede ser "11" (2 chars)
    # El campo situacion es 1 digito segun el layout, pero valor 11 existe
    # Revisemos: despues de actividad (3 chars en pos 24-26), viene situacion
    # Pos 27 es el primer char de situacion
    # Si la situacion es de 1 digito, pos 28 es el inicio del monto
    # Si la situacion es "11", necesitamos manejar diferente

    # Segun la documentacion BCRA, el campo situacion es de 1 posicion
    # PERO el valor 11 se codifica como dos caracteres
    # En realidad, mirando los datos, parece ser campos de ancho fijo
    # Revisemos la estructura completa del registro (173 bytes):
    # 5 + 6 + 2 + 11 + 3 + ?
    # = 27 chars hasta situacion

    # El PDF dice: situacion 1 digito. Pero el valor 11 existe.
    # En la practica, el campo puede ser de 2 digitos (espacio + digito para 1-5)
    # Necesitamos verificar con los datos reales

    # Mirando el sample: "0000720260111200182177330001 991,0..."
    # pos 0-4: 00007
    # pos 5-10: 202601
    # pos 11-12: 11
    # pos 13-23: 20018217733
    # pos 24-26: 000
    # pos 27: 1
    # pos 28: ' ' (espacio)
    # Entonces: situacion = 1 char en pos 27

    sit_char = line[27:28]

    # Para capturar situacion 11 (irrecuperable tecnica),
    # necesitariamos 2 chars. Pero si el campo es de 1 char,
    # el valor 11 no cabe. Verifiquemos si existe un campo de 2 chars.
    # Segun el layout del PDF: "1 digito" para situacion.
    # Posiblemente se reporta como "B" o similar para 11?
    # O el campo realmente tiene 2 posiciones.
    # Para estar seguros, chequeamos ambos chars

    try:
        # Intentar leer 2 chars para capturar posible "11"
        sit2 = line[27:29].strip()
        if sit2 == '11':
            situacion = 11
        else:
            situacion = int(sit_char)
    except ValueError:
        return None

    # Monto: campo 7 (prestamos) empieza despues de situacion
    # Intentamos extraer el monto sumando campos 7, 9, 10
    # Los montos estan separados por espacios en formato "NNNNN,D"
    # Para simplificar, extraemos lo que podemos del campo 7
    # Pos 28+ : primer campo de monto (12 chars segun doc)
    try:
        # Campo prestamos: 12 chars desde pos 28
        monto_str = line[28:40].strip().replace(',', '.')
        monto = float(monto_str) if monto_str else 0.0
    except (ValueError, IndexError):
        monto = 0.0

    return (dni, situacion, monto)


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 analisis_morosidad_jovenes.py <carpeta_202601DEUDORES>")
        sys.exit(1)

    input_dir = sys.argv[1]
    deudores_path = os.path.join(input_dir, 'deudores.txt')
    maeent_path = os.path.join(input_dir, 'Maeent.txt')

    if not os.path.exists(deudores_path):
        print(f"ERROR: No se encontro {deudores_path}")
        sys.exit(1)

    # Cargar entidades
    entities = {}
    with open(maeent_path, 'r', encoding='latin-1') as f:
        for line in f:
            line = line.rstrip('\r\n')
            if len(line) >= 6:
                entities[line[:5]] = line[5:].strip()

    # Contadores
    stats = {
        'total_personas': 0,
        'total_personas_monto': 0.0,
        'morosos_total': 0,
        'morosos_total_monto': 0.0,
        'jovenes_total': 0,
        'jovenes_monto': 0.0,
        'jovenes_morosos': 0,
        'jovenes_morosos_monto': 0.0,
        'adultos_total': 0,
        'adultos_monto': 0.0,
        'adultos_morosos': 0,
        'adultos_morosos_monto': 0.0,
        # Por situacion para jovenes
        'jovenes_por_situacion': {str(i): {'count': 0, 'monto': 0.0} for i in [1, 2, 3, 4, 5, 11]},
        # Por entidad (top)
        'jovenes_por_entidad': {},  # code -> {total, morosos, monto_total, monto_moroso}
        # Distribucion de DNI para verificar el corte
        'dni_ranges': {},  # rango -> count
    }

    start_time = time.time()
    lines_processed = 0

    with open(deudores_path, 'r', encoding='latin-1') as f:
        for line in f:
            lines_processed += 1

            if lines_processed % 5_000_000 == 0:
                elapsed = time.time() - start_time
                pct = (lines_processed / 39_900_649) * 100
                print(f"  Procesadas {lines_processed:,} lineas ({pct:.1f}%) - {elapsed:.0f}s")

            result = parse_line(line)
            if result is None:
                continue

            dni, situacion, monto = result
            es_moroso = situacion in (3, 4, 5, 11)
            es_joven = DNI_JOVEN_MIN <= dni < DNI_EXTRANJERO

            entity_code = line[:5]

            stats['total_personas'] += 1
            stats['total_personas_monto'] += monto

            if es_moroso:
                stats['morosos_total'] += 1
                stats['morosos_total_monto'] += monto

            if es_joven:
                stats['jovenes_total'] += 1
                stats['jovenes_monto'] += monto

                sit_key = str(situacion)
                if sit_key in stats['jovenes_por_situacion']:
                    stats['jovenes_por_situacion'][sit_key]['count'] += 1
                    stats['jovenes_por_situacion'][sit_key]['monto'] += monto

                if es_moroso:
                    stats['jovenes_morosos'] += 1
                    stats['jovenes_morosos_monto'] += monto

                # Por entidad
                if entity_code not in stats['jovenes_por_entidad']:
                    stats['jovenes_por_entidad'][entity_code] = {
                        'nombre': entities.get(entity_code, f'ENTIDAD_{entity_code}'),
                        'total': 0, 'morosos': 0,
                        'monto_total': 0.0, 'monto_moroso': 0.0
                    }
                ent = stats['jovenes_por_entidad'][entity_code]
                ent['total'] += 1
                ent['monto_total'] += monto
                if es_moroso:
                    ent['morosos'] += 1
                    ent['monto_moroso'] += monto
            else:
                stats['adultos_total'] += 1
                stats['adultos_monto'] += monto
                if es_moroso:
                    stats['adultos_morosos'] += 1
                    stats['adultos_morosos_monto'] += monto

            # Distribucion de DNI (rangos de 5M)
            rango = (dni // 5_000_000) * 5
            rango_key = f"{rango}M-{rango+5}M"
            stats['dni_ranges'][rango_key] = stats['dni_ranges'].get(rango_key, 0) + 1

    elapsed = time.time() - start_time
    print(f"\nProcesamiento completado en {elapsed:.0f} segundos")
    print(f"Lineas procesadas: {lines_processed:,}")

    # --- Generar reporte ---
    print("\n" + "=" * 70)
    print("ANALISIS DE MOROSIDAD - PERSONAS MENORES DE 25 ANIOS")
    print("Central de Deudores BCRA - Enero 2026")
    print("Proxy de edad: DNI >= 40.000.000 (excl. >= 90M extranjeros)")
    print("=" * 70)

    print(f"\n--- POBLACION GENERAL (personas humanas) ---")
    print(f"Total registros personas: {stats['total_personas']:,}")
    print(f"Morosos (sit >= 3): {stats['morosos_total']:,}")
    if stats['total_personas'] > 0:
        tasa_gral = stats['morosos_total'] / stats['total_personas'] * 100
        print(f"Tasa morosidad general: {tasa_gral:.2f}%")
    if stats['total_personas_monto'] > 0:
        tasa_gral_monto = stats['morosos_total_monto'] / stats['total_personas_monto'] * 100
        print(f"Tasa morosidad por monto: {tasa_gral_monto:.2f}%")

    print(f"\n--- JOVENES (<= 25 anios, DNI >= 40M) ---")
    print(f"Total registros jovenes: {stats['jovenes_total']:,}")
    print(f"Morosos jovenes: {stats['jovenes_morosos']:,}")
    if stats['jovenes_total'] > 0:
        tasa_jov = stats['jovenes_morosos'] / stats['jovenes_total'] * 100
        print(f"Tasa morosidad jovenes: {tasa_jov:.2f}%")
    if stats['jovenes_monto'] > 0:
        tasa_jov_m = stats['jovenes_morosos_monto'] / stats['jovenes_monto'] * 100
        print(f"Tasa morosidad jovenes por monto: {tasa_jov_m:.2f}%")

    print(f"\n--- ADULTOS (> 25 anios, DNI < 40M) ---")
    print(f"Total registros adultos: {stats['adultos_total']:,}")
    print(f"Morosos adultos: {stats['adultos_morosos']:,}")
    if stats['adultos_total'] > 0:
        tasa_adu = stats['adultos_morosos'] / stats['adultos_total'] * 100
        print(f"Tasa morosidad adultos: {tasa_adu:.2f}%")
    if stats['adultos_monto'] > 0:
        tasa_adu_m = stats['adultos_morosos_monto'] / stats['adultos_monto'] * 100
        print(f"Tasa morosidad adultos por monto: {tasa_adu_m:.2f}%")

    print(f"\n--- JOVENES POR SITUACION ---")
    for sit in ['1', '2', '3', '4', '5', '11']:
        s = stats['jovenes_por_situacion'].get(sit, {'count': 0, 'monto': 0.0})
        if s['count'] > 0:
            pct = s['count'] / stats['jovenes_total'] * 100 if stats['jovenes_total'] > 0 else 0
            print(f"  Situacion {sit}: {s['count']:,} registros ({pct:.2f}%) - Monto: {s['monto']:,.1f} miles $")

    print(f"\n--- TOP 20 ENTIDADES CON MAS JOVENES MOROSOS ---")
    top_ent = sorted(stats['jovenes_por_entidad'].items(),
                     key=lambda x: x[1]['morosos'], reverse=True)[:20]
    print(f"{'Codigo':<7} {'Entidad':<45} {'Total':>10} {'Morosos':>10} {'Tasa%':>7}")
    print("-" * 82)
    for code, data in top_ent:
        tasa = data['morosos'] / data['total'] * 100 if data['total'] > 0 else 0
        nombre = data['nombre'][:44]
        print(f"{code:<7} {nombre:<45} {data['total']:>10,} {data['morosos']:>10,} {tasa:>6.2f}%")

    print(f"\n--- DISTRIBUCION DE DNI (verificacion del corte de edad) ---")
    for rango_key in sorted(stats['dni_ranges'].keys()):
        count = stats['dni_ranges'][rango_key]
        print(f"  {rango_key}: {count:,} registros")

    # Guardar JSON con resultados
    output_json = {
        'metadata': {
            'fuente': 'Central de Deudores BCRA - Enero 2026',
            'proxy_edad': 'DNI >= 40.000.000 aprox menores 25 anios',
            'exclusiones': 'DNI >= 90M (extranjeros), empresas (CUIT 30/33/34)',
            'situaciones_morosas': [3, 4, 5, 11],
        },
        'resumen': {
            'total_personas': stats['total_personas'],
            'morosos_total': stats['morosos_total'],
            'tasa_morosidad_general': round(stats['morosos_total'] / max(stats['total_personas'], 1) * 100, 2),
            'jovenes_total': stats['jovenes_total'],
            'jovenes_morosos': stats['jovenes_morosos'],
            'tasa_morosidad_jovenes': round(stats['jovenes_morosos'] / max(stats['jovenes_total'], 1) * 100, 2),
            'adultos_total': stats['adultos_total'],
            'adultos_morosos': stats['adultos_morosos'],
            'tasa_morosidad_adultos': round(stats['adultos_morosos'] / max(stats['adultos_total'], 1) * 100, 2),
        },
        'jovenes_por_situacion': stats['jovenes_por_situacion'],
        'top_entidades_jovenes_morosos': [
            {
                'codigo': code,
                'nombre': data['nombre'],
                'total': data['total'],
                'morosos': data['morosos'],
                'tasa': round(data['morosos'] / max(data['total'], 1) * 100, 2),
                'monto_total': round(data['monto_total'], 1),
                'monto_moroso': round(data['monto_moroso'], 1),
            }
            for code, data in top_ent
        ],
        'distribucion_dni': stats['dni_ranges'],
    }

    json_path = os.path.join(input_dir, 'analisis_morosidad_jovenes.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(output_json, f, ensure_ascii=False, indent=2)
    print(f"\nResultados guardados en: {json_path}")


if __name__ == '__main__':
    main()
