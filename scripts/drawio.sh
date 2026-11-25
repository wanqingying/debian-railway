#!/bin/bash
# drawio — draw.io Desktop CLI for this container, baked at /opt/drawio-desktop.
#
# Why a wrapper and not the raw binary: headless export here needs three things that are
# easy to forget and fail confusingly, all measured on 32.7.4 (2026-11-24):
#   xvfb-run                   the Electron export needs an X server; without one it prints
#                              "Missing X server or $DISPLAY … Exiting" and exits 1.
#   --no-sandbox               this container runs as root.
#   --disable-dev-shm-usage    /dev/shm is 62 MB; without it the renderer dies with
#                              "Renderer process gone (crashed)" and writes no file.
#
# `--elk` inserts the layout pass that makes a Mermaid-derived diagram readable:
# `--normalize` (repair the model: file each edge under the nearest common ancestor,
# grow containers that would clip children) plus ELK layered layout. Without it you get
# Mermaid's own layout inside draw.io styling — edges cut through boxes and subgraph
# frames collide.
#
# Usage:
#   drawio -x -f xml -o x.drawio x.mmd                 # Mermaid -> editable .drawio cells
#   drawio --elk -x -f png -e -b 12 -o x.png x.drawio  # -> PNG with the model embedded
#   drawio --elk -x -f svg -e -b 12 -o x.svg x.drawio
#   DRAWIO_ELK_DIRECTION=DOWN drawio --elk …            # top-down instead of left-to-right
#
# Never `.mmd` -> PNG with `-e` in one call: that crashes in current draw.io. Convert
# to `.drawio` first, as above.
set -euo pipefail

BIN=${DRAWIO_BIN:-/opt/drawio-desktop/squashfs-root/drawio}
ELK_DIRECTION=${DRAWIO_ELK_DIRECTION:-RIGHT}

if [ ! -x "$BIN" ]; then
    echo "drawio: $BIN not found — this image was built without the draw.io layer" >&2
    exit 1
fi

layout=()
if [ "${1:-}" = "--elk" ]; then
    shift
    layout=(--normalize --layout "[{\"layout\":\"elkLayered\",\"config\":{\"elk.direction\":\"$ELK_DIRECTION\"}}]")
fi

# Prefer a throwaway X server so an export never draws on the interactive display the
# user is watching over VNC; fall back to the current $DISPLAY when xvfb is unavailable.
launcher=()
if command -v xvfb-run >/dev/null 2>&1; then
    launcher=(xvfb-run -a)
fi

exec "${launcher[@]}" "$BIN" --no-sandbox --disable-dev-shm-usage "${layout[@]}" "$@"
