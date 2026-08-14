# -*- coding: utf-8 -*-
"""
ingest.py — AI-MELT Nivel 0: Ingesta y preprocesamiento del corpus

Pipeline:
  3.  Extracción de texto y detección automática de capítulos
  3B. Limpieza del texto (encabezados, pies de página, portadas, TOC)
  3C. Inspección de la limpieza
  3D. Inspección de notas al pie
  4.  Segmentación en oraciones
  5.  Preprocesamiento lingüístico (tokenización, POS, NER, lematización)
  6.  Generación del resumen N0
  7.  Exportación de resultados

Salida:
  - JSON en stdout
  - Progreso en stderr
"""

import argparse
import datetime
import gc
import json
import os
import re
import sys
import time
import unicodedata
import warnings
from collections import Counter
from statistics import median

warnings.filterwarnings("ignore")


# ─────────────────────────────────────────────────────────────────────────────
# Utilidades de progreso (stderr)
# ─────────────────────────────────────────────────────────────────────────────

def _err(msg: str, indent: int = 0):
    prefix = "  " * indent
    sys.stderr.write(f"{prefix}{msg}\n")
    sys.stderr.flush()


def _section(title: str):
    bar = "=" * 60
    _err(f"\n{bar}")
    _err(f"  {title}")
    _err(bar)


def _step(label: str):
    _err(f"\n▶ {label}")


def _ok(msg: str, indent: int = 1):
    _err(f"✓ {msg}", indent)


def _warn(msg: str, indent: int = 1):
    _err(f"⚠ {msg}", indent)


def _bullet(msg: str, indent: int = 2):
    _err(f"• {msg}", indent)


def _progress_bar(current: int, total: int, width: int = 30, label: str = ""):
    pct = current / total if total > 0 else 0
    filled = int(width * pct)
    bar = "█" * filled + "░" * (width - filled)
    sys.stderr.write(f"\r  [{bar}] {current:,}/{total:,} {label}  ")
    sys.stderr.flush()
    if current >= total:
        sys.stderr.write("\n")
        sys.stderr.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Configuración
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
BATCH_SIZE_NLP = 500

