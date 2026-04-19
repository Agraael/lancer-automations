#!/usr/bin/env bash
# Diff the working copy against the GitHub repo before a release.
# Usage: ./release-diff.sh [--summary]
# Outputs markdown to stdout: per-file change list + unified diffs for modified files.

set -u

REPO="F:/GitHubs/lancer-automations"
LIVE="$(cd "$(dirname "$0")" && pwd)"
SUMMARY_ONLY=0
[ "${1:-}" = "--summary" ] && SUMMARY_ONLY=1

# Exclusions: .git, .gitignore entries, CLAUDE.md (per user request), editor/OS noise
EXCLUDES=(
    --exclude=.git
    --exclude=node_modules
    --exclude=module.zip
    --exclude=.DS_Store
    --exclude=Thumbs.db
    --exclude=.vscode
    --exclude=.vtt_ignore
    --exclude='*.suo'
    --exclude='*.user'
    --exclude=CLAUDE.md
    --exclude=.claude
    --exclude=eslint-report.json
    --exclude=release-diff.sh
    # LevelDB runtime files — change on every Foundry launch, not real source changes
    --exclude=LOG
    --exclude=LOG.old
    --exclude=LOCK
    --exclude=CURRENT
    --exclude='MANIFEST-*'
    --exclude='*.log'
)

if [ ! -d "$REPO" ]; then
    echo "Error: repo not found at $REPO" >&2
    exit 1
fi

modified=()
added=()
deleted=()

while IFS= read -r line; do
    case "$line" in
        "Files "*" differ")
            # "Files A and B differ" -> capture relative path from LIVE
            # Shell parameter expansion to extract the second path (the LIVE side)
            rest="${line#Files }"
            live_path="${rest#* and }"
            live_path="${live_path% differ}"
            rel="${live_path#$LIVE/}"
            modified+=("$rel")
            ;;
        "Only in $REPO"*)
            # File present in repo, absent in live = deleted
            dir="${line#Only in }"
            dir="${dir%%: *}"
            name="${line##*: }"
            rel="${dir#$REPO}"
            rel="${rel#/}"
            [ -n "$rel" ] && rel="$rel/$name" || rel="$name"
            deleted+=("$rel")
            ;;
        "Only in $LIVE"*)
            dir="${line#Only in }"
            dir="${dir%%: *}"
            name="${line##*: }"
            rel="${dir#$LIVE}"
            rel="${rel#/}"
            [ -n "$rel" ] && rel="$rel/$name" || rel="$name"
            added+=("$rel")
            ;;
    esac
done < <(diff -rq "${EXCLUDES[@]}" "$REPO" "$LIVE" 2>/dev/null || true)

echo "# Release diff"
echo
echo "_Working: \`$LIVE\`_"
echo "_Repo: \`$REPO\`_"
echo
echo "## Summary"
echo
echo "- Modified: ${#modified[@]}"
echo "- Added: ${#added[@]}"
echo "- Deleted: ${#deleted[@]}"
echo

if [ "${#modified[@]}" -gt 0 ]; then
    echo "## Modified"
    for f in "${modified[@]}"; do echo "- \`$f\`"; done
    echo
fi

if [ "${#added[@]}" -gt 0 ]; then
    echo "## Added"
    for f in "${added[@]}"; do echo "- \`$f\`"; done
    echo
fi

if [ "${#deleted[@]}" -gt 0 ]; then
    echo "## Deleted"
    for f in "${deleted[@]}"; do echo "- \`$f\`"; done
    echo
fi

if [ "$SUMMARY_ONLY" -eq 1 ]; then
    exit 0
fi

if [ "${#modified[@]}" -gt 0 ]; then
    echo "---"
    echo
    echo "## Diffs"
    echo
    for f in "${modified[@]}"; do
        echo "### \`$f\`"
        echo
        echo '```diff'
        diff -u "$REPO/$f" "$LIVE/$f" || true
        echo '```'
        echo
    done
fi
