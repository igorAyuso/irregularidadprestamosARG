# Dashboard de Irregularidad Crediticia — Central de Deudores BCRA

Dashboard interactivo y autocontenido que analiza la **Central de Deudores del Sistema Financiero** del Banco Central de la República Argentina (BCRA), calculando y visualizando el porcentaje de irregularidad crediticia (mora >90 días) a lo largo del tiempo.

## Demo

Abrir `irregularidad_crediticia.html` en cualquier navegador. No requiere servidor, internet ni dependencias externas.

## ¿Qué muestra?

- **Irregularidad crediticia** (situaciones 3, 4, 5 y 11 según norma BCRA) como porcentaje del crédito total
- Desglosado por **Familias** (personas humanas) vs **Empresas** (personas jurídicas)
- Desglosado por **Sector Financiero** (bancos, financieras) vs **Sector No Financiero** (fideicomisos, SGR, proveedores, plataformas)
- Medido **por monto** (miles de pesos) y **por cantidad** (número de deudores)
- **Serie histórica de 24 meses** con gráfico interactivo
- **Ranking de entidades** con tabla ordenable y filtrable
- **Detalle por entidad**: click en cualquier entidad para ver su evolución individual de 24 meses

## Datos fuente

Los datos se descargan gratuitamente desde la página del BCRA:

- [Central de Deudores del Sistema Financiero](https://www.bcra.gob.ar/BCRAyVos/Situacion_Deudores.asp) → descarga masiva
- **`deudores.txt`** — archivo mensual (un registro por deudor por entidad)
- **`24DSF.txt`** — archivo bianual (24 meses de historia por deudor por entidad)
- **`Maeent.txt`** — maestro de entidades (código + nombre)

> Los archivos de datos no se incluyen en el repositorio por su tamaño (6.9GB + 23GB).

## Scripts de procesamiento

### `process_v4.py` — Procesador del archivo mensual

Procesa `deudores.txt` y `Maeent.txt` para generar datos por entidad del mes corriente.

```bash
python3 process_v4.py
# Output: data_v4.json
```

### `process_24dsf.c` — Procesador del archivo bianual (agregados)

Programa en C que procesa el archivo de 23GB con mínimo uso de memoria. Genera la serie histórica agregada de 24 meses.

```bash
gcc -O2 -o process_24dsf process_24dsf.c -lm
./process_24dsf
# Output: data_series.json
```

### `process_24dsf_v2.c` — Procesador del archivo bianual (agregados + por entidad)

Versión extendida que además extrae la serie histórica individual de cada entidad para el detalle clickeable.

```bash
gcc -O2 -o process_24dsf_v2 process_24dsf_v2.c -lm
./process_24dsf_v2
# Output: data_series.json + data_entity_series.json
```

## Definiciones clave

### Irregularidad crediticia

| Situación | Descripción | Mora |
|-----------|-------------|------|
| 1 | Normal | Sin atraso |
| 2 | Seguimiento especial / Riesgo bajo | 31-90 días (**excluida** del cálculo) |
| 3 | Con problemas / Riesgo medio | 91-180 días |
| 4 | Alto riesgo de insolvencia | 181-365 días |
| 5 | Irrecuperable | >365 días |
| 11 | Irrecuperable por disposición técnica | Cubierta con garantías preferidas "A" |

### Monto de deuda

Suma de tres campos del archivo de deudores, equivalente a "Financiaciones y Otros conceptos (puntos 2 y 3 del T.O.)":

| Campo | Concepto |
|-------|----------|
| 7 | Préstamos, créditos por intermediación financiera, arrendamientos, obligaciones negociables, títulos de deuda FF |
| 9 | Garantías otorgadas y responsabilidades eventuales |
| 10 | Otros conceptos (compromisos crediticios adicionales) |

### Clasificación de CUITs

- **Familias**: prefijo 20, 23, 24, 27 (personas humanas)
- **Empresas**: prefijo 30, 33, 34 (personas jurídicas)

### Clasificación de entidades

- **Financiero**: código < 1000, o 44000-45999, o 65000-65999
- **No Financiero**: todo lo demás

## Estructura del repositorio

```
├── irregularidad_crediticia.html   # Dashboard autocontenido (abrir en navegador)
├── process_v4.py                   # Procesador archivo mensual (Python)
├── process_24dsf.c                 # Procesador archivo bianual - agregados (C)
├── process_24dsf_v2.c              # Procesador archivo bianual - con detalle por entidad (C)
├── DOCUMENTACION_PROYECTO.md       # Documentación técnica detallada
└── README.md
```

## Requisitos

- **Para ver el dashboard**: cualquier navegador moderno
- **Para reprocesar datos**: Python 3, GCC (para compilar los .c)
- **Datos fuente**: descargables desde el sitio del BCRA

## Período actual

Enero 2026 (serie histórica: Febrero 2024 — Enero 2026)

## Licencia

Los datos son de acceso público, publicados por el BCRA.
