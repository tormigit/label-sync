# label-sync

Health: yellow
Version: 1.2.0
Summary: GitHub Action that copies labels from this repo to the repos listed in label-sync.yml.
Run: `npm run typecheck && npm run build`, then `node dist/index.js sync --dry-run` (read-only)
Repo: https://github.com/tormigit/label-sync

## Now
- [ ] Turn the weekly workflow back on: GitHub paused it for inactivity (last run 2026-05-24). Actions → Label Sync →
      Enable workflow. Safe: the weekly run is a preview only and changes no labels
- [ ] Two targets have drifted (dry run 2026-10-30): seljeEmail-Contract-Hub (create 1, delete 1) and League4Friends
      (create 1, delete 2). Check them before any "Apply" run; the other five targets are in sync

## Next

## Later

## Done

## Notes
The labels on this GitHub repo are the source; `label-sync.yml` lists the targets and the order. No file holds the
labels. The app's export command writes the live labels to a file if a copy is ever wanted.

Only a manual "Apply" run changes labels. Never apply with `targetMode=discover`: it covers all 31 repos, and most of
them would get the full label set and lose their own labels.
