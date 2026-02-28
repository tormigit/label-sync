# github-label-sync

Sync GitHub repository labels from a canonical **source repository** to one or more **target repositories**.

## Setup

1. Install dependencies

```bash
npm install
```

2. Create an env file

```bash
copy .env.example .env
```

Set `GITHUB_TOKEN`.

If you run this from GitHub Actions and need to sync across multiple repositories, store a PAT in repository secret `LABEL_SYNC_TOKEN` (the built-in `GITHUB_TOKEN` is repo-scoped).

3. Edit `label-sync.yml`

- `source`: canonical labels repository
- `targets`: repositories to sync to
- `options.deleteExtraLabels`: when `true`, labels in targets that are not in the source repo are deleted

## Usage

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

## Safety

If the source repository has **zero labels**, sync is aborted by default when deletion is enabled. Override with `--allow-empty-source` only if you are absolutely sure.
