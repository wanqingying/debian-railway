#!/bin/bash
# wt -- create and manage git worktrees on the persistent volume.
#
# A worktree is a session's working directory. /workspace is the only path that
# survives a redeploy: /tmp, /root, /var/tmp and the rest of the root filesystem
# are rebuilt from the image every time. A worktree created in one of those
# disappears, and every session whose directory pointed at it then fails with
# "Directory not found: <path>" and cannot be resumed.
set -euo pipefail

WORKTREE_ROOT="${WORKTREE_ROOT:-/workspace/worktrees}"
WORKTREE_ROOT="${WORKTREE_ROOT%/}"

die() { echo "wt: $*" >&2; exit 1; }

# Hard guard: refuse a root that a redeploy would wipe.
case "$WORKTREE_ROOT" in
    /workspace | /workspace/*) ;;
    *)
        die "WORKTREE_ROOT=$WORKTREE_ROOT is not on the mounted volume (it must be /workspace/...);"$'\n'"    a redeploy rebuilds every other path and strands the sessions that point at it"
        ;;
esac

usage() {
    cat <<'EOF'
wt -- git worktrees on the persistent volume

  wt new <branch> [base-ref]   create $WORKTREE_ROOT/<branch>
  wt list                      this repository's worktrees
  wt remove <branch|path>      remove a worktree, then prune stale records
  wt prune                     drop records for worktrees whose directory is gone
  wt path                      print WORKTREE_ROOT

<branch> may contain slashes (feat/x creates $WORKTREE_ROOT/feat/x).
base-ref defaults to origin/HEAD, else origin/main, else the current branch.
An existing branch (local or origin/<branch>) is reused instead of recreated.
EOF
}

repo_root() {
    git rev-parse --show-toplevel 2>/dev/null || die "not inside a git repository"
}

cmd_new() {
    local branch="${1:-}" base="${2:-}" root dest
    [ -n "$branch" ] || die "wt new needs a branch name"
    root="$(repo_root)"
    dest="$WORKTREE_ROOT/$branch"
    [ -e "$dest" ] && die "$dest already exists"

    if [ -z "$base" ]; then
        if git remote get-url origin >/dev/null 2>&1; then
            base="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
        else
            base="$(git rev-parse --abbrev-ref HEAD)"
        fi
    fi

    # The worktree is safe either way, but a repository kept outside the volume
    # is itself wiped on the next redeploy.
    case "$root" in
        /workspace | /workspace/*) ;;
        *) echo "wt: warning: $root is outside the volume; the repository itself will vanish on the next redeploy" >&2 ;;
    esac

    if git show-ref --verify --quiet "refs/heads/$branch"; then
        git worktree add "$dest" "$branch"
    elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
        git worktree add --track -b "$branch" "$dest" "origin/$branch"
    else
        # --no-track: a new branch must not inherit base-ref as its upstream, or a
        # plain `git push` would aim at main.
        git worktree add --no-track -b "$branch" "$dest" "$base"
    fi
    echo "wt: $dest  (base: $base)"
}

cmd_remove() {
    local target="${1:-}" dest
    [ -n "$target" ] || die "wt remove needs a branch or an absolute path"
    case "$target" in
        /*) dest="$target" ;;
        *) dest="$WORKTREE_ROOT/$target" ;;
    esac
    git worktree remove "$dest"
    git worktree prune
    echo "wt: removed $dest"
}

case "${1:-}" in
    new) shift; cmd_new "$@" ;;
    list | ls) git worktree list ;;
    remove | rm) shift; cmd_remove "$@" ;;
    prune) git worktree prune -v ;;
    path) echo "$WORKTREE_ROOT" ;;
    "" | -h | --help | help) usage ;;
    *) die "unknown command: $1 (try: wt --help)" ;;
esac
