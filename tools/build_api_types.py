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

MAIN_FILE = MODULE_ROOT / 'scripts' / 'main.js'

API_BLOCK_RE = re.compile(r'export\s+const\s+\w+API\s*=\s*\{', re.MULTILINE)
# Capture the async keyword so sync members aren't declared as Promise.
FN_DEF_RE_TPL = r'(?:export\s+)?(async\s+)?function\s+{name}\s*\(([^)]*)\)'
ARROW_DEF_RE_TPL = r'(?:export\s+)?(?:const|let|var)\s+{name}\s*=\s*(async\s+)?\(([^)]*)\)\s*=>'
METHOD_DEF_RE_TPL = r'(?:static\s+)?(async\s+)?{name}\s*\(([^)]*)\)\s*\{{'


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


def resolve_import_path(from_path, spec):
    """'./cards.js' relative to from_path -> Path, or None for bare specifiers."""
    if not spec.startswith('.'):
        return None
    target = (from_path.parent / spec).resolve()
    return target if target.exists() else None


def module_exports(path, seen=None):
    """Every name a module exports, following `export * from` and `export {} from` one hop at a time."""
    if seen is None:
        seen = set()
    if path in seen or not path.exists():
        return set()
    seen.add(path)
    src = path.read_text(encoding='utf-8', errors='replace')
    names = set()
    for m in re.finditer(r'export\s+(?:async\s+)?function\s+(\w+)', src):
        names.add(m.group(1))
    for m in re.finditer(r'export\s+(?:const|let|var)\s+(\w+)', src):
        names.add(m.group(1))
    for m in re.finditer(r'export\s+class\s+(\w+)', src):
        names.add(m.group(1))
    # export { a, b as c } [from './x.js']
    for m in re.finditer(r'export\s*\{([^}]*)\}', src):
        for piece in m.group(1).split(','):
            piece = piece.strip()
            if not piece:
                continue
            alias = piece.split(' as ')[-1].strip()
            if re.match(r'^\w+$', alias):
                names.add(alias)
    # export * from './x.js'
    for m in re.finditer(r'export\s*\*\s*from\s*[\'"]([^\'"]+)[\'"]', src):
        target = resolve_import_path(path, m.group(1))
        if target:
            names |= module_exports(target, seen)
    return names


def names_from_object_body(body, path):
    """Shorthand/renamed keys in an object literal, plus `...ns` spreads resolved to that module's exports."""
    names = set()
    # Split on commas as well as newlines: some API objects are written on one line.
    for line in re.split(r'[,\n]', body):
        stripped = line.strip().rstrip(',').rstrip(';').strip()
        if not stripped or stripped.startswith('//') or stripped.startswith('*'):
            continue
        spread = re.match(r'^\.\.\.(\w+)$', stripped)
        if spread:
            ns = spread.group(1)
            src = path.read_text(encoding='utf-8', errors='replace')
            imp = re.search(r'import\s*\*\s*as\s+' + re.escape(ns) + r'\s+from\s*[\'"]([^\'"]+)[\'"]', src)
            if imp:
                target = resolve_import_path(path, imp.group(1))
                if target:
                    names |= module_exports(target)
            continue
        # `foo` (shorthand) or `foo: bar` (renamed)
        m2 = re.match(r'^(\w+)(?:\s*:\s*[\w.]+)?$', stripped)
        if m2:
            names.add(m2.group(1))
    return names


def collect_api_names():
    names = set()
    for path in iter_js_files():
        src = path.read_text(encoding='utf-8', errors='replace')
        for m in API_BLOCK_RE.finditer(src):
            close = find_close(src, m.end() - 1, '{', '}')
            names |= names_from_object_body(src[m.end():close], path)
    # The api object in main.js also carries ~40 literal keys that live in no *API object.
    if MAIN_FILE.exists():
        src = MAIN_FILE.read_text(encoding='utf-8', errors='replace')
        m = re.search(r'\.api\s*=\s*(?:/\*\*.*?\*/\s*)?\(?', src, re.DOTALL)
        if m:
            brace = src.find('{', m.end())
            if brace != -1:
                close = find_close(src, brace, '{', '}')
                names |= names_from_object_body(src[brace + 1:close], MAIN_FILE)
    return {n for n in names if not n.startswith('_')}


def find_function_signature(name):
    """Return (params_str, is_async), or (None, False) when the definition can't be found."""
    esc = re.escape(name)
    patterns = [
        re.compile(FN_DEF_RE_TPL.format(name=esc)),
        re.compile(ARROW_DEF_RE_TPL.format(name=esc)),
        re.compile(METHOD_DEF_RE_TPL.format(name=esc)),
    ]
    for path in iter_js_files():
        src = path.read_text(encoding='utf-8', errors='replace')
        for pattern in patterns:
            m = pattern.search(src)
            if m:
                return m.group(2), bool(m.group(1))
    return None, False


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


def render_signature(name, params, is_async, found):
    ret = 'Promise<any>' if is_async else 'any'
    if not found:
        # Constant, class, or aliased export: declare as a property. `any` stays callable.
        return f'    {name}: any;'
    if any(p[0].startswith('...') for p in params):
        return f'    {name}(...args: any[]): {ret};'
    pieces = []
    for n, opt in params:
        pieces.append(f'{n}{"?" if opt else ""}: any')
    return f'    {name}({", ".join(pieces)}): {ret};'


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
    for seg in flat.split(';'):
        # Drop full-line // comments so a member glued under a `// ── header ──`
        # line isn't skipped along with the comment.
        seg = '\n'.join(l for l in seg.split('\n') if not l.strip().startswith('//'))
        line = seg.strip()
        if not line or line.startswith('*') or line.startswith('/'):
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
        args, is_async = find_function_signature(name)
        params = parse_params(args or '')
        lines.append(render_signature(name, params, is_async, args is not None))
    lines.append('}')
    lines.append('')

    OUTPUT.write_text('\n'.join(lines), encoding='utf-8')
    print(f'Wrote {OUTPUT.relative_to(MODULE_ROOT)} — {len(missing)} new entries '
          f'({len(api_names)} total API names, {len(declared)} already hand-typed).')


if __name__ == '__main__':
    main()
