@echo off
chcp 65001 >nul
title Hi Logs Builder

echo ========================================
echo  Hi Logs - Build Script
echo  先运行测试，测试通过后打包 exe
echo ========================================
echo.

:: 进入项目根目录
cd /d "%~dp0"

:: Step 1: 运行测试
echo [1/2] 运行引擎一致性测试...
echo.
python -m pytest tests\test_engine.py -v --tb=short
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [失败] 测试未通过！请修复后重试。
    echo 可通过以下命令查看详细失败信息：
    echo   python -m unittest tests.test_engine -v
    pause
    exit /b 1
)
echo.
echo [通过] 所有测试通过！
echo.

:: Step 2: 清理旧构建
echo [2/2] 打包 exe...
if exist build rmdir /s /q build
if exist dist\logs_handler.exe del /f /q dist\logs_handler.exe

:: Step 3: 构建
python -m PyInstaller build.spec --noconfirm
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [失败] 打包失败，请检查错误信息。
    pause
    exit /b 1
)

echo.
echo ========================================
echo  ✓ 测试全部通过
echo  ✓ 打包完成
echo  输出: dist\logs_handler.exe
echo ========================================
pause