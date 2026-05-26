import re
from engine.indexer import FileIndex, read_raw_line, find_time_range
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


def search(
    indexes: list[FileIndex],
    *,
    rule_pattern: str | None = None,
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
    all_matches = []

    compiled_rule = _get_pattern(rule_pattern) if rule_pattern else None
    compiled_keyword = _get_pattern(keyword) if keyword else None
    level_set = set(levels) if levels else None
    need_parse = bool(pid is not None or tid is not None or tag_substr)

    ts_start = _parse_ts_str(time_start) if time_start else None
    ts_end = _parse_ts_str(time_end) if time_end else None

    for file_idx, index in enumerate(indexes):
        start_line = 0
        end_line = index.total_lines

        if ts_start is not None or ts_end is not None:
            s = ts_start or 0
            e = ts_end or float('inf')
            start_line, end_line = find_time_range(index, s, e)

        for line_no in range(start_line, end_line):
            raw = read_raw_line(index, line_no)
            if not raw:
                continue

            if level_set or need_parse:
                m = LOG_PATTERN.match(raw)
                if not m:
                    continue
                if level_set and m.group(5) not in level_set:
                    continue
                if need_parse:
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

            if compiled_rule and not compiled_rule.search(raw):
                continue

            if compiled_keyword and not compiled_keyword.search(raw):
                continue

            all_matches.append((file_idx, line_no))

    total = len(all_matches)
    page_matches = all_matches[offset:offset + limit]

    results = []
    for file_idx, line_no in page_matches:
        index = indexes[file_idx]
        raw = read_raw_line(index, line_no)
        entry = parse_line(raw, line_no, index.offsets[line_no])
        if entry:
            results.append({
                'line_no': entry.line_no,
                'date': entry.date,
                'time': entry.time,
                'pid': entry.pid,
                'tid': entry.tid,
                'level': entry.level,
                'tag': entry.tag,
                'message': entry.message,
                'raw': entry.raw,
                'file_path': index.path,
            })

    return results, total