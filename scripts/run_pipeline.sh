#!/bin/bash
# -*- coding: utf-8 -*-
#
# run_pipeline.sh — Orquestador del pipeline N0 modular
#
# Uso:
#   ./run_pipeline.sh /ruta/a/documento.pdf [--title "Título"] [--author "Autor"]
#
# Ejecuta todos los 7 pasos en secuencia y genera salida final en output/
#

set -e

# ─────────────────────────────────────────────────────────────────────────────
# Configuración
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Argumentos
PDF_FILE="$1"
TITLE=""
AUTHOR="Comisión de la Verdad"
LANGUAGE="es"

# Parsear argumentos adicionales
shift || true
while [[ $# -gt 0 ]]; do
    case $1 in
        --title)
            TITLE="$2"
            shift 2
            ;;
        --author)
            AUTHOR="$2"
            shift 2
            ;;
        --language)
            LANGUAGE="$2"
            shift 2
            ;;
        *)
            echo "Argumento desconocido: $1"
            exit 1
            ;;
    esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Validaciones
# ─────────────────────────────────────────────────────────────────────────────

if [[ -z "$PDF_FILE" ]]; then
    echo "❌ Uso: $0 /ruta/a/documento.pdf [--title 'Título'] [--author 'Autor']"
    exit 1
fi

if [[ ! -f "$PDF_FILE" ]]; then
    echo "❌ Error: Archivo no encontrado: $PDF_FILE"
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Crear directorio de salida
# ─────────────────────────────────────────────────────────────────────────────

mkdir -p "$OUTPUT_DIR"
cd "$SCRIPT_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# Logging helper
# ─────────────────────────────────────────────────────────────────────────────

log_section() {
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "  $1"
    echo "════════════════════════════════════════════════════════════════"
    echo ""
}

log_step() {
    echo "▶ $1"
}

log_ok() {
    echo "✓ $1"
}

log_error() {
    echo "❌ $1" >&2
}

# ─────────────────────────────────────────────────────────────────────────────
# Inicio del pipeline
# ─────────────────────────────────────────────────────────────────────────────

log_section "PIPELINE N0 — INICIO"
echo "  PDF Entrada: $PDF_FILE"
echo "  Título: ${TITLE:-[auto]}"
echo "  Autor: $AUTHOR"
echo "  Salida: $OUTPUT_DIR"
echo "  Timestamp: $TIMESTAMP"

# ─────────────────────────────────────────────────────────────────────────────
# PASO 1: Extracción
# ─────────────────────────────────────────────────────────────────────────────

log_section "PASO 1 — Extracción de Texto y Detección de Capítulos"
log_step "Extrayendo texto del PDF..."

if ! python "$SCRIPT_DIR/step1_extract.py" \
    --pdf "$PDF_FILE" \
    > "$OUTPUT_DIR/step1_extract.json" 2>>"$OUTPUT_DIR/pipeline.log"; then
    log_error "Paso 1 falló"
    exit 1
fi

PAGES=$(python -c "import json; d=json.load(open('$OUTPUT_DIR/step1_extract.json')); print(len(d['pages']))")
log_ok "Paso 1 completado: $PAGES páginas extraídas"

# ─────────────────────────────────────────────────────────────────────────────
# PASO 2: Limpieza
# ─────────────────────────────────────────────────────────────────────────────

log_section "PASO 2 — Limpieza de Texto"
log_step "Limpiando encabezados, pies, patrones..."

if ! python "$SCRIPT_DIR/step2_clean.py" \
    --step1-json "$OUTPUT_DIR/step1_extract.json" \
    > "$OUTPUT_DIR/step2_clean.json" 2>>"$OUTPUT_DIR/pipeline.log"; then
    log_error "Paso 2 falló"
    exit 1
fi

PAGES_CLEAN=$(python -c "import json; d=json.load(open('$OUTPUT_DIR/step2_clean.json')); print(d.get('pages_clean', '?'))")
log_ok "Paso 2 completado: $PAGES_CLEAN páginas limpias"

# ─────────────────────────────────────────────────────────────────────────────
# PASO 4: Segmentación
# ─────────────────────────────────────────────────────────────────────────────

log_section "PASO 4 — Segmentación en Oraciones"
log_step "Segmentando con spaCy..."

if ! python "$SCRIPT_DIR/step4_segment.py" \
    --step2-json "$OUTPUT_DIR/step2_clean.json" \
    > "$OUTPUT_DIR/step4_segment.json" 2>>"$OUTPUT_DIR/pipeline.log"; then
    log_error "Paso 4 falló"
    exit 1
fi

