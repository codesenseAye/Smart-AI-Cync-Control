@echo off
setlocal

echo ========================================
echo  Smart AI Cync Control - Release Build
echo ========================================
echo.

cd /d "%~dp0"

:: Skip code signing (personal/unsigned build)
set CSC_IDENTITY_AUTO_DISCOVERY=false

:: Pre-populate winCodeSign cache (avoids symlink extraction failure)
set CACHE_DIR=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0
set SEVEN_ZIP=%~dp0node_modules\7zip-bin\win\x64\7za.exe
if not exist "%CACHE_DIR%\rcedit-x64.exe" (
    echo [0/3] Setting up winCodeSign cache...
    if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" (
        rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
    )
    mkdir "%CACHE_DIR%" 2>nul
    curl -L -s -o "%CACHE_DIR%\winCodeSign.7z" "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
    "%SEVEN_ZIP%" x -y -bd "%CACHE_DIR%\winCodeSign.7z" -o"%CACHE_DIR%" >nul 2>&1
    del "%CACHE_DIR%\winCodeSign.7z" 2>nul
    if exist "%CACHE_DIR%\rcedit-x64.exe" (
        echo       Cache ready.
    ) else (
        echo       WARNING: winCodeSign extraction may have failed.
    )
)

echo [1/3] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo FAILED: npm install
    pause
    exit /b 1
)

echo.
echo [2/3] Compiling TypeScript...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo FAILED: TypeScript build
    pause
    exit /b 1
)

echo.
echo [3/3] Packaging exe...
call npx electron-builder --win --publish never
if %ERRORLEVEL% neq 0 (
    echo FAILED: electron-builder
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Build complete!
echo  Output: app\release\Smart AI Cync Control.exe
echo ========================================
pause
