---
name: architecture-diagrams
description: >-
  Draw an architecture, system, deployment or topology diagram (架构图, 系统图, 拓扑图, 部署图)
  as a committed Mermaid source plus a handoff-ready draw.io/PNG/SVG, or edit an existing
  .mmd/.drawio diagram. Use when the user asks for a diagram, when a design needs one, or
  when a .mmd or .drawio file has to be rendered, exported or reviewed.
---

# Architecture diagrams: Mermaid is the source, draw.io is the delivery

Two layers, and only one of them is hand-written.

| Path | Role | In git |
|---|---|---|
| `docs/architecture/<system>.mmd` | **The source of truth.** Small, reviewable, readable by any model, renders on GitHub/GitLab as-is. | Yes |
| `docs/architecture/<system>.png` / `.svg` | Generated. What people look at and paste into a PR. | Yes |
| `docs/architecture/<system>.drawio` | Generated. What a human opens to drag boxes or add vendor icons. | Only when a human has hand-tuned it — see below |

## The one rule that keeps this from rotting

Mermaid → draw.io is **one-way**. draw.io imports Mermaid into editable cells; nothing
writes back. So `.drawio` and the images are *products of* the `.mmd`, never a second
source:

- Change the diagram → edit the `.mmd`, regenerate. Never fix the picture.
- A `.drawio` that a human has tuned is an exception, not a habit: rename its page to
  `<system> — hand-tuned, do not regenerate from .mmd` and say so in the PR, so the next
  person knows which of the two is authoritative for that file.
- Never edit the exported PNG/SVG.

## Commands

`drawio` is a wrapper on PATH that carries the flags this container needs (`xvfb-run`,
`--no-sandbox`, `--disable-dev-shm-usage`) — use it, not the raw binary. `--elk` adds
`--normalize` plus ELK layered layout.

```bash
cd docs/architecture
drawio -x -f xml -o order-platform.drawio order-platform.mmd        # 1 s, Mermaid -> cells
drawio --elk -x -f png -e -b 12 -o order-platform.png order-platform.drawio   # 2 s
drawio --elk -x -f svg -e -b 12 -o order-platform.svg order-platform.drawio
```

- `-e` embeds the diagram model in the PNG/SVG/PDF, so an exported PNG can be dragged
  back into app.diagrams.net and edited. Keep it on for anything delivered.
- **`--elk` is not optional.** Without it the export inherits Mermaid's own layout inside
  draw.io styling: edges cut through boxes, subgraph frames collide, labels overlap.
  `DRAWIO_ELK_DIRECTION=DOWN` switches from left-to-right to top-down.
- Never convert `.mmd` straight to PNG with `-e`: current draw.io crashes. Go through
  `.drawio` as above.
- Export costs ~2 s (Electron); don't put it in a loop, and don't regenerate on every turn.

## Writing the Mermaid so the export stays clean

- `flowchart LR` for system/architecture pictures; one direction for the whole diagram.
- Subgraph ids distinct, labels quoted when they contain spaces or punctuation
  (`subgraph box["容器 · tini 为 PID 1"]`). Nest subgraphs for real boundaries
  (platform → cluster → namespace, cloud → VPC → subnet) — they survive the conversion as
  real containers.
- Keep node labels to a few words; put context in the subgraph title or add it by hand in
  the `.drawio`. Long labels fight the layout.
- **Avoid edges that leave a subgraph and come back into it.** ELK routes them around the
  outside of the whole canvas (measured: one such edge wrapped an 11-node diagram top and
  bottom). Moving a node so the edge is internal is the fix, not another flag.
- Style with `classDef`; colours come through the conversion.

## Known limits, say them rather than working around them silently

- The exported SVG writes text as `foreignObject` (68 of them in an 11-node test), so it is
  fine in a browser and in draw.io but **not editable in Figma/Illustrator**. When someone
  asks for an editable file, hand over the `.drawio`.
- Mermaid cannot express vendor stencils (AWS/Azure/network icons) or free placement. If a
  diagram truly needs those, it becomes a hand-tuned `.drawio` — mark it as such.
- The toolchain is local: no accounts, no upload, no network at render time.

## Where the tool comes from

`/usr/local/bin/drawio` → `/scripts/drawio.sh`, which runs
`/opt/drawio-desktop/squashfs-root/drawio` (baked, version pinned in the Dockerfile) under
`xvfb-run` (also baked). If `drawio: … not found` appears, the image predates the draw.io
layer — redeploy instead of installing anything by hand.
