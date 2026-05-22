import sys
import os
import webbrowser
import threading
import time

import uvicorn

from config import HOST, PORT, APP_DIR, EXPORT_DIR
from app import create_app


def ensure_export_dir():
    os.makedirs(EXPORT_DIR, exist_ok=True)


def open_browser():
    time.sleep(1)
    webbrowser.open(f'http://{HOST}:{PORT}')


def main():
    ensure_export_dir()
    app = create_app()

    if not getattr(sys, 'frozen', False):
        threading.Thread(target=open_browser, daemon=True).start()

    print(f'鸿蒙日志分析工具已启动: http://{HOST}:{PORT}')
    print(f'按 Ctrl+C 退出')
    uvicorn.run(app, host=HOST, port=PORT, log_level='info')


if __name__ == '__main__':
    main()