import os
import re

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from storage.database import get_db
from api.files import _file_indexes
from engine.filter_engine import search as search_engine
from config import EXPORT_DIR, MAX_EXPORT_LINES

router = APIRouter(prefix='/api/export', tags=['export'])


class ExportRequest(BaseModel):
    format: str = 'txt'
    rule_id: int | None = None
    pattern: str | None = None
    level: str | None = None
    pid: int | None = None
    tid: int | None = None
    tag: str | None = None
    time_start: str | None = None
    time_end: str | None = None
    keyword: str | None = None


os.makedirs(EXPORT_DIR, exist_ok=True)


@router.post('')
def export_logs(body: ExportRequest):
    if not _file_indexes:
        raise HTTPException(status_code=400, detail='请先加载日志文件')

    rule_pattern = None
    if body.rule_id:
        db = get_db()
        row = db.execute(
            'SELECT pattern FROM filter_rules WHERE id = ?', (body.rule_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='规则不存在')
        rule_pattern = row['pattern']
    elif body.pattern:
        try:
            re.compile(body.pattern)
        except re.error as e:
            raise HTTPException(status_code=400, detail=f'正则表达式无效: {e}')
        rule_pattern = body.pattern

    levels = None
    if body.level:
        levels = [l.strip().upper() for l in body.level.split(',') if l.strip()]

    indexes = list(_file_indexes.values())

    all_items = []
    batch_size = 5000
    offset = 0
    while len(all_items) < MAX_EXPORT_LINES:
        items, total = search_engine(
            indexes,
            rule_pattern=rule_pattern,
            levels=levels,
            pid=body.pid,
            tid=body.tid,
            tag_substr=body.tag,
            time_start=body.time_start,
            time_end=body.time_end,
            keyword=body.keyword,
            offset=offset,
            limit=batch_size,
        )
        all_items.extend(items)
        if len(items) < batch_size:
            break
        offset += batch_size

    truncated = len(all_items) >= MAX_EXPORT_LINES
    fmt = body.format.lower()
    if fmt not in ('txt', 'json'):
        raise HTTPException(status_code=400, detail='格式仅支持 txt 或 json')

    if fmt == 'json':
        import json
        content = json.dumps({
            'total_matches': len(all_items),
            'items': all_items,
        }, ensure_ascii=False, indent=2)
        media = 'application/json'
        filename = 'export.json'
    else:
        content = ''.join(item['raw'] + '\n' for item in all_items)
        media = 'text/plain; charset=utf-8'
        filename = 'export.log'

    filepath = os.path.join(EXPORT_DIR, filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    return {
        'ok': True,
        'total_matches': len(all_items),
        'truncated': truncated,
        'filename': filename,
        'filepath': filepath,
    }


@router.get('/download')
def download_export(filename: str = Query('export.log')):
    filepath = os.path.join(EXPORT_DIR, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail='文件不存在')
    media = 'application/json' if filename.endswith('.json') else 'text/plain; charset=utf-8'
    return StreamingResponse(
        open(filepath, 'rb'),
        media_type=media,
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )