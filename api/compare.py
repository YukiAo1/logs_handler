import os

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from storage.database import get_db
from api.files import _file_indexes
from engine.comparator import compare as compare_engine
from engine.indexer import index_file

router = APIRouter(prefix='/api/compare', tags=['compare'])


class CompareRequest(BaseModel):
    rule_ids: list[int] = []
    time_start: str | None = None
    time_end: str | None = None
    window_minutes: int = 5


@router.post('')
def run_compare(body: CompareRequest):
    indexes = list(_file_indexes.values())
    if len(indexes) < 2:
        raise HTTPException(status_code=400, detail='请先加载至少两个日志文件')

    rule_patterns = []
    db = get_db()
    for rid in (body.rule_ids or []):
        row = db.execute(
            'SELECT id, name, pattern FROM filter_rules WHERE id = ?', (rid,)
        ).fetchone()
        if row:
            rule_patterns.append((row['id'], row['name'], row['pattern']))

    result = compare_engine(
        index_a=indexes[0],
        index_b=indexes[1],
        rule_patterns=rule_patterns,
        time_start=body.time_start,
        time_end=body.time_end,
        window_minutes=body.window_minutes,
    )
    return result