@echo off
chcp 65001 >nul
cd /d "D:\dafeiyu\dsh-pet-ref\dsh-pet"
set "DSH_HOME=D:\dafeiyu\dsh-home"
set "OLLAMA_MODEL=qwen2.5:3b"
rem --- start pet server if not running ---
curl -s -o NUL http://127.0.0.1:8231/dsh-pet-7340/config
if errorlevel 1 (
  echo [server] starting ollama-pet-server on 8231...
  start "dafeiyu-pet-server" /min cmd /c "node scripts\ollama-pet-server.mjs 8231"
  timeout /t 2 /nobreak >nul
) else (
  echo [server] already running
)
echo [pet] launching dafeiyu pet ... (close this window to quit the pet)
call npm run start:desktop -- http://127.0.0.1:8231/dsh-pet-7340/config
