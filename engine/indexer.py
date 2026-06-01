import mmap
import os
import re
import time
from array import array
from dataclasses import dataclass, field
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from engine.parser import parse_line
from engine.logger import query_logger


@dataclass
class FileIndex:
    path: str
    file_size: int
    total_lines: int
    offsets: 'array'
    time_start: str = ''
    time_end: str = ''
    _mmap: Optional[mmap.mmap] = None
    _file_handle: Optional[object] = None

    def close(self):
        if self._mmap:
            self._mmap.close()
            self._mmap = None
        if self._file_handle:
            self._file_handle.close()
            self._file_handle = None


def index_file(path: str) -> FileIndex:
    t0 = time.perf_counter()
    file_size = os.path.getsize(path)
    mb = file_size / 1024 / 1024
    fh = open(path, 'rb')
    try:
        mm = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
    except Exception:
        fh.close()
        raise

    offsets = array('Q')
    pos = 0
    while pos < file_size:
        idx = mm.find(b'\n', pos)
        if idx == -1:
            break
        offsets.append(idx + 1)
        pos = idx + 1

    if offsets and offsets[-1] == file_size:
        offsets.pop()

    total_lines = len(offsets)
    ti = time.perf_counter() - t0

    result = FileIndex(
        path=path,
        file_size=file_size,
        total_lines=total_lines,
        offsets=offsets,
        _mmap=mm,
        _file_handle=fh,
    )

    _estimate_time_range(result)
    te = time.perf_counter() - t0
    query_logger.info(
        f"index_file | path={path} mb={mb:.0f} lines={total_lines} "
        f"index_ms={(ti)*1000:.0f} total_ms={te*1000:.0f}")
    return result


def index_files_parallel(paths: list[str], on_progress: callable = None) -> dict[str, FileIndex]:
    t0 = time.perf_counter()
    result = {}
    n = len(paths)
    with ThreadPoolExecutor(max_workers=min(n, os.cpu_count() or 4)) as exe:
        fut_map = {exe.submit(index_file, p): (i, p) for i, p in enumerate(paths)}
        for fut in as_completed(fut_map):
            i, p = fut_map[fut]
            try:
                idx = fut.result()
                result[p] = idx
            except (OSError, ValueError, UnicodeError) as e:
                pass
            if on_progress:
                on_progress(i + 1, n, p)
    elapsed = time.perf_counter() - t0
    query_logger.info(
        f"index_files_parallel | files={n} loaded={len(result)} total_ms={elapsed*1000:.0f}")
    return result


def _estimate_time_range(index: FileIndex):
    first_line = read_raw_line(index, 0)
    last_line = read_raw_line(index, index.total_lines - 1)
    entry = parse_line(first_line, 0, 0) if first_line else None
    if entry:
        index.time_start = f'{entry.date} {entry.time}'
    entry = parse_line(last_line, 0, 0) if last_line else None
    if entry:
        index.time_end = f'{entry.date} {entry.time}'


def read_raw_line(index: FileIndex, line_no: int) -> str:
    if line_no < 0 or line_no >= len(index.offsets):
        return ''
    offset = index.offsets[line_no]
    next_offset = (
        index.offsets[line_no + 1] if line_no + 1 < len(index.offsets)
        else index.file_size
    )
    data = index._mmap[offset:next_offset]
    return data.decode('utf-8', errors='replace').rstrip('\n\r')


def read_raw_lines_batch(index: FileIndex, start_line: int, end_line: int) -> list[str]:
    if start_line < 0 or start_line >= len(index.offsets):
        return []
    if end_line > len(index.offsets):
        end_line = len(index.offsets)
    if start_line >= end_line:
        return []
    start_offset = index.offsets[start_line]
    end_offset = index.offsets[end_line - 1]
    next_offset = (
        index.offsets[end_line] if end_line < len(index.offsets)
        else index.file_size
    )
    data = index._mmap[start_offset:next_offset]
    text = data.decode('utf-8', errors='replace')
    lines = text.splitlines(keepends=True)
    result = []
    for l in lines:
        l = l.rstrip('\n\r')
        if l:
            result.append(l)
    return result


def read_lines(index: FileIndex, line_nos: list[int]) -> list[str]:
    return [read_raw_line(index, n) for n in line_nos]


def find_time_range(index: FileIndex, time_start: float, time_end: float) -> tuple[int, int]:
    TIME_PATTERN = re.compile(r'^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})')

    def read_timestamp(line_no: int) -> float:
        line = read_raw_line(index, line_no)
        m = TIME_PATTERN.match(line)
        if not m:
            return -1.0
        date = m.group(1)
        time = m.group(2)
        month, day = date.split('-')
        hour, minute, second, millis = time.replace(':', '.').split('.')
        return (
            int(month) * 30 * 86400
            + int(day) * 86400
            + int(hour) * 3600
            + int(minute) * 60
            + int(second)
            + int(millis) / 1000.0
        )

    total = index.total_lines
    start_line = _bisect_left(read_timestamp, time_start, 0, total)
    end_line = _bisect_right(read_timestamp, time_end, start_line, total)
    return start_line, end_line


def _bisect_left(read_ts, target, lo, hi):
    while lo < hi:
        mid = (lo + hi) // 2
        if read_ts(mid) < target:
            lo = mid + 1
        else:
            hi = mid
    return lo


def _bisect_right(read_ts, target, lo, hi):
    while lo < hi:
        mid = (lo + hi) // 2
        if read_ts(mid) <= target:
            lo = mid + 1
        else:
            hi = mid
    return lo