@echo off
setlocal EnableExtensions
chcp 65001 >nul
title VIGILIA 3.4 — Запуск локальной лаборатории

cd /d "%~dp0"

set "NO_PAUSE=0"
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"

echo ============================================================
echo   VIGILIA 3.4 — Лаборатория безопасности банковских систем
echo   Независимый локальный запуск (Backend + External B + UI)
echo ============================================================
echo.

if not exist "logs" mkdir "logs"

:: 1. Проверка Python-окружения
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
    echo [ОШИБКА] Не найден Python 3.11+ или окружение backend\.venv.
    echo          Создайте виртуальное окружение и установите зависимости:
    echo            python -m venv backend\.venv
    echo            backend\.venv\Scripts\pip install -r backend\requirements.txt
    if "%NO_PAUSE%"=="0" pause
    exit /b 1
)

:: 2. Проверка Node.js / npm.cmd
where npm.cmd >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ОШИБКА] Не найден Node.js / npm.cmd в переменной PATH.
    echo          Установите Node.js 18+: https://nodejs.org/
    if "%NO_PAUSE%"=="0" pause
    exit /b 1
)

if not exist "frontend\node_modules" (
    echo [INFO] Установка зависимостей frontend ^(npm install^)...
    pushd "frontend"
    call npm.cmd install
    if %ERRORLEVEL% neq 0 (
        popd
        echo [ОШИБКА] Ошибка установки зависимостей frontend. Проверьте npm и сеть.
        if "%NO_PAUSE%"=="0" pause
        exit /b 1
    )
    popd
)

:: 3. Запуск и проверка портов/health через независимый процесс-менеджер
"%PYTHON_EXE%" "%~dp0scripts\vigilia_service_manager.py" start
set "RC=%ERRORLEVEL%"

echo.
if %RC%==0 (
    echo ============================================================
    echo   Все компоненты VIGILIA 3.4 запущены независимо:
    echo   Frontend UI          : http://localhost:5173
    echo   Backend API          : http://127.0.0.1:8001
    echo   OpenAPI Docs         : http://127.0.0.1:8001/docs
    echo   External Antifraud B : http://127.0.0.1:8010
    echo   Логи сервисов        : %~dp0logs\
    echo   Для остановки        : запустите STOP_WINDOWS.bat
    echo ============================================================
) else (
    echo ============================================================
    echo   [ОШИБКА] Не удалось полностью запустить VIGILIA 3.4.
    echo   Проверьте сообщения выше и логи в папке: %~dp0logs\
    echo ============================================================
)
echo.

if "%NO_PAUSE%"=="0" pause
exit /b %RC%
