@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title 大肥鱼桌宠 · 启动器

rem ============================================================
rem  大肥鱼桌宠（第二版：dsh-pet 桌面版）启动器
rem  仅启动 TypeScript + Electron 实现
rem ============================================================

rem ── 定位仓库根目录（本脚本所在目录，支持从任意位置调用）──
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PET_DIR=%ROOT%\dsh-pet-ref\dsh-pet"
set "DSH_HOME=%ROOT%\dsh-home"
set "PET_PORT=8231"
set "PET_BASE=http://127.0.0.1:%PET_PORT%/dsh-pet-7340"
set "OLLAMA_URL=http://localhost:11434"
set "OLLAMA_MODEL=qwen2.5:3b"

echo.
echo ============================================================
echo   大肥鱼桌宠 · 第二版（dsh-pet 桌面版）
echo ============================================================
echo   仓库根目录 : %ROOT%
echo   源码目录   : %PET_DIR%
echo   服务端口   : %PET_PORT%
echo ------------------------------------------------------------

rem ── [1/6] 项目结构 ──
echo [1/6] 检查项目结构 ...
if not exist "%PET_DIR%\package.json" (
  echo   [错误] 未找到第二版源码：%PET_DIR%\package.json
  echo          请确认 dsh-pet-ref\dsh-pet 目录完整。
  goto :fail
)
echo       OK

rem ── [2/6] Node.js / npm ──
echo [2/6] 检查 Node.js 环境 ...
where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 未检测到 node 命令。
  echo          请安装 Node.js 18 或更高版本，并勾选加入 PATH：https://nodejs.org/
  goto :fail
)
where npm >nul 2>nul
if errorlevel 1 (
  echo   [错误] 未检测到 npm 命令，Node.js 安装可能不完整。
  goto :fail
)
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
for /f "delims=" %%v in ('npm -v 2^>nul') do set "NPM_VER=%%v"
echo       OK - node %NODE_VER% / npm v%NPM_VER%

rem ── [3/6] 项目依赖与构建产物 ──
echo [3/6] 检查项目依赖 ...
if not exist "%PET_DIR%\node_modules" (
  echo       未找到 node_modules，开始安装依赖（首次运行耗时较长）...
  pushd "%PET_DIR%"
  call npm install
  set "RC_INSTALL=!errorlevel!"
  popd
  if not "!RC_INSTALL!"=="0" (
    echo   [错误] npm install 失败（退出码 !RC_INSTALL!）。
    echo          请检查网络连通性或 npm 源配置后重试。
    goto :fail
  )
)
if not exist "%PET_DIR%\lib\index.js" (
  echo       未找到构建产物 lib\，开始构建 ...
  pushd "%PET_DIR%"
  call npm run prepare
  set "RC_BUILD=!errorlevel!"
  popd
  if not "!RC_BUILD!"=="0" (
    echo   [错误] 构建失败（退出码 !RC_BUILD!）。
    goto :fail
  )
)
echo       OK

rem ── [4/6] Electron 运行时 ──
echo [4/6] 检查 Electron 运行时 ...
if not exist "%DSH_HOME%\electron\electron.exe" (
  echo       未找到 Electron，开始自动下载（约 100MB，请耐心等待）...
  pushd "%PET_DIR%"
  call npm run ensure:electron
  set "RC_ELECTRON=!errorlevel!"
  popd
  if not "!RC_ELECTRON!"=="0" (
    echo   [错误] Electron 下载失败（退出码 !RC_ELECTRON!）。
    echo          可手动重试：cd /d "%PET_DIR%" ^&^& npm run ensure:electron
    goto :fail
  )
)
echo       OK - %DSH_HOME%\electron\electron.exe

rem ── [5/6] Ollama 服务（可选，仅影响 AI 对话与碎碎念）──
echo [5/6] 检查 Ollama 服务 ...
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',11434);$c.Close();exit 0}catch{exit 1}" >nul 2>nul
if errorlevel 1 (
  echo       [警告] 未检测到 Ollama（%OLLAMA_URL%）。
  echo              桌宠仍会启动，但 AI 对话与碎碎念不可用。
  echo              需要时请启动 Ollama 并执行：ollama pull %OLLAMA_MODEL%
) else (
  echo       OK - %OLLAMA_URL%
)

rem ── [6/6] 启动本地服务与桌宠 ──
echo [6/6] 启动本地服务与桌宠 ...
netstat -an | findstr /R /C:":%PET_PORT% .*LISTENING" >nul
if errorlevel 1 (
  echo       启动 pet-server（端口 %PET_PORT%）...
  pushd "%PET_DIR%"
  start "dafeiyu-pet-server" /min cmd /c "node scripts\ollama-pet-server.mjs %PET_PORT%"
  set "SERVER_READY="
  for /l %%i in (1,1,15) do (
    if not defined SERVER_READY (
      powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PET_PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>nul
      if not errorlevel 1 (
        set "SERVER_READY=1"
      ) else (
        timeout /t 1 /nobreak >nul
      )
    )
  )
  popd
  if not defined SERVER_READY (
    echo   [错误] pet-server 在 15 秒内未就绪（端口 %PET_PORT%）。
    echo          请查看任务栏中「dafeiyu-pet-server」窗口的报错信息。
    goto :fail
  )
  echo       OK - pet-server 已就绪
) else (
  echo       OK - pet-server 已在运行，跳过启动
)

echo.
echo ------------------------------------------------------------
echo   正在启动桌宠窗口 ...
echo   关闭本窗口即结束桌宠进程。
echo ------------------------------------------------------------
echo.
pushd "%PET_DIR%"
call npm run start:desktop -- %PET_BASE%/config
set "RC_PET=!errorlevel!"
popd
if not "!RC_PET!"=="0" (
  echo.
  echo   [错误] 桌宠启动失败（退出码 !RC_PET!）。常见原因：
  echo          - Electron 运行时缺失或不完整
  echo          - 端口 %PET_PORT% 被其他程序占用
  echo          - 配置地址不可达：%PET_BASE%/config
  goto :fail
)
echo.
echo  桌宠已退出。
pause
exit /b 0

:fail
echo.
echo ============================================================
echo   启动中止，请按上述提示处理后重试。
echo ============================================================
pause
exit /b 1
