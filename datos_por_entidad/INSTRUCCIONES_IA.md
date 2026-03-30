# Instrucciones para Analisis por IA - Central de Deudores BCRA

## Descripcion General

Este directorio contiene los datos de la **Central de Deudores del Sistema Financiero** del Banco Central de la Republica Argentina (BCRA), correspondientes a **Enero 2026**. Los datos originales provienen de un unico archivo de 6.4 GB que fue separado en archivos individuales por entidad financiera.

## Estructura de Archivos

### Archivos de datos por entidad

Cada archivo `.txt` contiene los registros de deudores de una entidad financiera:

- **Nomenclatura**: `{codigo}_{nombre_entidad}.txt`
- **Nomenclatura para entidades grandes**: `{codigo}_{nombre_entidad}_parte_N.txt`
- Los archivos fueron particionados para que ninguno supere 100 MB
- El codigo de entidad son los primeros 5 caracteres del nombre de archivo

### Archivos de referencia

| Archivo | Descripcion |
|---------|-------------|
| `Maeent.txt` | Maestro de entidades: mapea codigo (5 digitos) a nombre completo |
| `Nomdeu.txt` | Nombres de deudores: mapea CUIT (11 digitos) a nombre/razon social |

## Formato de Cada Registro (Linea)

Cada linea tiene **173 caracteres** en formato de ancho fijo, con codificacion **Latin-1 (ISO-8859-1)** y terminador **CRLF**.

### Campos y Posiciones (0-indexed)

| Posicion | Largo | Campo | Descripcion |
|----------|-------|-------|-------------|
| 0-4 | 5 | Codigo entidad | Identifica la entidad financiera (ver Maeent.txt) |
| 5-10 | 6 | Fecha informacion | Formato AAAAMM (ej: 202601 = Enero 2026) |
| 11-12 | 2 | Tipo identificacion | 11 = CUIT/CUIL/CDI |
| 13-23 | 11 | Numero CUIT | Formato: prefijo(2) + DNI(8) + digito_verificador(1) |
| 24-26 | 3 | Codigo actividad | Segun clasificador BCRA |
| 27 | 1 | Situacion | Ver tabla de situaciones abajo |
| 28-39 | 12 | Prestamos/Financiaciones | En miles de pesos, formato "NNNNN,D" |
| 40-51 | 12 | Campo sin uso | Reservado |
| 52-63 | 12 | Garantias otorgadas | En miles de pesos |
| 64-75 | 12 | Otros conceptos | En miles de pesos |
| 76-87 | 12 | Garantias preferidas A | En miles de pesos |
| 88-99 | 12 | Garantias preferidas B | En miles de pesos |
| 100-111 | 12 | Sin garantia preferida | En miles de pesos |
| 112-123 | 12 | Contrapartida prestamos | En miles de pesos |
| 124-135 | 12 | Contrapartida garantias | En miles de pesos |
| 136-147 | 12 | Contrapartida otros | En miles de pesos |
| 148-159 | 12 | Previsiones | En miles de pesos |
| 160 | 1 | Cobertura | 0=sin cobertura, 1=cubierta |
| 161 | 1 | Proceso judicial/revision | 0=ninguno, 1=judicial, 2=revision |
| 162 | 1 | Refinanciacion | 0=no, 1=si, 9=no aplica |
| 163 | 1 | Recategorizacion obligatoria | Segun norma BCRA |
| 164 | 1 | Situacion juridica | Segun norma BCRA |
| 165 | 1 | Irrecuperabilidad | Segun norma BCRA |
| 166-172 | 7 | Dias de atraso | Cantidad de dias de mora |

### Tabla de Situaciones

| Codigo | Descripcion | Dias de mora |
|--------|-------------|--------------|
| 1 | Normal | Sin atraso o hasta 30 dias |
| 2 | Seguimiento especial / Riesgo bajo | 31-90 dias |
| 3 | Con problemas / Riesgo medio | 91-180 dias |
| 4 | Alto riesgo de insolvencia | 181-365 dias |
| 5 | Irrecuperable | Mas de 365 dias |

**Nota**: La situacion 11 (Irrecuperable por disposicion tecnica) no esta presente en este dataset.

### Interpretacion del CUIT

El CUIT/CUIL tiene 11 digitos: `XX-DDDDDDDD-V`

