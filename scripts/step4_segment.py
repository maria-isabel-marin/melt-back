# -*- coding: utf-8 -*-
"""
step4_segment.py — PASO 4: Segmentación en Oraciones

Replica el PASO 4 del notebook:
  - Carga modelo spaCy
  - Segmenta texto de cada página en oraciones
  - Filtra por longitud mínima y máxima

Entrada: JSON del step2 + opción de modelo spaCy
Salida: JSON con oraciones en stdout
"""

import argparse
import sys
import json
import os
import re
import time
import datetime
import warnings

warnings.filterwarnings("ignore")

from shared_utils import (
    _err, _section, _step, _ok, _warn, _bullet, _progress_bar
)


def segment_page_into_sentences(nlp, text: str, min_len: int = 10, max_len: int = 2000) -> list:
    """
    Segmenta el texto de una página en oraciones usando spaCy.
    """
    doc = nlp(text)
    sentences = []
    for sent in doc.sents:
        sent_text = sent.text.strip()
        sent_text = re.sub(r"\s+", " ", sent_text)
        if min_len <= len(sent_text) <= max_len:
            sentences.append(sent_text)
    return sentences


def main():
    parser = argparse.ArgumentParser(
        description="PASO 4 — Segmentación en Oraciones"
    )
    parser.add_argument("--step2-json", required=True, help="JSON de step2_clean.py")
    parser.add_argument("--language", default="SPANISH", choices=["SPANISH", "ENGLISH"])
    parser.add_argument("--title", help="Título del documento (para metadatos)")
    args = parser.parse_args()

    t_global_start = time.time()

    # ── Cargar JSON del paso anterior ──
    try:
        with open(args.step2_json, "r", encoding="utf-8") as f:
            step2_data = json.load(f)
    except Exception as e:
        _err(f"Error cargando step2 JSON: {e}")
        sys.exit(1)

    cleaned_pages = step2_data.get("cleaned_pages", [])

    _section("PASO 4 — Segmentación en Oraciones")
    _err(f"  Páginas   : {len(cleaned_pages):,}")
    _err(f"  Idioma    : {args.language}")
    _err(f"  Inicio    : {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # ── Cargar modelo spaCy ──
    _step("Cargando modelo spaCy…")
    import spacy
    model_name = "es_core_news_lg" if args.language == "SPANISH" else "en_core_web_trf"
    try:
        nlp = spacy.load(model_name, exclude=["textcat", "custom"])
        _ok(f"Modelo cargado: {nlp.meta['lang']}_{nlp.meta['name']} v{nlp.meta['version']}")
        _bullet(f"Pipeline: {nlp.pipe_names}")
    except Exception:
        _warn(f"Modelo '{model_name}' no encontrado. Usando modelo en blanco con sentencizer.")
        nlp = spacy.blank("es" if args.language == "SPANISH" else "en")
        nlp.add_pipe("sentencizer")

    nlp.max_length = 3_000_000

    # ─────────────────────────────────────────────────────────────────────────
    # Segmentación en oraciones
    # ─────────────────────────────────────────────────────────────────────────
    _section("PASO 4 — Segmentación en Oraciones (spaCy)")
    t_step = time.time()

    all_sentences = []
    sentence_counter = 0
    n_pages_clean = len(cleaned_pages)
    fallback_volume = args.title or "Documento"

    for i, page in enumerate(cleaned_pages):
        _progress_bar(i + 1, n_pages_clean, label="páginas segmentadas")
        sentences = segment_page_into_sentences(nlp, page["text"])
        for sent_text in sentences:
            sentence_counter += 1
            all_sentences.append({
                "ID_documento": f"DOC-{int(time.time() * 1000)}",
                "volumen": fallback_volume,
                "capitulo": page["chapter"],
                "pagina": page["page"],
                "ID_oracion": f"S-{sentence_counter:06d}",
                "oracion_texto": sent_text,
                "n_palabras": len(sent_text.split()),
                "n_caracteres": len(sent_text),
            })

    n_words_total = sum(s["n_palabras"] for s in all_sentences)
    avg_words = n_words_total / len(all_sentences) if all_sentences else 0

    _err("")
    _ok(f"Segmentación completada:")
    _bullet(f"Oraciones totales:       {len(all_sentences):,}")
    _bullet(f"Palabras totales:        {n_words_total:,}")
    _bullet(f"Promedio palabras/orac.: {avg_words:.1f}")
    if all_sentences:
        word_counts = [s["n_palabras"] for s in all_sentences]
        word_counts.sort()
        median_w = word_counts[len(word_counts) // 2]
        min_w = word_counts[0]
        max_w = word_counts[-1]
        _bullet(f"Mediana:                 {median_w}")
        _bullet(f"Mín / Máx:               {min_w} / {max_w} palabras")
    _bullet(f"Tiempo:                  {time.time() - t_step:.1f}s")

    if not all_sentences:
        _warn("¡No se generaron oraciones! Verifica la limpieza y el modelo spaCy.")
        sys.exit(1)

    # ─────────────────────────────────────────────────────────────────────────
    # Generación de salida JSON
    # ─────────────────────────────────────────────────────────────────────────

    output = {
        "sentences": all_sentences,
        "stats": {
            "total_sentences": len(all_sentences),
            "total_words": n_words_total,
            "avg_words_per_sentence": round(avg_words, 2),
            "total_chars": sum(s["n_caracteres"] for s in all_sentences),
            "language": args.language,
        }
    }

    _step("Serializando JSON a stdout…")
    print(json.dumps(output, ensure_ascii=False, indent=2))

    t_total = time.time() - t_global_start
    _err("")
    _section("RESUMEN PASO 4")
    _ok(f"Segmentación completada en {t_total:.1f}s")
    _bullet(f"Oraciones: {len(all_sentences):,}")
    _bullet(f"Palabras: {n_words_total:,}")
    _err("")


if __name__ == "__main__":
    main()