DEFAULT_LEVEL0_CONFIG = {
    "chapterDetection": {
        "enabled": True,
        "method": "AUTO",
    },
    "cleaning": {
        "repairHyphenation": True,
        "detectRepeatedHeaders": True,
        "repeatedHeaderThreshold": 0.3,
        "excludeFrontMatter": True,
        "minLineLength": 30,
        "additionalHeadersFooters": [],
    },
    "footnotes": {
        "extract": True,
    },
    "segmentation": {
        "minChars": 10,
        "maxChars": 2000,
    },
    # None keeps the current filename-specific legacy exclusions.
    # [] explicitly disables them.
    "excludedPageRanges": None,
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = dict(base)

    for key, value in (override or {}).items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value

    return result


def load_level0_config(raw_json: str) -> dict:
    config = json.loads(json.dumps(DEFAULT_LEVEL0_CONFIG))

    if not raw_json:
        return config

    try:
        incoming = json.loads(raw_json)
    except Exception as exc:
        _warn(f"Configuración N0 inválida; se usarán valores por defecto: {exc}")
        return config

    if not isinstance(incoming, dict):
        _warn("Configuración N0 inválida; se usarán valores por defecto.")
        return config

    config = _deep_merge(config, incoming)

    # Normalización defensiva.
    chapter = config.setdefault("chapterDetection", {})
    chapter["enabled"] = bool(chapter.get("enabled", True))
    method = str(chapter.get("method", "AUTO")).upper()
    if method not in {"AUTO", "TOC", "PRINTED_INDEX", "FONT_SIZE", "NONE"}:
        method = "AUTO"
    chapter["method"] = method

    cleaning = config.setdefault("cleaning", {})
    cleaning["repairHyphenation"] = bool(
        cleaning.get("repairHyphenation", True)
    )
    cleaning["detectRepeatedHeaders"] = bool(
        cleaning.get("detectRepeatedHeaders", True)
    )
    cleaning["excludeFrontMatter"] = bool(
        cleaning.get("excludeFrontMatter", True)
    )

    try:
        threshold = float(cleaning.get("repeatedHeaderThreshold", 0.3))
    except Exception:
        threshold = 0.3
    cleaning["repeatedHeaderThreshold"] = min(0.95, max(0.05, threshold))

    try:
        min_line_length = int(cleaning.get("minLineLength", 30))
    except Exception:
        min_line_length = 30
    cleaning["minLineLength"] = min(500, max(0, min_line_length))

    headers = cleaning.get("additionalHeadersFooters", [])
    if not isinstance(headers, list):
        headers = []
    cleaning["additionalHeadersFooters"] = [
        normalize_whitespace(str(item))[:250]
        for item in headers
        if normalize_whitespace(str(item))
    ][:250]

    footnotes = config.setdefault("footnotes", {})
    footnotes["extract"] = bool(footnotes.get("extract", True))

    segmentation = config.setdefault("segmentation", {})
    try:
        min_chars = int(segmentation.get("minChars", 10))
    except Exception:
        min_chars = 10

    try:
        max_chars = int(segmentation.get("maxChars", 2000))
    except Exception:
        max_chars = 2000

    min_chars = min(5000, max(1, min_chars))
    max_chars = min(20000, max(min_chars, max_chars))
    segmentation["minChars"] = min_chars
    segmentation["maxChars"] = max_chars

    ranges = config.get("excludedPageRanges", None)
    if ranges is not None:
        normalized_ranges = []

        if isinstance(ranges, list):
            for item in ranges[:250]:
                if not isinstance(item, (list, tuple)) or len(item) != 2:
                    continue
                try:
                    start = max(1, int(item[0]))
                    end = max(1, int(item[1]))
                except Exception:
                    continue
                if start > end:
                    start, end = end, start
                normalized_ranges.append([start, end])

        config["excludedPageRanges"] = normalized_ranges

    return config

REGEX_PATTERNS_TO_REMOVE = [
    r"^\d{1,4}$",
    r"^\d{1,4}\s*$",
    r"^Página\s+\d+",
    r"^\d+\s+de\s+\d+",
    r"^Capítulo\s+\d+",
    r"^Tabla de contenido",
    r"^Índice$",
    r"^Contenido$",
    r"^REFERENCIAS\s*$",
    r"^BIBLIOGRAFÍA\s*$",
    r"^Fuente:",
    r"^Foto:",
    r"^Ilustración:",
    r"^Gráfic[oa]\s+\d+",
    r"^Tabla\s+\d+",
    r"^Mapa\s+\d+",
    r"^Figura\s+\d+",
]

GENERIC_NON_CHAPTER_TITLES = {
    "indice",
    "índice",
    "contenido",
    "prefacio",
    "prologo",
    "prólogo",
    "introduccion",
    "introducción",
    "bibliografia",
    "bibliografía",
    "agradecimientos",
    "creditos",
    "créditos",
}

AUTHOR_LIKE_NAMES = {
    "emmanuel lizcano",
}

FRONT_MATTER_KEYWORDS = [
    "reconocimiento – nocomercial",
    "reconocimiento - nocomercial",
    "sinobraderivada",
    "prefacio",
    "índice",
    "indice",
    "bibliografía",
    "bibliografia",
]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers generales
# ─────────────────────────────────────────────────────────────────────────────

def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()

SOFT_HYPHEN = "\u00ad"
LETTER_CHARS = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ"
LOWERCASE_CHARS = "a-záéíóúüñ"
LINE_BREAK_HYPHENS = r"\-‐-‒–—"


def repair_pdf_hyphenation(text: str) -> str:

    if not text:
        return ""

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ")
    text = text.replace("\u200b", "")

    # Palabra cortada con guion suave y salto de línea:
    # enton­\nces -> entonces
    text = re.sub(
        rf"([{LETTER_CHARS}]){SOFT_HYPHEN}[ \t]*\n[ \t]*([{LOWERCASE_CHARS}])",
        r"\1\2",
        text,
    )

    # Palabra cortada con guion visible y salto de línea:
    # considera-\ndo -> considerado
    text = re.sub(
        rf"([{LETTER_CHARS}])[{LINE_BREAK_HYPHENS}][ \t]*\n[ \t]*([{LOWERCASE_CHARS}])",
        r"\1\2",
        text,
    )

    # Guion suave dentro de una misma línea:
    # pe­ lícula -> película
    text = re.sub(
        rf"([{LETTER_CHARS}]){SOFT_HYPHEN}[ \t]*([{LETTER_CHARS}])",
        r"\1\2",
        text,
    )

    # Eliminar cualquier guion suave restante.
    text = text.replace(SOFT_HYPHEN, "")

    return text

FOOTNOTE_MARKER_PATTERN = re.compile(
    r"^\s*(?:\d{1,3}|[*†‡§])(?:[\s.)\]]+|$)"
)


def extract_page_lines_with_layout(page) -> list:
    """
    Extrae las líneas de una página conservando posición y tamaño de fuente.
    """
    lines = []

    try:
        blocks = page.get_text(
            "dict",
            flags=0,
        ).get("blocks", [])
    except Exception:
        return lines

    for block in blocks:
        if "lines" not in block:
            continue

        for line in block["lines"]:
            spans = line.get("spans", [])
            if not spans:
                continue

            text = normalize_whitespace(
                " ".join(span.get("text", "") for span in spans)
            )

            if not text:
                continue

            sizes = [
                float(span.get("size", 0))
                for span in spans
                if float(span.get("size", 0)) > 0
            ]

            if not sizes:
                continue

            bbox = line.get("bbox")

            if not bbox or len(bbox) < 4:
                span_boxes = [
                    span.get("bbox")
                    for span in spans
                    if span.get("bbox") and len(span.get("bbox")) >= 4
                ]

                if not span_boxes:
                    continue

                x0 = min(box[0] for box in span_boxes)
                y0 = min(box[1] for box in span_boxes)
                x1 = max(box[2] for box in span_boxes)
                y1 = max(box[3] for box in span_boxes)
            else:
                x0, y0, x1, y1 = bbox

            lines.append({
                "text": repair_pdf_hyphenation(text),
                "size": median(sizes),
                "min_size": min(sizes),
                "max_size": max(sizes),
                "x0": float(x0),
                "y0": float(y0),
                "x1": float(x1),
                "y1": float(y1),
            })

    return sorted(lines, key=lambda item: (item["y0"], item["x0"]))


def estimate_body_font_size(lines: list) -> float:

    candidates = [
        line["size"]
        for line in lines
        if len(line["text"]) >= 35
        and not re.fullmatch(r"\d{1,4}", line["text"])
    ]

    if not candidates:
        candidates = [
            line["size"]
            for line in lines
            if not re.fullmatch(r"\d{1,4}", line["text"])
        ]

    return float(median(candidates)) if candidates else 0.0


def is_probable_footnote_line(
    line: dict,
    page_height: float,
    body_font_size: float,
) -> bool:

    text = normalize_whitespace(line.get("text", ""))

    if not text:
        return False

    # Evitar confundir el número de página con una nota.
    if re.fullmatch(r"\d{1,4}", text):
        return False

    if page_height <= 0 or body_font_size <= 0:
        return False

    vertical_ratio = line["y0"] / page_height
    smaller_font = line["size"] <= body_font_size * 0.92
    clearly_smaller_font = line["size"] <= body_font_size * 0.82
    has_marker = bool(FOOTNOTE_MARKER_PATTERN.match(text))

    # Debe estar en la zona inferior de la página.
    in_bottom_zone = vertical_ratio >= 0.64
    in_deep_bottom_zone = vertical_ratio >= 0.72

    # Con marcador aceptamos una diferencia de fuente menos fuerte.
    if has_marker and in_bottom_zone and smaller_font:
        return True

    # Una continuación sin número debe estar claramente abajo
    # y usar una fuente sensiblemente menor.
    if in_deep_bottom_zone and clearly_smaller_font:
        return True

    return False


def group_footnote_lines(candidate_lines: list) -> list[str]:

    notes = []
    current = ""

    for line in candidate_lines:
        text = normalize_whitespace(line.get("text", ""))

        if not text:
            continue

        starts_note = bool(FOOTNOTE_MARKER_PATTERN.match(text))

        if starts_note:
            if current:
                notes.append(normalize_whitespace(current))
            current = text
        elif current:
            current = f"{current} {text}"

    if current:
        notes.append(normalize_whitespace(current))

    return [
        note
        for note in notes
        if len(note) >= 15
    ]


def remove_layout_footnote_lines(
    page_text: str,
    candidate_lines: list,
) -> str:

    candidate_counts = Counter(
        normalize_for_match(line["text"])
        for line in candidate_lines
        if normalize_for_match(line["text"])
    )

    remaining_lines = []

    for raw_line in page_text.splitlines():
        normalized = normalize_for_match(raw_line)

        if normalized and candidate_counts.get(normalized, 0) > 0:
            candidate_counts[normalized] -= 1
            continue

        remaining_lines.append(raw_line)

    return "\n".join(remaining_lines)


def extract_footnotes_from_page_layout(page, page_text: str):

    lines = extract_page_lines_with_layout(page)

    if not lines:
        return page_text, [], {
            "body_font_size": None,
            "candidate_lines": 0,
        }

    page_height = float(page.rect.height)
    body_font_size = estimate_body_font_size(lines)

    candidate_lines = [
        line
        for line in lines
        if is_probable_footnote_line(
            line,
            page_height,
            body_font_size,
        )
    ]

    notes = group_footnote_lines(candidate_lines)

    if not notes:
        return page_text, [], {
            "body_font_size": body_font_size,
            "candidate_lines": len(candidate_lines),
        }

    text_without_notes = remove_layout_footnote_lines(
        page_text,
        candidate_lines,
    )

    return text_without_notes, notes, {
        "body_font_size": body_font_size,
        "candidate_lines": len(candidate_lines),
    }

def is_probable_short_noise(line: str, min_line_length: int) -> bool:

    if not line:
        return True

    if len(line) >= min_line_length:
        return False

    # Números de página o líneas formadas únicamente por símbolos.
    if re.fullmatch(r"\d{1,4}", line):
        return True

    if re.fullmatch(r"[\W_]+", line):
        return True

    letters = re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]", line)
    if not letters:
        return True

    words = line.split()
    upper_ratio = sum(1 for char in letters if char.isupper()) / len(letters)

    # Encabezado corto completamente en mayúsculas.
    if upper_ratio >= 0.85 and len(words) <= 8:
        return True

    return False


