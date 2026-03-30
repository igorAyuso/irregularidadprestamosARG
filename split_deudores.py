#!/usr/bin/env python3
"""
Separa deudores.txt en archivos individuales por entidad financiera.
Cada archivo pesa menos de 100 MB. Si una entidad supera ese limite,
se divide en partes numeradas.

Uso:
    python3 split_deudores.py /ruta/a/202601DEUDORES /ruta/salida

Requiere:
    - deudores.txt en la carpeta de entrada
    - Maeent.txt en la carpeta de entrada
"""

import os
import sys
import re
import time

# --- Configuracion ---
MAX_BYTES = 95_000_000  # 95 MB (margen de seguridad bajo 100 MB)
LINES_PER_FLUSH = 50_000  # Flush cada N lineas para no perder datos

def sanitize_name(name):
    """Convierte nombre de entidad a nombre de archivo seguro."""
    name = name.strip()
    # Reemplazar caracteres problematicos
    name = re.sub(r'[/\\:*?"<>|]', '_', name)
    name = re.sub(r'\s+', '_', name)
    name = re.sub(r'_+', '_', name)
    name = name.strip('_.')
    # Limitar largo
    if len(name) > 80:
        name = name[:80]
    return name

def load_entities(maeent_path):
    """Carga el maestro de entidades: codigo -> nombre."""
    entities = {}
    with open(maeent_path, 'r', encoding='latin-1') as f:
        for line in f:
            line = line.rstrip('\r\n')
            if len(line) >= 6:
                code = line[:5]
                name = line[5:].strip()
                entities[code] = name
    return entities

def main():
    if len(sys.argv) < 3:
        print("Uso: python3 split_deudores.py <carpeta_entrada> <carpeta_salida>")
        sys.exit(1)

    input_dir = sys.argv[1]
    output_dir = sys.argv[2]

    deudores_path = os.path.join(input_dir, 'deudores.txt')
    maeent_path = os.path.join(input_dir, 'Maeent.txt')

    if not os.path.exists(deudores_path):
        print(f"ERROR: No se encontro {deudores_path}")
        sys.exit(1)

    # Cargar maestro de entidades
    entities = load_entities(maeent_path)
    print(f"Entidades cargadas: {len(entities)}")

    os.makedirs(output_dir, exist_ok=True)

    # Estado por entidad: {codigo: {'file': handle, 'bytes': N, 'part': N, 'lines': N}}
    state = {}
    open_files = {}
    total_lines = 0
    start_time = time.time()

    def get_filename(code, part):
        name = entities.get(code, f"ENTIDAD_{code}")
        safe_name = sanitize_name(name)
        if part == 1:
            return f"{code}_{safe_name}.txt"
        else:
            return f"{code}_{safe_name}_parte_{part}.txt"

    def open_entity_file(code, part):
        fname = get_filename(code, part)
        fpath = os.path.join(output_dir, fname)
        fh = open(fpath, 'w', encoding='latin-1')
        return fh

    try:
        with open(deudores_path, 'r', encoding='latin-1') as f:
            for line in f:
                total_lines += 1
                code = line[:5]

                if code not in state:
                    state[code] = {'part': 1, 'bytes': 0, 'lines': 0}
                    fh = open_entity_file(code, 1)
                    open_files[code] = fh

                s = state[code]
                line_bytes = len(line.encode('latin-1'))

                # Verificar si necesitamos nueva parte
                if s['bytes'] + line_bytes > MAX_BYTES:
                    # Cerrar archivo actual
                    open_files[code].close()
                    s['part'] += 1
                    s['bytes'] = 0
                    s['lines'] = 0
                    fh = open_entity_file(code, s['part'])
                    open_files[code] = fh

                open_files[code].write(line)
                s['bytes'] += line_bytes
                s['lines'] += 1

                # Progreso cada 5M lineas
                if total_lines % 5_000_000 == 0:
                    elapsed = time.time() - start_time
                    pct = (total_lines / 39_900_649) * 100
                    print(f"  Procesadas {total_lines:,} lineas ({pct:.1f}%) - {elapsed:.0f}s")
                    # Flush all open files periodically
                    for fh in open_files.values():
                        fh.flush()

    finally:
        # Cerrar todos los archivos
        for fh in open_files.values():
            fh.close()

    elapsed = time.time() - start_time
    print(f"\nCompletado en {elapsed:.0f} segundos")
    print(f"Total lineas procesadas: {total_lines:,}")
    print(f"Entidades encontradas: {len(state)}")

    # Resumen de archivos creados
    total_files = sum(s['part'] for s in state.values())
    print(f"Archivos creados: {total_files}")

    # Verificar tamanos
    max_size = 0
    for fname in os.listdir(output_dir):
        fpath = os.path.join(output_dir, fname)
        if os.path.isfile(fpath):
            size = os.path.getsize(fpath)
            if size > max_size:
                max_size = size
            if size > 100_000_000:
                print(f"  ALERTA: {fname} = {size / 1_000_000:.1f} MB (>100 MB!)")

    print(f"Archivo mas grande: {max_size / 1_000_000:.1f} MB")

if __name__ == '__main__':
    main()
