# github-label-sync

Easy Sync GitHub repository labels from a canonical **source repository** to one or more **target repositories**.

## What it does

- **Sync** label name/color/description from the source repo to target repos
- **Optional deletion** of labels in targets that do not exist in the source
- **Optional ordering** via numeric-prefixed label names (renames labels safely to preserve assignments)
- **Automatic descriptions** for known base label names (with `Extratag*` kept empty)

Support this project: [Donate via Stripe](https://buy.stripe.com/fZuaEX1gYckd4xrcUWbQY0j)
50% of the earnings goes to support Ukraine!

## Quickstart (GitHub Actions)

Recommended approach:

- Make this repo a **template repository** and click **Use this template** to create your own label-sync automation repo.
  - If you do not see the template button, **Fork** also works.

## Using this repo as a template

If you are the owner of this repository and you want others to easily reuse it:

- GitHub -> `Settings` -> `General` -> enable **Template repository**

If you are using this project for your own automation:

- Click **Use this template** to create your own repo
- Update `label-sync.yml` in your copy (source/targets/options)
- Add the `LABEL_SYNC_TOKEN` secret in your copy

Steps:

1. Create your automation repo
   - Click **Use this template** (recommended)

2. Add `LABEL_SYNC_TOKEN` secret
   - Create a GitHub PAT that can access the **source repo** and all **target repos**
   - In your automation repo: `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`
   - Name it `LABEL_SYNC_TOKEN`

3. Configure `label-sync.yml`
   - Set `source` and `targets`
   - (Optional) set `ordering.names` to enforce GitHub UI ordering

4. Run the workflow
   - `Actions` -> `Label Sync` -> `Run workflow`
     - Set `mode=Dry run (preview only)` to preview changes
     - Set `mode=Apply (keep changed or added labels)` to apply changes while keeping manually added labels in targets
     - Set `mode=Apply (mirror source)` to apply changes and delete labels in targets that are not in the source

The workflow file is at `.github/workflows/label-sync.yml`.

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
    - "03-documentation"
    - "04-improvement"
    - "05-not Important"
    - "06-Wordpress demand"
    - "07-Pro-version"
    - "08-Milestone"
    - "09-bug"
    - "10-help wanted"
    - "11-question"
    - "12-wontfix"
    - "13-duplicate"

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

To override deletion behavior (local runs):

```bash
npm run sync -- --apply --delete-extra false
```

Export labels from the source repo:

```bash
npm run export -- --out labels-export.yml
```

## GitHub Actions

This repo includes a workflow at `.github/workflows/label-sync.yml`:

- Manual run: `Actions` -> `Label Sync` -> `Run workflow`
  - Set `mode=Dry run (preview only)` to preview changes (no changes are made)
  - Set `mode=Apply (keep changed or added labels)` to apply changes while keeping manually added labels in target repos
  - Set `mode=Apply (mirror source)` to apply changes and delete labels in targets that are not in the source repo
- Scheduled run: weekly (see workflow cron)

The workflow expects repository secret:

- `LABEL_SYNC_TOKEN`: a GitHub PAT with access to the source repo and all targets

Note: the workflow uses `LABEL_SYNC_TOKEN` (not the built-in `GITHUB_TOKEN`) because syncing across multiple repositories requires a PAT.

Recommended usage pattern:

- First cleanup run (standardize repos):
  - `mode=Apply (mirror source)`
- Later maintenance runs (keep manual labels in targets):
  - `mode=Apply (keep changed or added labels)`

Notes:

- `mode=Apply (keep changed or added labels)` does not delete labels that only exist in target repos.
- `mode=Apply (mirror source)` deletes labels in targets that are not present in the source repo.
- In target repos, labels `Extratag1` through `Extratag5` are treated as protected/unmanaged: they are not created, updated, renamed, or deleted by the workflow (even in delete mode).

## Security notes for public repos

- Do **not** commit tokens. Store PATs in GitHub repository secrets (like `LABEL_SYNC_TOKEN`).
- If you make this repo public, your `label-sync.yml` contents (including your repo list) are public too.
- Prefer least privilege for your PAT:
  - If you only sync public repos, `public_repo` is usually sufficient.
  - If you sync private repos, you typically need `repo`.
- If you accept contributions:
  - Avoid unsafe workflow patterns that could expose secrets.
  - Consider enabling branch protection for `main`.

## Ordering + descriptions

If `ordering.names` is provided:

- Labels are synced in the exact order of `ordering.names` (numeric prefixes provide stable GitHub UI ordering)
- If `ordering.applyToSource: true`, ordering renames are applied to the source repo too
- Renames use GitHub's label rename API so **existing issue/PR label assignments are preserved**
- If a repo contains **both** a base label and the prefixed label (example: both `bug` and `09-bug`), sync stops with an error to avoid splitting assignments
- `ordering.names` does not create labels by itself; it only controls ordering/renames. If an entry is missing from the source repo, it is skipped.

To delete a label everywhere:

- Delete it from the **source** repo
- Run sync with `options.deleteExtraLabels: true` (targets will delete labels not present in the source)

Descriptions:

- Descriptions are generated from the base name (the part after the `NN-` prefix)
- `Extratag*` labels always get an **empty description**

Default label descriptions (built-in):

- `important`: High priority.
- `idea`: New idea or proposal.
- `documentation`: Documentation updates.
- `improvement`: Enhancement/improvement.
- `not important`: Low priority.
- `wordpress demand`: WordPress-related request.
- `pro-version`: Pro/version-related work.
- `milestone`: Milestone tracking.
- `bug`: Bug report.
- `help wanted`: Help wanted.
- `question`: Question/support.
- `wontfix`: Won't fix.
- `duplicate`: Duplicate.
- `ExtratagN` (example: `Extratag1`): empty description.

## Troubleshooting

- **"Source repo has 0 labels"**
  - Add labels to the source repo, or pass `--allow-empty-source` only if you understand the delete risk.
- **"both 'X' and 'NN-X' exist"**
  - Delete/merge one of the two labels in that repo, then re-run.
- **Auth / 404 / permission errors in Actions**
  - Confirm `LABEL_SYNC_TOKEN` exists and can access every repo in `label-sync.yml`.

## Safety

If the source repository has **zero labels**, sync is aborted by default when deletion is enabled. Override with `--allow-empty-source` only if you are absolutely sure.
