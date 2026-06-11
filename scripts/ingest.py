# -*- coding: utf-8 -*-
"""
ingest.py — AI-MELT Nivel 0: Ingesta y preprocesamiento del corpus

Replica el pipeline del notebook N0_corpus_ingestion-v9.ipynb:
  3.  Extracción de texto y detección automática de capítulos
  3B. Limpieza del texto (encabezados, pies de página, portadas, TOC)
  3C. Inspección de la limpieza
  4.  Segmentación en oraciones
  5.  Preprocesamiento lingüístico (tokenización, POS, NER, lematización)
  6.  Generación del DataFrame N0
  7.  Exportación de resultados

Salida: JSON en stdout  |  Mensajes de progreso en stderr
"""

import argparse
import sys
import json
import os
import re
import gc
import time
import warnings
import datetime

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# Utilidades de progreso (stderr)
# ─────────────────────────────────────────────────────────────────────────────

def _err(msg: str, indent: int = 0):
    """Escribe una línea de progreso en stderr."""
    prefix = "  " * indent
    sys.stderr.write(f"{prefix}{msg}\n")
    sys.stderr.flush()

def _section(title: str):
    """Encabezado de sección al estilo notebook."""
    bar = "=" * 60
    _err(f"\n{bar}")
    _err(f"  {title}")
    _err(bar)

def _step(label: str):
    """Sub-paso dentro de una sección."""
    _err(f"\n▶ {label}")

def _ok(msg: str, indent: int = 1):
    _err(f"✓ {msg}", indent)

def _warn(msg: str, indent: int = 1):
    _err(f"⚠ {msg}", indent)

def _bullet(msg: str, indent: int = 2):
    _err(f"• {msg}", indent)

def _progress_bar(current: int, total: int, width: int = 30, label: str = ""):
    """Barra de progreso inline en stderr."""
    pct = current / total if total > 0 else 0
    filled = int(width * pct)
    bar = "█" * filled + "░" * (width - filled)
    sys.stderr.write(f"\r  [{bar}] {current:,}/{total:,} {label}  ")
    sys.stderr.flush()
    if current >= total:
        sys.stderr.write("\n")
        sys.stderr.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Configuración por defecto  (espeja el notebook)
# ─────────────────────────────────────────────────────────────────────────────

HEADERS_FOOTERS = [
    "CONVOCATORIA A LA PAZ GRANDE",
    "ESCLARECER LA VERDAD",
    "HAY FUTURO SI HAY VERDAD",
    "HALLAZGOS Y RECOMENDACIONES",
    "NO MATARÁS",
    "HASTA LA GUERRA TIENE LÍMITES",
    "MI CUERPO ES LA VERDAD",
    "CUANDO LOS PÁJAROS NO CANTABAN",
    "RESISTIR NO ES AGUANTAR",
    "SUFRIR LA GUERRA Y REHACER LA VIDA",
    "COLOMBIA ADENTRO",
    "COMISIÓN DE LA VERDAD",
    "INTRODUCCIÓN",
]

PAGES_TO_EXCLUDE = {
    "1.IF_CONVOCATORIA-A-LA-PAZ-GRANDE_DIGITAL_2022.pdf": [(1, 10), (52, 56)],
    "6 CEV_MI CUERPO ES LA VERDAD_DIGITAL_2022.pdf": [(1, 20), (334, 644)],
}

MIN_LINE_LENGTH = 30

REGEX_PATTERNS_TO_REMOVE = [
    r"^\d{1,4}$",                    # Números de página solos
    r"^\d{1,4}\s*$",                 # Números de página con espacios
    r"^Página\s+\d+",               # "Página 28"
    r"^\d+\s+de\s+\d+",            # "28 de 350"
    r"^Capítulo\s+\d+",             # "Capítulo 3"
    r"^Tabla de contenido",          # Tabla de contenido
    r"^Índice",                      # Índice
    r"^Contenido",                   # Contenido
    r"^REFERENCIAS\s*$",             # Referencias
    r"^BIBLIOGRAFÍA\s*$",
    r"^Fuente:",                     # Pies de tabla/gráficos
    r"^Foto:",                       # Créditos de fotos
    r"^Ilustración:",
    r"^Gráfic[oa]\s+\d+",           # "Gráfico 1"
    r"^Tabla\s+\d+",                 # "Tabla 1"
    r"^Mapa\s+\d+",                  # "Mapa 1"
    r"^Figura\s+\d+",                # "Figura 1"
]

