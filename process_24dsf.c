/*
 * Process 24DSF.txt - Ultra lean C processor.
 * Only accumulates 384 doubles (4 combos x 24 months x 4 metrics).
 * Uses a fixed-size hash table for entity->sector mapping.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

/* 4 combos x 24 months x 4 metrics = 384 */
#define N_COMBOS 4
#define N_MONTHS 24
#define N_METRICS 4
#define BLOCK_START 18
#define BLOCK_SIZE 15

/* Simple hash table for entity code -> sector (0=fin, 1=nofin) */
#define HT_SIZE 2048
typedef struct { int code; int sector; } ht_entry;
static ht_entry ht[HT_SIZE];
static int ht_used = 0;

static int classify_entity(int code) {
    if (code < 1000) return 0;
    if (code >= 44000 && code <= 45999) return 0;
    if (code >= 65000 && code <= 65999) return 0;
    return 1;
}

static void ht_insert(int code, int sector) {
    unsigned h = (unsigned)code % HT_SIZE;
    while (ht[h].code != -1) {
        if (ht[h].code == code) { ht[h].sector = sector; return; }
        h = (h + 1) % HT_SIZE;
    }
    ht[h].code = code;
    ht[h].sector = sector;
    ht_used++;
}

static int ht_lookup(int code) {
    unsigned h = (unsigned)code % HT_SIZE;
    while (ht[h].code != -1) {
        if (ht[h].code == code) return ht[h].sector;
        h = (h + 1) % HT_SIZE;
    }
    return -1;
}

/* accumulators: [combo][month][metric] where metric: 0=tc, 1=ic, 2=tr, 3=ir */
static double acc[N_COMBOS][N_MONTHS][N_METRICS];

static double parse_amount(const char *buf, int len) {
    /* buf is raw bytes from file, len chars. Replace ',' with '.', parse as double */
    char tmp[20];
    int j = 0;
    int has_content = 0;
    for (int i = 0; i < len && j < 19; i++) {
        char c = buf[i];
        if (c == ' ') continue;
        if (c == ',') { tmp[j++] = '.'; has_content = 1; }
        else if (isdigit(c) || c == '-') { tmp[j++] = c; if (c != '0') has_content = 1; }
    }
    if (!has_content || j == 0) return 0.0;
    tmp[j] = '\0';
    return atof(tmp);
}

static int is_irregular(const char *sit, int len) {
    /* Situations 3, 4, 5, 11 */
    /* sit is 2 chars, possibly space-padded */
    char s[4];
    int j = 0;
    for (int i = 0; i < len && j < 3; i++) {
        if (sit[i] != ' ') s[j++] = sit[i];
    }
    s[j] = '\0';
    if (j == 0) return 0;
    if (strcmp(s, "3") == 0 || strcmp(s, "4") == 0 || strcmp(s, "5") == 0 || strcmp(s, "11") == 0) return 1;
    return 0;
}

