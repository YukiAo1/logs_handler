import hashlib
import json

_search_cache: dict[str, list] = {}
_cache_key_prefix: str = ''


def _make_key(
    rule_pattern: str | None,
    rule_patterns: list[tuple[int, str]] | None,
    levels: list[str] | None,
    pid: int | None,
    tid: int | None,
    tag_substr: str | None,
    time_start: str | None,
    time_end: str | None,
    keyword: str | None,
    engine_mode: str = 'smart',
) -> str:
    raw = json.dumps(
        (rule_pattern, rule_patterns, levels, pid, tid,
         tag_substr, time_start, time_end, keyword, engine_mode),
        sort_keys=True, default=str
    )
    return hashlib.md5(raw.encode()).hexdigest()


def get_cached(key: str) -> list | None:
    return _search_cache.get(key)


def set_cache(key: str, matches: list):
    _search_cache[key] = matches


def invalidate():
    _search_cache.clear()


def make_key(*args, **kwargs) -> str:
    return _make_key(*args, **kwargs)