- **Prefijo (XX)**: Tipo de persona
  - `20`, `23`, `24`, `27` = Persona humana (individuo)
  - `30`, `33`, `34` = Persona juridica (empresa)
- **DNI (DDDDDDDD)**: 8 digitos del documento de identidad
- **V**: Digito verificador

### Montos

- Todos los montos estan expresados en **miles de pesos argentinos** con **un decimal**
- Formato en el archivo: `"NNNNN,D"` (coma como separador decimal, espacios de relleno)
- **Monto total de deuda** = Prestamos (campo 7) + Garantias otorgadas (campo 9) + Otros conceptos (campo 10)

## Clasificaciones Utiles para Analisis

### Tipo de persona
- **Familias/Individuos**: CUIT con prefijo 20, 23, 24, 27
- **Empresas**: CUIT con prefijo 30, 33, 34

### Tipo de entidad (por codigo)
- **Bancos**: codigo < 01000
- **Fideicomisos Financieros**: codigo 10000-19999
- **Plataformas Crowdlending**: codigo 40000-40999
- **Companias Financieras**: codigo 44000-45999
- **SGR (Soc. Garantia Reciproca)**: codigo 50000-50999
- **Fondos de Garantia**: codigo 51000-51999
- **Proveedores No Financieros de Credito (PNFC)**: codigo 55000-55999
- **Otros emisores no financieros**: codigo 65000-65999
- **Otros proveedores**: codigo 70000-79999

### Irregularidad crediticia (morosidad)
- **Normal**: Situacion 1
- **Alerta temprana**: Situacion 2 (algunos analisis la excluyen de morosidad)
- **Moroso/Irregular**: Situacion 3, 4, o 5
- **Tasa de irregularidad** = Registros con sit >= 3 / Total registros (por cantidad o por monto)

## Proxy de Edad por DNI

Los DNI argentinos se asignan secuencialmente. Correlacion aproximada:

| Rango DNI | Anio nacimiento aprox. | Edad aprox. (2026) |
|-----------|----------------------|-------------------|
| 5M - 10M | 1940-1955 | 71-86 |
| 10M - 15M | 1955-1965 | 61-71 |
| 15M - 20M | 1965-1972 | 54-61 |
| 20M - 25M | 1972-1980 | 46-54 |
| 25M - 30M | 1980-1987 | 39-46 |
| 30M - 35M | 1987-1995 | 31-39 |
| 35M - 40M | 1995-2001 | 25-31 |
| 40M - 45M | 2001-2006 | 20-25 |
| 45M - 50M | 2006-2010 | 16-20 |
| >= 90M | Extranjeros | N/A (excluir) |

**Nota**: Los DNI >= 90.000.000 corresponden a extranjeros residentes y deben excluirse de analisis demograficos.

## Volumen de Datos

- **Total registros**: ~39.9 millones
- **Entidades**: 521 entidades unicas
- **Entidades con multiples partes** (por exceder 100 MB): las mas grandes son MercadoLibre, Tarjeta Naranja, Banco Galicia, Banco Nacion, BBVA, Macro, Santander, Provincia de Buenos Aires, Naranja Digital, ICBC

## Ejemplo de Lectura en Python

```python
# Leer un archivo de entidad
with open('00007_BANCO_DE_GALICIA_Y_BUENOS_AIRES_S.A..txt', 'r', encoding='latin-1') as f:
    for line in f:
        entity = line[0:5]
        date = line[5:11]
        cuit = line[13:24]
        situation = int(line[27])

        # Monto de prestamos (campo 7)
        loan_str = line[28:40].strip().replace(',', '.')
        loan_amount = float(loan_str) if loan_str else 0.0

        # Clasificar persona
        prefix = cuit[:2]
        is_individual = prefix in ('20', '23', '24', '27')

        # DNI (para proxy de edad)
        dni = int(cuit[2:10])
```

## Notas Importantes

1. Un mismo deudor puede aparecer en multiples entidades (tiene deuda con varios bancos)
2. Para contar deudores unicos, usar el CUIT como clave de deduplicacion
3. Los montos en diferentes entidades NO deben sumarse sin verificar que no haya duplicacion de conceptos
4. La situacion de un deudor puede variar entre entidades (puede estar al dia en un banco y moroso en otro)