def rebuild_wrapped_lines(lines: list[str]) -> str:

    paragraphs = []
    current = ""

    for raw_line in lines:
        line = normalize_whitespace(raw_line)
        if not line:
            continue

        if not current:
            current = line
            continue

        current_ends_sentence = bool(
            re.search(r"""[.!?…]["'»”)]?$""", current)
        )

        line_starts_list = bool(
            re.match(
                r"^(?:[-–—•▪◦]\s+|\d{1,3}[.)]\s+|[A-Za-z][.)]\s+)",
                line,
            )
        )

        if current_ends_sentence or line_starts_list:
            paragraphs.append(current)
            current = line
        else:
            current = f"{current} {line}"

    if current:
        paragraphs.append(current)

    return "\n".join(paragraphs)


def strip_accents(text: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", text or "")
        if unicodedata.category(ch) != "Mn"
    )


def normalize_for_match(text: str) -> str:
    text = strip_accents(text).lower()
    text = re.sub(r"[«»“”\"'`´]", "", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_chapter_name(name: str) -> str:
    if not name:
        return ""

    name = normalize_whitespace(name)

    # quitar basura al inicio (cuadros, viñetas, símbolos raros)
    name = re.sub(r"^[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9¿¡«]+", "", name)

    name = re.sub(r"^(Capítulo|Cap\.?)\s*\d+\.?\s*", "", name, flags=re.IGNORECASE)
    name = re.sub(r"^\d+\.\s*", "", name)
    name = re.sub(r"^[IVXLC]+\.\s*", "", name)

    return name.strip(" -–—:;,.")[:220].strip()


def truncate_for_log(text: str, max_chars: int = 120) -> str:
    text = normalize_whitespace(text)
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "…"


def expand_page_ranges(page_specs) -> set:
    pages = set()
    for spec in page_specs:
        if isinstance(spec, (list, tuple)) and len(spec) == 2:
            pages.update(range(spec[0], spec[1] + 1))
        else:
            pages.add(spec)
    return pages


def is_probable_heading(text: str) -> bool:
    if not text:
        return False

    text = normalize_whitespace(text)
    text_lower = normalize_for_match(text)

    generic_norm = {normalize_for_match(x) for x in GENERIC_NON_CHAPTER_TITLES}
    author_norm = {normalize_for_match(x) for x in AUTHOR_LIKE_NAMES}

    if len(text) < 4 or len(text) > 110:
        return False

    if text_lower in generic_norm:
        return False

    if text_lower in author_norm:
        return False

    words = text.split()
    if len(words) > 14:
        return False

    if re.search(r"[.!?;:]\s*$", text):
        return False

    if text.count(",") > 2:
        return False

    if re.fullmatch(r"\d{1,4}", text):
        return False

    if 1 <= len(words) <= 3:
        capitalized_words = sum(1 for w in words if w[:1].isupper())
        if capitalized_words == len(words) and len(words) <= 2:
            return False

    letters = re.findall(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]", text)
    if not letters:
        return False

    lower_ratio = sum(1 for c in letters if c.islower()) / len(letters)
    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)

    if len(text) > 70 and lower_ratio > 0.75:
        return False

    if upper_ratio > 0.6:
        return True

    return True


def is_index_heading_line(text: str) -> bool:
    text = normalize_whitespace(text)
    if not text:
        return False

    lowered = normalize_for_match(text)
    generic_norm = {normalize_for_match(x) for x in GENERIC_NON_CHAPTER_TITLES}

    if lowered in generic_norm:
        return True

    letters = re.findall(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]", text)
    if letters:
        upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if upper_ratio > 0.75 and len(text.split()) <= 12:
            return True

    return False


def strip_trailing_page_number(line: str):
    """
    Soporta:
      titulo ..... 23
      titulo ---- 23
      titulo 23
    """
    line = normalize_whitespace(line)

    patterns = [
        r"^(.*?)\.{2,}\s*(\d{1,4})\s*$",
        r"^(.*?)\s+[·•…\-_]{2,}\s*(\d{1,4})\s*$",
        r"^(.*?)\s+(\d{1,4})\s*$",
    ]

    for pattern in patterns:
        m = re.match(pattern, line)
        if m:
            title = clean_chapter_name(m.group(1))
            page = int(m.group(2))
            return title, page

    return None, None

def parse_standalone_page_number(line: str):
    """
    Detecta líneas que solo contienen el número de página del índice.
    Ejemplo:
      '23'
      '127'
    """
    line = normalize_whitespace(line)
    if re.fullmatch(r"\d{1,4}", line):
        return int(line)
    return None


def looks_like_section_heading_without_page(line: str) -> bool:
    """
    Detecta encabezados de sección del índice como:
    'CÓMO HACER COSAS —Y DESHACERLAS— CON METÁFORAS'
    'LA FABRICACIÓN CIENTÍFICA DE LA REALIDAD'
    """
    text = normalize_whitespace(line)
    if not text:
        return False

    letters = re.findall(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]", text)
    if not letters:
        return False

    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
    word_count = len(text.split())

    if upper_ratio > 0.75 and 2 <= word_count <= 14:
        return True

    return False

def build_title_match_candidates(title: str) -> list:
    norm = normalize_for_match(title)
    words = [w for w in norm.split() if len(w) >= 3]

    if not words:
        return []

    candidates = []
    candidates.append(" ".join(words))

    if len(words) >= 8:
        candidates.append(" ".join(words[:8]))
    if len(words) >= 6:
        candidates.append(" ".join(words[:6]))
    if len(words) >= 5:
        candidates.append(" ".join(words[:5]))
    if len(words) >= 4:
        candidates.append(" ".join(words[:4]))

    seen = set()
    output = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            output.append(c)

    return output


def find_best_title_page_match(
    raw_pages: list,
    title: str,
    expected_page: int,
    search_back: int = 2,
    search_forward: int = 12,
):
    if not raw_pages or not title:
        return None

    candidates = build_title_match_candidates(title)
    if not candidates:
        return None

    page_texts = {
        p["pagina"]: normalize_for_match(p["texto"])
        for p in raw_pages
    }

    p_min = max(1, expected_page - search_back)
    p_max = expected_page + search_forward

    best_page = None
    best_distance = None
    best_candidate_len = -1

    for page_num in range(p_min, p_max + 1):
        text = page_texts.get(page_num, "")
        if not text:
            continue

        for cand in candidates:
            if cand in text:
                distance = abs(page_num - expected_page)
                cand_len = len(cand)

                if (
                    best_page is None
                    or distance < best_distance
                    or (distance == best_distance and cand_len > best_candidate_len)
                    or (
                        distance == best_distance
                        and cand_len == best_candidate_len
                        and page_num < best_page
                    )
                ):
                    best_page = page_num
                    best_distance = distance
                    best_candidate_len = cand_len

    return best_page


