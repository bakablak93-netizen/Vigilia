@echo off
setlocal EnableExtensions
chcp 65001 >nul
title VIGILIA 3.4 — Остановка сервисов

cd /d "%~dp0"

set "NO_PAUSE=0"
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"

echo ============================================================
echo   VIGILIA 3.4 — Остановка локальных серверов VIGILIA
echo ============================================================
echo.

set "PYTHON_EXE="
if exist "backend\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0backend\.venv\Scripts\python.exe"
) else (
    where python >nul 2>&1
    if %ERRORLEVEL%==0 (
        set "PYTHON_EXE=python"
    )
)

if "%PYTHON_EXE%"=="" (
    echo [ОШИБКА] Python не найден. Остановка через скрипт невозможна.
    if "%NO_PAUSE%"=="0" pause
    exit /b 1
)

"%PYTHON_EXE%" "%~dp0scripts\vigilia_service_manager.py" stop
set "RC=%ERRORLEVEL%"

echo.
if "%NO_PAUSE%"=="0" pause
exit /b %RC%
