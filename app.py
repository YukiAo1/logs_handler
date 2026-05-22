import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from storage.database import init_db
from api.rules import router as rules_router

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')


def create_app() -> FastAPI:
    init_db()

    app = FastAPI(title='鸿蒙日志分析工具', version='0.1.0')

    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_methods=['*'],
        allow_headers=['*'],
    )

    app.include_router(rules_router)

    if os.path.isdir(STATIC_DIR):
        app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')

        @app.get('/')
        async def root():
            from fastapi.responses import FileResponse
            return FileResponse(os.path.join(STATIC_DIR, 'index.html'))

    return app