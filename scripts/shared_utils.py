# -*- coding: utf-8 -*-
"""
shared_utils.py — Utilidades compartidas para el pipeline N0 modular

Contiene:
  - Funciones de logging (stderr)
  - Configuración por defecto (headers, patrones regex, etc.)
  - Funciones de utilidad genéricas
"""

import sys
import re


# ─────────────────────────────────────────────────────────────────────────────
# Configuración por defecto (espeja el notebook)
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
# Utilidades de procesamiento
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
