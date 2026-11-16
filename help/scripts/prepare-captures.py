#!/usr/bin/env python3
"""Optimize locally captured demo screenshots; Pillow is optional build tooling."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image
root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
records = json.loads((source / 'captures.json').read_text())
for record in records:
    original = source / record['file']
    image = Image.open(original)
    image.thumbnail((1100, 1200))
    target = root / 'docs/assets/screenshots' / (original.stem + '.webp')
    image.save(target, 'WEBP', quality=84, method=6)
    record.update(file=str(target.relative_to(root)), width=image.width, height=image.height,
                  source_sha256=hashlib.sha256(original.read_bytes()).hexdigest(),
                  sha256=hashlib.sha256(target.read_bytes()).hexdigest(), reviewed='2026-11-16')
(root / 'evidence/screenshots.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
print(f'Prepared {len(records)} demonstration screenshots.')
