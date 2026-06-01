import re
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from engine.indexer import FileIndex, read_raw_line, read_raw_lines_batch, find_time_range
from engine.parser import parse_line, LOG_PATTERN
from engine.rg_search import is_available as rg_available, search_lines, search_lines_batch, should_use_rg, build_rg_pattern
from engine.logger import query_logger, error_logger
from engine.search_cache import make_key, get_cached, set_cache, invalidate

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
    offset: int = 0,
    limit: int = 500,
    is_full_scan: bool = False,
) -> list[tuple]:
    t0 = time.perf_counter()
    if is_full_scan:
        return []

    matches = []

    start_line = 0
    end_line = index.total_lines

    if ts_start is not None or ts_end is not None:
        s = ts_start or 0
        e = ts_end or float('inf')
        start_line, end_line = find_time_range(index, s, e)

    if start_line >= end_line:
        return matches

    no_level_filter = level_set and len(level_set) == 4
    no_meta_filter = pid is None and tid is None and tag_substr is None
    no_pattern = not compiled_rules and not compiled_rule and not compiled_keyword

    if no_level_filter and no_meta_filter and no_pattern:
        for line_no in range(start_line, end_line):
            matches.append((file_idx, line_no, None))
        elapsed = time.perf_counter() - t0
        query_logger.info(
            f"  file_scan[{file_idx}] | shortcut | lines={end_line-start_line} ms={elapsed*1000:.0f}")
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

    elapsed = time.perf_counter() - t0
    query_logger.info(
        f"  file_scan[{file_idx}] | lines={end_line-start_line} matched={len(matches)} ms={elapsed*1000:.0f}")
    return matches


def _search_via_rg(
    indexes: list[FileIndex],
    rule_pattern: str | None,
    rule_patterns: list[tuple[int, str]] | None,
    levels: list[str] | None,
    pid: int | None,
    tid: int | None,
    tag_substr: str | None,
    time_start: str | None,
    time_end: str | None,
    keyword: str | None,
    offset: int,
    limit: int,
) -> tuple[list, int, str]:
    t0 = time.perf_counter()
    level_set = set(levels) if levels else None
    compiled_rule = _get_pattern(rule_pattern) if rule_pattern else None
    compiled_rules = None
    if rule_patterns:
        compiled_rules = [(rid, _get_pattern(p)) for rid, p in rule_patterns]
    compiled_keyword = _get_pattern(keyword) if keyword else None
    rg_pat = build_rg_pattern(rule_pattern, rule_patterns, levels, keyword)

    all_matches = []

    paths_with_time = []

    for file_idx, index in enumerate(indexes):
        start_line = 0
        end_line = index.total_lines
        if time_start is not None or time_end is not None:
            ts_start = _parse_ts_str(time_start) if time_start else 0
            ts_end = _parse_ts_str(time_end) if time_end else float('inf')
            start_line, end_line = find_time_range(index, ts_start, ts_end)
        if start_line >= end_line:
            continue
        paths_with_time.append((file_idx, index, start_line, end_line))

    if not paths_with_time or not rg_pat:
        return [], 0, 'rg', []

    ft0 = time.perf_counter()
    all_paths = [it[1].path for it in paths_with_time]
    query_logger.info(f"  rg_debug | pattern='{rg_pat[:150]}' files={len(all_paths)} first_path={all_paths[0][:60] if all_paths else 'none'}")
    batch_result = search_lines_batch(all_paths, rg_pat)
    ft1 = time.perf_counter()

    pre_filter_count = 0
    debug_samples = []
    for file_idx, index, start_line, end_line in paths_with_time:
        rg_hits = batch_result.get(index.path, set())
        pre_filter_count += len(rg_hits)
        if not rg_hits:
            continue
        for ln in sorted(rg_hits):
            if ln < start_line or ln >= end_line:
                continue
            raw = read_raw_line(index, ln)
            if not raw:
                continue
            m = LOG_PATTERN.match(raw)
            if not m:
                continue
            if level_set and m.group(5) not in level_set:
                if len(debug_samples) < 20:
                    debug_samples.append(('level_filter', raw[:120]))
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
                for rid, pat in compiled_rules:
                    if pat.search(raw):
                        matched_rule_id = rid
                        break
                if matched_rule_id is None:
                    if len(debug_samples) < 20:
                        debug_samples.append(('rule_miss', raw[:120]))
                    continue
            elif compiled_rule:
                if not compiled_rule.search(raw):
                    if len(debug_samples) < 20:
                        debug_samples.append(('rule_miss', raw[:120]))
                    continue
            if compiled_keyword and not compiled_keyword.search(raw):
                if len(debug_samples) < 20:
                    debug_samples.append(('keyword_miss', raw[:120]))
                continue
            all_matches.append((file_idx, ln, matched_rule_id))

    if debug_samples:
        for kind, sample in debug_samples[:10]:
            query_logger.info(f"  rg_debug_sample | {kind} | {sample}")

    all_matches.sort(key=lambda x: (x[0], x[1]))
    total = len(all_matches)
    page = all_matches[offset:offset + limit]
    t_build = time.perf_counter()
    results = _build_results_from_matches(page, indexes)
    build_ms = time.perf_counter() - t_build
    total_ms = time.perf_counter() - t0
    query_logger.info(
        f"  rg_batch | files={len(paths_with_time)} rg_ms={(ft1-ft0)*1000:.0f} "
        f"rg_hits={pre_filter_count} "
        f"after_filter={total} result_rows={len(results)} "
        f"total_ms={total_ms*1000:.0f} build_ms={build_ms*1000:.0f}")
    return results, total, 'rg', all_matches


