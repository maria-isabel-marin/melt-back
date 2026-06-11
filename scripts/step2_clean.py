# -*- coding: utf-8 -*-
"""
step2_clean.py — PASO 2: Limpieza de Texto

Replica el PASO 3B del notebook:
  - Detección automática de encabezados
  - Inyección de nombres de capítulos como headers
  - Exclusión de páginas completas (portadas, TOC, créditos)
  - Eliminación de notas al pie
  - Limpieza de regex patterns, líneas cortas, headers/footers

Entrada: JSON del step1 + archivo original
Salida: JSON con páginas limpias en stdout
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
    _err, _section, _step, _ok, _warn, _bullet, _progress_bar,
    HEADERS_FOOTERS, PAGES_TO_EXCLUDE, MIN_LINE_LENGTH, REGEX_PATTERNS_TO_REMOVE,
    expand_page_ranges, detect_repeated_headers, clean_page_text, remove_footnotes_from_bottom
)


def main():
    parser = argparse.ArgumentParser(
        description="PASO 2 — Limpieza del Texto"
    )
    parser.add_argument("--step1-json", required=True, help="JSON de step1_extract.py")
    parser.add_argument("--original-file", required=True, help="Ruta al archivo PDF/TXT original")
    args = parser.parse_args()

    t_global_start = time.time()

    # ── Cargar JSON del paso anterior ──
    try:
        with open(args.step1_json, "r", encoding="utf-8") as f:
            step1_data = json.load(f)
    except Exception as e:
        _err(f"Error cargando step1 JSON: {e}")
        sys.exit(1)

    raw_pages = step1_data.get("raw_pages", [])
    chapter_map = step1_data.get("chapter_map")
    fallback_chapter = step1_data.get("fallback_chapter", "Desconocido")
    filename = step1_data.get("stats", {}).get("filename", "documento.pdf")

    _section("PASO 2 — Limpieza del Texto")
    _err(f"  Archivo   : {filename}")
    _err(f"  Páginas   : {len(raw_pages):,}")
    _err(f"  Inicio    : {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # ─────────────────────────────────────────────────────────────────────────
    # Limpieza
    # ─────────────────────────────────────────────────────────────────────────
    t_step = time.time()

    # Paso 1A: Detectar headers por volumen (detección automática)
    _step("1A. Detectando encabezados repetidos automáticamente…")
    pages_text_list = [p["texto"] for p in raw_pages]
    auto_headers = detect_repeated_headers(pages_text_list, threshold=0.3)
    if auto_headers:
        _ok(f"{len(auto_headers)} encabezados auto-detectados:")
        for h in sorted(auto_headers)[:8]:
            _bullet(f'"{h}"')
        if len(auto_headers) > 8:
            _bullet(f"… y {len(auto_headers) - 8} más")
    else:
        _ok("No se detectaron encabezados repetidos adicionales.")

    # Paso 1B: Inyectar nombres de capítulos como encabezados a eliminar
    _step("1B. Inyectando nombres de capítulos como encabezados…")
    chapter_name_headers = set(chapter_map.values()) if chapter_map else set()
    if chapter_name_headers:
        _ok(f"{len(chapter_name_headers)} nombres de capítulo inyectados como headers:")
        for cn in list(chapter_name_headers)[:5]:
            _bullet(f'"{cn}"')
        if len(chapter_name_headers) > 5:
            _bullet(f"… y {len(chapter_name_headers) - 5} más")
    else:
        _ok("Sin capítulos para inyectar.")

    # Paso 1C: Combinar todos los headers
    all_headers = set(HEADERS_FOOTERS) | auto_headers | chapter_name_headers
    _step("1C. Resumen de encabezados a eliminar:")
    _bullet(f"Manuales (HEADERS_FOOTERS): {len(HEADERS_FOOTERS)}")
    _bullet(f"Auto-detectados (global):  {len(auto_headers)}")
    _bullet(f"Inyectados desde capítulos: {len(chapter_name_headers)}")
    _bullet(f"Total combinado:           {len(all_headers)}")

    # Paso 2: Excluir páginas completas (portadas, TOC, créditos)
    _step("2. Excluyendo páginas completas (portadas, TOC, créditos)…")
    excludes = set()
    if filename in PAGES_TO_EXCLUDE:
        excludes = expand_page_ranges(PAGES_TO_EXCLUDE[filename])
        _ok(f"Archivo reconocido — {len(excludes)} páginas excluidas según configuración")
        specs = PAGES_TO_EXCLUDE[filename]
        for spec in specs:
            if isinstance(spec, (list, tuple)):
                _bullet(f"Rango: pp. {spec[0]}–{spec[1]}")
            else:
                _bullet(f"Página: {spec}")
    else:
        _ok("Archivo sin exclusiones de página configuradas.")

    # Paso 3: Eliminar notas al pie + limpiar encabezados/footers/regex
    _step("3. Limpiando texto página por página…")
    original_char_count = sum(len(p["texto"]) for p in raw_pages)
    cleaned_pages = []
    all_footnotes = []
    excluded_count = 0
    empty_after_clean = 0

    n_raw = len(raw_pages)
    for i, page in enumerate(raw_pages):
        _progress_bar(i + 1, n_raw, label="páginas procesadas")
        page_num = page["pagina"]

        if page_num in excludes:
            excluded_count += 1
            continue

        chapter = chapter_map.get(page_num, fallback_chapter) if chapter_map else fallback_chapter

        # Eliminar notas al pie
        text_no_fn, page_footnotes = remove_footnotes_from_bottom(page["texto"])
        for fn in page_footnotes:
            all_footnotes.append({
                "archivo": filename,
                "pagina": page_num,
                "capitulo": chapter,
                "nota_al_pie": fn,
            })

        # Limpiar encabezados, regex, líneas cortas
        clean_text = clean_page_text(text_no_fn, all_headers, REGEX_PATTERNS_TO_REMOVE, MIN_LINE_LENGTH)

        if len(clean_text.strip()) > 50:
            cleaned_pages.append({
                "page": page_num,
                "chapter": chapter,
                "text": clean_text.strip(),
            })
        else:
            empty_after_clean += 1

    cleaned_char_count = sum(len(p["text"]) for p in cleaned_pages)
    reduction_pct = (1 - cleaned_char_count / original_char_count) * 100 if original_char_count else 0

    _err("")
    _ok("Resultado de la limpieza:")
    _bullet(f"Páginas en bruto:          {n_raw:,}")
    _bullet(f"Páginas excluidas:         {excluded_count:,}  (portadas / TOC / créditos)")
    _bullet(f"Páginas vacías post-clean: {empty_after_clean:,}")
    _bullet(f"Páginas limpias restantes: {len(cleaned_pages):,}")
    _bullet(f"Caracteres antes:          {original_char_count:,}")
    _bullet(f"Caracteres después:        {cleaned_char_count:,}")
    _bullet(f"Reducción:                 {reduction_pct:.1f}%")
    _bullet(f"Notas al pie extraídas:    {len(all_footnotes):,}")
    _bullet(f"Tiempo:                    {time.time() - t_step:.1f}s")

    # Capítulos detectados tras limpieza
    unique_caps_clean = {}
    for p in cleaned_pages:
        ch = p["chapter"]
        if ch not in unique_caps_clean:
            unique_caps_clean[ch] = []
        unique_caps_clean[ch].append(p["page"])

    _step(f"Capítulos presentes tras limpieza ({len(unique_caps_clean)} únicos):")
    for ch, pages in sorted(unique_caps_clean.items(), key=lambda x: x[1][0]):
        _bullet(f"pp. {pages[0]}-{pages[-1]} ({len(pages)} págs.) → {ch[:70]}")

    # ─────────────────────────────────────────────────────────────────────────
    # Generación de salida JSON
    # ─────────────────────────────────────────────────────────────────────────

    output = {
        "cleaned_pages": cleaned_pages,
        "cleaning_stats": {
            "total_raw_pages": n_raw,
            "pages_excluded": excluded_count,
            "pages_empty_after_clean": empty_after_clean,
            "pages_clean": len(cleaned_pages),
            "char_reduction_pct": round(reduction_pct, 2),
            "footnotes_count": len(all_footnotes),
            "unique_chapters": len(unique_caps_clean),
        },
        "footnotes": all_footnotes,
        "chapters_summary": [
            {
                "name": ch,
                "pages": pages,
                "page_count": len(pages),
            }
            for ch, pages in sorted(unique_caps_clean.items(), key=lambda x: x[1][0])
        ]
    }

    _step("Serializando JSON a stdout…")
    print(json.dumps(output, ensure_ascii=False, indent=2))

    t_total = time.time() - t_global_start
    _err("")
    _section("RESUMEN PASO 2")
    _ok(f"Limpieza completada en {t_total:.1f}s")
    _bullet(f"Páginas limpias: {len(cleaned_pages):,} / {n_raw:,}")
    _bullet(f"Reducción: {reduction_pct:.1f}%")
    _err("")


if __name__ == "__main__":
    main()
