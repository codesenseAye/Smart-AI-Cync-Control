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
    echo [0/5] Setting up winCodeSign cache...
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

echo [1/5] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo FAILED: npm install
    pause
    exit /b 1
)

echo.
echo [2/5] Compiling server TypeScript...
cd /d "%~dp0.."
call npm run build
if %ERRORLEVEL% neq 0 (
    echo FAILED: Server TypeScript build
    pause
    exit /b 1
)
cd /d "%~dp0"

echo.
echo [3/5] Compiling Electron TypeScript...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo FAILED: Electron TypeScript build
    pause
    exit /b 1
)

echo.
echo [4/5] Bundling server for distribution...
call npm run build:server
if %ERRORLEVEL% neq 0 (
    echo FAILED: Server bundle
    pause
    exit /b 1
)

echo.
echo [5/5] Packaging exe...
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
echo.
echo  User data will be stored in:
echo  %%LOCALAPPDATA%%\Smart AI Cync Control\
echo ========================================
pause
