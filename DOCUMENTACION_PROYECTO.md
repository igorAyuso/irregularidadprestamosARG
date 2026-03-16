# Documentación del Proyecto: Dashboard de Irregularidad Crediticia

## Resumen
Dashboard HTML autocontenido que analiza la Central de Deudores del BCRA (Argentina) para calcular y visualizar el porcentaje de irregularidad crediticia (mora >90 días), desglosado por:
- **Familias** (personas humanas, CUIT 20/23/24/27) vs **Empresas** (personas jurídicas, CUIT 30/33/34)
- **Sector Financiero** (bancos, financieras) vs **Sector No Financiero** (fideicomisos, SGR, proveedores)
- **Por Monto** (importes en miles de pesos) vs **Por Cantidad** (número de créditos/deudores)

---

## Archivo de Salida (ÚNICO)
**`irregularidad_crediticia.html`** — Dashboard autocontenido, sin dependencias externas.

> IMPORTANTE: Nunca cambiar el nombre de este archivo. Siempre sobreescribir este mismo archivo.

---

## Archivos Fuente (datos de entrada)

| Archivo | Ubicación | Descripción | Tamaño |
|---------|-----------|-------------|--------|
| `deudores.txt` | `./deudores.txt` | Archivo mensual Enero 2026. Todos los deudores, 1 registro por CUIT por entidad. Formato ancho fijo 171 chars. | 6.9 GB, 39.8M líneas |
| `Maeent.txt` | `./Maeent.txt` | Maestro de entidades: código (5 chars, zero-padded) + nombre | 551 entidades |
| `24DSF.txt` | `./DATAHISTORICA/24DSF.txt` | Archivo bianual (24 meses, Feb 2024 - Ene 2026). 1 registro por CUIT por entidad. Formato ancho fijo 378 chars. | 23 GB, 60.5M líneas |

### Estructura de `deudores.txt` (171 chars por línea)
```
Pos 0-4:   Campo 1 - Código entidad (5 chars, zero-padded: "00007")
Pos 5-10:  Campo 2 - Fecha AAAAMM ("202601")
Pos 11-12: Campo 3 - Tipo identificación ("11" = CUIT)
Pos 13-23: Campo 4 - CUIT (11 dígitos)
Pos 24-26: Campo 5 - Actividad
Pos 27-28: Campo 6 - Situación (1-5, 11)
Pos 29-40: Campo 7 - Préstamos / Total de garantías afrontadas (12 chars, miles $, punto 2.1 T.O.)
Pos 41-52: Campo 8 - Sin uso (12 chars)
Pos 53-64: Campo 9 - Garantías otorgadas (12 chars, puntos 2.2 y 2.3 T.O.)
Pos 65-76: Campo 10 - Otros conceptos (12 chars, puntos 3.1 y 3.2 T.O.)
Pos 77-88: Campo 11 - Garantías preferidas "A" (12 chars)
Pos 89-100:  Campo 12 - Garantías preferidas "B" (12 chars)
Pos 101-112: Campo 13 - Sin garantías preferidas (12 chars)
Pos 113-124: Campo 14 - Contragarantías preferidas "A" (12 chars)
Pos 125-136: Campo 15 - Contragarantías preferidas "B" (12 chars)
Pos 137-148: Campo 16 - Sin contragarantías preferidas (12 chars)
Pos 149-160: Campo 17 - Previsiones (12 chars)
Pos 161:     Campo 18 - Deuda cubierta (1 char)
Pos 162:     Campo 19 - Proceso Judicial/Revisión (1 char)
Pos 163:     Campo 20 - Refinanciaciones (1 char)
Pos 164:     Campo 21 - Recategorización obligatoria (1 char)
Pos 165:     Campo 22 - Situación jurídica (1 char)
Pos 166:     Campo 23 - Irrecuperables (1 char)
Pos 167-170: Campo 24 - Días de atraso (4 chars)
```

### Estructura de `24DSF.txt` (378 chars por línea)
```
Pos 0-4:   Código entidad (5 chars, right-padded con espacios: "7    ")
Pos 5-6:   Tipo identificación ("11" = CUIT, "98" = otros → ignorar)
Pos 7-17:  CUIT (11 dígitos)
Pos 18+:   24 bloques de 15 chars cada uno:
           - Pos +0..+1: Situación (2 chars)
           - Pos +2..+13: Monto (12 chars, miles de $)
           - Pos +14: Proceso (1 char)
           Bloque 0 = mes más reciente (Ene 2026), Bloque 23 = más antiguo (Feb 2024)
```

