# label-sync

Stage: Maintenance
Health: green
Version: 1.2.0
Summary: GitHub Action that copies labels from this repo to the repos listed in label-sync.yml.
Run: `npm run typecheck && npm run build`, then `node dist/index.js sync --dry-run` (read-only)
Repo: https://github.com/tormigit/label-sync

## Now

## Next

## Later

## Done
- [x] Weekly workflow turned back on after GitHub paused it; the scheduled preview ran fine on 2026-11-01

## Notes
The labels on this GitHub repo are the source; `label-sync.yml` lists the targets and the order. No file holds the
labels. The app's export command writes the live labels to a file if a copy is ever wanted.

Repos moved to the `tormigit-archive` account are no longer followed: take them out of `label-sync.yml` (GitHub's
redirect from the old name hides the move). Discover mode only lists repos owned by `tormigit`, so it skips them.

Differences the preview shows between a target and the source are not tasks: Tormod picks per repo which labels to
sync.

Only a manual "Apply" run changes labels. Never apply with `targetMode=discover`: it covers all 31 repos, and most of
them would get the full label set and lose their own labels.
