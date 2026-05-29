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


def check_and_free_port(host, port):
    """检查端口是否可用，被占用则自动杀掉占用进程"""
    try:
        with socket.create_connection((host, port), timeout=1):
            pass
    except (ConnectionRefusedError, OSError):
        return True

    print(f'端口 {port} 已被占用，正在自动清理...')
    pid = find_pid_by_port(port)
    if pid:
        print(f'占用进程 PID: {pid}，正在结束...')
        if kill_process(pid):
            print('进程已结束')
            if wait_port_free(port):
                print('端口已释放')
                return True
            else:
                print('端口释放超时')
                return False
        else:
            print('结束进程失败，请尝试以管理员身份运行')
            return False
    else:
        print('未找到占用端口的进程')
        return False


def main():
    ensure_export_dir()

    if not check_and_free_port(HOST, PORT):
        print('端口无法释放，程序退出')
        input('\n按 Enter 键退出...')
        return

    app = create_app()

    threading.Thread(target=open_browser, daemon=True).start()

    from engine.rg_search import is_available as rg_avail, fail_reason as rg_reason
    if rg_avail():
        print('  bin/rg.exe 已就绪 (智能模式: 大文件+复杂正则自动启用)')
    else:
        reason = rg_reason()
        if reason:
            print(f'  bin/rg.exe 不可用: {reason}')
        else:
            print('  bin/rg.exe 未安装 (如需rg加速，下载后放入 bin/ 目录)')

    print(f'Hi Logs 已启动: http://{HOST}:{PORT}')
    print('按 Ctrl+C 退出')
    uvicorn.run(app, host=HOST, port=PORT, log_level='warning')


if __name__ == '__main__':
    if is_frozen():
        import multiprocessing
        multiprocessing.freeze_support()
    main()