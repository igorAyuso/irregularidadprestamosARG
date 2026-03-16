/*
 * Process 24DSF.txt v2 - Per-entity + aggregate time series.
 * Outputs:
 *   data_series.json      - aggregate series (same as before)
 *   data_entity_series.json - per-entity monthly series
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#define N_MONTHS 24
#define BLOCK_START 18
#define BLOCK_SIZE 15
#define MAX_ENTITIES 600
#define MAX_COMBOS 4

/* Entity info */
typedef struct {
    int code;
    int sector; /* 0=fin, 1=nofin */
    char name[80];
} Entity;

static Entity entities[MAX_ENTITIES];
static int n_entities = 0;

/* Per-entity per-tipo per-month accumulators */
/* Key: entity_index * 2 + tipo (0=familia, 1=empresa) */
#define MAX_KEYS (MAX_ENTITIES * 2)
typedef struct {
    double tc, ic;
    int tr, ir;
} MonthData;

static MonthData ent_data[MAX_KEYS][N_MONTHS];
/* Aggregate accumulators: [combo][month] */
static MonthData agg_data[MAX_COMBOS][N_MONTHS];

static int classify_entity(int code) {
    if (code < 1000) return 0;
    if (code >= 44000 && code <= 45999) return 0;
    if (code >= 65000 && code <= 65999) return 0;
    return 1;
}

static int find_or_add_entity(int code) {
    for (int i = 0; i < n_entities; i++) {
        if (entities[i].code == code) return i;
    }
    if (n_entities >= MAX_ENTITIES) return -1;
    int i = n_entities++;
    entities[i].code = code;
    entities[i].sector = classify_entity(code);
    entities[i].name[0] = '\0';
    return i;
}

static double parse_amount(const char *buf, int len) {
    char tmp[20];
    int j = 0, has = 0;
    for (int i = 0; i < len && j < 19; i++) {
        char c = buf[i];
        if (c == ' ') continue;
        if (c == ',') { tmp[j++] = '.'; has = 1; }
        else if (isdigit(c) || c == '-') { tmp[j++] = c; if (c != '0') has = 1; }
    }
    if (!has || j == 0) return 0.0;
    tmp[j] = '\0';
    return atof(tmp);
}

static void fprint_json_string(FILE *f, const char *s) {
    fputc('"', f);
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"') { fputs("\\\"", f); }
        else if (c == '\\') { fputs("\\\\", f); }
        else if (c == '\n') { fputs("\\n", f); }
        else if (c == '\r') { fputs("\\r", f); }
        else if (c == '\t') { fputs("\\t", f); }
        else { fputc(c, f); }
    }
    fputc('"', f);
}

static int is_irregular(const char *sit) {
    char s[4]; int j = 0;
    for (int i = 0; i < 2; i++) if (sit[i] != ' ') s[j++] = sit[i];
    s[j] = '\0';
    return (strcmp(s,"3")==0 || strcmp(s,"4")==0 || strcmp(s,"5")==0 || strcmp(s,"11")==0);
}

