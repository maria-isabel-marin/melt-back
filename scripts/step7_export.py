# -*- coding: utf-8 -*-
"""
step7_export.py — PASO 7: Exportación de Resultados

Replica el PASO 7 del notebook:
  - Recibe JSON del step6 (DataFrame N0 completo)
  - Enriquece con metadatos finales
  - Exporta a JSON en stdout con formato normalizado

Entrada: JSON del step6
Salida: JSON final enriquecido en stdout
"""

import argparse
import sys
import json
import os
import time
import datetime
import warnings

warnings.filterwarnings("ignore")

from shared_utils import (
    _err, _section, _step, _ok, _warn, _bullet, _progress_bar
)


def main():
    parser = argparse.ArgumentParser(
        description="PASO 7 — Exportación de Resultados"
    )
    parser.add_argument("--step6-json", required=True, help="JSON de step6_generate.py")
    parser.add_argument("--title", help="Título del documento (sobrescribe step6)")
    parser.add_argument("--author", default="Comisión de la Verdad", help="Autor")
    parser.add_argument("--language", default="es", help="Código de idioma (ISO 639-1)")
    parser.add_argument("--output-file", help="Guardar en archivo en lugar de stdout")
    args = parser.parse_args()

    t_global_start = time.time()

    # ── Cargar JSON del paso anterior ──
    try:
        with open(args.step6_json, "r", encoding="utf-8") as f:
            step6_data = json.load(f)
    except Exception as e:
        _err(f"Error cargando step6 JSON: {e}")
        sys.exit(1)

    _section("PASO 7 — Exportación de Resultados")
    _err(f"  Timestamp : {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    _err("")

    # ─────────────────────────────────────────────────────────────────────────
    # Enriquecimiento de metadatos
    # ─────────────────────────────────────────────────────────────────────────
    t_step = time.time()

    _step("Enriqueciendo metadatos…")

    all_sentences = step6_data.get("sentences", [])
    chapters = step6_data.get("chapters", [])
    stats = step6_data.get("stats", {})

    # Calcular estadísticas adicionales por capítulo
    _step("Computando estadísticas por capítulo…")
    chapters_extended = []
    for ch in chapters:
        ch_copy = ch.copy()
        # Agrega información de densidad
        if ch["n_pages"] > 0:
            ch_copy["avg_sentences_per_page"] = ch["n_sentences"] / ch["n_pages"]
            ch_copy["avg_words_per_sentence"] = (
                ch["n_words"] / ch["n_sentences"] if ch["n_sentences"] > 0 else 0
            )
        else:
            ch_copy["avg_sentences_per_page"] = 0
            ch_copy["avg_words_per_sentence"] = 0
        chapters_extended.append(ch_copy)

    # Estadísticas de densidad textual
    total_pages = stats.get("total_pages", 0)
    total_sentences = stats.get("total_sentences", 0)
    total_words = stats.get("total_words", 0)
    total_tokens = stats.get("total_tokens", 0)
    total_ner_entities = stats.get("total_ner_entities", 0)

    avg_words_per_sentence = (
        total_words / total_sentences if total_sentences > 0 else 0
    )
    avg_sentences_per_page = (
        total_sentences / total_pages if total_pages > 0 else 0
    )
    avg_tokens_per_word = total_tokens / total_words if total_words > 0 else 0

    density_stats = {
        "avg_words_per_sentence": round(avg_words_per_sentence, 2),
        "avg_sentences_per_page": round(avg_sentences_per_page, 2),
        "avg_tokens_per_word": round(avg_tokens_per_word, 2),
        "avg_entities_per_sentence": (
            round(total_ner_entities / total_sentences, 2)
            if total_sentences > 0
            else 0
        ),
    }

    _ok("Metadatos enriquecidos:")
    _bullet(f"Capítulos: {len(chapters_extended)}")
    _bullet(f"Oraciones: {total_sentences:,}")
    _bullet(f"Palabras: {total_words:,}")
    _bullet(f"Tokens: {total_tokens:,}")
    _bullet(f"Entidades NER: {total_ner_entities:,}")
    _bullet(f"Densidad: {avg_words_per_sentence:.2f} palabras/oración")

    _step("Construyendo estructura de salida final…")

    # ─────────────────────────────────────────────────────────────────────────
    # Construcción del JSON de salida final
    # ─────────────────────────────────────────────────────────────────────────

    title_final = args.title or step6_data.get("title", "Documento procesado")

    output = {
        # Metadatos del documento
        "metadata": {
            "title": title_final,
            "author": args.author,
            "language": args.language,
            "processed_at": datetime.datetime.now().isoformat(),
            "source_file": step6_data.get("title", "unknown"),
        },
        # Resumen de estadísticas
        "statistics": {
            "total_pages": total_pages,
            "total_sentences": total_sentences,
            "total_words": total_words,
            "total_tokens": total_tokens,
            "total_characters": stats.get("total_chars", 0),
            "total_chapters": len(chapters_extended),
            "total_ner_entities": total_ner_entities,
            "density": density_stats,
        },
        # Capítulos con metadatos enriquecidos
        "chapters": chapters_extended,
        # Oraciones procesadas con todo el preprocesamiento
        "sentences": all_sentences,
        # Metadata de ejecución
        "execution": {
            "step6_source": args.step6_json,
            "pipeline_version": "N0-v9.0",
            "language_model": "es_core_news_sm",
        },
    }

    _ok("Estructura final construida.")

    # ─────────────────────────────────────────────────────────────────────────
    # Exportación del JSON
    # ─────────────────────────────────────────────────────────────────────────
    _step("Serializando JSON…")

    json_output = json.dumps(output, ensure_ascii=False, indent=2)

    if args.output_file:
        try:
            with open(args.output_file, "w", encoding="utf-8") as f:
                f.write(json_output)
            _ok(f"JSON guardado en: {args.output_file}")
            _bullet(f"Tamaño: {len(json_output) / 1024 / 1024:.2f} MB")
        except Exception as e:
            _err(f"Error guardando JSON: {e}")
            sys.exit(1)
    else:
        print(json_output)

    t_total = time.time() - t_global_start
    _err("")
    _section("RESUMEN PASO 7")
    _ok(f"Exportación completada en {t_total:.1f}s")
    _bullet(f"Documento: {title_final}")
    _bullet(f"Oraciones procesadas: {total_sentences:,}")
    _bullet(f"Capítulos: {len(chapters_extended)}")
    _bullet(f"Palabras totales: {total_words:,}")
    _bullet(f"Tokens NLP: {total_tokens:,}")
    _bullet(f"Entidades NER: {total_ner_entities:,}")
    _bullet(f"Salida: {'archivo' if args.output_file else 'stdout'}")
    _err("")


if __name__ == "__main__":
    main()
