# -*- coding: utf-8 -*-
"""
step6_generate.py — PASO 6: Generación del DataFrame N0

Replica el PASO 6 del notebook:
  - Genera el DataFrame N0 normalizado
  - Computa estadísticas por capítulo
  - Genera vista previa

Entrada: JSON del step5
Salida: JSON con DataFrame N0 final en stdout
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
        description="PASO 6 — Generación del DataFrame N0"
    )
    parser.add_argument("--step5-json", required=True, help="JSON de step5_nlp.py")
    parser.add_argument("--title", help="Título del documento")
    parser.add_argument("--author", default="Comisión de la Verdad", help="Autor")
    args = parser.parse_args()

    t_global_start = time.time()

    # ── Cargar JSON del paso anterior ──
    try:
        with open(args.step5_json, "r", encoding="utf-8") as f:
            step5_data = json.load(f)
    except Exception as e:
        _err(f"Error cargando step5 JSON: {e}")
        sys.exit(1)

    all_sentences = step5_data.get("sentences", [])

    _section("PASO 6 — Generación del DataFrame N0")
    _err(f"  Oraciones : {len(all_sentences):,}")
    _err(f"  Inicio    : {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # ─────────────────────────────────────────────────────────────────────────
    # Generación del DataFrame N0
    # ─────────────────────────────────────────────────────────────────────────
    _section("PASO 6 — Generación del DataFrame N0")
    t_step = time.time()

    _step("Construyendo resumen por capítulos…")

    # Agrupar oraciones por capítulo
    chapters_map = {}
    for s in all_sentences:
        ch = s["capitulo"]
        if ch not in chapters_map:
            chapters_map[ch] = []
        chapters_map[ch].append(s)

    chapters_summary = []
    for ch in sorted(chapters_map.keys()):
        ch_sents = chapters_map[ch]
        ch_pages = sorted(set(s["pagina"] for s in ch_sents))
        chapters_summary.append({
            "name": ch,
            "start_page": min(ch_pages),
            "end_page": max(ch_pages),
            "n_pages": len(ch_pages),
            "n_sentences": len(ch_sents),
            "n_words": sum(s["n_palabras"] for s in ch_sents),
            "n_tokens": sum(len(s["tokens"]) for s in ch_sents),
            "n_ner_entities": sum(len(s["entidades_NER"]) for s in ch_sents),
        })

    _ok(f"DataFrame N0 construido:")
    _bullet(f"Filas (oraciones):  {len(all_sentences):,}")
    _bullet(f"Columnas:           ID_documento, volumen, capitulo, pagina,")
    _bullet(f"                    ID_oracion, oracion_texto, n_palabras, n_caracteres,")
    _bullet(f"                    tokens, lemas, pos_tags, entidades_NER")
    _bullet(f"Capítulos únicos:   {len(chapters_summary)}")
    _bullet(f"Páginas procesadas: {len(set(s['pagina'] for s in all_sentences)):,}")

    _step("Vista previa — primeras 3 oraciones:")
    for s in all_sentences[:3]:
        _err(f"[{s['ID_oracion']}] p.{s['pagina']} | {s['capitulo'][:40]}", 1)
        _err(f"  {s['oracion_texto'][:120]}{'…' if len(s['oracion_texto']) > 120 else ''}", 1)
        _err(f"  Tokens: {len(s['tokens'])} | Lemas: {len(s['lemas'])} | NER: {len(s['entidades_NER'])}", 1)

    _bullet(f"Tiempo:                  {time.time() - t_step:.1f}s")

    # ─────────────────────────────────────────────────────────────────────────
    # Generación de salida JSON
    # ─────────────────────────────────────────────────────────────────────────

    output = {
        "title": args.title or "Documento procesado",
        "author": args.author,
        "processed_at": datetime.datetime.now().isoformat(),
        "sentences": all_sentences,
        "chapters": chapters_summary,
        "stats": {
            "total_sentences": len(all_sentences),
            "total_chapters": len(chapters_summary),
            "total_pages": len(set(s["pagina"] for s in all_sentences)),
            "total_words": sum(s["n_palabras"] for s in all_sentences),
            "total_chars": sum(s["n_caracteres"] for s in all_sentences),
            "total_tokens": sum(len(s["tokens"]) for s in all_sentences),
            "total_ner_entities": sum(len(s["entidades_NER"]) for s in all_sentences),
        }
    }

    _step("Serializando JSON a stdout…")
    print(json.dumps(output, ensure_ascii=False, indent=2))

    t_total = time.time() - t_global_start
    _err("")
    _section("RESUMEN PASO 6")
    _ok(f"Generación del N0 completada en {t_total:.1f}s")
    _bullet(f"Oraciones: {len(all_sentences):,}")
    _bullet(f"Capítulos: {len(chapters_summary)}")
    _bullet(f"Palabras: {output['stats']['total_words']:,}")
    _err("")


if __name__ == "__main__":
    main()