def _build_results_from_matches(matches: list[tuple], indexes: list[FileIndex]) -> list[dict]:
    if not matches:
        return []

    file_groups = {}
    for file_idx, line_no, matched_rule_id in matches:
        if file_idx not in file_groups:
            file_groups[file_idx] = []
        file_groups[file_idx].append((line_no, matched_rule_id))

    results = []
    for file_idx, items in file_groups.items():
        index = indexes[file_idx]
        items_sorted = sorted(items, key=lambda x: x[0])
        line_nos = [it[0] for it in items_sorted]
        rule_ids = [it[1] for it in items_sorted]

        batch = read_raw_lines_batch(index, line_nos[0], line_nos[-1] + 1)
        line_map = {line_nos[0] + j: raw for j, raw in enumerate(batch) if raw}

        for line_no, matched_rule_id in zip(line_nos, rule_ids):
            raw = line_map.get(line_no)
            if raw is None:
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

    return results


def _search_via_python(
    indexes: list[FileIndex],
    rule_pattern: str | None,
    rule_patterns: list[tuple[int, str]] | None,
    levels: list[str] | None,
    pid: int | None,
    tid: int | None,
    tag_substr: str | None,
    time_start: str | None,
    time_end: str | None,
    keyword: str | None,
    offset: int,
    limit: int,
    engine_hint: str = 'python',
) -> tuple[list, int, str]:
    compiled_rule = _get_pattern(rule_pattern) if rule_pattern else None

    compiled_rules = None
    if rule_patterns:
        compiled_rules = [(rid, _get_pattern(p)) for rid, p in rule_patterns]

    compiled_keyword = _get_pattern(keyword) if keyword else None
    level_set = set(levels) if levels else None
    ts_start = _parse_ts_str(time_start) if time_start else None
    ts_end = _parse_ts_str(time_end) if time_end else None

    no_level_filter = level_set and len(level_set) == 4
    no_meta_filter = pid is None and tid is None and tag_substr is None
    no_pattern = not compiled_rules and not compiled_rule and not compiled_keyword
    no_time = ts_start is None and ts_end is None
    is_full_scan = no_level_filter and no_meta_filter and no_pattern and no_time

    parallel = len(indexes) > 1

    if is_full_scan:
        t0 = time.perf_counter()
        total = sum(idx.total_lines for idx in indexes)
        results = []
        remaining = limit
        skip = offset
        for file_idx, index in enumerate(indexes):
            n = index.total_lines
            if skip >= n:
                skip -= n
                continue
            start = skip
            count = min(n - start, remaining)
            if count <= 0:
                continue
            batch = read_raw_lines_batch(index, start, start + count)
            for i, raw in enumerate(batch):
                if not raw:
                    continue
                line_no = start + i
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
                        'matched_rule_id': None,
                    })
            remaining -= count
            if remaining <= 0:
                break
        elapsed = time.perf_counter() - t0
        query_logger.info(
            f"  full_scan_shortcut | files={len(indexes)} result_rows={len(results)} "
            f"build_ms={elapsed*1000:.0f}")
        return results, total, engine_hint, []

    t_scan = time.perf_counter()
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

    scan_ms = time.perf_counter() - t_scan
    total = len(all_matches)
    page_matches = all_matches[offset:offset + limit]

    t_build = time.perf_counter()
    results = _build_results_from_matches(page_matches, indexes)
    build_ms = time.perf_counter() - t_build

    query_logger.info(
        f"  py_scan | match_before_filter={total} files={len(indexes)} "
        f"scan_ms={scan_ms*1000:.0f} build_ms={build_ms*1000:.0f}")

    return results, total, engine_hint, all_matches


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
    engine_mode: str = 'smart',
) -> tuple[list, int, str]:
    t_start = time.perf_counter()
    total_lines = sum(idx.total_lines for idx in indexes)
    mb = total_lines * 90 / 1024 / 1024

    cache_key = make_key(
        rule_pattern, rule_patterns, levels,
        pid, tid, tag_substr,
        time_start, time_end, keyword,
    )

    cached = get_cached(cache_key)
    if cached is not None:
        total = len(cached)
        page_raw = cached[offset:offset + limit]
        page_built = _build_results_from_matches(page_raw, indexes)
        elapsed = time.perf_counter() - t_start
        used = 'rg' if engine_mode == 'rg' else 'python'
        query_logger.info(
            f"cached | rows={total_lines} mb={mb:.0f} offset={offset} limit={limit} "
            f"levels={levels or 'all'} keyword={keyword or ''} "
            f"engine_mode={engine_mode} cache_hits={total} "
            f"total_ms={elapsed*1000:.0f}")
        return page_built, total, used

    has_filter = bool(rule_pattern or rule_patterns or keyword or
                      tag_substr or pid is not None or tid is not None)
    has_level = levels and len(levels) < 4
    has_time = time_start or time_end

    no_real_filter = not has_filter and not has_level and not has_time
    if no_real_filter and engine_mode == 'rg':
        results, total, _, raw = _search_via_python(
            indexes, rule_pattern, rule_patterns, levels,
            pid, tid, tag_substr, time_start, time_end,
            keyword, offset, limit, 'python',
        )
        elapsed = time.perf_counter() - t_start
        query_logger.info(
            f"no_filter_rg | rows={total_lines} mb={mb:.0f} "
            f"offset={offset} limit={limit} "
            f"total_ms={elapsed*1000:.0f}")
        set_cache(cache_key, raw)
        return results, total, 'rg'
    if no_real_filter:
        results, total, _, raw = _search_via_python(
            indexes, rule_pattern, rule_patterns, levels,
            pid, tid, tag_substr, time_start, time_end,
            keyword, offset, limit, 'python',
        )
        elapsed = time.perf_counter() - t_start
        query_logger.info(
            f"no_filter_shortcut | rows={total_lines} mb={mb:.0f} "
            f"offset={offset} limit={limit} "
            f"total_ms={elapsed*1000:.0f}")
        set_cache(cache_key, raw)
        return results, total, 'python'

    meta = (
        f"rows={total_lines} mb={mb:.0f} offset={offset} limit={limit} "
        f"levels={levels or 'all'} pid={pid} tid={tid} tag={tag_substr or ''} "
        f"time=[{time_start or ''}~{time_end or ''}] keyword={keyword or ''} "
        f"rules={len(rule_patterns) if rule_patterns else (1 if rule_pattern else 0)} "
        f"engine_mode={engine_mode}"
    )

    make_decision = True
    results = []
    total = 0
    used_engine = 'python'
    all_matches = []

    def do_rg(offs, lim):
        nonlocal results, total, used_engine, all_matches
        r, t, e, raw = _search_via_rg(
            indexes, rule_pattern, rule_patterns, levels,
            pid, tid, tag_substr, time_start, time_end,
            keyword, offs, lim,
        )
        results, total, used_engine, all_matches = r, t, e, raw

    def do_py(offs, lim):
        nonlocal results, total, used_engine, all_matches
        r, t, e, raw = _search_via_python(
            indexes, rule_pattern, rule_patterns, levels,
            pid, tid, tag_substr, time_start, time_end,
            keyword, offs, lim, 'python',
        )
        results, total, used_engine, all_matches = r, t, e, raw

    if engine_mode == 'rg':
        if rg_available():
            do_rg(0, limit if offset == 0 else limit + offset)
            elapsed = time.perf_counter() - t_start
            query_logger.info(f"rg_forced | {meta} | engine=rg | "
                              f"search_ms={elapsed*1000:.0f} | hits={total}")
            make_decision = False
        else:
            query_logger.warning(f"rg_req_unavail | {meta}")

    if make_decision and engine_mode == 'python':
        do_py(0, limit if offset == 0 else limit + offset)
        elapsed = time.perf_counter() - t_start
        query_logger.info(f"python_forced | {meta} | engine=python | "
                          f"search_ms={elapsed*1000:.0f} | hits={total}")
        make_decision = False

    if make_decision and rg_available() and (has_filter or has_level or has_time):
        if should_use_rg(total_lines):
            do_rg(0, limit if offset == 0 else limit + offset)
            elapsed = time.perf_counter() - t_start
            query_logger.info(f"rg_smart | {meta} | engine=rg | "
                              f"search_ms={elapsed*1000:.0f} | hits={total}")
            make_decision = False

    if make_decision:
        do_py(0, limit if offset == 0 else limit + offset)
        elapsed = time.perf_counter() - t_start
        query_logger.info(f"python_default | {meta} | engine=python | "
                          f"search_ms={elapsed*1000:.0f} | hits={total}")

    if all_matches and offset == 0:
        set_cache(cache_key, all_matches)
        query_logger.info(f"  cache_stored | key={cache_key[:8]} entries={len(all_matches)}")

    if keyword and results:
        query_logger.info(f"  result_samples | keyword='{keyword}' | first_5_msgs: {' | '.join(r.get('message', '')[:60] for r in results[:5])}")
    elif keyword and not results:
        query_logger.info(f"  result_samples | keyword='{keyword}' | EMPTY_RESULTS")

    return results, total, used_engine