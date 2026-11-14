#!/usr/bin/env bash
# Mirror the agent-facing reference docs into the baked config tree.
#
# The global prompt (opencode-config/opencode/AGENTS.md) routes a session to
# these docs, and it must not point into a project checkout: the prompt applies
# to every project on the machine, and a path under /workspace/debian-railway
# makes one repo's tree load-bearing for unrelated sessions.
#
# So the canonical text stays in docs/ (reviewed in git), and these copies are
# baked into the image with the rest of opencode-config, then synced to
# $XDG_CONFIG_HOME/opencode/docs/ by entrypoint.sh at every start. Edit docs/,
# then run this script; the copies are artifacts, not a second source.
#
# Only .md is copied. The JSON data files that ai-model-pricing.md refers to
# (docs/models-prices.json, docs/models.dev.json, ~9.6 MB together) stay in the
# repo: they are inputs for regenerating prices, not reading material.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/docs"
dst="$root/opencode-config/opencode/docs"

docs=(
    prompt-skill-tool-design
    railway-cli
    worktrees
    browser-self-check
    interactive-browser
    agent-web-access
    reddit-data-access
    ai-model-pricing
    go-allowance
    a6api
    lark-cli
)

mkdir -p "$dst"
for name in "${docs[@]}"; do
    if [ ! -f "$src/$name.md" ]; then
        echo "missing source: docs/$name.md" >&2
        exit 1
    fi
    cp -p "$src/$name.md" "$dst/$name.md"
done

# Drop copies whose source was removed from the list above, so the mirror
# cannot keep serving a doc that no longer exists.
for f in "$dst"/*.md; do
    [ -e "$f" ] || continue
    base="$(basename "$f" .md)"
    if ! printf '%s\n' "${docs[@]}" | grep -qx "$base"; then
        rm -f "$f"
        echo "pruned stale copy: ${f#"$root/"}"
    fi
done

echo "mirrored ${#docs[@]} docs -> ${dst#"$root/"}"
