import json
import re

from fastapi import APIRouter, HTTPException, UploadFile, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from storage.database import get_db
from storage.models import FilterRule, now_iso

router = APIRouter(prefix='/api/rules', tags=['rules'])


class RuleCreate(BaseModel):
    name: str
    pattern: str
    description: str = ''
    group_name: str = ''


class RuleUpdate(BaseModel):
    name: str | None = None
    pattern: str | None = None
    description: str | None = None
    group_name: str | None = None


class RuleMove(BaseModel):
    rule_id: int
    target_group: str = ''
    target_order: int = 0


def _validate_pattern(pattern: str):
    if not pattern.strip():
        raise HTTPException(status_code=400, detail='正则表达式不能为空')
    try:
        re.compile(pattern)
    except re.error as e:
        raise HTTPException(status_code=400, detail=f'正则表达式无效: {e}')


@router.get('')
def list_rules():
    db = get_db()
    rows = db.execute(
        'SELECT * FROM filter_rules ORDER BY sort_order ASC, id ASC'
    ).fetchall()

    groups = {}
    for r in rows:
        rule = FilterRule.from_row(r).to_dict()
        g = rule.pop('group_name') or ''
        if g not in groups:
            groups[g] = []
        groups[g].append(rule)

    result = []
    for g, rules in groups.items():
        result.append({'group_name': g, 'rules': rules})
    return result


@router.post('')
def create_rule(body: RuleCreate):
    _validate_pattern(body.pattern)
    db = get_db()
    ts = now_iso()

    max_order = db.execute(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 FROM filter_rules'
    ).fetchone()[0]

    cursor = db.execute(
        'INSERT INTO filter_rules (name, pattern, description, group_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (body.name.strip(), body.pattern.strip(), body.description, body.group_name.strip(), max_order, ts, ts),
    )
    db.commit()
    rule = FilterRule(
        id=cursor.lastrowid,
        name=body.name.strip(),
        pattern=body.pattern.strip(),
        description=body.description,
        group_name=body.group_name.strip(),
        sort_order=max_order,
        created_at=ts,
        updated_at=ts,
    )
    return rule.to_dict()


@router.put('/{rule_id}')
def update_rule(rule_id: int, body: RuleUpdate):
    db = get_db()
    existing = db.execute('SELECT * FROM filter_rules WHERE id = ?', (rule_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail='规则不存在')
    rule = FilterRule.from_row(existing)

    if body.name is not None:
        rule.name = body.name.strip()
    if body.pattern is not None:
        _validate_pattern(body.pattern)
        rule.pattern = body.pattern.strip()
    if body.description is not None:
        rule.description = body.description
    if body.group_name is not None:
        rule.group_name = body.group_name.strip()

    rule.updated_at = now_iso()
    db.execute(
        'UPDATE filter_rules SET name=?, pattern=?, description=?, group_name=?, updated_at=? WHERE id=?',
        (rule.name, rule.pattern, rule.description, rule.group_name, rule.updated_at, rule_id),
    )
    db.commit()
    return rule.to_dict()


@router.delete('/{rule_id}')
def delete_rule(rule_id: int):
    db = get_db()
    existing = db.execute('SELECT id FROM filter_rules WHERE id = ?', (rule_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail='规则不存在')
    db.execute('DELETE FROM filter_rules WHERE id = ?', (rule_id,))
    db.commit()
    return {'ok': True}


@router.put('/move')
def move_rule(body: RuleMove):
    db = get_db()
    src = db.execute('SELECT * FROM filter_rules WHERE id = ?', (body.rule_id,)).fetchone()
    if not src:
        raise HTTPException(status_code=404, detail='规则不存在')
    ts = now_iso()

    # 拖到目录头 → 移入目录，放在最前面
    if body.target_group is not None and body.target_order == 0:
        db.execute(
            'UPDATE filter_rules SET group_name=?, sort_order=0, updated_at=? WHERE id=?',
            (body.target_group.strip(), ts, body.rule_id),
        )
    elif body.target_order >= 0:
        # 拖到具体规则 → 交换 sort_order
        tgt = db.execute(
            'SELECT id, sort_order FROM filter_rules WHERE id != ? AND sort_order = ? LIMIT 1',
            (body.rule_id, body.target_order),
        ).fetchone()
        if tgt:
            # 交换两个规则的 sort_order
            db.execute(
                'UPDATE filter_rules SET sort_order=?, updated_at=? WHERE id=?',
                (tgt['sort_order'], ts, body.rule_id),
            )
            db.execute(
                'UPDATE filter_rules SET sort_order=?, updated_at=? WHERE id=?',
                (src['sort_order'], ts, tgt['id']),
            )
        else:
            db.execute(
                'UPDATE filter_rules SET sort_order=?, updated_at=? WHERE id=?',
                (body.target_order, ts, body.rule_id),
            )

    db.commit()
    return {'ok': True}


@router.get('/export')
def export_rules():
    db = get_db()
    rows = db.execute('SELECT * FROM filter_rules ORDER BY sort_order ASC, id ASC').fetchall()
    rules = []
    for r in rows:
        rule = FilterRule.from_row(r)
        rules.append({
            'name': rule.name,
            'pattern': rule.pattern,
            'description': rule.description,
            'group_name': rule.group_name,
        })
    return JSONResponse(content={
        'version': '2.0',
        'exported_at': now_iso(),
        'rules': rules,
    })


class ImportMode(BaseModel):
    mode: str = 'merge'


@router.post('/import')
def import_rules(mode: ImportMode = ImportMode(mode='merge')):
    return JSONResponse(
        status_code=400,
        content={'detail': '请通过 multipart/form-data 上传 JSON 文件，字段名: file'},
    )


@router.post('/import/upload')
async def import_rules_upload(file: UploadFile, mode: str = Query('merge')):
    if not file.filename or not file.filename.endswith('.json'):
        raise HTTPException(status_code=400, detail='请上传 .json 文件')
    raw = await file.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail='JSON 解析失败')

    rules_list = data.get('rules', [])
    if not isinstance(rules_list, list) or len(rules_list) == 0:
        raise HTTPException(status_code=400, detail='JSON 文件中没有有效的规则数据')

    db = get_db()
    ts = now_iso()

    if mode == 'replace':
        db.execute('DELETE FROM filter_rules')

    imported = 0
    skipped = 0
    max_order = db.execute('SELECT COALESCE(MAX(sort_order), -1) FROM filter_rules').fetchone()[0]

    for item in rules_list:
        name = item.get('name', '').strip()
        pattern = item.get('pattern', '').strip()
        description = item.get('description', '')
        group_name = item.get('group_name', '').strip()
        if not name or not pattern:
            skipped += 1
            continue
        try:
            re.compile(pattern)
        except re.error:
            skipped += 1
            continue

        if mode == 'merge':
            exist = db.execute(
                'SELECT id FROM filter_rules WHERE name = ?', (name,)
            ).fetchone()
            if exist:
                skipped += 1
                continue

        max_order += 1
        db.execute(
            'INSERT INTO filter_rules (name, pattern, description, group_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (name, pattern, description, group_name, max_order, ts, ts),
        )
        imported += 1

    db.commit()
    return {'imported': imported, 'skipped': skipped}