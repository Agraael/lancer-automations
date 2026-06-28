#!/usr/bin/env python3
"""Add width/height attributes to SVGs that only declare dimensions via viewBox.

Usage: python tools/normalize_svg_dimensions.py [directory]
Defaults to the LA icons folder. Idempotent.
"""

import re
import sys
from pathlib import Path

VIEWBOX_RE = re.compile(r'viewBox="\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*"')
WIDTH_ATTR_RE = re.compile(r'<svg\b[^>]*\bwidth\s*=')
HEIGHT_ATTR_RE = re.compile(r'<svg\b[^>]*\bheight\s*=')
SVG_OPEN_RE = re.compile(r'(<svg\b)([^>]*?)(\s*/?>)', re.DOTALL)


def normalize(content):
    has_width = bool(WIDTH_ATTR_RE.search(content))
    has_height = bool(HEIGHT_ATTR_RE.search(content))
    if has_width and has_height:
        return content, False

    vb = VIEWBOX_RE.search(content)
    if not vb:
        return content, False

    _, _, vb_w, vb_h = vb.groups()

    def add_attrs(match):
        attrs = match.group(2)
        if not has_width:
            attrs = f' width="{vb_w}"' + attrs
        if not has_height:
            attrs = f' height="{vb_h}"' + attrs
        return f"{match.group(1)}{attrs}{match.group(3)}"

    new_content = SVG_OPEN_RE.sub(add_attrs, content, count=1)
    return new_content, new_content != content


def main():
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "icons"
    if not target.is_dir():
        print(f"error: not a directory: {target}", file=sys.stderr)
        sys.exit(2)

    svgs = sorted(target.rglob("*.svg"))
    if not svgs:
        print(f"no .svg files found under {target}")
        return

    changed = 0
    for path in svgs:
        new_content, did = normalize(path.read_text(encoding="utf-8"))
        if did:
            path.write_text(new_content, encoding="utf-8")
            changed += 1
            print(f"  fixed: {path.relative_to(target)}")

    print(f"\n{changed} of {len(svgs)} SVG(s) normalized in {target}.")


if __name__ == "__main__":
    main()
