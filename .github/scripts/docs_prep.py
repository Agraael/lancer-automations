import os
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "doc"
OUT = ROOT / ".docs-build"
BLOB = "https://github.com/Agraael/lancer-automations/blob/main/"

ESCAPES = {
    "](../../extra/": f"]({BLOB}extra/",
    "](../extra/": f"]({BLOB}extra/",
    "](../scripts/": f"]({BLOB}scripts/",
    "](../../scripts/": f"]({BLOB}scripts/",
}

DETAILS = re.compile(r"<details(?![^>]*\bmarkdown=)((?:\s[^>]*)?)>")
BANNER = re.compile(r"\A```[^\n]*\n(.*?)\n```", re.S)
FENCE = re.compile(r"^```.*?^```", re.S | re.M)
INLINE_CODE = re.compile(r"`([^`\n]+)`")


def unfence_banner(text):
    m = BANNER.match(text)
    if not m or "█" not in m.group(1):
        return text
    art = m.group(1).rstrip()
    return f'<div class="la-banner-wrap"><pre class="la-banner">{art}</pre></div>' + text[m.end():]


def _promote(m):
    body = m.group(1)
    if body.startswith("#!") or "\\|" in body:
        return m.group(0)
    if "(" not in body and "{" not in body:
        return m.group(0)
    return f"`#!js {body}`"


def highlight_inline_code(text):
    out = []
    pos = 0
    for fence in FENCE.finditer(text):
        out.append(INLINE_CODE.sub(_promote, text[pos:fence.start()]))
        out.append(fence.group(0))
        pos = fence.end()
    out.append(INLINE_CODE.sub(_promote, text[pos:]))
    return "".join(out)


def build_anchor_map():
    anchors = {}
    for f in sorted(SRC.glob('API_*.md')):
        for name in re.findall(r'<details id="(\w+)"', f.read_text(encoding='utf-8')):
            anchors.setdefault(name, f.name)
    return anchors


ANCHORS = build_anchor_map()
BARE_REF = re.compile(r'(?<!\[)`(api\.)?(\w+)`')
CALL_REF = re.compile(r'(?<!\[)`#!js (await )?(api\.)?(\w+)(\([^`]*\))`')


def linkify(text, prefix):
    def sub_bare(m):
        name = m.group(2)
        if name not in ANCHORS:
            return m.group(0)
        return f'[{m.group(0)}]({prefix}{ANCHORS[name]}#{name})'

    def sub_call(m):
        name = m.group(3)
        if name not in ANCHORS:
            return m.group(0)
        return f'[{m.group(0)}]({prefix}{ANCHORS[name]}#{name})'

    out, pos = [], 0
    for fence in FENCE.finditer(text):
        seg = text[pos:fence.start()]
        out.append(CALL_REF.sub(sub_call, BARE_REF.sub(sub_bare, seg)))
        out.append(fence.group(0))
        pos = fence.end()
    out.append(CALL_REF.sub(sub_call, BARE_REF.sub(sub_bare, text[pos:])))
    return ''.join(out)


ALERT_TYPES = {'NOTE': 'note', 'TIP': 'tip', 'IMPORTANT': 'info',
               'WARNING': 'warning', 'CAUTION': 'danger'}
ALERT_HEAD = re.compile(r'^> \[!(' + '|'.join(ALERT_TYPES) + r')\]\s*$', re.M)


def convert_alerts(text):
    """GitHub `> [!TIP]` blockquote alerts -> Material `!!! tip` admonitions."""
    lines = text.split('\n')
    out, i = [], 0
    while i < len(lines):
        head = ALERT_HEAD.match(lines[i])
        if not head:
            out.append(lines[i])
            i += 1
            continue
        i += 1
        body = []
        while i < len(lines) and lines[i].startswith('>'):
            body.append(lines[i][1:].lstrip(' '))
            i += 1
        out.append(f'!!! {ALERT_TYPES[head.group(1)]}')
        out.append('')
        out.extend(f'    {line}' if line else '' for line in body)
    return '\n'.join(out)


def rewrite(text, prefix=''):
    for old, new in ESCAPES.items():
        text = text.replace(old, new)
    text = DETAILS.sub(r'<details markdown="1"\1>', text)
    text = convert_alerts(text)
    text = highlight_inline_code(text)
    text = linkify(text, prefix)
    return unfence_banner(text)


def link_or_copy(src, dst):
    if src.lower().endswith(".md"):
        shutil.copy2(src, dst)
        return
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(SRC, OUT, copy_function=link_or_copy)

    for md in OUT.rglob("*.md"):
        prefix = '' if md.parent == OUT else '../'
        md.write_text(rewrite(md.read_text(encoding="utf-8"), prefix), encoding="utf-8")

    print(f"prepared {OUT} ({len(list(OUT.rglob('*.md')))} pages)")


if __name__ == "__main__":
    main()
