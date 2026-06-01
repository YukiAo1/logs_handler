import os
import logging
from logging.handlers import RotatingFileHandler
from config import APP_DIR

LOG_DIR = os.path.join(APP_DIR, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)


def _setup_logger(name: str, filename: str, fmt: str = None) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    if logger.handlers:
        return logger

    path = os.path.join(LOG_DIR, filename)
    handler = RotatingFileHandler(path, maxBytes=50 * 1024 * 1024, backupCount=3, encoding='utf-8')
    if not fmt:
        fmt = '%(asctime)s [%(levelname)s] %(message)s'
    formatter = logging.Formatter(fmt, datefmt='%Y-%m-%d %H:%M:%S')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    return logger


search_logger = _setup_logger('search', 'search.log',
                              '%(asctime)s [SEARCH] %(message)s')

query_logger = _setup_logger('query', 'query.log',
                              '%(asctime)s [QUERY] %(message)s')

error_logger = _setup_logger('error', 'error.log',
                              '%(asctime)s [ERROR] %(message)s')