BATCH_SIZE_NLP = 500   # oraciones por lote en paso 5


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3 — Extracción de texto y detección de capítulos
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3B — Limpieza de texto
# ─────────────────────────────────────────────────────────────────────────────

def expand_page_ranges(page_specs) -> set:
    """Expande rangos mixtos [(inicio, fin), página, ...] en un set de páginas."""
    pages = set()
    for spec in page_specs:
        if isinstance(spec, (list, tuple)) and len(spec) == 2:
            pages.update(range(spec[0], spec[1] + 1))
        else:
            pages.add(spec)
    return pages


def detect_repeated_headers(pages_text: list, threshold: float = 0.3) -> set:
    """
    Detecta líneas que se repiten en más del threshold de páginas.
    Equivale al paso 1A/1C del notebook (detección automática de encabezados).
    """
    from collections import Counter
    n_pages = len(pages_text)
    if n_pages < 3:
        return set()
    line_counts = Counter()
    for page in pages_text:
        unique_lines = set()
        for line in page.split("\n"):
            cleaned = line.strip()
            if 5 < len(cleaned) < 100:
                unique_lines.add(cleaned)
        for line in unique_lines:
            line_counts[line] += 1
    return {line for line, count in line_counts.items() if count >= n_pages * threshold}


def clean_page_text(text: str, headers_set: set, regex_patterns: list, min_line_length: int) -> str:
    """
    Limpia una página eliminando:
      - Encabezados/pies de página (coincidencia exacta case-insensitive)
      - Patrones regex (números de página, rúbricas, etc.)
      - Líneas demasiado cortas
    """
    lines = text.split("\n")
    cleaned = []
    headers_upper = {h.upper().strip() for h in headers_set}

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.upper() in headers_upper:
            continue
        skip = False
        for pattern in regex_patterns:
            if re.match(pattern, stripped, re.IGNORECASE):
                skip = True
                break
        if skip:
            continue
        if 0 < len(stripped) < min_line_length and not stripped[0].islower():
            continue
        cleaned.append(stripped)

    return "\n".join(cleaned)


def remove_footnotes_from_bottom(text: str):
    """
    Recorre las líneas de abajo hacia arriba.
    Extrae notas al pie (número + espacio + Mayúscula + ... + punto).
    Retorna (texto_sin_notas, lista_notas).
    """
    lines = text.split("\n")
    footnotes = []
    while lines:
        last = lines[-1].strip()
        if not last:
            lines.pop()
            continue
        if re.match(r"^\d{1,3}\s+[A-ZÁÉÍÓÚÑ].*\.\s*$", last):
            footnotes.append(last)
            lines.pop()
        else:
            break
    footnotes.reverse()
    return "\n".join(lines), footnotes


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3C — Inspección de la limpieza
# ─────────────────────────────────────────────────────────────────────────────

def inspect_cleaning(raw_pages: list, cleaned_pages: list, sample_count: int = 3):
    """
    Muestra muestras aleatorias del texto limpio para verificar la calidad.
    Equivale a la celda 3C del notebook.
    """
    import random
    if not cleaned_pages:
        _warn("No hay páginas limpias para inspeccionar.")
        return

    sample = random.sample(cleaned_pages, min(sample_count, len(cleaned_pages)))
    for pg in sample:
        _err("-" * 60, 1)
        _err(f"Página {pg['page']} | Capítulo: {pg['chapter'][:60]}", 1)
        _err(f"Caracteres: {len(pg['text']):,}", 1)
        _err("Inicio del texto:", 1)
        preview = pg["text"][:200].replace("\n", "↵")
        _err(preview, 2)
        if len(pg["text"]) > 200:
            _err(f"... ({len(pg['text']) - 200:,} caracteres más)", 2)
    _err("-" * 60, 1)


# ─────────────────────────────────────────────────────────────────────────────
# PASO 4 — Segmentación en oraciones
# ─────────────────────────────────────────────────────────────────────────────