---

## Definiciones Clave

### Irregularidad crediticia (mora >90 días)
Situaciones incluidas:
- **Situación 3**: Con problemas (91-180 días)
- **Situación 4**: Alto riesgo de insolvencia (181-365 días)
- **Situación 5**: Irrecuperable (>365 días)
- **Situación 11**: Irrecuperable por disposición técnica (cubierta con garantías A)

**Excluida**: Situación 2 (seguimiento especial, 31-90 días) — por decisión explícita del usuario.

### Clasificación de CUITs
- **Familias** (personas humanas): CUIT prefijo 20, 23, 24, 27
- **Empresas** (personas jurídicas): CUIT prefijo 30, 33, 34
- Otros prefijos (ej: "00" de tipo_id=98): ignorados

### Clasificación de entidades
- **Financiero**: código < 1000, o 44000-45999, o 65000-65999
- **No Financiero**: todo lo demás

### Filtros de tabla (solo para display, NO para % agregado)
- Excluir entidades con crédito total < 100.000 miles de $
- Excluir entidades con % irregularidad >= 95% (compradores de cartera en sit. 5)

### % Agregado
El porcentaje agregado de irregularidad usa **TODAS** las entidades del sector (sin filtros). Los filtros solo aplican a la tabla de ranking por entidad.

---

## Archivos de Procesamiento

### `process_v4.py` — Procesador del archivo mensual
- Lee `deudores.txt` + `Maeent.txt`
- Genera `data_v4.json` con 4 secciones (familia/empresa × financiero/no_financiero)
- Cada sección tiene: `summary` (% agregado) + `entities` (lista para tabla)
- **Resultado Ene 2026**: Fam Fin=10.19%, Fam NoFin=27.85%, Emp Fin=2.50%, Emp NoFin=8.13%

### `process_24dsf.c` — Procesador del archivo bianual (C, ultra-liviano)
- Lee `24DSF.txt` (23GB) en streaming con ~0 KB de RAM extra
- Genera `data_series.json` con 24 meses de datos agregados por sector
- **NOTA CRÍTICA**: El 24DSF incluye CUITs históricos que ya no tienen deuda activa en el mes actual, por lo que sus % son ligeramente más altos que los del archivo mensual. Los bloques con situación 0 y monto 0 ya se filtran correctamente.
- **Solución**: Enero 2026 se sobreescribe con los valores de `deudores.txt` (archivo mensual = fuente autoritativa para el mes corriente).

### Archivos intermedios de datos
| Archivo | Descripción |
|---------|-------------|
| `data_v4.json` | Datos por entidad, Enero 2026 (de deudores.txt) |
| `data_series.json` | Serie 24 meses agregada por sector (de 24DSF.txt, Ene 2026 corregido con deudores.txt) |

---

## Definición de Monto: Campo 7 vs C7+C9+C10

### Descubrimiento clave
El 24DSF define "Monto" como **"Financiaciones y Otros conceptos (puntos 2 y 3 del T.O.)"**, que corresponde a la suma de tres campos del deudores.txt:

| Campo | Posición | Concepto | Incluido en 24DSF? |
|-------|----------|----------|-------------------|
| 7 | 29-40 | Préstamos / Total garantías afrontadas (pto. 2.1) | SÍ |
| 9 | 53-64 | Garantías otorgadas (ptos. 2.2, 2.3) | SÍ |
| 10 | 65-76 | Otros conceptos (ptos. 3.1, 3.2) | SÍ |

### Impacto por sector
- **No Financiero**: C9 y C10 son siempre CERO → no hay diferencia
- **Financiero**: C9+C10 agregan ~4-6% más crédito → el % de irregularidad cambia

### Verificación (Ene 2026, Entidad 7 - Banco Nación, familias)
```
Solo Campo 7:     TC = 8.657.675.065  →  16.58%
C7 + C9 + C10:    TC = 10.071.011.713  →  21.38%
24DSF:             TC = 10.071.015.088  →  21.38%  ← coincide exactamente
```