int main(int argc, char **argv) {
    const char *maeent_path = "/sessions/practical-upbeat-ride/mnt/202601DEUDORES/Maeent.txt";
    const char *input_path = "/sessions/practical-upbeat-ride/mnt/202601DEUDORES/DATAHISTORICA/24DSF.txt";
    const char *output_path = "/sessions/practical-upbeat-ride/data_series.json";

    /* Init hash table */
    for (int i = 0; i < HT_SIZE; i++) ht[i].code = -1;

    /* Load Maeent */
    FILE *fm = fopen(maeent_path, "r");
    if (!fm) { fprintf(stderr, "Cannot open Maeent\n"); return 1; }
    char line[1024];
    while (fgets(line, sizeof(line), fm)) {
        if (strlen(line) < 6) continue;
        char codestr[6];
        strncpy(codestr, line, 5);
        codestr[5] = '\0';
        int code = atoi(codestr);
        ht_insert(code, classify_entity(code));
    }
    fclose(fm);
    fprintf(stderr, "Loaded %d entities\n", ht_used);

    /* Init accumulators */
    memset(acc, 0, sizeof(acc));

    /* Process 24DSF */
    FILE *fi = fopen(input_path, "r");
    if (!fi) { fprintf(stderr, "Cannot open 24DSF\n"); return 1; }

    /* Use a large buffer for fgets */
    char buf[512];
    long long n = 0;
    int min_len = BLOCK_START + BLOCK_SIZE;

    while (fgets(buf, sizeof(buf), fi)) {
        n++;
        if ((n % 10000000) == 0) fprintf(stderr, "  %lld lines...\n", n);

        int blen = strlen(buf);
        if (blen < min_len) continue;

        /* CUIT prefix at pos 7-8 */
        char cp0 = buf[7], cp1 = buf[8];
        int tipo;
        if ((cp0 == '2' && (cp1 == '0' || cp1 == '3' || cp1 == '4' || cp1 == '7'))) {
            tipo = 0; /* familia */
        } else if ((cp0 == '3' && (cp1 == '0' || cp1 == '3' || cp1 == '4'))) {
            tipo = 1; /* empresa */
        } else {
            continue;
        }

        /* Entity code: pos 0-4 */
        char ecstr[6];
        strncpy(ecstr, buf, 5);
        ecstr[5] = '\0';
        int ec = atoi(ecstr);

        int sector = ht_lookup(ec);
        if (sector < 0) sector = classify_entity(ec);

        int combo = sector * 2 + tipo; /* 0=fin_fam, 1=fin_emp, 2=nofin_fam, 3=nofin_emp */

        /* Process 24 monthly blocks */
        for (int mi = 0; mi < N_MONTHS; mi++) {
            int off = BLOCK_START + mi * BLOCK_SIZE;
            if (off + 14 > blen) break;

            /* Situation: 2 chars at off */
            char sit[3] = { buf[off], buf[off+1], '\0' };

            /* Skip empty/zero situation */
            int sit_trimmed = 0;
            for (int i = 0; i < 2; i++) if (sit[i] != ' ' && sit[i] != '0') sit_trimmed = 1;
            if (!sit_trimmed) continue;

            /* Parse amount: 12 chars at off+2 */
            double amt = parse_amount(buf + off + 2, 12);

            acc[combo][mi][0] += amt;  /* tc */
            acc[combo][mi][2] += 1.0;  /* tr */

            if (is_irregular(sit, 2)) {
                acc[combo][mi][1] += amt;  /* ic */
                acc[combo][mi][3] += 1.0;  /* ir */
            }
        }
    }
    fclose(fi);
    fprintf(stderr, "Done: %lld lines\n", n);

    /* Generate output JSON */
    FILE *fo = fopen(output_path, "w");
    if (!fo) { fprintf(stderr, "Cannot open output\n"); return 1; }

    /* Month labels */
    const char *mnames[] = {"","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"};
    char months[24][8];
    char labels[24][16];
    int y = 2026, m = 1;
    for (int i = 0; i < 24; i++) {
        sprintf(months[i], "%04d-%02d", y, m);
        sprintf(labels[i], "%s %02d", mnames[m], y % 100);
        m--;
        if (m == 0) { m = 12; y--; }
    }

    /* Write JSON */
    fprintf(fo, "{\"months\":[");
    for (int i = 23; i >= 0; i--) { fprintf(fo, "\"%s\"%s", months[i], i > 0 ? "," : ""); }
    fprintf(fo, "],\"month_labels\":[");
    for (int i = 23; i >= 0; i--) { fprintf(fo, "\"%s\"%s", labels[i], i > 0 ? "," : ""); }
    fprintf(fo, "],\"series\":[");

    const char *keys[] = {"fam_fin", "emp_fin", "fam_nofin", "emp_nofin"};

    for (int i = 23; i >= 0; i--) {
        fprintf(fo, "{\"periodo\":\"%s\",\"label\":\"%s\"", months[i], labels[i]);
        for (int c = 0; c < 4; c++) {
            double tc = acc[c][i][0], ic = acc[c][i][1];
            double tr = acc[c][i][2], ir = acc[c][i][3];
            double pa = (tc > 0) ? (ic / tc * 100.0) : 0;
            double pq = (tr > 0) ? (ir / tr * 100.0) : 0;
            fprintf(fo, ",\"%s_amt\":%.2f,\"%s_qty\":%.2f", keys[c], pa, keys[c], pq);
            fprintf(fo, ",\"%s_tc\":%.1f,\"%s_ic\":%.1f", keys[c], tc, keys[c], ic);
            fprintf(fo, ",\"%s_tr\":%d,\"%s_ir\":%d", keys[c], (int)tr, keys[c], (int)ir);
        }
        fprintf(fo, "}%s", i > 0 ? "," : "");
    }
    fprintf(fo, "]}");
    fclose(fo);

    /* Print summary */
    fprintf(stderr, "\n=== SERIE HISTORICA (familias, por monto) ===\n");
    for (int i = 23; i >= 0; i--) {
        double tc_ff = acc[0][i][0], ic_ff = acc[0][i][1];
        double tc_nf = acc[2][i][0], ic_nf = acc[2][i][1];
        double pf = (tc_ff > 0) ? ic_ff/tc_ff*100 : 0;
        double pn = (tc_nf > 0) ? ic_nf/tc_nf*100 : 0;
        fprintf(stderr, "  %s: Fin=%6.2f%%  NoFin=%6.2f%%\n", labels[i], pf, pn);
    }

    fprintf(stderr, "\nSaved to %s\n", output_path);
    return 0;
}