def segment_page_into_sentences(nlp, text: str, min_len: int = 10, max_len: int = 2000) -> list:
    """
    Segmenta el texto de una página en oraciones usando spaCy.
    Equivale a la función segment_into_sentences del notebook.
    """
    doc = nlp(text)
    sentences = []
    for sent in doc.sents:
        sent_text = sent.text.strip()
        sent_text = re.sub(r"\s+", " ", sent_text)
        if min_len <= len(sent_text) <= max_len:
            sentences.append(sent_text)
    return sentences


# ─────────────────────────────────────────────────────────────────────────────
# PASO 5 — Preprocesamiento lingüístico
# ─────────────────────────────────────────────────────────────────────────────

def process_nlp_batch(nlp, texts: list) -> list:
    """
    Procesa un lote de oraciones con spaCy.pipe y devuelve
    [(tokens, lemas, pos_tags, entities), ...].
    Equivale a process_batch del notebook.
    """
    results = []
    for doc in nlp.pipe(texts, batch_size=200, n_process=1):
        tokens = [t.text for t in doc if not t.is_space]
        lemas = [t.lemma_ for t in doc if not t.is_space]
        pos_tags = [t.pos_ for t in doc if not t.is_space]
        entities = [{"text": ent.text, "label": ent.label_} for ent in doc.ents]
        results.append((tokens, lemas, pos_tags, entities))
    return results


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="AI-MELT N0 — Ingesta y preprocesamiento del corpus"
    )
    parser.add_argument("--file", required=True, help="Ruta al archivo PDF o TXT")
    parser.add_argument("--title", help="Título del documento")
    parser.add_argument("--author", default="Comisión de la Verdad", help="Autor del documento")
    parser.add_argument("--language", default="SPANISH", choices=["SPANISH", "ENGLISH"])
    parser.add_argument(
        "--inspect-pages", type=int, default=3,
        help="Número de páginas a mostrar en la inspección 3C (0 = omitir)"
    )
    args = parser.parse_args()

    t_global_start = time.time()

    # ── Validar archivo ──
    file_path = args.file
    if not os.path.exists(file_path):
        sys.stderr.write(f"Error: Archivo no encontrado en '{file_path}'\n")
        sys.exit(1)

    filename = os.path.basename(file_path)
    file_ext = os.path.splitext(filename)[1].lower()

    _section("AI-MELT N0 — Ingesta y Preprocesamiento del Corpus")
    _err(f"  Archivo   : {filename}")
    _err(f"  Título    : {args.title or '(auto)'}")
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
    # PASO 3 — Extracción de texto y detección automática de capítulos
    # ─────────────────────────────────────────────────────────────────────────
    _section("PASO 3 — Extracción de Texto y Detección de Capítulos")

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
    # PASO 3B — Limpieza del texto
    # ─────────────────────────────────────────────────────────────────────────
    _section("PASO 3B — Limpieza del Texto")
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

    # ─────────────────────────────────────────────────────────────────────────
    # PASO 3C — Inspección de la limpieza
    # ─────────────────────────────────────────────────────────────────────────
    _section("PASO 3C — Inspección de la Limpieza")

    if args.inspect_pages > 0 and cleaned_pages:
        _step(f"Mostrando muestra aleatoria de {args.inspect_pages} página(s) limpias:")
        inspect_cleaning(raw_pages, cleaned_pages, sample_count=args.inspect_pages)
        _ok("Si ves ruido, añade patrones a HEADERS_FOOTERS o REGEX_PATTERNS_TO_REMOVE.")
    else:
        _warn("Inspección omitida (--inspect-pages=0 o sin páginas limpias).")

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
    # PASO 4 — Segmentación en oraciones
    # ─────────────────────────────────────────────────────────────────────────
    _section("PASO 4 — Segmentación en Oraciones (spaCy)")
    t_step = time.time()

    all_sentences = []
    sentence_counter = 0
    n_pages_clean = len(cleaned_pages)

    for i, page in enumerate(cleaned_pages):
        _progress_bar(i + 1, n_pages_clean, label="páginas segmentadas")
        sentences = segment_page_into_sentences(nlp, page["text"])
        for sent_text in sentences:
            sentence_counter += 1
            all_sentences.append({
                "ID_documento": f"DOC-{os.path.splitext(filename)[0]}",
                "volumen": fallback_chapter,
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
    # PASO 5 — Preprocesamiento lingüístico
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

        # Liberar memoria del lote
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
    # PASO 6 — Generación del DataFrame N0
    # ─────────────────────────────────────────────────────────────────────────
    _section("PASO 6 — Generación del DataFrame N0")

    _step("Construyendo resumen por capítulos…")
    chapters_summary = []
    for ch, pages_list in sorted(unique_caps_clean.items(), key=lambda x: x[1][0]):
        ch_sents = [s for s in all_sentences if s["capitulo"] == ch]
        chapters_summary.append({
            "name": ch,
            "start_page": min(pages_list),
            "end_page": max(pages_list),
            "n_pages": len(pages_list),
            "n_sentences": len(ch_sents),
            "n_words": sum(s["n_palabras"] for s in ch_sents),
        })

    _ok(f"DataFrame N0 construido:")
    _bullet(f"Filas (oraciones):  {len(all_sentences):,}")
    _bullet(f"Columnas:           ID_documento, volumen, capitulo, pagina,")
    _bullet(f"                    ID_oracion, oracion_texto, n_palabras, n_caracteres,")
    _bullet(f"                    tokens, lemas, pos_tags, entidades_NER")
    _bullet(f"Documentos únicos:  1")
    _bullet(f"Capítulos únicos:   {len(chapters_summary)}")
    _bullet(f"Páginas procesadas: {len(cleaned_pages):,}")

    _step("Vista previa — primeras 3 oraciones:")
    for s in all_sentences[:3]:
        _err("-" * 50, 1)
        _err(f"[{s['ID_oracion']}] p.{s['pagina']} | {s['capitulo'][:40]}", 1)
        _err(f"  {s['oracion_texto'][:120]}{'…' if len(s['oracion_texto']) > 120 else ''}", 1)
        _err(f"  Tokens: {len(s['tokens'])} | Lemas: {len(s['lemas'])} | NER: {len(s['entidades_NER'])}", 1)

    # ─────────────────────────────────────────────────────────────────────────
    # PASO 7 — Exportación de resultados (JSON → stdout)
    # ─────────────────────────────────────────────────────────────────────────
    _section("PASO 7 — Exportación de Resultados")
    t_step = time.time()

    title_final = args.title or os.path.splitext(filename)[0].replace("_", " ").title()

    output = {
        "title": title_final,
        "author": args.author,
        "language": args.language,
        "processed_at": datetime.datetime.now().isoformat(),
        # Estadísticas del corpus
        "page_count": len(raw_pages),
        "pages_excluded": excluded_count,
        "pages_clean": len(cleaned_pages),
        "word_count": n_words_total,
        "token_count": total_tokens,
        "sentence_count": len(all_sentences),
        "footnote_count": len(all_footnotes),
        # Metadatos de capítulos
        "chapter_detection_method": chapter_method,
        "chapters": chapters_summary,
        # Notas al pie
        "footnotes": all_footnotes,
        # Oraciones con todo el preprocesamiento
        "sentences": all_sentences,
    }

    _step("Serializando JSON a stdout…")
    print(json.dumps(output, ensure_ascii=False, indent=2))

    t_total = time.time() - t_global_start
    _err("")
    _section("RESUMEN FINAL")
    _ok(f"Ingesta completada en {t_total:.1f}s")
    _bullet(f"Archivo:            {filename}")
    _bullet(f"Páginas procesadas: {len(cleaned_pages):,} / {len(raw_pages):,}")
    _bullet(f"Oraciones N0:       {len(all_sentences):,}")
    _bullet(f"Palabras totales:   {n_words_total:,}")
    _bullet(f"Tokens NLP:         {total_tokens:,}")
    _bullet(f"Entidades NER:      {total_ner:,}")
    _bullet(f"Capítulos:          {len(chapters_summary)}")
    _bullet(f"Notas al pie:       {len(all_footnotes):,}")
    _bullet(f"Método capítulos:   {chapter_method}")
    _err("")
    _ok("El JSON con las oraciones y metadatos fue enviado a stdout.")
    _ok("Siguiente paso: ejecutar N0_corpus_ingestion_viz.ipynb para visualización.")


if __name__ == "__main__":
    main()
