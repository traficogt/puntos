#!/usr/bin/env python3
"""Validate public help content, reviewed implementation, navigation and generated URLs."""
from datetime import date
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit
import yaml
ROOT = Path(__file__).resolve().parents[2]
HELP = ROOT / 'help'
DOCS = HELP / 'docs'
MANDATORY = ['## Antes de empezar', '## Paso a paso', '## Qué debe pasar', '## Si algo no funciona', '## Referencia']

def read_page(path):
    value = path.read_text()
    if not value.startswith('---\n'): raise ValueError(f'{path}: missing metadata')
    header, body = value[4:].split('\n---\n', 1)
    return yaml.safe_load(header), body

def sources():
    return sorted({source for page in DOCS.rglob('*.md') for source in read_page(page)[0].get('sources', [])} | {'web/merchant/src/navigation.js', 'web/merchant/src/merchant-navigation.js'})

def source_lock():
    return {source: hashlib.sha256((ROOT/source).read_bytes()).hexdigest() for source in sources()}

def validate_content():
    failures = []
    config = yaml.safe_load((HELP / 'mkdocs.yml').read_text())
    assert config['docs_dir'] == 'docs', 'Only dedicated public help sources may be published'
    nav = []
    def walk(items):
        for item in items:
            for value in item.values():
                if isinstance(value, list): walk(value)
                else: nav.append(value)
    walk(config['nav'])
    actual = {str(p.relative_to(DOCS)) for p in DOCS.rglob('*.md')}
    if len(nav) != len(set(nav)): failures.append('Duplicate pages in navigation')
    if set(nav) != actual: failures.append(f'Navigation/source mismatch: {set(nav)^actual}')
    routes = set(re.findall(r': "([a-z-]+)"', (ROOT/'web/merchant/src/navigation.js').read_text().split('};')[0]))
    covered = set()
    for page in DOCS.rglob('*.md'):
        meta, body = read_page(page)
        name = str(page.relative_to(DOCS))
        for key in ['title','description','reviewed','kind','sources']:
            if not meta.get(key): failures.append(f'{name}: missing {key}')
        reviewed = date.fromisoformat(str(meta['reviewed']))
        if reviewed > date.today() or (date.today()-reviewed).days > 90: failures.append(f'{name}: review date outside the current 90-day window')
        if meta.get('owner_route'): covered.add(meta['owner_route'])
        if meta.get('kind') == 'task':
            for heading in MANDATORY:
                if heading not in body: failures.append(f'{name}: missing {heading}')
            if len(body.split()) < 150: failures.append(f'{name}: insufficient task guidance')
            if '(PuntosFieles, 2026)' not in body or 'PuntosFieles. (2026).' not in body: failures.append(f'{name}: citation/reference pair missing')
            if not re.search(r'^1\. ',body,re.M): failures.append(f'{name}: missing ordered steps')
        if re.search(r'\b(?:TODO|TBD|FIXME|lorem ipsum)\b',body,re.I): failures.append(f'{name}: unfinished text')
        for source in meta.get('sources',[]):
            if not (ROOT/source).is_file(): failures.append(f'{name}: source not found: {source}')
            if not source.startswith(('public/','web/merchant/src/','src/')): failures.append(f'{name}: unexpected source path {source}')
    if routes != covered: failures.append(f'Owner route coverage mismatch: missing {routes-covered}; invalid {covered-routes}')
    lock=json.loads((HELP/'reviewed-sources.json').read_text())
    current=source_lock()
    for source in set(current)|set(lock['sources']):
        if current.get(source)!=lock['sources'].get(source): failures.append(f'Source changed since review: {source}. Review affected guides before recording a new baseline.')
    for contract in lock.get('button_contracts',[]):
        if contract['text'] not in (ROOT/contract['source']).read_text(): failures.append(f'UI label changed: {contract["text"]}')
        if contract['text'] not in (DOCS/contract['page']).read_text(): failures.append(f'Guide no longer names verified label: {contract["text"]}')
    for scene in json.loads((HELP/'evidence/screenshots.json').read_text()):
        path=HELP/scene['file']
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=scene['sha256']: failures.append(f'Screenshot provenance mismatch: {scene["file"]}')
    if failures: raise ValueError('\n'.join(failures))
    return len(actual)

