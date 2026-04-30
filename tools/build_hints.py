#!/usr/bin/env python3
# Run from the module root: python tools/build_hints.py

import json
import re
from datetime import datetime, timezone
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parent.parent

SCAN_DIRS = [
    MODULE_ROOT / 'scripts',
    MODULE_ROOT / 'scripts' / 'interactive',
    MODULE_ROOT / 'scripts' / 'tah',
    MODULE_ROOT / 'scripts' / 'alt-struct',
    MODULE_ROOT / 'scripts' / 'filters',
]
SKIP_FILES = {'codemirror-hints.js', 'codemirror-hints-data.js'}
SKIP_DIRS  = {'typing', 'node_modules'}

DOC_DIR = MODULE_ROOT / 'doc'
DOC_FILES = ['API_REFERENCE.md', 'API_COMBAT.md', 'API_EFFECTS.md', 'API_INTERACTIVE.md', 'API_HOWTO.md']
DETAILS_RE = re.compile(
    r'<details>\s*<summary><b><code>(\w+)</code></b>[^\n]*\n([\s\S]*?)</details>',
    re.IGNORECASE,
)

OPTION_PARAM_NAMES = ['options', 'opts', 'config', 'extraOptions', 'extraData']
OUTPUT = Path(__file__).resolve().parent / 'codemirror-hints-data.generated.js'

FN_RE = re.compile(r'^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(', re.MULTILINE)
STATIC_METHOD_RE = re.compile(r'^[ \t]+static\s+(?:async\s+)?(\w+)\s*\(', re.MULTILINE)
API_BLOCK_RE = re.compile(r'export\s+const\s+\w+API\s*=\s*\{')
JSDOC_BLOCK_RE = re.compile(r'/\*\*[\s\S]*?\*/|/\*[\s\S]*?\*/')
WS_RE = re.compile(r'\s+')
RETURNS_TAG_RE = re.compile(r'@returns?\s*\{')