### Resolución
Ambas fuentes (deudores.txt y 24DSF) ahora usan la misma definición:
- `process_v4.py`: suma C7 + C9 + C10
- `process_24dsf.c`: usa el monto del 24DSF directamente (que ya es C7+C9+C10)

Diferencias residuales entre fuentes (0.06% - 0.53%) se deben a la cantidad ligeramente distinta de CUITs en cada archivo.

---

## Dashboard: Estructura y Funcionalidades

### Tabs principales
1. **Familias** — Personas humanas
2. **Empresas** — Personas jurídicas

### Componentes por tab
1. **KPIs**: % irregularidad por monto y cantidad, sector financiero y no financiero
2. **Gráfico de evolución** (SVG puro): Líneas de 24 meses, toggle monto/cantidad, hover con tooltip
3. **Selector de mes**: 24 botones para navegar meses (actualiza KPIs y barras)
4. **Gráficos de barras**: Financiero vs No Financiero, por monto y por cantidad
5. **Tabla de entidades**: Sub-tabs por sector, búsqueda, columnas ordenables, barras de % con colores (verde <5%, ámbar 5-15%, rojo >15%)

### Diseño
- Tema oscuro (bg #0f1117, cards #1a1d27)
- Sin dependencias externas (ni CDN, ni JS libraries)
- Charts con SVG puro + HTML/CSS
- Responsive

---

## Historial de Cambios

### v1 (archivo mensual básico)
- Procesamiento de deudores.txt
- Dashboard con barras y tabla por entidad
- Archivo: `irregularidad_crediticia_familias.html` ← NOMBRE VIEJO, ya no usar

### v2 (separación familias/empresas)
- Agregados tabs Familias/Empresas
- Separación por CUIT prefix
- Exclusión de situación 2

### v3 (corrección de % agregado)
- % agregado usa TODAS las entidades (no solo las de la tabla)
- Tabla filtra entidades chicas y compradores de cartera
- Coincidencia con referencia 1816: ~10.6% fin, ~27.4% nofin

### v4 (serie histórica 24 meses)
- Procesamiento de 24DSF.txt con programa en C (23GB, 60.5M líneas)
- Gráfico de evolución SVG con 24 meses
- Selector de mes
- Toggle monto/cantidad en gráfico
- Tooltip inteligente (se muestra a la izquierda cuando está cerca del borde derecho)
- Labels del eje X rotados 45° para mostrar todos los meses
- Enero 2026 corregido con valores de deudores.txt
- Archivo: **`irregularidad_crediticia.html`** ← NOMBRE DEFINITIVO

---

## Comandos de Re-procesamiento

### Re-procesar archivo mensual (si se actualiza deudores.txt)
```bash
cd /sessions/practical-upbeat-ride
python3 process_v4.py
# Output: data_v4.json
```

### Re-procesar archivo bianual (si se actualiza 24DSF.txt)
```bash
cd /sessions/practical-upbeat-ride
gcc -O2 -o process_24dsf process_24dsf.c -lm
./process_24dsf
# Output: data_series.json
```

### Re-generar dashboard
Después de actualizar data_v4.json y/o data_series.json, hay que re-embeber los datos en el HTML. El proceso de embebido se hace con Python (re-insertar JSON en las variables `seriesData` y `entityData` dentro del `<script>`).

---

## Datos de Referencia para Validación

| Fuente | Fam Fin | Fam NoFin | Emp Fin | Emp NoFin |
|--------|---------|-----------|---------|-----------|
| 1816 (analista, Ene 2026) | ~10.6% | ~27.4% | - | - |
| deudores.txt solo C7 (definición estrecha) | 10.19% | 27.85% | 2.50% | 8.13% |
| deudores.txt C7+C9+C10 (definición amplia) | 12.17% | 27.85% | 2.90% | 8.13% |
| 24DSF.txt (Ene 2026, definición amplia) | 12.11% | 27.41% | 2.53% | 7.60% |
| Dashboard (Ene 2026, definición amplia) | **12.11%** | **27.41%** | **2.53%** | **7.60%** |

> **Nota**: 1816 probablemente usa solo Campo 7 (Préstamos). Nuestro dashboard usa C7+C9+C10 para ser consistente con la serie histórica del 24DSF. La diferencia en Financiero es ~2 puntos porcentuales; en No Financiero es cero.
