import re
from dataclasses import dataclass, field


LOG_PATTERN = re.compile(
    r'^(\d{2}-\d{2})\s+'
    r'(\d{2}:\d{2}:\d{2}\.\d{3})\s+'
    r'(\d+)\s+'
    r'(\d+)\s+'
    r'([VDIWEF])\s+'
    r'(\S+):\s+'
    r'(.*)$'
)

LEVEL_ORDER = {'V': 0, 'D': 1, 'I': 2, 'W': 3, 'E': 4, 'F': 5}


@dataclass
class LogEntry:
    line_no: int
    offset: int
    date: str
    time: str
    timestamp: float
    pid: int
    tid: int
    level: str
    tag: str
    message: str
    raw: str


def parse_line(line: str, line_no: int, offset: int) -> LogEntry | None:
    m = LOG_PATTERN.match(line)
    if not m:
        return None
    date = m.group(1)
    time = m.group(2)
    try:
        pid = int(m.group(3))
        tid = int(m.group(4))
    except ValueError:
        pid = 0
        tid = 0
    level = m.group(5)
    tag = m.group(6)
    message = m.group(7)
    timestamp = _parse_timestamp(date, time)
    return LogEntry(
        line_no=line_no,
        offset=offset,
        date=date,
        time=time,
        timestamp=timestamp,
        pid=pid,
        tid=tid,
        level=level,
        tag=tag,
        message=message,
        raw=line.rstrip('\n\r'),
    )


def _parse_timestamp(date: str, time: str) -> float:
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


def parse_lines(lines: list[str], line_nos: list[int], offsets: list[int]) -> list[LogEntry]:
    entries = []
    for line, line_no, offset in zip(lines, line_nos, offsets):
        entry = parse_line(line, line_no, offset)
        if entry:
            entries.append(entry)
    return entries