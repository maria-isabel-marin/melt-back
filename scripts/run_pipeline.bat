@echo off
REM -*- coding: utf-8 -*-
REM
REM run_pipeline.bat — Orquestador del pipeline N0 modular (Windows)
REM
REM Uso:
REM   run_pipeline.bat C:\ruta\a\documento.pdf [--title "Título"] [--author "Autor"]
REM
REM Ejecuta todos los 7 pasos en secuencia y genera salida final en output\
REM

setlocal enabledelayedexpansion

REM ─────────────────────────────────────────────────────────────────────────────
REM Configuración
REM ─────────────────────────────────────────────────────────────────────────────

set "SCRIPT_DIR=%~dp0"
set "OUTPUT_DIR=%SCRIPT_DIR%output"
set "TIMESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TIMESTAMP=%TIMESTAMP: =0%"

REM Argumentos
set "PDF_FILE=%~1"
set "TITLE="
set "AUTHOR=Comisión de la Verdad"
set "LANGUAGE=es"

REM Parsear argumentos adicionales
shift
:parse_args
if "%~1"=="" goto args_done
if "%~1"=="--title" (
    set "TITLE=%~2"
    shift
    shift
    goto parse_args
)
if "%~1"=="--author" (
    set "AUTHOR=%~2"
    shift
    shift
    goto parse_args
)
if "%~1"=="--language" (
    set "LANGUAGE=%~2"
    shift
    shift
    goto parse_args
)
shift
goto parse_args

:args_done

REM ─────────────────────────────────────────────────────────────────────────────
REM Validaciones
REM ─────────────────────────────────────────────────────────────────────────────

if "%PDF_FILE%"=="" (
    echo.
    echo ❌ Uso: run_pipeline.bat "C:\ruta\a\documento.pdf" [--title "Título"] [--author "Autor"]
    echo.
    exit /b 1
)

if not exist "%PDF_FILE%" (
    echo.
    echo ❌ Error: Archivo no encontrado: %PDF_FILE%
    echo.
    exit /b 1
)

REM ─────────────────────────────────────────────────────────────────────────────
REM Crear directorio de salida
REM ─────────────────────────────────────────────────────────────────────────────

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
cd /d "%SCRIPT_DIR%"

REM ─────────────────────────────────────────────────────────────────────────────
REM Logging helper (macros)
REM ─────────────────────────────────────────────────────────────────────────────

REM Macro para sección
set "log_section=echo. & echo ════════════════════════════════════════════════════════════════ & echo   $1 & echo ════════════════════════════════════════════════════════════════ & echo."

REM Macro para paso
set "log_step=echo ▶ $1"

REM Macro para OK
set "log_ok=echo ✓ $1"

REM Macro para error
set "log_error=echo ❌ $1"

REM ─────────────────────────────────────────────────────────────────────────────
REM Inicio del pipeline
REM ─────────────────────────────────────────────────────────────────────────────

echo.
echo ════════════════════════════════════════════════════════════════
echo   PIPELINE N0 — INICIO
echo ════════════════════════════════════════════════════════════════
echo.
echo   PDF Entrada: %PDF_FILE%
echo   Título: %TITLE%
echo   Autor: %AUTHOR%
echo   Salida: %OUTPUT_DIR%
echo   Timestamp: %TIMESTAMP%
echo.

REM ─────────────────────────────────────────────────────────────────────────────
REM PASO 1: Extracción
REM ─────────────────────────────────────────────────────────────────────────────

echo.
echo ════════════════════════════════════════════════════════════════
echo   PASO 1 — Extracción de Texto y Detección de Capítulos
echo ════════════════════════════════════════════════════════════════
echo.
echo ▶ Extrayendo texto del PDF...
echo.

python "%SCRIPT_DIR%step1_extract.py" ^
    --pdf "%PDF_FILE%" ^
    > "%OUTPUT_DIR%\step1_extract.json" 2>>"%OUTPUT_DIR%\pipeline.log"

if errorlevel 1 (
    echo ❌ Paso 1 falló
    exit /b 1
)

for /f %%i in ('python -c "import json; d=json.load(open(r'%OUTPUT_DIR%\step1_extract.json')); print(len(d['pages']))"') do set "PAGES=%%i"
echo ✓ Paso 1 completado: %PAGES% páginas extraídas

REM ─────────────────────────────────────────────────────────────────────────────
REM PASO 2: Limpieza
REM ─────────────────────────────────────────────────────────────────────────────

echo.
echo ════════════════════════════════════════════════════════════════
echo   PASO 2 — Limpieza de Texto
echo ════════════════════════════════════════════════════════════════
echo.
echo ▶ Limpiando encabezados, pies, patrones...
echo.

python "%SCRIPT_DIR%step2_clean.py" ^
    --step1-json "%OUTPUT_DIR%\step1_extract.json" ^
    > "%OUTPUT_DIR%\step2_clean.json" 2>>"%OUTPUT_DIR%\pipeline.log"

if errorlevel 1 (
    echo ❌ Paso 2 falló
    exit /b 1
)

for /f %%i in ('python -c "import json; d=json.load(open(r'%OUTPUT_DIR%\step2_clean.json')); print(d.get('pages_clean', '?'))"') do set "PAGES_CLEAN=%%i"
echo ✓ Paso 2 completado: %PAGES_CLEAN% páginas limpias

REM ─────────────────────────────────────────────────────────────────────────────
REM PASO 4: Segmentación
REM ─────────────────────────────────────────────────────────────────────────────