class Links(HTMLParser):
    def __init__(self): super().__init__(); self.links=[]; self.ids=set(); self.h1=0; self.main=0
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if attrs.get('id'): self.ids.add(attrs['id'])
        if tag=='h1': self.h1+=1
        if tag=='main': self.main+=1
        for key in ['href','src']:
            if attrs.get(key): self.links.append(attrs[key])

# Public application contracts; the parent release verifies their server responses.
APP_ROUTES={'/':'index.html','/equipo/ingresar/':'staff-login.html','/equipo/escaner/':'staff.html','/mi-tarjeta/':'customer.html','/privacidad':'privacidad.html','/preferencias-de-mensajes/':'marketing-preferences.html'}
INTEGRATION_ROUTES={'/soporte','/estado','/calculadora','/guias/'}

def validate_output(site):
    parsed={}
    for path in site.rglob('*.html'):
        parser=Links(); parser.feed(path.read_text()); parsed[path]=parser
        if parser.main!=1 or parser.h1!=1: raise ValueError(f'{path}: expected one main landmark and one h1')
        if re.search(r'<(?:script|style)(?:>|\s(?![^>]*\bsrc=))',path.read_text()):
            # Inline scripts/styles are forbidden so the site works with PF CSP.
            if re.search(r'<style\b|<script(?![^>]*\bsrc=)[^>]*>',path.read_text()): raise ValueError(f'{path}: inline executable content')
    issues=[]
    merchant_routes=set(re.findall(r': "([a-z-]+)"',(ROOT/'web/merchant/src/navigation.js').read_text().split('};')[0]))
    for path,parser in parsed.items():
        for link in parser.links:
            url=urlsplit(link)
            if url.scheme in ['mailto','tel','https','http']: continue
            if url.scheme: issues.append(f'{path}: unexpected scheme {link}');continue
            urlpath=unquote(url.path)
            if urlpath.startswith('/ayuda/'):
                target=site/urlpath.removeprefix('/ayuda/')
            elif urlpath.startswith('/negocio/'):
                if url.fragment and url.fragment not in merchant_routes:issues.append(f'{path}: unknown owner route {link}')
                continue
            elif urlpath in INTEGRATION_ROUTES:continue
            elif urlpath in APP_ROUTES:target=ROOT/'public'/APP_ROUTES[urlpath]
            elif urlpath.startswith('/'):target=ROOT/'public'/urlpath.lstrip('/')
            elif not urlpath:target=path
            else:target=path.parent/urlpath
            if target.is_dir():target=target/'index.html'
            if not target.exists():issues.append(f'{path}: missing target {link}');continue
            if url.fragment and target.suffix=='.html':
                if target not in parsed:
                    other=Links();other.feed(target.read_text());parsed_target=other
                else:parsed_target=parsed[target]
                if unquote(url.fragment) not in parsed_target.ids:issues.append(f'{path}: missing anchor {link}')
    index=json.loads((site/'search/search_index.json').read_text())
    if index['config'].get('min_search_length')!=2 or index['config'].get('lang')!=['es']:issues.append('Search must support Spanish and two-character queries')
    if len({d['location'].split('#')[0] for d in index['docs']}) != len(list(DOCS.rglob('*.md'))):issues.append('Search does not cover every help page')
    if list(site.rglob('*.md')) or list(site.rglob('*.py')) or list(site.rglob('reviewed-sources.json')):issues.append('Private/build sources leaked into generated site')
    if issues:raise ValueError('\n'.join(issues))
    return len(parsed)

if __name__=='__main__':
    try:
        count=validate_content()
        if len(sys.argv)>1: validate_output(Path(sys.argv[1]).resolve())
        routes=len(set(re.findall(r': "([a-z-]+)"',(ROOT/'web/merchant/src/navigation.js').read_text().split('};')[0])))
        print(f'PASS {count} pages: navigation, {routes} owner routes, citations, source freshness and screenshot provenance'+('; generated links, anchors, semantics and search' if len(sys.argv)>1 else ''))
    except (ValueError,AssertionError,KeyError) as error:
        print(f'FAIL {error}',file=sys.stderr);sys.exit(1)
