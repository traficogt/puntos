#!/usr/bin/env python3
"""Reproducible, credential-free addon zip; --check refuses a stale distribution."""
import hashlib
import io
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
VERSION = '18.0.3.0.0'
TARGET = ROOT / 'dist' / ('pf_pos_connector-%s.zip' % VERSION)
stream = io.BytesIO()
with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted((ROOT / 'pf_pos_connector').rglob('*')):
        if not path.is_file() or '__pycache__' in path.parts or path.suffix not in {'.py','.xml','.csv','.sql','.md','.txt','.js','.scss','.po'}:
            continue
        info = zipfile.ZipInfo(path.relative_to(ROOT).as_posix(), (2026,11,11,0,0,0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
data = stream.getvalue()
if '--check' in sys.argv:
    if not TARGET.exists() or TARGET.read_bytes() != data:
        raise SystemExit('Addon ZIP is stale; run python3 integrations/odoo/build_package.py')
else:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(data)
print('%s  %s' % (hashlib.sha256(data).hexdigest(), TARGET.relative_to(ROOT)))
