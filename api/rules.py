import json
import re

from fastapi import APIRouter, HTTPException, UploadFile, Query, Request
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

    # 按组内最小 sort_order 排序目录
    result = []
    for g, rules in groups.items():
        min_order = min(r.get('sort_order', 0) for r in rules)
        result.append({'group_name': g, 'rules': rules, '_min_order': min_order})
    result.sort(key=lambda x: x['_min_order'])
    for item in result:
        del item['_min_order']
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


@router.put('/move')
async def move_rule(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail='请求体不是有效的 JSON')
    rule_id = int(body.get('rule_id', 0))
    target_group = str(body.get('target_group', ''))
    target_order = int(body.get('target_order', 0))

    db = get_db()
    src = db.execute('SELECT * FROM filter_rules WHERE id = ?', (rule_id,)).fetchone()
    if not src:
        raise HTTPException(status_code=404, detail='规则不存在')

    src_group = src['group_name'] or ''
    ts = now_iso()

    tgt = db.execute(
        'SELECT id, sort_order FROM filter_rules WHERE id != ? AND sort_order = ? LIMIT 1',
        (rule_id, target_order),
    ).fetchone()

    if tgt:
        db.execute(
            'UPDATE filter_rules SET sort_order=?, group_name=?, updated_at=? WHERE id=?',
            (tgt['sort_order'], target_group, ts, rule_id),
        )
        db.execute(
            'UPDATE filter_rules SET sort_order=?, updated_at=? WHERE id=?',
            (src['sort_order'], ts, tgt['id']),
        )
    else:
        db.execute(
            'UPDATE filter_rules SET sort_order=?, group_name=?, updated_at=? WHERE id=?',
            (target_order, target_group, ts, rule_id),
        )

    # 源目录如果没有真实规则了，插入占位规则保持目录可见
    if src_group and src_group != target_group:
        remaining = db.execute(
            'SELECT COUNT(*) FROM filter_rules WHERE group_name = ? AND name NOT LIKE ? AND id != ?',
            (src_group, '__group_placeholder__%', rule_id),
        ).fetchone()[0]
        if remaining == 0:
            max_order = db.execute(
                'SELECT COALESCE(MAX(sort_order), -1) + 1 FROM filter_rules'
            ).fetchone()[0]
            db.execute(
                'INSERT INTO filter_rules (name, pattern, description, group_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                (f'__group_placeholder__{src_group}', '.^', '', src_group, max_order, ts, ts),
            )

    # 目标目录如果有占位规则，清理掉
    if target_group and src_group != target_group:
        db.execute(
            'DELETE FROM filter_rules WHERE group_name = ? AND name LIKE ?',
            (target_group, '__group_placeholder__%'),
        )

    db.commit()
    return {'ok': True}


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


@router.delete('/group')
def delete_group(group_name: str = Query('')):
    if not group_name.strip():
        raise HTTPException(status_code=400, detail='目录名称不能为空')
    db = get_db()
    db.execute('DELETE FROM filter_rules WHERE group_name = ?', (group_name.strip(),))
    db.commit()
    return {'ok': True}


@router.delete('/{rule_id}')
def delete_rule(rule_id: int):
    db = get_db()
    existing = db.execute('SELECT id FROM filter_rules WHERE id = ?', (rule_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail='规则不存在')
    db.execute('DELETE FROM filter_rules WHERE id = ?', (rule_id,))
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