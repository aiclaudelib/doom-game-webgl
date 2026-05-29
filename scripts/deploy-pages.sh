#!/usr/bin/env bash
# Publish the production build to the `gh-pages` branch (GitHub Pages → "Deploy from a branch").
#
# Repo prerequisite (one-time, in GitHub UI):
#   Settings → Pages → Build and deployment → Source = "Deploy from a branch",
#   Branch = `gh-pages`, folder = `/ (root)`.
#
# Usage: bun run deploy
#   Builds the app, then force-pushes ONLY dist/ (+ .nojekyll) to origin/gh-pages.
#   No dependencies, never commits dist/ to master, and wipes any stale clutter on the
#   branch so it holds nothing but the built site.
set -euo pipefail

BRANCH="gh-pages"
REMOTE="origin"
WORKTREE=".tmp/gh-pages"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SRC_SHA="$(git rev-parse --short HEAD)"

# 1. Build the site → dist/
bun run build

# 2. Worktree tracking the published branch (created from the empty tree on first deploy).
git worktree remove --force "$WORKTREE" 2>/dev/null || true
rm -rf "$WORKTREE"
git fetch "$REMOTE" "$BRANCH" --depth=1 2>/dev/null || true
if git show-ref --verify --quiet "refs/remotes/$REMOTE/$BRANCH"; then
  git worktree add -B "$BRANCH" "$WORKTREE" "$REMOTE/$BRANCH"
else
  EMPTY_TREE=4b825dc642cb6eb9a060e54bf8d69288fbee4904
  INIT="$(git commit-tree "$EMPTY_TREE" -m 'init gh-pages')"
  git worktree add "$WORKTREE" "$INIT"
  git -C "$WORKTREE" checkout -b "$BRANCH"
fi

# 3. Replace branch contents with the fresh build only.
find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -R dist/. "$WORKTREE"/
touch "$WORKTREE/.nojekyll" # disable Jekyll so dotfiles / _dirs are served verbatim

# 4. Commit + push (no-op when the build is byte-identical to what's published).
git -C "$WORKTREE" add -A
if git -C "$WORKTREE" diff --cached --quiet; then
  echo "gh-pages already up to date — nothing to publish."
else
  git -C "$WORKTREE" commit -q -m "deploy from $SRC_SHA"
  git -C "$WORKTREE" push -f "$REMOTE" "$BRANCH"
  echo "Published build ($SRC_SHA) → $REMOTE/$BRANCH."
fi

# 5. Cleanup.
git worktree remove --force "$WORKTREE"