def _extract_braced(src, open_idx):
    depth = 1
    i = open_idx + 1
    n = len(src)
    while i < n and depth > 0:
        c = src[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return src[open_idx + 1:i]
        i += 1
    return src[open_idx + 1:i]


def iter_js_files():
    seen = set()
    for d in SCAN_DIRS:
        if not d.exists():
            continue
        for path in d.rglob('*.js'):
            if path.name in SKIP_FILES:
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if path in seen:
                continue
            seen.add(path)
            yield path


def find_close(src, open_idx, open_ch, close_ch):
    depth = 1
    i = open_idx + 1
    n = len(src)
    while i < n and depth > 0:
        c = src[i]
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
        i += 1
    return i


def clean_args(args):
    s = JSDOC_BLOCK_RE.sub('', args)
    return WS_RE.sub(' ', s).strip()


def extract_schema_keys(body, param_name):
    pattern = re.compile(
        r'(?:const|let|var)\s*\{([^}]+)\}\s*=\s*' + re.escape(param_name) + r'\b'
    )
    m = pattern.search(body)
    if not m:
        return None
    keys = []
    for raw in m.group(1).split(','):
        k = raw.split('=')[0].split(':')[0].strip()
        if k:
            keys.append(k)
    return keys


def _find_jsdoc_block(src, start_idx):
    end = src.rfind('*/', 0, start_idx)
    if end == -1:
        return None
    between = src[end + 2:start_idx]
    if between.strip():
        return None
    begin = src.rfind('/**', 0, end)
    if begin == -1:
        return None
    return src[begin:end + 2]


def extract_returns_from_jsdoc(src, start_idx):
    block = _find_jsdoc_block(src, start_idx)
    if not block:
        return ''
    m = RETURNS_TAG_RE.search(block)
    if not m:
        return ''
    inside = _extract_braced(block, m.end() - 1)
    return WS_RE.sub(' ', inside).strip()


_JSDOC_LINE_RE = re.compile(r'^\s*\*\s?', re.MULTILINE)
_JSDOC_TAG_RE = re.compile(r'^\s*@\w+', re.MULTILINE)
_PARAM_LINE_RE = re.compile(
    r'@param\s*'
    r'(?:\{([^}]+)\}\s*)?'
    r'(\[?[\w$.]+(?:=[^\]]*)?\]?)\s*'
    r'(?:-\s*)?'
    r'([^\n@]*)'
)


def extract_summary_and_params(src, start_idx):
    block = _find_jsdoc_block(src, start_idx)
    if not block:
        return '', []
    inner = block[3:-2]
    cleaned = _JSDOC_LINE_RE.sub('', inner).strip()

    first_tag = _JSDOC_TAG_RE.search(cleaned)
    summary = cleaned[:first_tag.start()].strip() if first_tag else cleaned.strip()
    summary = WS_RE.sub(' ', summary)

    params = []
    for m in _PARAM_LINE_RE.finditer(cleaned):
        ptype, pname, pdesc = m.group(1), m.group(2), m.group(3)
        clean_name = pname.strip().lstrip('[').split('=')[0].rstrip(']').strip()
        params.append({
            'name': clean_name,
            'type': WS_RE.sub(' ', (ptype or '').strip()),
            'desc': WS_RE.sub(' ', pdesc.strip()),
        })
    return summary, params


CODE_MENTION_RE = re.compile(r'<code>(\w+)</code>|api\.(\w+)\s*\(|`(\w+)\s*\(')


def extract_doc_index(known_names):
    docs = {}
    refs = {}
    for fname in DOC_FILES:
        path = DOC_DIR / fname
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8')
        for m in DETAILS_RE.finditer(text):
            name = m.group(1)
            snippet = m.group(0)
            line = text.count('\n', 0, m.start()) + 1
            if name in docs:
                continue
            docs[name] = {'file': fname, 'line': line, 'snippet': snippet}
        for m in CODE_MENTION_RE.finditer(text):
            name = m.group(1) or m.group(2) or m.group(3)
            if not name or name in refs or name in docs:
                continue
            if name not in known_names:
                continue
            line = text.count('\n', 0, m.start()) + 1
            refs[name] = {'file': fname, 'line': line}
    return docs, refs


def extract_api_surface(src):
    names = set()
    for m in API_BLOCK_RE.finditer(src):
        open_idx = src.find('{', m.start() + len(m.group(0)) - 1)
        if open_idx == -1:
            continue
        close_idx = find_close(src, open_idx, '{', '}')
        block = src[open_idx + 1:close_idx - 1]
        for raw in block.split(','):
            name = raw.split(':')[0].strip()
            if re.fullmatch(r'[A-Za-z_]\w*', name):
                names.add(name)
    return names


def parse_declaration(src, m, manifest_raw, schemas):
    name = m.group(1)
    open_paren = src.find('(', m.start() + len(m.group(0)) - 1)
    if open_paren == -1:
        return
    close_paren = find_close(src, open_paren, '(', ')')
    raw_args = src[open_paren + 1:close_paren - 1]
    args = '(' + clean_args(raw_args) + ')'

    open_brace = src.find('{', close_paren)
    if open_brace == -1:
        return
    close_brace = find_close(src, open_brace, '{', '}')
    body = src[open_brace + 1:close_brace - 1]

    returns = extract_returns_from_jsdoc(src, m.start())
    summary, params = extract_summary_and_params(src, m.start())
    manifest_raw.append({
        'name':    name,
        'args':    args,
        'returns': returns,
        'summary': summary,
        'params':  params,
    })

    for p_name in OPTION_PARAM_NAMES:
        if not re.search(r'\b' + re.escape(p_name) + r'\b', raw_args):
            continue
        keys = extract_schema_keys(body, p_name)
        if keys:
            schemas[f'{name}.{p_name}'] = [[k, ''] for k in keys]


def main():
    manifest_raw = []
    schemas = {}
    api_surface = set()

    for path in iter_js_files():
        src = path.read_text(encoding='utf-8')
        api_surface.update(extract_api_surface(src))

        for m in FN_RE.finditer(src):
            parse_declaration(src, m, manifest_raw, schemas)
        for m in STATIC_METHOD_RE.finditer(src):
            parse_declaration(src, m, manifest_raw, schemas)

    known_names = {e['name'] for e in manifest_raw}
    docs, refs = extract_doc_index(known_names)

    by_name = {}
    for e in manifest_raw:
        existing = by_name.get(e['name'])
        if existing:
            existing_score = (bool(existing['returns']), bool(existing['summary']), len(existing['params']))
            new_score = (bool(e['returns']), bool(e['summary']), len(e['params']))
            if existing_score >= new_score:
                continue
        by_name[e['name']] = e
    sorted_entries = sorted(by_name.values(), key=lambda e: e['name'])
    annotated = [
        {
            'name':         e['name'],
            'args':         e['args'],
            'returns':      e['returns'],
            'summary':      e['summary'],
            'params':       e['params'],
            'inApiSurface': e['name'] in api_surface,
            'hasDoc':       e['name'] in docs or e['name'] in refs,
        }
        for e in sorted_entries
    ]
    surface_arr = sorted(api_surface)

    lines = []
    lines.append('// AUTO-GENERATED by tools/build_hints.py — do not edit by hand.')
    lines.append(f'// Generated {datetime.now(timezone.utc).isoformat()}')
    lines.append('')
    lines.append('export const AUTO_API_MANIFEST = [')
    for e in annotated:
        params_json = ', '.join(
            f'{{ name: {json.dumps(p["name"])}, '
            f'type: {json.dumps(p["type"])}, '
            f'desc: {json.dumps(p["desc"])} }}'
            for p in e['params']
        )
        lines.append(
            f'    {{ name: {json.dumps(e["name"])}, '
            f'args: {json.dumps(e["args"])}, '
            f'returns: {json.dumps(e["returns"])}, '
            f'summary: {json.dumps(e["summary"])}, '
            f'params: [{params_json}], '
            f'hasDoc: {"true" if e["hasDoc"] else "false"}, '
            f'inApiSurface: {"true" if e["inApiSurface"] else "false"} }},'
        )
    lines.append('];')
    lines.append('')
    lines.append('export const AUTO_API_SURFACE = new Set([')
    for n in surface_arr:
        lines.append(f'    {json.dumps(n)},')
    lines.append(']);')
    lines.append('')
    lines.append('export const AUTO_OPTION_SCHEMAS = {')
    for key in sorted(schemas):
        formatted = ', '.join(
            f'[{json.dumps(k)}, {json.dumps(t)}]' for k, t in schemas[key]
        )
        lines.append(f'    {json.dumps(key)}: [{formatted}],')
    lines.append('};')
    lines.append('')

    lines.append('export const AUTO_DOC_INDEX = {')
    for name in sorted(docs):
        d = docs[name]
        lines.append(
            f'    {json.dumps(name)}: {{ '
            f'file: {json.dumps(d["file"])}, '
            f'line: {d["line"]}, '
            f'snippet: {json.dumps(d["snippet"])} '
            f'}},'
        )
    lines.append('};')
    lines.append('')

    lines.append('export const AUTO_DOC_REF = {')
    for name in sorted(refs):
        d = refs[name]
        lines.append(
            f'    {json.dumps(name)}: {{ '
            f'file: {json.dumps(d["file"])}, '
            f'line: {d["line"]} '
            f'}},'
        )
    lines.append('};')
    lines.append('')

    OUTPUT.write_text('\n'.join(lines), encoding='utf-8')

    surface_count = sum(1 for e in annotated if e['inApiSurface'])
    returns_count = sum(1 for e in annotated if e['returns'])
    doc_count = sum(1 for e in annotated if e['hasDoc'])
    missing_returns = [
        e['name'] for e in annotated
        if e['inApiSurface'] and not e['returns'] and e['args'] not in ('()', '(...)')
    ]
    missing_docs = [e['name'] for e in annotated if e['inApiSurface'] and not e['hasDoc']]
    rel = OUTPUT.relative_to(MODULE_ROOT)
    print(f'Wrote {rel}')
    print(f'  {len(annotated)} manifest entries ({surface_count} on the API surface)')
    print(f'  {returns_count} entries with @returns')
    print(f'  {doc_count} entries with doc snippets ({len(docs)} doc entries indexed)')
    print(f'  {len(api_surface)} *API surface names')
    print(f'  {len(schemas)} option-schema entries')
    print()
    print(f'API-surface functions missing doc snippet ({len(missing_docs)}):')
    for n in missing_docs[:20]:
        print(f'  {n}')
    if len(missing_docs) > 20:
        print(f'  ... ({len(missing_docs) - 20} more)')
    print()
    print(f'API-surface functions missing @returns ({len(missing_returns)}):')
    for n in missing_returns:
        print(f'  {n}')


if __name__ == '__main__':
    main()
