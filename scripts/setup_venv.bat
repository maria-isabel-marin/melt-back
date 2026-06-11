@echo off
echo ==========================================
echo Configurando entorno virtual para MELT
echo ==========================================

cd %~dp0\..

if not exist venv (
    echo Creando entorno virtual...
    python -m venv venv
) else (
    echo Entorno virtual ya existe.
)

echo Activando entorno virtual e instalando dependencias...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install PyMuPDF spacy pandas numpy tqdm

echo Descargando modelo lingüístico de spaCy en español (es_core_news_lg)...
python -m spacy download es_core_news_lg

echo ==========================================
echo Entorno virtual configurado correctamente.
echo ==========================================