SENTENCES=$(python -c "import json; d=json.load(open('$OUTPUT_DIR/step4_segment.json')); print(len(d['sentences']))")
log_ok "Paso 4 completado: $SENTENCES oraciones segmentadas"

# ─────────────────────────────────────────────────────────────────────────────
# PASO 5: NLP
# ─────────────────────────────────────────────────────────────────────────────

log_section "PASO 5 — Preprocesamiento Lingüístico"
log_step "Aplicando tokenización, POS, NER, lematización..."

if ! python "$SCRIPT_DIR/step5_nlp.py" \
    --step4-json "$OUTPUT_DIR/step4_segment.json" \
    > "$OUTPUT_DIR/step5_nlp.json" 2>>"$OUTPUT_DIR/pipeline.log"; then
    log_error "Paso 5 falló"
    exit 1
fi

log_ok "Paso 5 completado: análisis NLP aplicado"

# ─────────────────────────────────────────────────────────────────────────────
# PASO 6: Generación del DataFrame N0
# ─────────────────────────────────────────────────────────────────────────────

log_section "PASO 6 — Generación del DataFrame N0"
log_step "Normalizando y computando estadísticas..."

TITLE_ARG=""
if [[ -n "$TITLE" ]]; then
    TITLE_ARG="--title \"$TITLE\""
fi

if ! python "$SCRIPT_DIR/step6_generate.py" \
    --step5-json "$OUTPUT_DIR/step5_nlp.json" \
    $TITLE_ARG \
    --author "$AUTHOR" \
    > "$OUTPUT_DIR/step6_generate.json" 2>>"$OUTPUT_DIR/pipeline.log"; then
    log_error "Paso 6 falló"
    exit 1
fi

CHAPTERS=$(python -c "import json; d=json.load(open('$OUTPUT_DIR/step6_generate.json')); print(len(d['chapters']))")
log_ok "Paso 6 completado: $CHAPTERS capítulos detectados"

# ─────────────────────────────────────────────────────────────────────────────
# PASO 7: Exportación
# ─────────────────────────────────────────────────────────────────────────────

log_section "PASO 7 — Exportación de Resultados"
log_step "Enriqueciendo metadatos y generando salida final..."

FINAL_OUTPUT="$OUTPUT_DIR/N0_${TIMESTAMP}.json"

if ! python "$SCRIPT_DIR/step7_export.py" \
    --step6-json "$OUTPUT_DIR/step6_generate.json" \
    $TITLE_ARG \
    --author "$AUTHOR" \
    --language "$LANGUAGE" \
    --output-file "$FINAL_OUTPUT" 2>>"$OUTPUT_DIR/pipeline.log"; then
    log_error "Paso 7 falló"
    exit 1
fi

log_ok "Paso 7 completado: JSON final generado"

# ─────────────────────────────────────────────────────────────────────────────
# Resumen final
# ─────────────────────────────────────────────────────────────────────────────

log_section "RESUMEN FINAL"

FINAL_SIZE=$(du -h "$FINAL_OUTPUT" | awk '{print $1}')
TOTAL_WORDS=$(python -c "import json; d=json.load(open('$FINAL_OUTPUT')); print(d['statistics']['total_words'])")
TOTAL_TOKENS=$(python -c "import json; d=json.load(open('$FINAL_OUTPUT')); print(d['statistics']['total_tokens'])")
TOTAL_ENTITIES=$(python -c "import json; d=json.load(open('$FINAL_OUTPUT')); print(d['statistics']['total_ner_entities'])")

echo ""
echo "  ✓ Pipeline completado exitosamente"
echo ""
echo "  Resultados:"
echo "    • Archivos JSON intermedios: $OUTPUT_DIR/step*.json"
echo "    • Salida final: $FINAL_OUTPUT"
echo "    • Tamaño: $FINAL_SIZE"
echo ""
echo "  Estadísticas finales:"
echo "    • Páginas procesadas: $PAGES_CLEAN / $PAGES"
echo "    • Oraciones: $SENTENCES"
echo "    • Capítulos: $CHAPTERS"
echo "    • Palabras: $TOTAL_WORDS"
echo "    • Tokens: $TOTAL_TOKENS"
echo "    • Entidades NER: $TOTAL_ENTITIES"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Crear enlace a última salida
# ─────────────────────────────────────────────────────────────────────────────

ln -sf "$(basename "$FINAL_OUTPUT")" "$OUTPUT_DIR/N0_latest.json"
log_ok "Enlace: $OUTPUT_DIR/N0_latest.json → $(basename "$FINAL_OUTPUT")"

echo ""
echo "✓ ¡Done!"
