from engine.indexer import FileIndex, read_raw_line, find_time_range
from engine.filter_engine import _get_pattern, _parse_ts_str
from engine.parser import LOG_PATTERN


def _count_by_rule(index: FileIndex, pattern_str: str,
                   start_line: int, end_line: int) -> int:
    compiled = _get_pattern(pattern_str)
    count = 0
    for line_no in range(start_line, end_line):
        raw = read_raw_line(index, line_no)
        if raw and compiled.search(raw):
            count += 1
    return count


def _level_dist(index: FileIndex, start_line: int, end_line: int) -> dict[str, int]:
    dist = {'V': 0, 'D': 0, 'I': 0, 'W': 0, 'E': 0, 'F': 0}
    for line_no in range(start_line, end_line):
        raw = read_raw_line(index, line_no)
        m = LOG_PATTERN.match(raw) if raw else None
        if m:
            lv = m.group(5)
            dist[lv] = dist.get(lv, 0) + 1
    return dist


def compare(
    index_a: FileIndex,
    index_b: FileIndex,
    rule_patterns: list[tuple[int, str, str]],
    time_start: str | None = None,
    time_end: str | None = None,
    window_minutes: int = 5,
) -> dict:
    total_a = index_a.total_lines
    total_b = index_b.total_lines

    ts_start = _parse_ts_str(time_start) if time_start else None
    ts_end = _parse_ts_str(time_end) if time_end else None

    if ts_start is not None and ts_end is not None:
        a_start, a_end = find_time_range(index_a, ts_start, ts_end)
        b_start, b_end = find_time_range(index_b, ts_start, ts_end)
    else:
        a_start, a_end = 0, total_a
        b_start, b_end = 0, total_b

    level_a = _level_dist(index_a, a_start, a_end)
    level_b = _level_dist(index_b, b_start, b_end)

    rules_summary = []
    for rule_id, rule_name, rule_pattern in rule_patterns:
        count_a = _count_by_rule(index_a, rule_pattern, a_start, a_end)
        count_b = _count_by_rule(index_b, rule_pattern, b_start, b_end)
        rules_summary.append({
            'rule_id': rule_id,
            'name': rule_name,
            'pattern': rule_pattern,
            'count_a': count_a,
            'count_b': count_b,
            'delta': count_b - count_a,
        })

    window_secs = window_minutes * 60
    if ts_start is not None and ts_end is not None:
        total_span = ts_end - ts_start
    else:
        total_span = 3600

    window_count = max(1, int(total_span / window_secs) + 1)
    windows = []
    for w in range(window_count):
        w_start = (ts_start or 0) + w * window_secs
        w_end = min(w_start + window_secs, ts_end or float('inf'))
        w_rule_stats = {}
        for rule_id, rule_name, rule_pattern in rule_patterns:
            wa_start, wa_end = find_time_range(index_a, w_start, w_end)
            wb_start, wb_end = find_time_range(index_b, w_start, w_end)
            ca = _count_by_rule(index_a, rule_pattern, wa_start, wa_end)
            cb = _count_by_rule(index_b, rule_pattern, wb_start, wb_end)
            w_rule_stats[str(rule_id)] = {
                'name': rule_name,
                'count_a': ca,
                'count_b': cb,
                'delta': cb - ca,
            }
        windows.append({
            'time_start': f'{w_start:.3f}',
            'time_end': f'{w_end:.3f}',
            'rules': w_rule_stats,
        })

    return {
        'file_a': {
            'path': index_a.path,
            'total_lines': total_a,
            'file_size': index_a.file_size,
            'time_start': index_a.time_start,
            'time_end': index_a.time_end,
        },
        'file_b': {
            'path': index_b.path,
            'total_lines': total_b,
            'file_size': index_b.file_size,
            'time_start': index_b.time_start,
            'time_end': index_b.time_end,
        },
        'level_dist': {
            'a': level_a,
            'b': level_b,
        },
        'rules': rules_summary,
        'windows': windows,
    }