def infer_printed_index_offset(index_entries: list, raw_pages: list) -> int:
    """
    Calcula offset SOLO para índice impreso.
    Ejemplos posibles: 0, +1, +2, +3...
    """
    if not index_entries or not raw_pages:
        return 0

    deltas = []

    usable_entries = [entry for entry in index_entries if entry["book_page"] >= 5][:8]

    for entry in usable_entries:
        matched_page = find_best_title_page_match(
            raw_pages=raw_pages,
            title=entry["title"],
            expected_page=entry["book_page"],
            search_back=2,
            search_forward=12,
        )

        if matched_page is not None:
            deltas.append(matched_page - entry["book_page"])

    if not deltas:
        return 0

    counts = Counter(deltas)
    best_delta, best_count = counts.most_common(1)[0]

    if best_count >= 2:
        return max(-2, min(15, best_delta))

    if len(deltas) == 1:
        return max(-2, min(15, deltas[0]))

    deltas_sorted = sorted(deltas)
    if deltas_sorted[-1] - deltas_sorted[0] <= 2:
        median_delta = deltas_sorted[len(deltas_sorted) // 2]
        return max(-2, min(15, median_delta))

    return 0


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3 — Extracción de texto y detección de capítulos
# ─────────────────────────────────────────────────────────────────────────────

def get_chapter_map_from_toc(pdf_path: str):
    """
    Estrategia 1: usar TOC/bookmarks del PDF.
    """
    import fitz

    try:
        doc = fitz.open(pdf_path)
        toc = doc.get_toc()
        doc.close()
    except Exception as e:
        _warn(f"Error leyendo TOC: {e}", 2)
        return None

    if not toc:
        return None

    level1 = [(clean_chapter_name(t), p) for lvl, t, p in toc if lvl == 1]
    level1 = [(t, p) for t, p in level1 if t]

    if not level1:
        min_level = min(lvl for lvl, _, _ in toc)
        level1 = [(clean_chapter_name(t), p) for lvl, t, p in toc if lvl == min_level]
        level1 = [(t, p) for t, p in level1 if t]

    if not level1:
        return None

    chapter_map = {}
    for i, (titulo, p_ini) in enumerate(level1):
        p_fin = level1[i + 1][1] - 1 if i + 1 < len(level1) else 999999
        for p in range(p_ini, p_fin + 1):
            chapter_map[p] = titulo

    return chapter_map


def get_chapter_map_from_index_pages(pdf_path: str, raw_pages: list = None):
    """
    Estrategia 2: detectar una página de índice/tabla de contenido y construir
    el mapa de capítulos a partir de líneas con títulos + página.

    Mejoras:
    - soporta títulos partidos en varias líneas
    - soporta cuando el número de página viene solo en otra línea
    - ignora encabezados de sección sin número de página
    - calcula offset automático por documento
    - corta en bibliografía
    """
    import fitz

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        _warn(f"Error leyendo índice impreso: {e}", 2)
        return None, None, 0

    entries = []
    bibliography_book_page = None

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text")
        text_norm = normalize_for_match(text)

        if "indice" not in text_norm and "contenido" not in text_norm:
            continue

        lines = [normalize_whitespace(line) for line in text.splitlines() if normalize_whitespace(line)]
        buffer_parts = []

        for line in lines:
            lowered = normalize_for_match(line)

            if lowered in {"indice", "contenido"}:
                buffer_parts = []
                continue

            if looks_like_section_heading_without_page(line):
                buffer_parts = []
                continue

            # Caso 1: la línea termina con número de página
            title_part, page_num_idx = strip_trailing_page_number(line)
            if page_num_idx is not None:
                full_parts = buffer_parts[:]
                if title_part:
                    full_parts.append(title_part)

                full_title = clean_chapter_name(" ".join(full_parts))
                buffer_parts = []

                if not full_title:
                    continue

                full_title_norm = normalize_for_match(full_title)
                generic_norm = {normalize_for_match(x) for x in GENERIC_NON_CHAPTER_TITLES}
                author_norm = {normalize_for_match(x) for x in AUTHOR_LIKE_NAMES}

                if full_title_norm in generic_norm:
                    continue

                if full_title_norm in author_norm:
                    continue

                if "bibliograf" in full_title_norm:
                    bibliography_book_page = page_num_idx
                    continue

                if "prefacio" in full_title_norm:
                    continue

                entries.append({
                    "title": full_title,
                    "book_page": page_num_idx,
                })
                continue

            # Caso 2: la línea es SOLO el número de página, y el título venía antes
            standalone_page = parse_standalone_page_number(line)
            if standalone_page is not None and buffer_parts:
                full_title = clean_chapter_name(" ".join(buffer_parts))
                buffer_parts = []

                if not full_title:
                    continue

                full_title_norm = normalize_for_match(full_title)
                generic_norm = {normalize_for_match(x) for x in GENERIC_NON_CHAPTER_TITLES}
                author_norm = {normalize_for_match(x) for x in AUTHOR_LIKE_NAMES}

                if full_title_norm in generic_norm:
                    continue

                if full_title_norm in author_norm:
                    continue

                if "bibliograf" in full_title_norm:
                    bibliography_book_page = standalone_page
                    continue

                if "prefacio" in full_title_norm:
                    continue

                entries.append({
                    "title": full_title,
                    "book_page": standalone_page,
                })
                continue

            # Caso 3: línea normal, probablemente parte de un título multilinea
            cleaned = clean_chapter_name(line)
            if cleaned:
                buffer_parts.append(cleaned)

    doc.close()

    if not entries:
        return None, None, 0

    # deduplicar por página impresa, conservar el título más largo
    dedup = {}
    for entry in entries:
        page_num_idx = entry["book_page"]
        title = entry["title"]
        if page_num_idx not in dedup or len(title) > len(dedup[page_num_idx]):
            dedup[page_num_idx] = title

    entries = sorted(
        [{"title": title, "book_page": page_num_idx} for page_num_idx, title in dedup.items()],
        key=lambda x: x["book_page"],
    )

    offset = infer_printed_index_offset(entries, raw_pages or [])

    total_pdf_pages = max((p["pagina"] for p in (raw_pages or [])), default=999999)
    bibliography_start = bibliography_book_page + offset if bibliography_book_page else None

    chapter_map = {}
    chapters_summary = []

    for i, entry in enumerate(entries):
        start_page = entry["book_page"] + offset

        if i + 1 < len(entries):
            end_page = entries[i + 1]["book_page"] + offset - 1
        elif bibliography_start:
            end_page = bibliography_start - 1
        else:
            end_page = total_pdf_pages

        if start_page < 1:
            continue
        if end_page < start_page:
            continue

        chapters_summary.append({
            "name": entry["title"],
            "start_page": start_page,
            "end_page": end_page,
        })

        for p in range(start_page, end_page + 1):
            chapter_map[p] = entry["title"]

    if not chapters_summary:
        return None, None, offset

    return chapter_map, chapters_summary, offset


def get_chapter_map_from_fonts(pdf_path: str, top_percentile: float = 0.01):
    """
    Estrategia 3: detectar capítulos por tamaño de fuente con filtros fuertes.
    """
    import fitz
    import numpy as np

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        _warn(f"Error leyendo fuentes: {e}", 2)
        return None

    all_sizes = []
    long_line_sizes = []
    page_candidates = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        page_height = page.rect.height
        page_width = page.rect.width

        try:
            blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        except Exception:
            continue

        lines_info = []
        for block in blocks:
            if "lines" not in block:
                continue

            for line in block["lines"]:
                spans = line.get("spans", [])
                if not spans:
                    continue

                text = normalize_whitespace(" ".join(s.get("text", "") for s in spans))
                if not text:
                    continue

                size = max(s.get("size", 0) for s in spans)
                bold = any("bold" in s.get("font", "").lower() for s in spans)
                x0 = min(s.get("bbox", [0, 0, 0, 0])[0] for s in spans)
                y0 = min(s.get("bbox", [0, 0, 0, 0])[1] for s in spans)
                x1 = max(s.get("bbox", [0, 0, 0, 0])[2] for s in spans)
                y1 = max(s.get("bbox", [0, 0, 0, 0])[3] for s in spans)
                width_ratio = (x1 - x0) / page_width if page_width else 1.0

                all_sizes.append(size)
                if len(text) > 25:
                    long_line_sizes.append(size)

                lines_info.append({
                    "text": text,
                    "size": size,
                    "bold": bold,
                    "page": page_num + 1,
                    "y0": y0,
                    "y1": y1,
                    "page_height": page_height,
                    "width_ratio": width_ratio,
                })

        page_candidates.append(lines_info)

    doc.close()

    if not all_sizes:
        return None

    body_reference = np.median(long_line_sizes) if long_line_sizes else np.median(all_sizes)
    percentile_reference = np.percentile(np.array(all_sizes), (1 - top_percentile) * 100)
    font_threshold = max(body_reference * 1.5, percentile_reference)

    raw_candidates = []
    for lines in page_candidates:
        per_page = []

        for line in lines:
            not_front_cover_zone = line["page"] > 8
            top_zone = line["y0"] <= line["page_height"] * 0.28
            large_enough = line["size"] >= font_threshold
            narrow_enough = line["width_ratio"] <= 0.95
            probable_title = is_probable_heading(line["text"])

            if not_front_cover_zone and top_zone and large_enough and narrow_enough and probable_title:
                per_page.append(line)

        if not per_page:
            continue

        per_page.sort(key=lambda x: (x["y0"], -x["size"]))
        merged = []
        current = per_page[0].copy()

        for cand in per_page[1:]:
            same_page = cand["page"] == current["page"]
            close_y = abs(cand["y0"] - current["y1"]) <= 12
            similar_size = abs(cand["size"] - current["size"]) <= 1.5

            if same_page and close_y and similar_size:
                current["text"] = normalize_whitespace(current["text"] + " " + cand["text"])
                current["y1"] = max(current["y1"], cand["y1"])
                current["bold"] = current["bold"] or cand["bold"]
                current["width_ratio"] = max(current["width_ratio"], cand["width_ratio"])
            else:
                merged.append(current)
                current = cand.copy()

        merged.append(current)

        def _score(item):
            score = item["size"] * 10
            if item["bold"]:
                score += 8
            if item["y0"] <= item["page_height"] * 0.12:
                score += 4
            if len(item["text"]) <= 70:
                score += 3
            return score

        best = max(merged, key=_score)
        best["text"] = clean_chapter_name(best["text"])

        if best["text"] and is_probable_heading(best["text"]):
            raw_candidates.append(best)

    if not raw_candidates:
        return None

    freq = Counter(c["text"] for c in raw_candidates if c["text"])
    max_repeat = max(2, int(len(page_candidates) * 0.08))
    filtered = [c for c in raw_candidates if freq[c["text"]] <= max_repeat]

    if not filtered:
        return None

    filtered.sort(key=lambda x: x["page"])

    chapter_map = {}
    for i, ch in enumerate(filtered):
        title = ch["text"]
        page_start = ch["page"]
        page_end = filtered[i + 1]["page"] - 1 if i + 1 < len(filtered) else 999999

        if not title:
            continue

        for p in range(page_start, page_end + 1):
            chapter_map[p] = title

    return chapter_map if chapter_map else None


def extract_text_from_pdf(pdf_path: str, level0_config: dict) -> list:
    import fitz

    doc = fitz.open(pdf_path)
    total = len(doc)
    pages = []

    cleaning_cfg = level0_config["cleaning"]
    footnote_cfg = level0_config["footnotes"]

    _err("")

    for page_num in range(total):
        _progress_bar(
            page_num + 1,
            total,
            label="páginas extraídas",
        )

        page = doc[page_num]
        raw_text = page.get_text("text")

        if cleaning_cfg["repairHyphenation"]:
            raw_text = repair_pdf_hyphenation(raw_text)

        raw_text = re.sub(r"\n{3,}", "\n\n", raw_text)
        raw_text = re.sub(r"[ \t]{2,}", " ", raw_text)

        if footnote_cfg["extract"]:
            text_without_footnotes, footnotes, footnote_debug = (
                extract_footnotes_from_page_layout(
                    page,
                    raw_text,
                )
            )
        else:
            text_without_footnotes = raw_text
            footnotes = []
            footnote_debug = {
                "body_font_size": None,
                "candidate_lines": 0,
            }

        if cleaning_cfg["repairHyphenation"]:
            text_without_footnotes = repair_pdf_hyphenation(
                text_without_footnotes
            )

        if raw_text.strip():
            pages.append({
                "pagina": page_num + 1,

                # Texto sin notas para limpieza y NLP.
                "texto": text_without_footnotes.strip(),

                # Texto original por si después necesitamos inspección.
                "texto_original": raw_text.strip(),

                # Notas detectadas mediante posición y fuente.
                "footnotes": footnotes,

                # Datos útiles para depurar el algoritmo.
                "footnote_debug": footnote_debug,
            })

    doc.close()
    return pages

def extract_text_from_txt(txt_path: str) -> list:
    with open(txt_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()

    return [{"pagina": 1, "texto": text.strip()}]


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3B — Limpieza
# ─────────────────────────────────────────────────────────────────────────────

def detect_repeated_headers(pages_text: list, threshold: float = 0.3) -> set:
    n_pages = len(pages_text)
    if n_pages < 3:
        return set()

    line_counts = Counter()
    for page in pages_text:
        unique_lines = set()
        for line in page.split("\n"):
            cleaned = normalize_whitespace(line)
            if 5 < len(cleaned) < 100:
                unique_lines.add(cleaned)
        for line in unique_lines:
            line_counts[line] += 1

    return {line for line, count in line_counts.items() if count >= n_pages * threshold}


def clean_page_text(
    text: str,
    headers_set: set,
    regex_patterns: list,
    min_line_length: int,
    repair_hyphenation: bool = True,
) -> str:

    if repair_hyphenation:
        text = repair_pdf_hyphenation(text)

    lines = text.split("\n")
    cleaned = []

    headers_normalized = {
        normalize_for_match(header)
        for header in headers_set
        if normalize_whitespace(header)
    }

    for line in lines:
        stripped = normalize_whitespace(line)

        if not stripped:
            continue

        # Encabezados conocidos o repetidos.
        if normalize_for_match(stripped) in headers_normalized:
            continue

        # Patrones explícitos: números de página, índices, figuras, etc.
        if any(
            re.match(pattern, stripped, re.IGNORECASE)
            for pattern in regex_patterns
        ):
            continue

        # Solo descartar líneas cortas cuando realmente parecen ruido.
        if is_probable_short_noise(stripped, min_line_length):
            continue

        cleaned.append(stripped)

    return rebuild_wrapped_lines(cleaned)


def remove_footnotes_from_bottom(text: str):
    lines = text.split("\n")
    footnotes = []

    while lines:
        last = normalize_whitespace(lines[-1])
        if not last:
            lines.pop()
            continue

        if re.match(r"^\d{1,3}\s+[A-ZÁÉÍÓÚÑ].*", last):
            footnotes.append(last)
            lines.pop()
        else:
            break

    footnotes.reverse()
    return "\n".join(lines), footnotes


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3C — Inspección de limpieza
# ─────────────────────────────────────────────────────────────────────────────

def inspect_cleaning(cleaned_pages: list, sample_count: int = 3):
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
        preview = pg["text"][:160].replace("\n", " ↵ ")
        _err(preview, 2)
        if len(pg["text"]) > 160:
            _err(f"... ({len(pg['text']) - 160:,} caracteres más)", 2)
    _err("-" * 60, 1)


# ─────────────────────────────────────────────────────────────────────────────
# PASO 4 — Segmentación
# ─────────────────────────────────────────────────────────────────────────────

def segment_page_into_sentences(nlp, text: str, min_len: int = 10, max_len: int = 2000) -> list:
    doc = nlp(text)
    sentences = []

    for sent in doc.sents:
        sent_text = normalize_whitespace(sent.text)
        if min_len <= len(sent_text) <= max_len:
            sentences.append(sent_text)

    return sentences


# ─────────────────────────────────────────────────────────────────────────────
# PASO 5 — NLP
# ─────────────────────────────────────────────────────────────────────────────

def process_nlp_batch(nlp, texts: list) -> list:
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
    parser.add_argument("--inspect-pages", type=int, default=3)
    parser.add_argument(
        "--config-json",
        default="",
        help="Configuración efectiva de Nivel 0 serializada como JSON",
    )
    args = parser.parse_args()

    level0_config = load_level0_config(args.config_json)

    t_global_start = time.time()

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
    _err(f"  Config N0 : {json.dumps(level0_config, ensure_ascii=False)}")
    _err(f"  Inicio    : {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

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
        if "sentencizer" not in nlp.pipe_names:
            nlp.add_pipe("sentencizer")

    nlp.max_length = 3_000_000

    # ─────────────────────────────────────────────────────────────────────
    # PASO 3 — Extracción de texto y detección de capítulos
    # ─────────────────────────────────────────────────────────────────────
    _section("PASO 3 — Extracción de Texto y Detección de Capítulos")
    t_step = time.time()

    raw_pages = []
    chapter_map = None
    chapter_method = "ninguno"
    index_chapters_summary = None
    printed_index_offset = 0

    chapter_cfg = level0_config["chapterDetection"]
    requested_chapter_method = chapter_cfg["method"]

    if file_ext == ".pdf":
        _step("Extrayendo texto…")
        raw_pages = extract_text_from_pdf(file_path, level0_config)
        _ok(f"Texto extraído: {len(raw_pages):,} páginas con texto")
        _bullet(f"Tiempo extracción: {time.time() - t_step:.1f}s")

        if not chapter_cfg["enabled"] or requested_chapter_method == "NONE":
            chapter_method = "fallback_filename"
            _warn("Detección de capítulos desactivada por configuración.")
        else:
            if requested_chapter_method in {"AUTO", "TOC"}:
                _step("Intentando detección de capítulos por TOC/Bookmarks…")
                chapter_map = get_chapter_map_from_toc(file_path)

                if chapter_map:
                    chapter_method = "toc_bookmarks"
                    unique_chapters = sorted(
                        set(chapter_map.values()),
                        key=lambda x: min(p for p, c in chapter_map.items() if c == x),
                    )
                    _ok(f"{len(unique_chapters)} capítulos detectados vía TOC/Bookmarks")
                    for ch in unique_chapters[:12]:
                        pages_range = sorted(p for p, c in chapter_map.items() if c == ch)
                        _bullet(f"pp. {pages_range[0]}-{pages_range[-1]}: {ch}")
                    if len(unique_chapters) > 12:
                        _bullet(f"… y {len(unique_chapters) - 12} más")

            if (
                chapter_map is None
                and requested_chapter_method in {"AUTO", "PRINTED_INDEX"}
            ):
                if requested_chapter_method == "AUTO":
                    _warn("Sin TOC. Intentando detección desde índice impreso…")
                else:
                    _step("Detectando capítulos desde índice impreso…")

                (
                    chapter_map,
                    index_chapters_summary,
                    printed_index_offset,
                ) = get_chapter_map_from_index_pages(
                    file_path,
                    raw_pages=raw_pages,
                )

                if chapter_map:
                    chapter_method = "printed_index"
                    _ok(
                        f"{len(index_chapters_summary)} capítulos "
                        "detectados vía índice impreso"
                    )
                    _bullet(
                        "Offset inferido automáticamente: "
                        f"{printed_index_offset:+d}"
                    )
                    for ch in index_chapters_summary:
                        _bullet(
                            f"pp. {ch['start_page']}-{ch['end_page']}: "
                            f"{ch['name']}"
                        )
                    if len(index_chapters_summary) > 12:
                        _bullet(
                            f"… y {len(index_chapters_summary) - 12} más"
                        )

            if (
                chapter_map is None
                and requested_chapter_method in {"AUTO", "FONT_SIZE"}
            ):
                if requested_chapter_method == "AUTO":
                    _warn(
                        "Sin índice utilizable. Intentando detección tipográfica…"
                    )
                else:
                    _step("Detectando capítulos por tamaño de fuente…")

                chapter_map = get_chapter_map_from_fonts(
                    file_path,
                    top_percentile=0.01,
                )

                if chapter_map:
                    chapter_method = "font_size"
                    unique_chapters = sorted(
                        set(chapter_map.values()),
                        key=lambda x: min(
                            p for p, c in chapter_map.items() if c == x
                        ),
                    )
                    _ok(
                        f"{len(unique_chapters)} capítulos detectados "
                        "vía tamaño de fuente"
                    )
                    for ch in unique_chapters[:12]:
                        pages_range = sorted(
                            p for p, c in chapter_map.items() if c == ch
                        )
                        _bullet(
                            f"pp. {pages_range[0]}-{pages_range[-1]}: {ch}"
                        )
                    if len(unique_chapters) > 12:
                        _bullet(
                            f"… y {len(unique_chapters) - 12} más"
                        )

            if chapter_map is None:
                chapter_method = "fallback_filename"
                _warn(
                    "No se detectaron capítulos con el método configurado "
                    "→ fallback al título/archivo"
                )

    else:
        _step("Leyendo archivo TXT…")
        raw_pages = extract_text_from_txt(file_path)
        chapter_method = "fallback_filename"
        _ok(f"Texto cargado: {len(raw_pages[0]['texto']):,} caracteres")

    fallback_chapter = args.title or os.path.splitext(filename)[0].replace("_", " ").title()
    _ok(f"Método de capítulos: {chapter_method}")
    _ok(f"Capítulo fallback: '{fallback_chapter}'")

    # ─────────────────────────────────────────────────────────────────────
    # PASO 3B — Limpieza
    # ─────────────────────────────────────────────────────────────────────
    _section("PASO 3B — Limpieza del Texto")
    t_step = time.time()

    _step("Detectando encabezados repetidos automáticamente…")
    pages_text_list = [p["texto"] for p in raw_pages]

    if level0_config["cleaning"]["detectRepeatedHeaders"]:
        auto_headers = detect_repeated_headers(
            pages_text_list,
            threshold=level0_config["cleaning"]["repeatedHeaderThreshold"],
        )
    else:
        auto_headers = set()
        _ok("Detección automática de encabezados desactivada.")

    if auto_headers:
        _ok(f"{len(auto_headers)} encabezados auto-detectados")
        for h in sorted(auto_headers)[:8]:
            _bullet(f'"{h}"')
        if len(auto_headers) > 8:
            _bullet(f"… y {len(auto_headers) - 8} más")
    else:
        _ok("No se detectaron encabezados repetidos adicionales.")

    _step("Inyectando nombres de capítulos como encabezados…")
    chapter_name_headers = set(chapter_map.values()) if chapter_map else set()
    if chapter_name_headers:
        _ok(f"{len(chapter_name_headers)} nombres de capítulo inyectados")
        for cn in list(chapter_name_headers)[:6]:
            _bullet(f'"{cn}"')
        if len(chapter_name_headers) > 6:
            _bullet(f"… y {len(chapter_name_headers) - 6} más")
    else:
        _ok("Sin capítulos para inyectar.")

    configured_headers = set(
        level0_config["cleaning"]["additionalHeadersFooters"]
    )
    all_headers = (
        set(HEADERS_FOOTERS)
        | configured_headers
        | auto_headers
        | chapter_name_headers
    )

    _step("Excluyendo páginas completas (portadas, TOC, créditos)…")
    excludes = set()
    configured_ranges = level0_config.get("excludedPageRanges")

    if configured_ranges is not None:
        excludes = expand_page_ranges(configured_ranges)

        if excludes:
            _ok(f"{len(excludes)} páginas excluidas por configuración efectiva")
            for spec in configured_ranges:
                if isinstance(spec, (list, tuple)):
                    _bullet(f"Rango: pp. {spec[0]}–{spec[1]}")
                else:
                    _bullet(f"Página: {spec}")
        else:
            _ok("Exclusión manual de páginas desactivada para este documento.")

    elif filename in PAGES_TO_EXCLUDE:
        # Compatibilidad temporal con las exclusiones antiguas.
        excludes = expand_page_ranges(PAGES_TO_EXCLUDE[filename])
        _ok(f"{len(excludes)} páginas excluidas según configuración heredada")
        for spec in PAGES_TO_EXCLUDE[filename]:
            if isinstance(spec, (list, tuple)):
                _bullet(f"Rango: pp. {spec[0]}–{spec[1]}")
            else:
                _bullet(f"Página: {spec}")
    else:
        _ok("Sin exclusiones configuradas para este archivo.")

    _step("Limpiando texto página por página…")
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

        page_text_lower = page["texto"].lower()

        if (
            level0_config["cleaning"]["excludeFrontMatter"]
            and page_num <= 20
            and any(
                keyword in page_text_lower
                for keyword in FRONT_MATTER_KEYWORDS
            )
        ):
            excluded_count += 1
            continue

        if chapter_method == "printed_index" and chapter_map:
            if page_num not in chapter_map:
                excluded_count += 1
                continue
            chapter = clean_chapter_name(chapter_map.get(page_num)) or fallback_chapter
        else:
            chapter = chapter_map.get(page_num, fallback_chapter) if chapter_map else fallback_chapter
            chapter = clean_chapter_name(chapter) or fallback_chapter

        page_footnotes = page.get("footnotes", [])
        text_no_fn = page["texto"]

        # Fallback para TXT o páginas donde la extracción visual no encontró nada.
        if (
            level0_config["footnotes"]["extract"]
            and not page_footnotes
        ):
            text_no_fn, fallback_footnotes = remove_footnotes_from_bottom(
                page["texto"]
            )
            page_footnotes = fallback_footnotes

        for fn in page_footnotes:
            normalized_note = normalize_whitespace(fn)

            if not normalized_note:
                continue

            all_footnotes.append({
                "archivo": filename,
                "pagina": page_num,
                "capitulo": chapter,
                "nota_al_pie": normalized_note,
            })

        clean_text = clean_page_text(
            text_no_fn,
            all_headers,
            REGEX_PATTERNS_TO_REMOVE,
            level0_config["cleaning"]["minLineLength"],
            repair_hyphenation=level0_config["cleaning"]["repairHyphenation"],
        )

        if len(clean_text.strip()) > 50:
            cleaned_pages.append({
                "archivo": filename,
                "page": page_num,
                "chapter": chapter,
                "text": clean_text.strip(),
                "n_chars": len(clean_text.strip()),
            })
        else:
            empty_after_clean += 1

    cleaned_char_count = sum(len(p["text"]) for p in cleaned_pages)
    reduction_pct = (1 - cleaned_char_count / original_char_count) * 100 if original_char_count else 0

    _err("")
    _ok("Resultado de la limpieza:")
    _bullet(f"Páginas en bruto:          {n_raw:,}")
    _bullet(f"Páginas excluidas:         {excluded_count:,}")
    _bullet(f"Páginas vacías post-clean: {empty_after_clean:,}")
    _bullet(f"Páginas limpias restantes: {len(cleaned_pages):,}")
    _bullet(f"Caracteres antes:          {original_char_count:,}")
    _bullet(f"Caracteres después:        {cleaned_char_count:,}")
    _bullet(f"Reducción:                 {reduction_pct:.1f}%")
    _bullet(f"Notas al pie extraídas:    {len(all_footnotes):,}")
    pages_with_detected_footnotes = sum(
        1
        for page in raw_pages
        if page.get("footnotes")
    )

    layout_candidate_lines = sum(
        page.get("footnote_debug", {}).get("candidate_lines", 0)
        for page in raw_pages
    )

    _bullet(
        f"Páginas con notas:         "
        f"{pages_with_detected_footnotes:,}"
    )
    _bullet(
        f"Líneas candidatas:         "
        f"{layout_candidate_lines:,}"
    )
    _bullet(f"Tiempo:                    {time.time() - t_step:.1f}s")

    # ─────────────────────────────────────────────────────────────────────
    # PASO 3C — Inspección limpieza
    # ─────────────────────────────────────────────────────────────────────
    _section("PASO 3C — Inspección de la Limpieza")
    if args.inspect_pages > 0 and cleaned_pages:
        _step(f"Inspección de {min(args.inspect_pages, len(cleaned_pages))} páginas (muestra aleatoria)")
        inspect_cleaning(cleaned_pages, sample_count=args.inspect_pages)
        _ok("Si ves ruido, ajusta HEADERS_FOOTERS o REGEX_PATTERNS_TO_REMOVE.")
    else:
        _warn("Inspección omitida (--inspect-pages=0 o sin páginas limpias).")

    unique_caps_clean = {}
    for p in cleaned_pages:
        ch = p["chapter"]
        if ch not in unique_caps_clean:
            unique_caps_clean[ch] = []
        unique_caps_clean[ch].append(p["page"])

    _step(f"Capítulos presentes tras limpieza ({len(unique_caps_clean)} únicos):")
    for ch, pages in sorted(unique_caps_clean.items(), key=lambda x: x[1][0]):
        _bullet(f"pp. {pages[0]}-{pages[-1]} ({len(pages)} págs.) → {ch[:80]}")

    # ─────────────────────────────────────────────────────────────────────
    # PASO 3D — Inspección notas al pie
    # ─────────────────────────────────────────────────────────────────────
    _section("PASO 3D — Inspección de Notas al Pie")

    if all_footnotes:
        _ok(f"Notas al pie extraídas: {len(all_footnotes):,} total")
        _bullet(f"{filename}: {len(all_footnotes):,} notas")

        sample_fn = all_footnotes[: min(8, len(all_footnotes))]
        _step(f"Muestra de {len(sample_fn)} notas al pie:")
        for row in sample_fn:
            _bullet(f"[p.{row['pagina']}] {truncate_for_log(row['nota_al_pie'], 120)}")
        _warn("Verifica que sean notas reales y no texto del cuerpo.")
    else:
        _ok("No se extrajeron notas al pie.")

    # ─────────────────────────────────────────────────────────────────────
    # PASO 4 — Segmentación
    # ─────────────────────────────────────────────────────────────────────
    _section("PASO 4 — Segmentación en Oraciones (spaCy)")
    t_step = time.time()

    all_sentences = []
    sentence_counter = 0
    n_pages_clean = len(cleaned_pages)

    _step("Segmentando oraciones…")
    for i, page in enumerate(cleaned_pages):
        _progress_bar(i + 1, n_pages_clean, label="páginas segmentadas")
        sentences = segment_page_into_sentences(
            nlp,
            page["text"],
            min_len=level0_config["segmentation"]["minChars"],
            max_len=level0_config["segmentation"]["maxChars"],
        )

        for sent_text in sentences:
            sentence_counter += 1
            all_sentences.append({
                "ID_documento": f"DOC-{os.path.splitext(filename)[0]}",
                "archivo": filename,
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
    _ok("Segmentación completada:")
    _bullet(f"Oraciones totales:       {len(all_sentences):,}")
    _bullet(f"Palabras totales:        {n_words_total:,}")
    _bullet(f"Promedio palabras/orac.: {avg_words:.1f}")

    if all_sentences:
        word_counts = sorted(s["n_palabras"] for s in all_sentences)
        median_w = word_counts[len(word_counts) // 2]
        _bullet(f"Mediana:                 {median_w}")
        _bullet(f"Mín / Máx:               {word_counts[0]} / {word_counts[-1]} palabras")

    _bullet(f"Tiempo:                  {time.time() - t_step:.1f}s")

    if not all_sentences:
        _warn("No se generaron oraciones. Verifica limpieza y segmentación.")
        sys.exit(1)

    # ─────────────────────────────────────────────────────────────────────
    # PASO 5 — NLP
    # ─────────────────────────────────────────────────────────────────────
    _section("PASO 5 — Preprocesamiento Lingüístico")
    t_step = time.time()

    texts_list = [s["oracion_texto"] for s in all_sentences]
    n_total = len(texts_list)
    n_batches = (n_total + BATCH_SIZE_NLP - 1) // BATCH_SIZE_NLP

    _step(f"Procesando NLP para {n_total:,} oraciones en {n_batches} lotes…")

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

    for i, sent in enumerate(all_sentences):
        sent["tokens"] = all_tokens_list[i]
        sent["lemas"] = all_lemas_list[i]
        sent["pos_tags"] = all_pos_list[i]
        sent["entidades_NER"] = all_ner_list[i]

    total_tokens = sum(len(s["tokens"]) for s in all_sentences)
    total_ner = sum(len(s["entidades_NER"]) for s in all_sentences)

    ner_label_counts = {}
    lemma_counts = {}
    for s in all_sentences:
        for ent in s["entidades_NER"]:
            label = ent.get("label", "?")
            ner_label_counts[label] = ner_label_counts.get(label, 0) + 1

        for lemma in s["lemas"]:
            lemma_clean = normalize_whitespace(str(lemma)).lower()
            if len(lemma_clean) >= 3:
                lemma_counts[lemma_clean] = lemma_counts.get(lemma_clean, 0) + 1

    _ok("Preprocesamiento completado:")
    _bullet(f"Tokens procesados:      {total_tokens:,}")
    _bullet(f"Entidades NER totales:  {total_ner:,}")

    if lemma_counts:
        _bullet("Top lemas:")
        for lemma, count in sorted(lemma_counts.items(), key=lambda x: -x[1])[:10]:
            _err(f"      {lemma}: {count:,}", 2)

    if ner_label_counts:
        _bullet("Top etiquetas NER:")
        for label, count in sorted(ner_label_counts.items(), key=lambda x: -x[1])[:6]:
            _err(f"      {label}: {count:,}", 2)

    _bullet(f"Tiempo:                 {time.time() - t_step:.1f}s")

    del all_tokens_list, all_lemas_list, all_pos_list, all_ner_list
    gc.collect()

    # ─────────────────────────────────────────────────────────────────────
    # PASO 6 — Resumen N0
    # ─────────────────────────────────────────────────────────────────────
    _section("PASO 6 — Generación del Resumen N0")

    _step("Construyendo resumen por capítulos…")
    chapters_summary = []

    if chapter_method == "printed_index" and index_chapters_summary:
        for ch in index_chapters_summary:
            ch_sents = [s for s in all_sentences if s["capitulo"] == ch["name"]]
            chapter_pages = [p["page"] for p in cleaned_pages if p["chapter"] == ch["name"]]

            chapters_summary.append({
                "name": ch["name"],
                "start_page": ch["start_page"],
                "end_page": ch["end_page"],
                "n_pages": len(set(chapter_pages)),
                "n_sentences": len(ch_sents),
                "n_words": sum(s["n_palabras"] for s in ch_sents),
            })
    else:
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

    _ok("Resumen N0 construido:")
    _bullet(f"Filas (oraciones):  {len(all_sentences):,}")
    _bullet(f"Capítulos únicos:   {len(chapters_summary)}")
    _bullet(f"Páginas procesadas: {len(cleaned_pages):,}")

    _step("Vista previa — primeras 3 oraciones:")
    for s in all_sentences[:3]:
        _err("-" * 50, 1)
        _err(f"[{s['ID_oracion']}] p.{s['pagina']} | {s['capitulo'][:40]}", 1)
        _err(f"  {truncate_for_log(s['oracion_texto'], 120)}", 1)
        _err(f"  Tokens: {len(s['tokens'])} | Lemas: {len(s['lemas'])} | NER: {len(s['entidades_NER'])}", 1)

    # ─────────────────────────────────────────────────────────────────────
    # PASO 7 — Exportación
    # ─────────────────────────────────────────────────────────────────────
    _section("PASO 7 — Exportación de Resultados")
    t_step = time.time()

    title_final = args.title or os.path.splitext(filename)[0].replace("_", " ").title()

    output = {
        "title": title_final,
        "author": args.author,
        "language": args.language,
        "processed_at": datetime.datetime.now().isoformat(),
        "page_count": len(raw_pages),
        "pages_excluded": excluded_count,
        "pages_clean": len(cleaned_pages),
        "word_count": n_words_total,
        "token_count": total_tokens,
        "sentence_count": len(all_sentences),
        "footnote_count": len(all_footnotes),
        "original_chars": original_char_count,
        "chars_after": cleaned_char_count,
        "chapter_detection_method": chapter_method,
        "chapter_page_offset": printed_index_offset if chapter_method == "printed_index" else 0,
        "level0_config": level0_config,
        "pages": [
            {
                "archivo": p["archivo"],
                "page": p["page"],
                "chapter": p["chapter"],
                "text": p["text"],
                "n_caracteres": p["n_chars"],
            }
            for p in cleaned_pages
        ],
        "chapters": chapters_summary,
        "footnotes": all_footnotes,
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
    if chapter_method == "printed_index":
        _bullet(f"Offset índice:      {printed_index_offset:+d}")
    _err("")
    _ok("El JSON con las oraciones y metadatos fue enviado a stdout.")
    _ok("Siguiente paso: ejecutar N0_corpus_ingestion_viz.ipynb para visualización.")


if __name__ == "__main__":
    main()
