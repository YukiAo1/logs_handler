import sys
import os
import webbrowser
import threading
import time
import subprocess
import socket

import uvicorn

from config import HOST, PORT, EXPORT_DIR
from app import create_app


def ensure_export_dir():
    os.makedirs(EXPORT_DIR, exist_ok=True)


def is_frozen():
    return getattr(sys, 'frozen', False)


def open_browser():
    time.sleep(1.5)
    url = f'http://{HOST}:{PORT}'
    try:
        webbrowser.open(url)
    except Exception:
        pass


def find_pid_by_port(port):
    """查找占用指定端口的进程PID"""
    try:
        result = subprocess.run(
            ['netstat', '-ano'],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            if f':{port} ' in line and 'LISTENING' in line:
                parts = line.strip().split()
                if parts:
                    pid = parts[-1]
                    if pid.isdigit():
                        return int(pid)
    except Exception:
        pass
    return None


def kill_process(pid):
    """结束指定PID的进程"""
    try:
        subprocess.run(['taskkill', '/f', '/pid', str(pid)],
                       capture_output=True, timeout=5)
        return True
    except Exception:
        return False


def wait_port_free(port, timeout=3):
    """等待端口释放，最多等待 timeout 秒"""
    for _ in range(timeout * 2):
        time.sleep(0.5)
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                pass
        except (ConnectionRefusedError, OSError):
            return True
    return False


def main():
    ensure_export_dir()
    app = create_app()

    try:
        threading.Thread(target=open_browser, daemon=True).start()

        print(f'鸿蒙日志分析工具已启动: http://{HOST}:{PORT}')
        print('按 Ctrl+C 退出')
        uvicorn.run(app, host=HOST, port=PORT, log_level='warning')
    except OSError as e:
        if e.winerror == 10048 or '10048' in str(e):
            print(f'\n端口 {PORT} 已被占用，无法启动。')
            pid = find_pid_by_port(PORT)
            if pid:
                print(f'占用端口进程 PID: {pid}')
            choice = input('是否清理占用进程并重新启动？(y/N): ').strip().lower()
            if choice in ('y', 'yes'):
                if pid:
                    print(f'正在结束进程 {pid}...')
                    if kill_process(pid):
                        print('进程已结束')
                        if wait_port_free(PORT):
                            print('端口已释放，重新启动...\n')
                            threading.Thread(target=open_browser, daemon=True).start()
                            print(f'鸿蒙日志分析工具已启动: http://{HOST}:{PORT}')
                            print('按 Ctrl+C 退出')
                            uvicorn.run(app, host=HOST, port=PORT, log_level='warning')
                        else:
                            print('端口释放超时，请稍后重试')
                    else:
                        print('结束进程失败，请尝试以管理员身份运行')
                else:
                    print('未找到占用端口的进程，请手动检查')
            else:
                print('已取消启动')
        else:
            print(f'启动失败: {e}')
        input('\n按 Enter 键退出...')


if __name__ == '__main__':
    if is_frozen():
        import multiprocessing
        multiprocessing.freeze_support()
    main()