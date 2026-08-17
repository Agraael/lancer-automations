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


def rewrite(text):
    for old, new in ESCAPES.items():
        text = text.replace(old, new)
    text = DETAILS.sub(r'<details markdown="1"\1>', text)
    text = highlight_inline_code(text)
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
        md.write_text(rewrite(md.read_text(encoding="utf-8")), encoding="utf-8")

    print(f"prepared {OUT} ({len(list(OUT.rglob('*.md')))} pages)")


if __name__ == "__main__":
    main()
