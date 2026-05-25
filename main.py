import sys
import os
import webbrowser
import threading
import time
import socket

import uvicorn

from config import HOST, PORT, APP_DIR, EXPORT_DIR
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


def main():
    ensure_export_dir()
    app = create_app()

    if is_frozen():
        import multiprocessing
        multiprocessing.freeze_support()

    threading.Thread(target=open_browser, daemon=True).start()

    print(f'鸿蒙日志分析工具已启动: http://{HOST}:{PORT}')
    print('按 Ctrl+C 退出')
    uvicorn.run(app, host=HOST, port=PORT, log_level='warning')


if __name__ == '__main__':
    if is_frozen():
        import multiprocessing
        multiprocessing.freeze_support()
    main()