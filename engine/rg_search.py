import os
import subprocess
import re
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from functools import partial

_RG_AVAILABLE = None
_RG_PATH = None


def _find_rg():
    global _RG_AVAILABLE, _RG_PATH
    if _RG_AVAILABLE is not None:
        return _RG_AVAILABLE
    candidates = ['rg', 'rg.exe']
    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates.insert(0, os.path.join(app_dir, 'rg.exe'))
    for exe in candidates:
        try:
            r = subprocess.run([exe, '--version'], capture_output=True, timeout=3)
            if r.returncode == 0:
                _RG_AVAILABLE = True
                _RG_PATH = exe
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue
    _RG_AVAILABLE = False
    return False


def is_available():
    return _find_rg()


def search_lines(file_path: str, pattern: str) -> set[int]:
    line_nos = set()
    try:
        r = subprocess.run(
            [_RG_PATH, '--line-number', '--no-heading', '--regexp', pattern, file_path],
            capture_output=True, timeout=60, text=True
        )
        if r.returncode in (0, 1):
            for line in r.stdout.splitlines():
                parts = line.split(':', 1)
                if parts and parts[0].isdigit():
                    line_nos.add(int(parts[0]) - 1)
    except (subprocess.TimeoutExpired, OSError):
        pass
    return line_nos


def search_lines_multi(file_path: str, patterns: list[str]) -> dict[str, set[int]]:
    result = {}
    for pat in patterns:
        result[pat] = search_lines(file_path, pat)
    return result


_worker_cache = {}

def _worker_parse(line: str) -> dict | None:
    from engine.parser import LOG_PATTERN, _parse_timestamp
    m = LOG_PATTERN.match(line)
    if not m:
        return None
    try:
        pid = int(m.group(3))
        tid = int(m.group(4))
    except ValueError:
        pid = 0
        tid = 0
    return {
        'date': m.group(1),
        'time': m.group(2),
        'timestamp': _parse_timestamp(m.group(1), m.group(2)),
        'pid': pid,
        'tid': tid,
        'level': m.group(5),
        'tag': m.group(6),
        'message': m.group(7),
    }


def _worker_match(line: str, pattern_str: str) -> bool:
    cache = _worker_cache
    if pattern_str not in cache:
        try:
            cache[pattern_str] = re.compile(pattern_str, re.IGNORECASE)
        except re.error:
            cache[pattern_str] = re.compile(re.escape(pattern_str), re.IGNORECASE)
    return bool(cache[pattern_str].search(line))


def parse_lines_parallel(lines: list[str], max_workers: int = None) -> list[dict | None]:
    if len(lines) < 500:
        return [_worker_parse(l) for l in lines]
    with ProcessPoolExecutor(max_workers=max_workers) as exe:
        return list(exe.map(_worker_parse, lines, chunksize=200))


def match_lines_parallel(lines: list[str], pattern: str, max_workers: int = None) -> list[bool]:
    if len(lines) < 500:
        return [_worker_match(l, pattern) for l in lines]
    fn = partial(_worker_match, pattern_str=pattern)
    with ProcessPoolExecutor(max_workers=max_workers) as exe:
        return list(exe.map(fn, lines, chunksize=200))