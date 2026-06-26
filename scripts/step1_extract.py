# -*- coding: utf-8 -*-
"""
step1_extract.py — PASO 1: Extracción de Texto y Detección Automática de Capítulos

Replica el PASO 3 del notebook N0_corpus_ingestion-v9.ipynb:
  - Extracción de texto página por página del PDF
  - Detección automática de capítulos (cascada: TOC → fuentes → fallback)

Salida: JSON en stdout  |  Mensajes de progreso en stderr
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


def get_chapter_map_from_toc(pdf_path: str):
    """
    Estrategia 1: Usa el outline/bookmarks internos del PDF.
    Devuelve dict {página: nombre_capítulo} para el nivel más grueso (nivel 1).
    """
    import fitz
    try:
        doc = fitz.open(pdf_path)
        toc = doc.get_toc()          # [[nivel, título, página], ...]
        doc.close()
    except Exception as e:
        _warn(f"Error leyendo TOC: {e}", 2)
        return None

    if not toc:
        return None

    level1 = [(t.strip(), p) for lvl, t, p in toc if lvl == 1]
    if not level1:
        min_level = min(lvl for lvl, _, _ in toc)
        level1 = [(t.strip(), p) for lvl, t, p in toc if lvl == min_level]
    if not level1:
        return None

    chapter_map = {}
    for i, (titulo, p_ini) in enumerate(level1):
        p_fin = level1[i + 1][1] - 1 if i + 1 < len(level1) else 999999
        for p in range(p_ini, p_fin + 1):
            chapter_map[p] = titulo
    return chapter_map


def get_chapter_map_from_fonts(pdf_path: str, top_percentile: float = 0.05):
    """
    Estrategia 2: Detecta títulos de capítulo por tamaño de fuente.
    """
    import fitz
    import numpy as np
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        _warn(f"Error leyendo fuentes: {e}", 2)
        return None

    all_font_sizes = []
    page_texts_with_fonts = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        try:
            blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        except Exception:
            continue
        page_lines = []
        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                spans = line.get("spans", [])
                if not spans:
                    continue
                max_size = max(s.get("size", 0) for s in spans)
                text = " ".join(s.get("text", "") for s in spans).strip()
                is_bold = any("bold" in s.get("font", "").lower() for s in spans)
                if text and len(text) > 2:
                    all_font_sizes.append(max_size)
                    page_lines.append({
                        "text": text,
                        "size": max_size,
                        "bold": is_bold,
                        "page": page_num + 1,
                    })
        page_texts_with_fonts.append(page_lines)

    doc.close()

    if not all_font_sizes:
        return None

    sizes_array = np.array(all_font_sizes)
    threshold = np.percentile(sizes_array, (1 - top_percentile) * 100)

    chapter_candidates = []
    for page_lines in page_texts_with_fonts:
        for line in page_lines:
            if line["size"] >= threshold and 3 < len(line["text"]) < 200:
                text = line["text"].strip()
                if re.match(r"^\d{1,4}$", text):
                    continue
                chapter_candidates.append({
                    "text": text,
                    "page": line["page"],
                    "size": line["size"],
                    "bold": line["bold"],
                })

    if not chapter_candidates:
        return None

    chapters = []
    current = chapter_candidates[0]
    for cand in chapter_candidates[1:]:
        if cand["page"] == current["page"] and cand["size"] == current["size"]:
            current["text"] += " " + cand["text"]
        else:
            chapters.append(current)
            current = cand
    chapters.append(current)

    chapter_map = {}
    for i, ch in enumerate(chapters):
        p_end = chapters[i + 1]["page"] - 1 if i + 1 < len(chapters) else 999999
        name = ch["text"].strip()
        name = re.sub(r"^(Capítulo|Cap\.?)\s*\d+\.?\s*", "", name, flags=re.IGNORECASE)
        name = re.sub(r"^\d+\.\s*", "", name)
        name = re.sub(r"^[IVXLC]+\.\s*", "", name)
        name = name.strip()
        if name:
            for p in range(ch["page"], p_end + 1):
                chapter_map[p] = name

    return chapter_map


def extract_text_from_pdf(pdf_path: str, filename: str) -> list:
    """
    Extrae texto página por página del PDF.
    Retorna lista de dicts {pagina, texto}.
    """
    import fitz
    doc = fitz.open(pdf_path)
    total = len(doc)
    pages = []
    _err("")
    for page_num in range(total):
        _progress_bar(page_num + 1, total, label="páginas extraídas")
        page = doc[page_num]
        text = page.get_text("text")
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"[ \t]{2,}", " ", text)
        if text.strip():
            pages.append({"pagina": page_num + 1, "texto": text.strip()})
    doc.close()
    return pages


def main():
    parser = argparse.ArgumentParser(
        description="PASO 1 — Extracción de Texto y Detección de Capítulos"
    )
    parser.add_argument("--file", required=True, help="Ruta al archivo PDF o TXT")
    parser.add_argument("--title", help="Título del documento")
    parser.add_argument("--language", default="SPANISH", choices=["SPANISH", "ENGLISH"])
    args = parser.parse_args()

    t_global_start = time.time()

    # ── Validar archivo ──
    file_path = args.file
    if not os.path.exists(file_path):
        sys.stderr.write(f"Error: Archivo no encontrado en '{file_path}'\n")
        sys.exit(1)

    filename = os.path.basename(file_path)
    file_ext = os.path.splitext(filename)[1].lower()

    _section("PASO 1 — Extracción de Texto y Detección de Capítulos")
    _err(f"  Archivo   : {filename}")
    _err(f"  Título    : {args.title or '(auto)'}")
    _err(f"  Idioma    : {args.language}")
    _err(f"  Inicio    : {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # ─────────────────────────────────────────────────────────────────────────
    # Extracción de texto
    # ─────────────────────────────────────────────────────────────────────────

    raw_pages = []
    chapter_map = None
    chapter_method = "ninguno"
    t_step = time.time()

    if file_ext == ".pdf":
        _step("Extrayendo texto del PDF página por página…")
        raw_pages = extract_text_from_pdf(file_path, filename)
        _ok(f"{len(raw_pages):,} páginas con texto extraídas")
        _bullet(f"Tiempo: {time.time() - t_step:.1f}s")

        # Detección de capítulos — cascada de 3 estrategias
        _step("Detectando capítulos (cascada de 3 estrategias)…")

        _err("  [1/3] Intentando TOC/Bookmarks del PDF…", 1)
        chapter_map = get_chapter_map_from_toc(file_path)
        if chapter_map:
            chapter_method = "toc_bookmarks"
            unique_chapters = sorted(
                set(chapter_map.values()),
                key=lambda x: min(p for p, c in chapter_map.items() if c == x),
            )
            _ok(f"{len(unique_chapters)} capítulos detectados vía TOC/Bookmarks", 1)
            for ch in unique_chapters:
                pages_range = sorted(p for p, c in chapter_map.items() if c == ch)
                _bullet(f"pp. {pages_range[0]}-{pages_range[-1]}: {ch}")
        else:
            _warn("Sin TOC. Intentando detección tipográfica (tamaño de fuente)…", 1)
            _err("  [2/3] Analizando tamaños de fuente…", 1)
            chapter_map = get_chapter_map_from_fonts(file_path, top_percentile=0.03)
            if chapter_map:
                chapter_method = "font_size"
                unique_chapters = sorted(
                    set(chapter_map.values()),
                    key=lambda x: min(p for p, c in chapter_map.items() if c == x),
                )
                _ok(f"{len(unique_chapters)} capítulos detectados vía tamaño de fuente", 1)
                for ch in unique_chapters:
                    pages_range = sorted(p for p, c in chapter_map.items() if c == ch)
                    _bullet(f"pp. {pages_range[0]}-{pages_range[-1]}: {ch}")
            else:
                _warn("Sin fuentes detectables.", 1)
                _err("  [3/3] Usando nombre del archivo como fallback.", 1)
                chapter_method = "fallback_filename"

    else:
        # Archivo TXT
        _step("Leyendo archivo TXT…")
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
        raw_pages = [{"pagina": 1, "texto": text.strip()}]
        chapter_method = "fallback_filename"
        _ok(f"Texto cargado: {len(text):,} caracteres")

    fallback_chapter = args.title or os.path.splitext(filename)[0].replace("_", " ").title()
    _ok(f"Método de capítulos: {chapter_method}")
    _ok(f"Capítulo fallback: '{fallback_chapter}'")

    # ─────────────────────────────────────────────────────────────────────────
    # Generación de salida JSON
    # ─────────────────────────────────────────────────────────────────────────

    output = {
        "raw_pages": raw_pages,
        "chapter_map": chapter_map,
        "chapter_method": chapter_method,
        "fallback_chapter": fallback_chapter,
        "stats": {
            "total_pages": len(raw_pages),
            "total_chars": sum(len(p["texto"]) for p in raw_pages),
            "language": args.language,
            "filename": filename,
        }
    }

    _step("Serializando JSON a stdout…")
    print(json.dumps(output, ensure_ascii=False, indent=2))

    t_total = time.time() - t_global_start
    _err("")
    _section("RESUMEN PASO 1")
    _ok(f"Extracción completada en {t_total:.1f}s")
    _bullet(f"Archivo: {filename}")
    _bullet(f"Páginas extraídas: {len(raw_pages):,}")
    _bullet(f"Método capítulos: {chapter_method}")
    _err("")


if __name__ == "__main__":
    main()
