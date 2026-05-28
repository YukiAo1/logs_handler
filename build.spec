import os
import sys
import shutil

base_dir = SPECPATH

sys.path.insert(0, base_dir)

from config import STATIC_DIR, APP_DIR, TOOLS_DIR

datas = []
if os.path.isdir(STATIC_DIR):
    for root, dirs, files in os.walk(STATIC_DIR):
        for f in files:
            src = os.path.join(root, f)
            dst = os.path.relpath(os.path.dirname(src), STATIC_DIR)
            datas.append((src, os.path.join('static', dst)))

hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops.auto',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan.on',
    'anyio._backends._asyncio',
    'starlette',
    'pydantic',
]

rg_tools = os.path.join(TOOLS_DIR, 'rg.exe')
rg_system = shutil.which('rg') or shutil.which('rg.exe')
rg_path = rg_tools if os.path.isfile(rg_tools) else (rg_system if rg_system else None)
binaries = [(rg_path, '.')] if rg_path else []

a = Analysis(
    ['main.py'],
    pathex=[APP_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='logs_handler',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emplacement=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)