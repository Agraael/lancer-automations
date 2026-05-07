#!/usr/bin/env python3
# Generate a loose `.d.ts` declaration for every function exposed on the
# lancer-automations API by scanning `*API` objects in scripts/.
# Hand-tuned signatures in scripts/typing/types.d.ts are NOT overwritten;
# this generator only emits members that aren't already declared there
# (so the rich types win and the generated file fills the gaps).
#
# Run from the module root:
#   python tools/build_api_types.py

import re
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parent.parent
SCAN_DIRS = [MODULE_ROOT / 'scripts']
SKIP_FILES = {'codemirror-hints-data.generated.js'}
SKIP_DIRS = {'typing', 'node_modules', 'tests'}

TYPES_FILE = MODULE_ROOT / 'scripts' / 'typing' / 'types.d.ts'
OUTPUT = MODULE_ROOT / 'scripts' / 'typing' / 'api.generated.d.ts'

API_BLOCK_RE = re.compile(r'export\s+const\s+\w+API\s*=\s*\{', re.MULTILINE)
FN_DEF_RE_TPL = r'(?:export\s+)?(?:async\s+)?function\s+{name}\s*\(([^)]*)\)'


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
            if depth == 0:
                return i
        i += 1
    return i


def iter_js_files():
    for d in SCAN_DIRS:
        if not d.exists():
            continue
        for path in d.rglob('*.js'):
            if path.name in SKIP_FILES:
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            yield path


def collect_api_names():
    names = set()
    for path in iter_js_files():
        src = path.read_text(encoding='utf-8', errors='replace')
        for m in API_BLOCK_RE.finditer(src):
            close = find_close(src, m.end() - 1, '{', '}')
            body = src[m.end():close]
            for line in body.splitlines():
                stripped = line.strip().rstrip(',').rstrip(';').strip()
                if not stripped or stripped.startswith('//') or stripped.startswith('*'):
                    continue
                # Match either `foo` (shorthand) or `foo: bar` (renamed)
                m2 = re.match(r'^(\w+)(?:\s*:\s*\w+)?$', stripped)
                if m2:
                    names.add(m2.group(1))
    return names


def find_function_signature(name):
    pattern = re.compile(FN_DEF_RE_TPL.format(name=re.escape(name)))
    for path in iter_js_files():
        src = path.read_text(encoding='utf-8', errors='replace')
        m = pattern.search(src)
        if m:
            return m.group(1)
    return None


def parse_params(arg_str):
    """Return list of (name, optional) tuples. Drops type annotations from defaults."""
    if not arg_str.strip():
        return []
    # Split top-level commas
    parts = []
    depth = 0
    cur = ''
    for ch in arg_str:
        if ch in '({[':
            depth += 1
        elif ch in ')}]':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())

    out = []
    for p in parts:
        optional = '=' in p
        name = p.split('=')[0].strip()
        # Strip destructuring: `{ a, b }` -> use a synthetic name
        if name.startswith('{') or name.startswith('['):
            name = 'opts'
            optional = optional or True  # destructure with default
        # Rest: `...args` -> keep name without ...
        if name.startswith('...'):
            out.append((name, False))
            continue
        out.append((name, optional))
    return out


def render_signature(name, params):
    if any(p[0].startswith('...') for p in params):
        # Has rest param -> simplest declaration
        return f'    {name}(...args: any[]): Promise<any>;'
    pieces = []
    for n, opt in params:
        pieces.append(f'{n}{"?" if opt else ""}: any')
    return f'    {name}({", ".join(pieces)}): Promise<any>;'


def collect_already_declared():
    """Names already declared inside `interface LancerAutomationsAPI { ... }` in types.d.ts."""
    if not TYPES_FILE.exists():
        return set()
    src = TYPES_FILE.read_text(encoding='utf-8', errors='replace')
    m = re.search(r'interface\s+LancerAutomationsAPI\s*\{', src)
    if not m:
        return set()
    close = find_close(src, m.end() - 1, '{', '}')
    body = src[m.end():close]
    # Strip nested braces (option-bag types) so member-name regex doesn't pick up nested keys.
    flat = ''
    depth = 0
    for ch in body:
        if ch == '{':
            depth += 1
            continue
        if ch == '}':
            depth -= 1
            continue
        if depth == 0:
            flat += ch
    declared = set()
    for line in flat.split(';'):
        line = line.strip()
        if not line or line.startswith('//') or line.startswith('*') or line.startswith('/'):
            continue
        m2 = re.match(r'^(\w+)\s*[(?:]', line)
        if m2:
            declared.add(m2.group(1))
    return declared


def main():
    api_names = collect_api_names()
    declared = collect_already_declared()
    missing = sorted(n for n in api_names if n not in declared)

    lines = [
        '// AUTO-GENERATED by tools/build_api_types.py — do not edit by hand.',
        '// Hand-tuned signatures in types.d.ts override these via interface merging.',
        '// Regenerate after changing *API exports: `python tools/build_api_types.py`',
        '',
        'interface LancerAutomationsAPI {',
    ]
    for name in missing:
        args = find_function_signature(name) or ''
        params = parse_params(args)
        lines.append(render_signature(name, params))
    lines.append('}')
    lines.append('')

    OUTPUT.write_text('\n'.join(lines), encoding='utf-8')
    print(f'Wrote {OUTPUT.relative_to(MODULE_ROOT)} — {len(missing)} new entries '
          f'({len(api_names)} total API names, {len(declared)} already hand-typed).')


if __name__ == '__main__':
    main()
