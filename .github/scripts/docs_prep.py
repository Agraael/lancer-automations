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

INDEX_FIXES = {
    "](doc/": "](",
    'src="doc/': 'src="',
    "](extra/": f"]({BLOB}extra/",
    "](scripts/": f"]({BLOB}scripts/",
}

BACKLINKS = {
    "](../../README.md": "](../index.md",
    "](../README.md": "](index.md",
}

DETAILS = re.compile(r"<details(?![^>]*\bmarkdown=)((?:\s[^>]*)?)>")
BANNER = re.compile(r"\A```[^\n]*\n(.*?)\n```", re.S)
OPEN_TAG = re.compile(r'<details markdown="1"([^>]*)>')


def unfence_banner(text):
    m = BANNER.match(text)
    if not m or "█" not in m.group(1):
        return text
    art = m.group(1).rstrip()
    return f'<div class="la-banner-wrap"><pre class="la-banner">{art}</pre></div>' + text[m.end():]


def open_mermaid_details(text):
    edits = []
    for m in OPEN_TAG.finditer(text):
        end = text.find("</details>", m.end())
        block = text[m.end():end if end != -1 else len(text)]
        if "```mermaid" in block and " open" not in m.group(1):
            edits.append((m.start(), m.end(), f'<details markdown="1"{m.group(1)} open>'))
    for start, end, tag in reversed(edits):
        text = text[:start] + tag + text[end:]
    return text


def rewrite(text, is_index):
    rules = INDEX_FIXES if is_index else {**BACKLINKS, **ESCAPES}
    for old, new in rules.items():
        text = text.replace(old, new)
    text = DETAILS.sub(r'<details markdown="1"\1>', text)
    text = open_mermaid_details(text)
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
        md.write_text(rewrite(md.read_text(encoding="utf-8"), False), encoding="utf-8")

    if (OUT / "index.md").exists():
        home = "doc/index.md"
    else:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        (OUT / "index.md").write_text(rewrite(readme, True), encoding="utf-8")
        home = "README.md"

    print(f"prepared {OUT} ({len(list(OUT.rglob('*.md')))} pages, home from {home})")


if __name__ == "__main__":
    main()
