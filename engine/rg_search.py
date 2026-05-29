import os
import subprocess
import re
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from functools import partial

from config import TOOLS_DIR

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


_RG_STARTUP_MS = 1500.0
_RG_PER_MB_MS = 30.0
_PY_SIMPLE_PER_MB_MS = 12.0
_PY_COMPLEX_PER_MB_MS = 55.0


def _is_complex_pattern(pattern: str) -> bool:
    stripped = pattern.strip()
    if '|' in stripped:
        return True
    if '\\' in stripped and any(c in stripped for c in 'dDwWsSbB'):
        return True
    if stripped.startswith('(') or stripped.endswith(')'):
        return True
    if '{' in stripped and '}' in stripped:
        return True
    return False


def estimate_mb(lines: int) -> float:
    return lines * 90 / 1024 / 1024


def smart_decision(
    pattern_strs: list[str],
    estimated_lines: int,
    multi_rule: bool = False,
) -> dict:
    if not is_available():
        return {'engine': 'python', 'reason': 'rg.exe 未安装'}

    if estimated_lines <= 0:
        return {'engine': 'python', 'reason': '无数据'}

    mb = estimate_mb(estimated_lines)

    any_complex = any(_is_complex_pattern(p) for p in pattern_strs) if pattern_strs else False
    num_rules = len(pattern_strs) if pattern_strs else 0

    if not pattern_strs:
        return {'engine': 'python', 'reason': '无正则,不走rg'}

    py_per_mb = _PY_COMPLEX_PER_MB_MS if any_complex or multi_rule else _PY_SIMPLE_PER_MB_MS
    py_cost = py_per_mb * mb
    rg_cost = _RG_STARTUP_MS + _RG_PER_MB_MS * mb

    if rg_cost < py_cost:
        return {
            'engine': 'rg',
            'reason': (f'rg: {rg_cost:.0f}ms < Python: {py_cost:.0f}ms '
                       f'({mb:.0f}MB, {"复杂" if any_complex else "简单"}正则, {num_rules}规则)'),
        }

    return {
        'engine': 'python',
        'reason': (f'Python: {py_cost:.0f}ms <= rg: {rg_cost:.0f}ms '
                   f'({mb:.0f}MB, {"复杂" if any_complex else "简单"}正则)'),
    }