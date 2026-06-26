# -*- coding: utf-8 -*-
"""
step5_nlp.py — PASO 5: Preprocesamiento Lingüístico

Replica el PASO 5 del notebook:
  - Procesa oraciones con spaCy (tokenización, POS, NER, lematización)
  - Procesa en lotes para optimizar memoria

Entrada: JSON del step4
Salida: JSON con oraciones enriquecidas en stdout
"""

import argparse
import sys
import json
import os
import gc
import time
import datetime
import warnings

warnings.filterwarnings("ignore")

from shared_utils import (
    _err, _section, _step, _ok, _warn, _bullet, _progress_bar,
    BATCH_SIZE_NLP
)


def process_nlp_batch(nlp, texts: list) -> list:
    """
    Procesa un lote de oraciones con spaCy.pipe y devuelve
    [(tokens, lemas, pos_tags, entities), ...].
    """
    results = []
    for doc in nlp.pipe(texts, batch_size=200, n_process=1):
        tokens = [t.text for t in doc if not t.is_space]
        lemas = [t.lemma_ for t in doc if not t.is_space]
        pos_tags = [t.pos_ for t in doc if not t.is_space]
        entities = [{"text": ent.text, "label": ent.label_} for ent in doc.ents]
        results.append((tokens, lemas, pos_tags, entities))
    return results


def main():
    parser = argparse.ArgumentParser(
        description="PASO 5 — Preprocesamiento Lingüístico"
    )
    parser.add_argument("--step4-json", required=True, help="JSON de step4_segment.py")
    parser.add_argument("--language", default="SPANISH", choices=["SPANISH", "ENGLISH"])
    args = parser.parse_args()

    t_global_start = time.time()

    # ── Cargar JSON del paso anterior ──
    try:
        with open(args.step4_json, "r", encoding="utf-8") as f:
            step4_data = json.load(f)
    except Exception as e:
        _err(f"Error cargando step4 JSON: {e}")
        sys.exit(1)

    all_sentences = step4_data.get("sentences", [])

    _section("PASO 5 — Preprocesamiento Lingüístico")
    _err(f"  Oraciones : {len(all_sentences):,}")
    _err(f"  Idioma    : {args.language}")
    _err(f"  Inicio    : {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # ── Cargar modelo spaCy ──
    _step("Cargando modelo spaCy…")
    import spacy
    model_name = "es_core_news_lg" if args.language == "SPANISH" else "en_core_web_trf"
    try:
        nlp = spacy.load(model_name)
        _ok(f"Modelo cargado: {nlp.meta['lang']}_{nlp.meta['name']} v{nlp.meta['version']}")
        _bullet(f"Pipeline: {nlp.pipe_names}")
    except Exception:
        _warn(f"Modelo '{model_name}' no encontrado. Usando modelo en blanco.")
        nlp = spacy.blank("es" if args.language == "SPANISH" else "en")

    nlp.max_length = 3_000_000

    # ─────────────────────────────────────────────────────────────────────────
    # Preprocesamiento lingüístico
    # ─────────────────────────────────────────────────────────────────────────
    _section("PASO 5 — Preprocesamiento Lingüístico (tokenización, POS, NER, lematización)")
    t_step = time.time()

    texts_list = [s["oracion_texto"] for s in all_sentences]
    n_total = len(texts_list)
    n_batches = (n_total + BATCH_SIZE_NLP - 1) // BATCH_SIZE_NLP

    _step(f"Procesando {n_total:,} oraciones en {n_batches} lotes de {BATCH_SIZE_NLP}…")
    _err("")

    batch_num = 0
    all_tokens_list = []
    all_lemas_list = []
    all_pos_list = []
    all_ner_list = []

    for start in range(0, n_total, BATCH_SIZE_NLP):
        end = min(start + BATCH_SIZE_NLP, n_total)
        batch_num += 1
        _progress_bar(end, n_total, label=f"oraciones (lote {batch_num}/{n_batches})")

        batch_texts = texts_list[start:end]
        batch_results = process_nlp_batch(nlp, batch_texts)

        for tokens, lemas, pos_tags, entities in batch_results:
            all_tokens_list.append(tokens)
            all_lemas_list.append(lemas)
            all_pos_list.append(pos_tags)
            all_ner_list.append(entities)

        del batch_results, batch_texts
        gc.collect()

    _err("")

    # Asignar resultados a cada oración
    for i, sent in enumerate(all_sentences):
        sent["tokens"] = all_tokens_list[i]
        sent["lemas"] = all_lemas_list[i]
        sent["pos_tags"] = all_pos_list[i]
        sent["entidades_NER"] = all_ner_list[i]

    # Estadísticas NLP
    total_tokens = sum(len(s["tokens"]) for s in all_sentences)
    total_ner = sum(len(s["entidades_NER"]) for s in all_sentences)
    ner_label_counts: dict = {}
    for s in all_sentences:
        for ent in s["entidades_NER"]:
            label = ent.get("label", "?")
            ner_label_counts[label] = ner_label_counts.get(label, 0) + 1

    _ok("Preprocesamiento lingüístico completado:")
    _bullet(f"Tokens procesados:      {total_tokens:,}")
    _bullet(f"Entidades NER totales:  {total_ner:,}")
    if ner_label_counts:
        top_labels = sorted(ner_label_counts.items(), key=lambda x: -x[1])[:6]
        _bullet("Top etiquetas NER:")
        for label, count in top_labels:
            _err(f"      {label}: {count:,}", 2)
    _bullet(f"Tiempo:                 {time.time() - t_step:.1f}s")

    # Liberar listas temporales
    del all_tokens_list, all_lemas_list, all_pos_list, all_ner_list
    gc.collect()

    # ─────────────────────────────────────────────────────────────────────────
    # Generación de salida JSON
    # ─────────────────────────────────────────────────────────────────────────

    output = {
        "sentences": all_sentences,
        "nlp_stats": {
            "total_tokens": total_tokens,
            "total_ner_entities": total_ner,
            "ner_label_distribution": ner_label_counts,
        }
    }

    _step("Serializando JSON a stdout…")
    print(json.dumps(output, ensure_ascii=False, indent=2))

    t_total = time.time() - t_global_start
    _err("")
    _section("RESUMEN PASO 5")
    _ok(f"Preprocesamiento completado en {t_total:.1f}s")
    _bullet(f"Tokens: {total_tokens:,}")
    _bullet(f"Entidades NER: {total_ner:,}")
    _err("")


if __name__ == "__main__":
    main()
