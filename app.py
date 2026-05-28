import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from storage.database import init_db
from config import STATIC_DIR
from api.rules import router as rules_router
from api.files import router as files_router
from api.search import router as search_router
from api.compare import router as compare_router
from api.export import router as export_router
from api.scenarios import router as scenarios_router


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

    return app