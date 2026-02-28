# github-label-sync

Sync GitHub repository labels from a canonical **source repository** to one or more **target repositories**.

## What it does

- **Sync** label name/color/description from the source repo to target repos
- **Optional deletion** of labels in targets that do not exist in the source
- **Optional ordering** via numeric-prefixed label names (renames labels safely to preserve assignments)
- **Automatic descriptions** for known base label names (with `Extratag*` kept empty)

## Setup

Prerequisites:

- Node.js (the included GitHub Action uses Node `20`)

1. Install dependencies

```bash
npm install
```

2. Create an env file

```bash
copy .env.example .env
```

Set `GITHUB_TOKEN` for local runs.

If you run this from GitHub Actions and need to sync across multiple repositories, store a PAT in repository secret `LABEL_SYNC_TOKEN` (the built-in `GITHUB_TOKEN` is repo-scoped).

Token guidance:

- For **private repos**, the PAT typically needs `repo`
- For **public repos only**, `public_repo` is usually sufficient
- The PAT must be able to **read and write labels** (Issues permissions)

3. Edit `label-sync.yml`

- `source`: canonical labels repository
- `targets`: repositories to sync to
- `options.deleteExtraLabels`: when `true`, labels in targets that are not in the source repo are deleted

Example:

```yml
source:
  owner: your-user-or-org
  repo: your-canonical-labels-repo

targets:
  - owner: your-user-or-org
    repo: target-repo-1
  - owner: your-user-or-org
    repo: target-repo-2

ordering:
  applyToSource: true
  names:
    - "01-important"
    - "02-idea"
    - "20-Extratag1"

options:
  deleteExtraLabels: true
  allowEmptySource: false
```

## Usage

Recommended first run:

- If `options.deleteExtraLabels: true`, run **dry-run** first to confirm what would be created/updated/deleted.

Dry-run (no changes):

```bash
npm run sync -- --dry-run
```

Apply changes:

```bash
npm run sync -- --apply
```

Export labels from the source repo:

```bash
npm run export -- --out labels-export.yml
```

## GitHub Actions

This repo includes a workflow at `.github/workflows/label-sync.yml`:

- Manual run: `Actions` -> `Label Sync` -> `Run workflow`
  - Set `apply=false` for dry-run
  - Set `apply=true` to apply changes
- Scheduled run: weekly (see workflow cron)

The workflow expects repository secret:

- `LABEL_SYNC_TOKEN`: a GitHub PAT with access to the source repo and all targets

Note: the workflow uses `LABEL_SYNC_TOKEN` (not the built-in `GITHUB_TOKEN`) because syncing across multiple repositories requires a PAT.

## Ordering + descriptions

If `ordering.names` is provided:

- Labels are synced in the exact order of `ordering.names` (numeric prefixes provide stable GitHub UI ordering)
- If `ordering.applyToSource: true`, ordering renames are applied to the source repo too
- Renames use GitHub's label rename API so **existing issue/PR label assignments are preserved**
- If a repo contains **both** a base label and the prefixed label (example: both `bug` and `09-bug`), sync stops with an error to avoid splitting assignments
- If `ordering.applyToSource: true` and a label from `ordering.names` is missing in the source repo, it will be created during an apply run (default color: `ededed`).

Descriptions:

- Descriptions are generated from the base name (the part after the `NN-` prefix)
- `Extratag*` labels always get an **empty description**

## Troubleshooting

- **"Source repo has 0 labels"**
  - Add labels to the source repo, or pass `--allow-empty-source` only if you understand the delete risk.
- **"both 'X' and 'NN-X' exist"**
  - Delete/merge one of the two labels in that repo, then re-run.
- **Auth / 404 / permission errors in Actions**
  - Confirm `LABEL_SYNC_TOKEN` exists and can access every repo in `label-sync.yml`.

## Safety

If the source repository has **zero labels**, sync is aborted by default when deletion is enabled. Override with `--allow-empty-source` only if you are absolutely sure.
