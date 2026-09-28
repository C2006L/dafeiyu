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
rem ── 服务端口：.data\server.json 优先（右键菜单「端口设置」写入），否则默认 8231 ──
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$v=8231;try{$j=ConvertFrom-Json -InputObject (Get-Content -Raw -LiteralPath '%PET_DIR%\.data\server.json' -ErrorAction Stop);$n=[int]$j.port;if($n -gt 0 -and $n -lt 65536){$v=$n}}catch{};Write-Output $v"`) do set "PET_PORT=%%p"
echo %PET_PORT%|findstr /R "^[0-9][0-9]*$" >nul 2>nul || set "PET_PORT=8231"
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
set "PET_LOG_DIR=%PET_DIR%\.data\logs"
set "PET_LOG=%PET_LOG_DIR%\pet-server.log"
set "PET_ERR_LOG=%PET_LOG_DIR%\pet-server.err.log"
call :probe_health
if not errorlevel 1 (
  echo       OK - pet-server 已在运行（端口 %PET_PORT%），跳过启动
) else (
  echo       启动 pet-server（端口 %PET_PORT%）...
  if not exist "%PET_LOG_DIR%" mkdir "%PET_LOG_DIR%" >nul 2>nul
  rem 隐藏窗口常驻 + 输出重定向到日志：此前用 start /min cmd /c，服务一旦意外退出既无痕迹也无法
  rem 感知，用户只能看到"桌宠开着但所有功能没反应"。现在出问题可回看日志，启动器也会打印日志尾部。
  powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList @('scripts\ollama-pet-server.mjs','%PET_PORT%') -WorkingDirectory '%PET_DIR%' -WindowStyle Hidden -RedirectStandardOutput '%PET_LOG%' -RedirectStandardError '%PET_ERR_LOG%'"
  set "SERVER_READY="
  for /l %%i in (1,1,20) do (
    if not defined SERVER_READY (
      call :probe_health
      if not errorlevel 1 (
        set "SERVER_READY=1"
      ) else (
        timeout /t 1 /nobreak >nul
      )
    )
  )
  if not defined SERVER_READY (
    echo   [错误] pet-server 在 20 秒内未就绪（端口 %PET_PORT%）。
    echo          —— 错误日志 %PET_ERR_LOG% ——
    powershell -NoProfile -Command "Get-Content -LiteralPath '%PET_ERR_LOG%' -Tail 20 -ErrorAction SilentlyContinue"
    echo          —— 运行日志 %PET_LOG% ——
    powershell -NoProfile -Command "Get-Content -LiteralPath '%PET_LOG%' -Tail 20 -ErrorAction SilentlyContinue"
    echo          常见原因：端口 %PET_PORT% 被其它程序占用、Node.js 版本过低、或日志中的报错。
    goto :fail
  )
  echo       OK - pet-server 已就绪（日志：%PET_LOG%）
)

echo.
echo ------------------------------------------------------------
echo   正在启动桌宠窗口 ...
echo   关闭本窗口即结束桌宠本体（本地服务为后台常驻，不会随之停止；
echo   需要停止请在任务管理器中结束 node.exe）。
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

:probe_health
rem /health 返回 200 视为就绪（比裸 TCP 更可靠：端口通了不代表服务真的可用）
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PET_PORT%/dsh-pet-7340/health' -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){exit 0}}catch{};exit 1" >nul 2>nul
exit /b %errorlevel%

:fail
echo.
echo ============================================================
echo   启动中止，请按上述提示处理后重试。
echo ============================================================
pause
exit /b 1
