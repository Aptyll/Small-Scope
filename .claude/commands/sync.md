Rebase the current branch onto origin/main and push it.

1. `git branch --show-current`. If it prints `main`, stop: "refusing to sync on main".
2. `git fetch origin && git rebase origin/main`.
3. On each conflict, for every conflicted file (`git diff --name-only --diff-filter=U`):
   - `js/world.js` with a conflict inside `genWorld()`: stop mid-rebase. Report the file. Do not touch it.
   - `js/menu.js` at `PATCH_TXT` / `PATCH_NOTES`: keep both notes, ours above main's. Set `PATCH_TXT` to main's value + 0.01. Amend the commit message so its patch name matches.
   - Any other file: keep both sides' intent.
   Remove every conflict marker. `git add` the file.
   Run `for f in js/*.js; do node --check "$f" || exit 1; done`. On failure: stop mid-rebase. Report the file and the error.
   `git rebase --continue`.
4. If a conflict cannot be resolved: stop mid-rebase. Report the file.
5. Never `git rebase --abort`. Never `git reset --hard`.
6. `git push --force-with-lease`. Never `--force`.
7. Report each resolution in one line: `<file>: <what was kept>`.
