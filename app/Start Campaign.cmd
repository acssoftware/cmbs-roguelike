@echo off
rem Starts the local server and opens the page. Close this window to stop the app.
rem The usual way is CMBS Roguelike.exe, beside the app folder (no console window, an icon in the tray); this is the alternative.
setlocal
cd /d "%~dp0"
set NODE=node
if exist "%~dp0node\node.exe" set NODE="%~dp0node\node.exe"
rem The package carries its own Node (app\node). Without it, the one installed on this computer must be 20.11 or newer.
if not exist "%~dp0node\node.exe" (
  where node >nul 2>nul || goto :nonode
)
%NODE% -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=11)?0:1)" || goto :oldnode
start "" http://localhost:8765
%NODE% server.mjs
rem Quit on the page ends the server cleanly and the window closes; anything else stops to show why.
if errorlevel 1 (
  echo.
  echo The server stopped. Read the lines above for the reason.
  pause
)
goto :eof

:nonode
echo Node.js was not found. The app needs Node.js 20.11 or newer.
echo The download page opens now: install the LTS version, then start the app again.
echo (The release package carries its own Node in app\node; if you extracted it, extract the whole zip again.)
start "" https://nodejs.org/en/download
pause
goto :eof

:oldnode
for /f "delims=" %%v in ('%NODE% --version') do set NODEVER=%%v
echo This computer has Node.js %NODEVER%; the app needs 20.11 or newer.
echo The download page opens now: install the LTS version, then start the app again.
start "" https://nodejs.org/en/download
pause