echo.
echo ════════════════════════════════════════════════════════════════
echo   PASO 4 — Segmentación en Oraciones
echo ════════════════════════════════════════════════════════════════
echo.
echo ▶ Segmentando con spaCy...
echo.

python "%SCRIPT_DIR%step4_segment.py" ^
    --step2-json "%OUTPUT_DIR%\step2_clean.json" ^
    > "%OUTPUT_DIR%\step4_segment.json" 2>>"%OUTPUT_DIR%\pipeline.log"

if errorlevel 1 (
    echo ❌ Paso 4 falló
    exit /b 1
)

for /f %%i in ('python -c "import json; d=json.load(open(r'%OUTPUT_DIR%\step4_segment.json')); print(len(d['sentences']))"') do set "SENTENCES=%%i"
echo ✓ Paso 4 completado: %SENTENCES% oraciones segmentadas

REM ─────────────────────────────────────────────────────────────────────────────
REM PASO 5: NLP
REM ─────────────────────────────────────────────────────────────────────────────

echo.
echo ════════════════════════════════════════════════════════════════
echo   PASO 5 — Preprocesamiento Lingüístico
echo ════════════════════════════════════════════════════════════════
echo.
echo ▶ Aplicando tokenización, POS, NER, lematización...
echo.

python "%SCRIPT_DIR%step5_nlp.py" ^
    --step4-json "%OUTPUT_DIR%\step4_segment.json" ^
    > "%OUTPUT_DIR%\step5_nlp.json" 2>>"%OUTPUT_DIR%\pipeline.log"

if errorlevel 1 (
    echo ❌ Paso 5 falló
    exit /b 1
)

echo ✓ Paso 5 completado: análisis NLP aplicado

REM ─────────────────────────────────────────────────────────────────────────────
REM PASO 6: Generación del DataFrame N0
REM ─────────────────────────────────────────────────────────────────────────────

echo.
echo ════════════════════════════════════════════════════════════════
echo   PASO 6 — Generación del DataFrame N0
echo ════════════════════════════════════════════════════════════════
echo.
echo ▶ Normalizando y computando estadísticas...
echo.

set "TITLE_ARG="
if not "%TITLE%"=="" set "TITLE_ARG=--title %TITLE%"

python "%SCRIPT_DIR%step6_generate.py" ^
    --step5-json "%OUTPUT_DIR%\step5_nlp.json" ^
    %TITLE_ARG% ^
    --author "%AUTHOR%" ^
    > "%OUTPUT_DIR%\step6_generate.json" 2>>"%OUTPUT_DIR%\pipeline.log"

if errorlevel 1 (
    echo ❌ Paso 6 falló
    exit /b 1
)

for /f %%i in ('python -c "import json; d=json.load(open(r'%OUTPUT_DIR%\step6_generate.json')); print(len(d['chapters']))"') do set "CHAPTERS=%%i"
echo ✓ Paso 6 completado: %CHAPTERS% capítulos detectados

REM ─────────────────────────────────────────────────────────────────────────────
REM PASO 7: Exportación
REM ─────────────────────────────────────────────────────────────────────────────

echo.
echo ════════════════════════════════════════════════════════════════
echo   PASO 7 — Exportación de Resultados
echo ════════════════════════════════════════════════════════════════
echo.
echo ▶ Enriqueciendo metadatos y generando salida final...
echo.

set "FINAL_OUTPUT=%OUTPUT_DIR%\N0_%TIMESTAMP%.json"

python "%SCRIPT_DIR%step7_export.py" ^
    --step6-json "%OUTPUT_DIR%\step6_generate.json" ^
    %TITLE_ARG% ^
    --author "%AUTHOR%" ^
    --language "%LANGUAGE%" ^
    --output-file "%FINAL_OUTPUT%" 2>>"%OUTPUT_DIR%\pipeline.log"

if errorlevel 1 (
    echo ❌ Paso 7 falló
    exit /b 1
)

echo ✓ Paso 7 completado: JSON final generado

REM ─────────────────────────────────────────────────────────────────────────────
REM Resumen final
REM ─────────────────────────────────────────────────────────────────────────────

echo.
echo ════════════════════════════════════════════════════════════════
echo   RESUMEN FINAL
echo ════════════════════════════════════════════════════════════════
echo.
echo   ✓ Pipeline completado exitosamente
echo.

for /f %%i in ('python -c "import json; d=json.load(open(r'%FINAL_OUTPUT%')); print(d['statistics']['total_words'])"') do set "TOTAL_WORDS=%%i"
for /f %%i in ('python -c "import json; d=json.load(open(r'%FINAL_OUTPUT%')); print(d['statistics']['total_tokens'])"') do set "TOTAL_TOKENS=%%i"
for /f %%i in ('python -c "import json; d=json.load(open(r'%FINAL_OUTPUT%')); print(d['statistics']['total_ner_entities'])"') do set "TOTAL_ENTITIES=%%i"

echo   Resultados:
echo     · Archivos JSON intermedios: %OUTPUT_DIR%\step*.json
echo     · Salida final: %FINAL_OUTPUT%
echo.
echo   Estadísticas finales:
echo     · Páginas procesadas: %PAGES_CLEAN% / %PAGES%
echo     · Oraciones: %SENTENCES%
echo     · Capítulos: %CHAPTERS%
echo     · Palabras: %TOTAL_WORDS%
echo     · Tokens: %TOTAL_TOKENS%
echo     · Entidades NER: %TOTAL_ENTITIES%
echo.
echo ════════════════════════════════════════════════════════════════
echo.

echo ✓ ¡Done!
echo.

endlocal
