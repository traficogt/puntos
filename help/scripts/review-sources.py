#!/usr/bin/env python3
"""Record a reviewed source baseline; never invoked automatically by the build."""
import argparse
from datetime import date
import json
from pathlib import Path
from check import HELP, source_lock, read_page, DOCS
parser=argparse.ArgumentParser(description='After manually reviewing affected guides, record their implementation hashes.')
parser.add_argument('--record-reviewed',action='store_true',required=True)
args=parser.parse_args()
file=HELP/'reviewed-sources.json'
old=json.loads(file.read_text()) if file.exists() else {}
file.write_text(json.dumps({'reviewed':str(date.today()),'sources':source_lock(),'button_contracts':old.get('button_contracts',[])},ensure_ascii=False,indent=2)+'\n')
print('Recorded reviewed source hashes. This does not review or rewrite guide content.')
