import os
import sys
import subprocess
import re
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from functools import partial

from config import TOOLS_DIR
from engine.logger import query_logger

_RG_AVAILABLE = None
_RG_PATH = None
_RG_FAIL_REASON = ''


def _find_rg():
    global _RG_AVAILABLE, _RG_PATH, _RG_FAIL_REASON
    if _RG_AVAILABLE is not None:
        return _RG_AVAILABLE
    candidates = ['rg', 'rg.exe']
    rg_in_tools = os.path.join(TOOLS_DIR, 'rg.exe')
    if rg_in_tools not in candidates:
        candidates.insert(0, rg_in_tools)
    cwd_rg = os.path.normpath(os.path.join(os.getcwd(), 'bin', 'rg.exe'))
    if cwd_rg not in candidates:
        candidates.append(cwd_rg)
    for exe in candidates:
        try:
            r = subprocess.run([exe, '--version'], capture_output=True, timeout=3)
            if r.returncode == 0:
                _RG_AVAILABLE = True
                _RG_PATH = exe
                _RG_FAIL_REASON = ''
                return True
        except FileNotFoundError:
            continue
        except OSError as e:
            _RG_FAIL_REASON = f'找到 {exe} 但无法运行: {e}'
            continue
        except subprocess.TimeoutExpired:
            continue
    _RG_AVAILABLE = False
    return False


def is_available():
    return _find_rg()


def fail_reason() -> str:
    _find_rg()
    return _RG_FAIL_REASON


def search_lines(file_path: str, pattern: str) -> set[int]:
    line_nos = set()
    try:
        r = subprocess.run(
            [_RG_PATH, '--line-number', '--no-heading', '--regexp', pattern, file_path],
            capture_output=True, timeout=60, encoding='utf-8', errors='replace'
        )
        if r.returncode in (0, 1) and r.stdout:
            for line in r.stdout.splitlines():
                parts = line.split(':', 1)
                if parts and parts[0].isdigit():
                    line_nos.add(int(parts[0]) - 1)
    except (subprocess.TimeoutExpired, OSError):
        pass
    return line_nos


def search_lines_batch(file_paths: list[str], pattern: str) -> dict[str, set[int]]:
    result = {p: set() for p in file_paths}
    if not file_paths or not pattern:
        return result
    cmd = [_RG_PATH, '--line-number', '--no-heading', '--with-filename',
           '--regexp', pattern] + file_paths
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=120,
                           encoding='utf-8', errors='replace')
        if r.returncode in (0, 1) and r.stdout:
            for line in r.stdout.splitlines():
                idx = line.find(':', line.find(':') + 1)
                if idx == -1:
                    continue
                path = line[:idx]
                rest = line[idx + 1:]
                sep = rest.find(':')
                if sep == -1:
                    continue
                lineno_str = rest[:sep]
                if lineno_str.isdigit():
                    lineno = int(lineno_str) - 1
                    if path in result:
                        result[path].add(lineno)
    except (subprocess.TimeoutExpired, OSError):
        pass
    return result


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


_RG_SPAWN_MS = 500.0
_RG_PER_GB_MS = 1000.0
_PY_PER_GB_MS = 35000.0


def should_use_rg(total_lines: int) -> bool:
    if not is_available():
        return False
    if total_lines <= 0:
        return False
    mb = total_lines * 90 / 1024 / 1024
    py_est = _PY_PER_GB_MS * mb / 1024
    rg_est = _RG_SPAWN_MS + _RG_PER_GB_MS * mb / 1024
    return rg_est < py_est


def build_rg_pattern(
    rule_pattern: str | None,
    rule_patterns: list[tuple[int, str]] | None,
    levels: list[str] | None,
    keyword: str | None,
) -> str:
    parts = []

    if levels and len(levels) < 4:
        level_chars = ''.join(levels)
        parts.append(f'^\\d{{2}}-\\d{{2}}\\s+\\d{{2}}:\\d{{2}}:\\d{{2}}\\.\\d{{3}}\\s+\\d+\\s+\\d+\\s+[{level_chars}]\\s+')

    if rule_patterns:
        sub = [f'(?:{p})' for _, p in rule_patterns]
        parts.append('(?:' + '|'.join(sub) + ')')
    elif rule_pattern:
        parts.append(f'(?:{rule_pattern})')

    if keyword:
        parts.append(f'(?:{keyword})')

    if not parts:
        return ''

    return '|'.join(f'({p})' for p in parts) if len(parts) > 1 else parts[0]