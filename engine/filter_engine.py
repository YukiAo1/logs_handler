import re
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from engine.indexer import FileIndex, read_raw_line, read_raw_lines_batch, find_time_range
from engine.parser import parse_line, LOG_PATTERN

_pattern_cache = {}


def _get_pattern(pattern_str: str) -> re.Pattern:
    if pattern_str not in _pattern_cache:
        try:
            _pattern_cache[pattern_str] = re.compile(pattern_str, re.IGNORECASE)
        except re.error:
            _pattern_cache[pattern_str] = re.compile(re.escape(pattern_str), re.IGNORECASE)
    return _pattern_cache[pattern_str]


def _parse_ts_str(ts: str) -> float:
    month, day = ts[:5].split('-')
    hour, minute, second, millis = ts[6:].replace(':', '.').split('.')
    return (
        int(month) * 30 * 86400
        + int(day) * 86400
        + int(hour) * 3600
        + int(minute) * 60
        + int(second)
        + int(millis) / 1000.0
    )


def _search_single_file(
    index: FileIndex,
    file_idx: int,
    compiled_rules: list | None,
    compiled_rule: re.Pattern | None,
    compiled_keyword: re.Pattern | None,
    level_set: set | None,
    pid: int | None,
    tid: int | None,
    tag_substr: str | None,
    ts_start: float | None,
    ts_end: float | None,
) -> list[tuple]:
    matches = []

    start_line = 0
    end_line = index.total_lines

    if ts_start is not None or ts_end is not None:
        s = ts_start or 0
        e = ts_end or float('inf')
        start_line, end_line = find_time_range(index, s, e)

    if start_line >= end_line:
        return matches

    batch = read_raw_lines_batch(index, start_line, end_line)
    for i, raw in enumerate(batch):
        line_no = start_line + i
        if not raw:
            continue

        if level_set or pid is not None or tid is not None or tag_substr:
            m = LOG_PATTERN.match(raw)
            if not m:
                continue
            if level_set and m.group(5) not in level_set:
                continue
            if pid is not None:
                try:
                    if int(m.group(3)) != pid:
                        continue
                except ValueError:
                    continue
            if tid is not None:
                try:
                    if int(m.group(4)) != tid:
                        continue
                except ValueError:
                    continue
            if tag_substr and tag_substr.lower() not in m.group(6).lower():
                continue

        matched_rule_id = None

        if compiled_rules:
            found = False
            for rid, pat in compiled_rules:
                if pat.search(raw):
                    found = True
                    matched_rule_id = rid
                    break
            if not found:
                continue
        elif compiled_rule:
            if not compiled_rule.search(raw):
                continue

        if compiled_keyword and not compiled_keyword.search(raw):
            continue

        matches.append((file_idx, line_no, matched_rule_id))

    return matches


def search(
    indexes: list[FileIndex],
    *,
    rule_pattern: str | None = None,
    rule_patterns: list[tuple[int, str]] | None = None,
    levels: list[str] | None = None,
    pid: int | None = None,
    tid: int | None = None,
    tag_substr: str | None = None,
    time_start: str | None = None,
    time_end: str | None = None,
    keyword: str | None = None,
    offset: int = 0,
    limit: int = 500,
) -> tuple[list, int]:
    compiled_rule = _get_pattern(rule_pattern) if rule_pattern else None

    compiled_rules = None
    if rule_patterns:
        compiled_rules = [(rid, _get_pattern(p)) for rid, p in rule_patterns]

    compiled_keyword = _get_pattern(keyword) if keyword else None
    level_set = set(levels) if levels else None
    ts_start = _parse_ts_str(time_start) if time_start else None
    ts_end = _parse_ts_str(time_end) if time_end else None

    parallel = len(indexes) > 1

    if parallel:
        all_matches = []
        with ThreadPoolExecutor(max_workers=min(len(indexes), os.cpu_count() or 4)) as exe:
            futures = {
                exe.submit(
                    _search_single_file,
                    index, file_idx,
                    compiled_rules, compiled_rule, compiled_keyword,
                    level_set, pid, tid, tag_substr,
                    ts_start, ts_end,
                ): file_idx
                for file_idx, index in enumerate(indexes)
            }
            for fut in as_completed(futures):
                all_matches.extend(fut.result())
        all_matches.sort(key=lambda x: (x[1], x[0]))
    else:
        all_matches = []
        for file_idx, index in enumerate(indexes):
            result = _search_single_file(
                index, file_idx,
                compiled_rules, compiled_rule, compiled_keyword,
                level_set, pid, tid, tag_substr,
                ts_start, ts_end,
            )
            all_matches.extend(result)

    total = len(all_matches)
    page_matches = all_matches[offset:offset + limit]

    results = []
    for file_idx, line_no, matched_rule_id in page_matches:
        index = indexes[file_idx]
        raw = read_raw_line(index, line_no)
        entry = parse_line(raw, line_no, index.offsets[line_no])
        if entry:
            results.append({
                'line_no': entry.line_no + 1,
                'date': entry.date,
                'time': entry.time,
                'pid': entry.pid,
                'tid': entry.tid,
                'level': entry.level,
                'tag': entry.tag,
                'message': entry.message,
                'raw': entry.raw,
                'file_path': index.path,
                'matched_rule_id': matched_rule_id,
            })

    return results, total