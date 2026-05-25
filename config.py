import os
import sys


def _app_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _static_dir():
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, 'static')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')


APP_DIR = _app_dir()
STATIC_DIR = _static_dir()
DB_PATH = os.path.join(APP_DIR, 'logs_handler.db')
HOST = '127.0.0.1'
PORT = 18766
PAGE_SIZE = 500
MAX_UPLOAD_SIZE = 512 * 1024 * 1024
EXPORT_DIR = os.path.join(APP_DIR, 'exports')
MAX_EXPORT_LINES = 200000