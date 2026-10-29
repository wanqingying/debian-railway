# Worktrees on the volume

Every worktree in this container lives under **`/workspace/worktrees`** (`$WORKTREE_ROOT`). Nothing else is allowed, because `/workspace` is the only mounted volume.

## Why

Railway rebuilds the root filesystem from the image on every redeploy. `/tmp`, `/var/tmp`, `/root`, `/run`, `/usr` come back empty, and `/root` does not even keep a home directory.

A worktree is not scratch space — it is a **session's working directory**. When it disappears:

1. the session still points at the old path;
2. the next turn fails immediately with `Directory not found: <path>` (`idle.outcome = failed`);
3. nothing can resume it until a checkout exists at that path again;
4. any uncommitted change in that worktree is gone for good — gitignored files (`.env*`, `node_modules`) included.

Measured cost of getting this wrong once (2026-10-29): a worktree at `/tmp/opencode/product-binding` was wiped by a redeploy during an active turn. The session sat unusable for 13 hours, and the matrix fix it had just written had to be re-applied by hand.

## Layout

```text
/workspace/worktrees/
├── product-binding/        # branch feat/product-binding-top-ads (joops)
├── fix-ssh-timeout/        # branch fix/ssh-timeout (debian-railway)
└── feat/
    └── review-evals/       # branches containing "/" get nested one level
```

The directory name is the branch name. The repository is identified by the worktree's `.git` file, and `git -C /workspace/worktrees/<name> worktree list` shows every sibling of that repository.

## Creating one

```bash
wt new feat/webhooks          # branch feat/webhooks from origin/HEAD → /workspace/worktrees/feat/webhooks
wt new hotfix/x origin/main   # explicit base ref
wt list                       # this repository's worktrees
wt remove feat/webhooks       # remove, then prune stale records
wt prune                      # drop records whose directory is gone
```

`wt` is `scripts/worktree.sh`, baked to `/scripts/worktree.sh` and symlinked to `/usr/local/bin/wt` at boot. Behaviour worth knowing:

- **It refuses a root outside `/workspace`** (`WORKTREE_ROOT=/tmp/x wt …` → exit 1, with the reason). That guard, not discipline, is the point of the wrapper.
- Base ref defaults to `origin/HEAD`, then `origin/main`, then the current branch.
- A branch that already exists (local, or `origin/<branch>`) is **reused**, not recreated.
- A new branch is created with `--no-track`, so a plain `git push` cannot accidentally target `main`.
- It warns when the *repository* is itself outside the volume, which is the same failure one level up.

OpenChamber's own **New worktree** button honours `worktree.directory` from `opencode.jsonc`, which this image sets to `/workspace/worktrees` — so the UI and `wt` produce worktrees in the same place, with the same naming. After creating one, a new session starts there, or an existing session moves with the `session_move` tool.

## Restoring a session whose directory vanished

```bash
cd /workspace/<repo>
git fetch origin <branch>
git worktree add -B <branch> /workspace/worktrees/<name> origin/<branch>   # or: wt new <branch>
```

Then point the session at the new directory (OpenChamber: the tool/panel action that moves a session; CLI: the session's `directory`), and re-create what git does not track:

- `pnpm install --frozen-lockfile` (or `npm ci`) — a fresh worktree has no `node_modules`;
- `uv sync` for Python projects;
- `.env*` files, copied from the primary checkout (`/workspace/<repo>`), since they are gitignored.

## Verification

```bash
wt path                                   # /workspace/worktrees
git worktree list                         # no "prunable" entries
node --input-type=module -e "import { readWorktreeDirectorySetting } from '/usr/lib/node_modules/@openchamber/web/server/lib/opencode/shared.js'; console.log(readWorktreeDirectorySetting('/workspace/joops'))"
```

The last line is what OpenChamber resolves for a project: it must print `/workspace/worktrees`. `previewWorktreeCreate(directory, {name})` from `server/lib/git/service.js` shows the exact path the UI button would use, without creating anything.

## Pitfalls

- **Changing `worktree.directory` does not move existing worktrees.** They stay where they are; only new ones follow the setting.
- **OpenChamber's data-dir root is the legacy default** (`$XDG_DATA_HOME/opencode/worktree/<projectID>/`). Worktrees created before this setting are still there, also on the volume — harmless, but do not confuse the two.
- **`~` is not a volume.** `/root` is ephemeral, so `worktree.directory: "~/trees"` would rebuild the same trap.
- **A session moved out of a deleted directory cannot be "fixed" by recreating an unrelated one**: `git worktree add` the *same branch* at the *same path*, or move the session; do not create a fresh empty directory to silence the error.
