import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from storage.database import init_db
from config import STATIC_DIR
from api.rules import router as rules_router
from api.files import router as files_router
from api.search import router as search_router
from api.compare import router as compare_router
from api.export import router as export_router
from api.scenarios import router as scenarios_router

_engine_mode: str = 'smart'


class EngineModeRequest(BaseModel):
    mode: str


def get_engine_mode() -> str:
    return _engine_mode


def set_engine_mode(mode: str):
    global _engine_mode
    _engine_mode = mode


def create_app() -> FastAPI:
    init_db()

    app = FastAPI(title='Hi Logs', version='0.1.0')

    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_methods=['*'],
        allow_headers=['*'],
    )

    app.include_router(rules_router)
    app.include_router(files_router)
    app.include_router(search_router)
    app.include_router(compare_router)
    app.include_router(export_router)
    app.include_router(scenarios_router)

    if os.path.isdir(STATIC_DIR):
        app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')

        @app.get('/')
        async def root():
            from fastapi.responses import FileResponse
            return FileResponse(os.path.join(STATIC_DIR, 'index.html'))

    @app.get('/status')
    async def status():
        from engine.rg_search import is_available as rg_avail, fail_reason as rg_reason
        avail = rg_avail()
        return {
            'status': 'ok',
            'rg_available': avail,
            'rg_reason': rg_reason() if not avail else '',
            'engine_mode': _engine_mode,
        }

    @app.post('/api/config/engine')
    async def set_engine(body: EngineModeRequest):
        global _engine_mode
        if body.mode not in ('python', 'rg', 'smart'):
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail='模式必须为 python/rg/smart')
        if body.mode in ('rg', 'smart'):
            from engine.rg_search import is_available as rg_avail
            if not rg_avail():
                from fastapi import HTTPException
                raise HTTPException(status_code=400, detail='rg.exe 未安装，无法使用此模式')
        _engine_mode = body.mode
        return {'engine_mode': _engine_mode}

    @app.get('/api/config/engine')
    async def get_engine():
        from engine.rg_search import is_available as rg_avail
        return {
            'engine_mode': _engine_mode,
            'rg_available': rg_avail(),
        }

    return app