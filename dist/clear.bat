@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "PORT=20306"

echo 正在检查端口 %PORT% 的占用情况...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% "') do (
    if not "%%a"=="" (
        set "PID=%%a"
        echo 发现占用进程 PID=!PID!，正在结束...
        taskkill /f /pid !PID! >nul 2>&1
        if !errorlevel! equ 0 (
            echo 进程 !PID! 已成功结束
        ) else (
            echo 结束进程 !PID! 失败，请尝试以管理员身份运行
        )
    )
)

echo 端口 %PORT% 已清理完毕
pause