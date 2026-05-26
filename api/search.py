import os
import re

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from storage.database import get_db
from api.files import _file_indexes
from engine.filter_engine import search as search_engine

router = APIRouter(prefix='/api/search', tags=['search'])


@router.get('')
def search_logs(
    rule_id: int | None = Query(None),
    pattern: str | None = Query(None),
    level: str | None = Query(None),
    pid: int | None = Query(None),
    tid: int | None = Query(None),
    tag: str | None = Query(None),
    time_start: str | None = Query(None),
    time_end: str | None = Query(None),
    keyword: str | None = Query(None),
    offset: int = Query(0),
    limit: int = Query(500),
):
    if not _file_indexes:
        raise HTTPException(status_code=400, detail='请先加载日志文件')

    rule_pattern = None
    if rule_id:
        db = get_db()
        row = db.execute(
            'SELECT pattern FROM filter_rules WHERE id = ?', (rule_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='规则不存在')
        rule_pattern = row['pattern']
    elif pattern:
        try:
            re.compile(pattern)
        except re.error as e:
            raise HTTPException(status_code=400, detail=f'正则表达式无效: {e}')
        rule_pattern = pattern

    levels = None
    if level:
        levels = [l.strip().upper() for l in level.split(',') if l.strip()]
        for lv in levels:
            if lv not in 'DIWE':
                raise HTTPException(status_code=400, detail=f'无效的日志级别: {lv}')
        if not levels:
            levels = None

    indexes = list(_file_indexes.values())

    items, total = search_engine(
        indexes,
        rule_pattern=rule_pattern,
        levels=levels,
        pid=pid,
        tid=tid,
        tag_substr=tag,
        time_start=time_start,
        time_end=time_end,
        keyword=keyword,
        offset=offset,
        limit=min(limit, 2000),
    )

    return {
        'items': items,
        'total_matches': total,
        'offset': offset,
        'limit': min(limit, 2000),
    }


@router.get('/count')
def count_matches(
    rule_id: int | None = Query(None),
):
    if not _file_indexes:
        raise HTTPException(status_code=400, detail='请先加载日志文件')
    if not rule_id:
        raise HTTPException(status_code=400, detail='请指定 rule_id')

    db = get_db()
    row = db.execute(
        'SELECT pattern FROM filter_rules WHERE id = ?', (rule_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='规则不存在')

    indexes = list(_file_indexes.values())
    _, total = search_engine(
        indexes,
        rule_pattern=row['pattern'],
        offset=0,
        limit=1,
    )
    return {'rule_id': rule_id, 'total_matches': total}