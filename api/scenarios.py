import json
import re

from fastapi import APIRouter, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from storage.database import get_db
from storage.models import ClassicScenario, now_iso

router = APIRouter(prefix='/api/scenarios', tags=['scenarios'])


class ScenarioCreate(BaseModel):
    title: str
    note: str


class ScenarioUpdate(BaseModel):
    title: str | None = None
    note: str | None = None


@router.get('')
def list_scenarios():
    db = get_db()
    rows = db.execute(
        'SELECT * FROM classic_scenarios ORDER BY updated_at DESC'
    ).fetchall()
    return [ClassicScenario.from_row(r).to_dict() for r in rows]


@router.post('')
def create_scenario(body: ScenarioCreate):
    title = body.title.strip()
    note = body.note.strip()
    if not title:
        raise HTTPException(status_code=400, detail='标题不能为空')
    if not note:
        raise HTTPException(status_code=400, detail='备注不能为空')
    db = get_db()
    ts = now_iso()
    cursor = db.execute(
        'INSERT INTO classic_scenarios (title, note, created_at, updated_at) VALUES (?, ?, ?, ?)',
        (title, note, ts, ts),
    )
    db.commit()
    scenario = ClassicScenario(
        id=cursor.lastrowid,
        title=title,
        note=note,
        created_at=ts,
        updated_at=ts,
    )
    return scenario.to_dict()


@router.put('/{scenario_id}')
def update_scenario(scenario_id: int, body: ScenarioUpdate):
    db = get_db()
    row = db.execute(
        'SELECT * FROM classic_scenarios WHERE id = ?', (scenario_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='场景不存在')
    scenario = ClassicScenario.from_row(row)
    if body.title is not None:
        t = body.title.strip()
        if not t:
            raise HTTPException(status_code=400, detail='标题不能为空')
        scenario.title = t
    if body.note is not None:
        n = body.note.strip()
        if not n:
            raise HTTPException(status_code=400, detail='备注不能为空')
        scenario.note = n
    scenario.updated_at = now_iso()
    db.execute(
        'UPDATE classic_scenarios SET title=?, note=?, updated_at=? WHERE id=?',
        (scenario.title, scenario.note, scenario.updated_at, scenario_id),
    )
    db.commit()
    return scenario.to_dict()


@router.delete('/{scenario_id}')
def delete_scenario(scenario_id: int):
    db = get_db()
    row = db.execute(
        'SELECT id FROM classic_scenarios WHERE id = ?', (scenario_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='场景不存在')
    db.execute('DELETE FROM classic_scenarios WHERE id = ?', (scenario_id,))
    db.commit()
    return {'ok': True}


@router.get('/export')
def export_scenarios():
    db = get_db()
    rows = db.execute('SELECT * FROM classic_scenarios ORDER BY id').fetchall()
    scenarios = []
    for r in rows:
        s = ClassicScenario.from_row(r)
        scenarios.append({'title': s.title, 'note': s.note})
    return JSONResponse(content={
        'version': '1.0',
        'exported_at': now_iso(),
        'scenarios': scenarios,
    })


@router.post('/import')
async def import_scenarios(file: UploadFile, mode: str = Query('merge')):
    if not file.filename or not file.filename.endswith('.json'):
        raise HTTPException(status_code=400, detail='请上传 .json 文件')
    raw = await file.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail='JSON 解析失败')

    scenarios_list = data.get('scenarios', [])
    if not isinstance(scenarios_list, list) or len(scenarios_list) == 0:
        raise HTTPException(status_code=400, detail='JSON 文件中没有有效的场景数据')

    db = get_db()
    ts = now_iso()

    if mode == 'replace':
        db.execute('DELETE FROM classic_scenarios')

    imported = 0
    skipped = 0
    for item in scenarios_list:
        title = item.get('title', '').strip()
        note = item.get('note', '').strip()
        if not title or not note:
            skipped += 1
            continue

        if mode == 'merge':
            exist = db.execute(
                'SELECT id FROM classic_scenarios WHERE title = ?', (title,)
            ).fetchone()
            if exist:
                skipped += 1
                continue

        db.execute(
            'INSERT INTO classic_scenarios (title, note, created_at, updated_at) VALUES (?, ?, ?, ?)',
            (title, note, ts, ts),
        )
        imported += 1

    db.commit()
    return {'imported': imported, 'skipped': skipped}


@router.post('/match')
def match_scenarios(messages: list[str]):
    """批量匹配消息列表，返回每个消息匹配的场景ID列表"""
    db = get_db()
    rows = db.execute(
        'SELECT id, title FROM classic_scenarios ORDER BY LENGTH(title) DESC'
    ).fetchall()
    if not rows:
        return {'matches': {}}

    scenarios = [(r['id'], r['title']) for r in rows]
    result = {}
    for msg in messages:
        matched = []
        for sid, title in scenarios:
            if title and msg and title.lower() in msg.lower():
                matched.append(sid)
        if matched:
            result[msg] = matched
    return {'matches': result}