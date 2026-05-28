import os
import glob as glob_module

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel

from storage.database import get_db
from storage.models import now_iso
from engine.indexer import FileIndex, index_file, read_raw_line
from engine.parser import parse_line
from config import APP_DIR

router = APIRouter(prefix='/api/files', tags=['files'])


class OpenRequest(BaseModel):
    paths: list[str]
    reload: bool = False


class CloseRequest(BaseModel):
    paths: list[str] | None = None


_file_indexes: dict[str, FileIndex] = {}


def _resolve_paths(paths: list[str]) -> list[str]:
    files = []
    for p in paths:
        p = os.path.normpath(p)
        if os.path.isfile(p):
            if p.lower().endswith(('.log', '.txt')):
                files.append(p)
        elif os.path.isdir(p):
            for ext in ('*.log', '*.txt'):
                for f in glob_module.glob(os.path.join(p, ext)):
                    files.append(os.path.normpath(f))
    return sorted(set(files))


@router.post('/open')
def open_files(body: OpenRequest):
    if body.reload:
        for idx in _file_indexes.values():
            idx.close()
        _file_indexes.clear()

    resolved = _resolve_paths(body.paths)
    if not resolved:
        raise HTTPException(status_code=400, detail='未找到有效的 .log 或 .txt 文件')

    existing = set(_file_indexes.keys())
    new_paths = [p for p in resolved if p not in existing]

    results = []
    for p in resolved:
        if p in _file_indexes:
            idx = _file_indexes[p]
        else:
            try:
                idx = index_file(p)
                _file_indexes[p] = idx
            except (OSError, ValueError, UnicodeError) as e:
                continue
        results.append({
            'path': idx.path,
            'file_size': idx.file_size,
            'total_lines': idx.total_lines,
            'time_start': idx.time_start,
            'time_end': idx.time_end,
        })

    _save_recent(resolved)

    if not results:
        raise HTTPException(status_code=400, detail='文件加载失败，请检查文件是否可读')

    return {
        'files': results,
        'total_files': len(results),
        'total_lines': sum(r['total_lines'] for r in results),
    }


def _save_recent(paths: list[str]):
    db = get_db()
    ts = now_iso()
    for p in paths:
        idx = _file_indexes.get(p)
        if not idx:
            continue
        db.execute(
            'INSERT OR REPLACE INTO recent_files (path, file_size, total_lines, time_range, opened_at) VALUES (?, ?, ?, ?, ?)',
            (
                p,
                idx.file_size,
                idx.total_lines,
                f'{idx.time_start}~{idx.time_end}' if idx.time_start else '',
                ts,
            ),
        )
    db.execute(
        'DELETE FROM recent_files WHERE id NOT IN (SELECT id FROM recent_files ORDER BY opened_at DESC LIMIT 20)'
    )
    db.commit()


@router.get('/info')
def get_info():
    results = []
    for p, idx in _file_indexes.items():
        results.append({
            'path': idx.path,
            'file_size': idx.file_size,
            'total_lines': idx.total_lines,
            'time_start': idx.time_start,
            'time_end': idx.time_end,
        })
    return {'files': results, 'total_files': len(results)}


@router.post('/close')
def close_files(body: CloseRequest = CloseRequest()):
    if body.paths is None:
        for idx in _file_indexes.values():
            idx.close()
        _file_indexes.clear()
    else:
        for p in body.paths:
            p = os.path.normpath(p)
            if p in _file_indexes:
                _file_indexes[p].close()
                del _file_indexes[p]
    return {'ok': True, 'remaining': len(_file_indexes)}


@router.get('/sample')
def sample_lines(path: str = '', offset: int = 0, limit: int = 20):
    path = os.path.normpath(path)
    idx = _file_indexes.get(path)
    if not idx:
        raise HTTPException(status_code=404, detail='文件未加载')
    lines = []
    end = min(offset + limit, idx.total_lines)
    for line_no in range(offset, end):
        raw = read_raw_line(idx, line_no)
        entry = parse_line(raw, line_no, idx.offsets[line_no])
        if entry:
            lines.append({
                'line_no': entry.line_no + 1,
                'date': entry.date,
                'time': entry.time,
                'pid': entry.pid,
                'tid': entry.tid,
                'level': entry.level,
                'tag': entry.tag,
                'message': entry.message,
                'raw': entry.raw,
            })
    return {'lines': lines, 'offset': offset, 'limit': limit, 'total_lines': idx.total_lines}


@router.get('/context')
def context_lines(path: str = '', line_no: int = 1, before: int = 200, after: int = 200):
    path = os.path.normpath(path)
    idx = _file_indexes.get(path)
    if not idx:
        raise HTTPException(status_code=404, detail='文件未加载')
    zero_based = max(0, line_no - 1 - before)
    end = min(line_no - 1 + after + 1, idx.total_lines)
    lines = []
    for ln in range(zero_based, end):
        raw = read_raw_line(idx, ln)
        entry = parse_line(raw, ln, idx.offsets[ln])
        if entry:
            lines.append({
                'line_no': entry.line_no + 1,
                'date': entry.date,
                'time': entry.time,
                'pid': entry.pid,
                'tid': entry.tid,
                'level': entry.level,
                'tag': entry.tag,
                'message': entry.message,
                'raw': entry.raw,
            })
    return {
        'lines': lines,
        'center_line': line_no,
        'total_lines': idx.total_lines,
        'file_path': path,
    }


_upload_dir = os.path.join(APP_DIR, 'uploads')
os.makedirs(_upload_dir, exist_ok=True)


@router.post('/upload')
async def upload_files(files: list[UploadFile] = File(...)):
    saved_paths = []
    for f in files:
        if not f.filename:
            continue
        name = f.filename.replace('\\', '/').split('/')[-1]
        if not name.lower().endswith(('.log', '.txt')):
            continue
        save_path = os.path.join(_upload_dir, name)
        # 先关闭已有的索引和 mmap，避免 Windows 文件锁定
        if save_path in _file_indexes:
            _file_indexes[save_path].close()
            del _file_indexes[save_path]
        content = await f.read()
        with open(save_path, 'wb') as wf:
            wf.write(content)
        saved_paths.append(save_path)
    if not saved_paths:
        raise HTTPException(status_code=400, detail='未找到有效的 .log 或 .txt 文件')
    result = open_files(OpenRequest(paths=saved_paths))
    return result


@router.get('/recent')
def recent_files():
    db = get_db()
    rows = db.execute(
        'SELECT * FROM recent_files ORDER BY opened_at DESC LIMIT 10'
    ).fetchall()
    return [
        {
            'path': r['path'],
            'file_size': r['file_size'],
            'total_lines': r['total_lines'],
            'time_range': r['time_range'],
            'opened_at': r['opened_at'],
        }
        for r in rows
    ]