int main() {
    /* Load Maeent */
    FILE *fm = fopen("/sessions/practical-upbeat-ride/mnt/202601DEUDORES/Maeent.txt", "r");
    if (!fm) { fprintf(stderr, "Cannot open Maeent\n"); return 1; }
    char line[1024];
    while (fgets(line, sizeof(line), fm)) {
        if (strlen(line) < 6) continue;
        char cs[6]; strncpy(cs, line, 5); cs[5] = '\0';
        int code = atoi(cs);
        int idx = find_or_add_entity(code);
        if (idx >= 0) {
            /* Copy name, trim trailing whitespace */
            strncpy(entities[idx].name, line + 5, 75);
            entities[idx].name[75] = '\0';
            int len = strlen(entities[idx].name);
            while (len > 0 && (entities[idx].name[len-1] == '\n' || entities[idx].name[len-1] == '\r' || entities[idx].name[len-1] == ' '))
                entities[idx].name[--len] = '\0';
        }
    }
    fclose(fm);
    fprintf(stderr, "Loaded %d entities from Maeent\n", n_entities);

    /* Init */
    memset(ent_data, 0, sizeof(ent_data));
    memset(agg_data, 0, sizeof(agg_data));

    /* Process 24DSF */
    FILE *fi = fopen("/sessions/practical-upbeat-ride/mnt/202601DEUDORES/DATAHISTORICA/24DSF.txt", "r");
    if (!fi) { fprintf(stderr, "Cannot open 24DSF\n"); return 1; }

    char buf[512];
    long long n = 0;

    while (fgets(buf, sizeof(buf), fi)) {
        n++;
        if ((n % 10000000) == 0) fprintf(stderr, "  %lld lines...\n", n);

        int blen = strlen(buf);
        if (blen < BLOCK_START + BLOCK_SIZE) continue;

        /* CUIT prefix */
        char cp0 = buf[7], cp1 = buf[8];
        int tipo;
        if (cp0 == '2' && (cp1 == '0' || cp1 == '3' || cp1 == '4' || cp1 == '7')) tipo = 0;
        else if (cp0 == '3' && (cp1 == '0' || cp1 == '3' || cp1 == '4')) tipo = 1;
        else continue;

        /* Entity */
        char ecstr[6]; strncpy(ecstr, buf, 5); ecstr[5] = '\0';
        int ec = atoi(ecstr);
        int eidx = find_or_add_entity(ec);
        if (eidx < 0) continue;

        int sector = entities[eidx].sector;
        int combo = sector * 2 + tipo; /* 0=fin_fam, 1=fin_emp, 2=nofin_fam, 3=nofin_emp */
        int ekey = eidx * 2 + tipo;

        for (int mi = 0; mi < N_MONTHS; mi++) {
            int off = BLOCK_START + mi * BLOCK_SIZE;
            if (off + 14 > blen) break;

            char sit[3] = { buf[off], buf[off+1], '\0' };
            int sit_ok = 0;
            for (int i = 0; i < 2; i++) if (sit[i] != ' ' && sit[i] != '0') sit_ok = 1;
            if (!sit_ok) continue;

            double amt = parse_amount(buf + off + 2, 12);

            /* Aggregate */
            agg_data[combo][mi].tc += amt;
            agg_data[combo][mi].tr++;
            if (is_irregular(sit)) { agg_data[combo][mi].ic += amt; agg_data[combo][mi].ir++; }

            /* Per-entity */
            ent_data[ekey][mi].tc += amt;
            ent_data[ekey][mi].tr++;
            if (is_irregular(sit)) { ent_data[ekey][mi].ic += amt; ent_data[ekey][mi].ir++; }
        }
    }
    fclose(fi);
    fprintf(stderr, "Done: %lld lines, %d entities\n", n, n_entities);

    /* Month labels */
    const char *mnames[] = {"","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"};
    char months[24][8], labels[24][16];
    int y = 2026, m = 1;
    for (int i = 0; i < 24; i++) {
        sprintf(months[i], "%04d-%02d", y, m);
        sprintf(labels[i], "%s %02d", mnames[m], y % 100);
        m--; if (m == 0) { m = 12; y--; }
    }

    /* Write aggregate series (same format as before) */
    FILE *fo = fopen("/sessions/practical-upbeat-ride/data_series.json", "w");
    const char *keys[] = {"fam_fin", "emp_fin", "fam_nofin", "emp_nofin"};
    fprintf(fo, "{\"months\":[");
    for (int i = 23; i >= 0; i--) fprintf(fo, "\"%s\"%s", months[i], i > 0 ? "," : "");
    fprintf(fo, "],\"month_labels\":[");
    for (int i = 23; i >= 0; i--) fprintf(fo, "\"%s\"%s", labels[i], i > 0 ? "," : "");
    fprintf(fo, "],\"series\":[");
    for (int i = 23; i >= 0; i--) {
        fprintf(fo, "{\"periodo\":\"%s\",\"label\":\"%s\"", months[i], labels[i]);
        for (int c = 0; c < 4; c++) {
            MonthData *d = &agg_data[c][i];
            double pa = d->tc > 0 ? d->ic / d->tc * 100.0 : 0;
            double pq = d->tr > 0 ? (double)d->ir / d->tr * 100.0 : 0;
            fprintf(fo, ",\"%s_amt\":%.2f,\"%s_qty\":%.2f", keys[c], pa, keys[c], pq);
            fprintf(fo, ",\"%s_tc\":%.1f,\"%s_ic\":%.1f", keys[c], d->tc, keys[c], d->ic);
            fprintf(fo, ",\"%s_tr\":%d,\"%s_ir\":%d", keys[c], d->tr, keys[c], d->ir);
        }
        fprintf(fo, "}%s", i > 0 ? "," : "");
    }
    fprintf(fo, "]}");
    fclose(fo);

    /* Write per-entity series */
    FILE *fe = fopen("/sessions/practical-upbeat-ride/data_entity_series.json", "w");
    fprintf(fe, "{");
    int first_ent = 1;
    for (int ei = 0; ei < n_entities; ei++) {
        for (int tipo = 0; tipo < 2; tipo++) {
            int ekey = ei * 2 + tipo;
            /* Check if this entity-tipo has any data */
            int has_data = 0;
            for (int mi = 0; mi < N_MONTHS; mi++) {
                if (ent_data[ekey][mi].tr > 0) { has_data = 1; break; }
            }
            if (!has_data) continue;

            if (!first_ent) fprintf(fe, ",");
            first_ent = 0;

            /* Key: "00007_familia" or "00007_empresa" */
            const char *tipo_name = tipo == 0 ? "familia" : "empresa";
            fprintf(fe, "\"%05d_%s\":{\"code\":\"%05d\",\"name\":", entities[ei].code, tipo_name, entities[ei].code);
            fprint_json_string(fe, entities[ei].name);
            fprintf(fe, ",\"sector\":\"%s\",\"tipo\":\"%s\",\"months\":[",
                entities[ei].sector == 0 ? "financiero" : "no_financiero",
                tipo_name);

            for (int i = 23; i >= 0; i--) {
                MonthData *d = &ent_data[ekey][i];
                double pa = d->tc > 0 ? d->ic / d->tc * 100.0 : 0;
                double pq = d->tr > 0 ? (double)d->ir / d->tr * 100.0 : 0;
                fprintf(fe, "[%.1f,%.1f,%d,%d,%.2f,%.2f]%s",
                    d->tc, d->ic, d->tr, d->ir, pa, pq,
                    i > 0 ? "," : "");
            }
            fprintf(fe, "]}");
        }
    }
    fprintf(fe, "}");
    fclose(fe);

    /* Summary */
    fprintf(stderr, "\n=== Fam Fin (últimos 6 meses) ===\n");
    for (int i = 5; i >= 0; i--) {
        MonthData *d = &agg_data[0][i];
        double p = d->tc > 0 ? d->ic/d->tc*100 : 0;
        fprintf(stderr, "  %s: %.2f%%\n", labels[i], p);
    }
    fprintf(stderr, "\nSaved data_series.json + data_entity_series.json\n");
    return 0;
}
