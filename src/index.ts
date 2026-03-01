#!/usr/bin/env node

import { Command, type OptionValues } from "commander";
import dotenv from "dotenv";
import path from "path";
import type { Octokit } from "@octokit/rest";
import { loadConfig, type LabelSyncConfig, type RepoRef } from "./labelSyncConfig";
import { createOctokit } from "./octokit";
import { exportLabelsFromSource, syncLabelsToTargets } from "./sync";

dotenv.config();

const program = new Command();

function parseCsv(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function matchesRepoSelector(selector: string, owner: string, repo: string): boolean {
  const s = selector.trim();
  if (s.length === 0) return false;
  const sKey = s.toLowerCase();
  const repoKey = repo.toLowerCase();
  const fullKey = `${owner}/${repo}`.toLowerCase();
  if (sKey === repoKey) return true;
  if (sKey === fullKey) return true;
  return false;
}

function filterTargets(params: {
  targets: RepoRef[];
  includeSelectors: string[];
  excludeSelectors: string[];
}): RepoRef[] {
  let out = params.targets;

  if (params.includeSelectors.length > 0) {
    out = out.filter((t) =>
      params.includeSelectors.some((s) => matchesRepoSelector(s, t.owner, t.repo)),
    );
  }

  if (params.excludeSelectors.length > 0) {
    out = out.filter(
      (t) => !params.excludeSelectors.some((s) => matchesRepoSelector(s, t.owner, t.repo)),
    );
  }

  return out;
}

async function discoverUserOwnedRepos(params: {
  octokit: Octokit;
  owner: string;
}): Promise<RepoRef[]> {
  const perPage = 100;
  let page = 1;
  const repos: Array<{ owner?: { login?: string | null } | null; name: string }> = [];

  for (;;) {
    const res = await params.octokit.repos.listForAuthenticatedUser({
      per_page: perPage,
      page,
      affiliation: "owner",
    });

    repos.push(
      ...(res.data as unknown as Array<{ owner?: { login?: string | null } | null; name: string }>),
    );

    if (res.data.length < perPage) {
      break;
    }

    page += 1;
  }

  return repos
    .filter((r) => {
      const login = r.owner?.login ?? "";
      return login.trim().toLowerCase() === params.owner.toLowerCase();
    })
    .map((r) => ({ owner: (r.owner?.login ?? "").trim(), repo: r.name }))
    .filter((t) => t.owner.length > 0 && t.repo.length > 0);
}

async function resolveTargets(params: {
  octokit: Octokit;
  config: LabelSyncConfig;
  opts: OptionValues;
}): Promise<RepoRef[]> {
  const includeSelectors = parseCsv(params.opts.includeRepos);
  const excludeSelectors = parseCsv(params.opts.excludeRepos);

  const targetMode = String(params.opts.targetMode ?? "config").trim().toLowerCase();
  if (targetMode !== "config" && targetMode !== "discover") {
    throw new Error("--target-mode must be config or discover");
  }

  let targets: RepoRef[];
  if (targetMode === "discover") {
    const discoverOwnerRaw = typeof params.opts.discoverOwner === "string" ? params.opts.discoverOwner : "";
    const discoverOwner = (discoverOwnerRaw || params.config.source.owner).trim();
    if (!discoverOwner) {
      throw new Error("--discover-owner is required when --target-mode=discover");
    }

    const discovered = await discoverUserOwnedRepos({ octokit: params.octokit, owner: discoverOwner });

    targets = discovered.filter(
      (t) =>
        !(
          t.owner.toLowerCase() === params.config.source.owner.toLowerCase() &&
          t.repo.toLowerCase() === params.config.source.repo.toLowerCase()
        ),
    );
  } else {
    targets = params.config.targets;
  }

  const filtered = filterTargets({ targets, includeSelectors, excludeSelectors });
  if (filtered.length === 0) {
    throw new Error(
      targetMode === "discover"
        ? "Target discovery resulted in 0 repositories after filtering"
        : "Target filtering resulted in 0 repositories",
    );
  }

  return filtered;
}

program
  .name("gh-label-sync")
  .description("Sync GitHub labels from a source repository to target repositories")
  .option(
    "--config <path>",
    "Path to label sync config file",
    process.env.LABEL_SYNC_CONFIG || "label-sync.yml",
  );

program
  .command("sync")
  .description("Sync labels from source to all targets")
  .option("--apply", "Apply changes (default is dry-run)", false)
  .option("--dry-run", "Alias for not passing --apply", false)
  .option(
    "--target-mode <config|discover>",
    "Choose targets from config file (config) or auto-discover repos owned by a user (discover)",
    "config",
  )
  .option(
    "--discover-owner <owner>",
    "When --target-mode=discover: discover repos owned by this user (defaults to config.source.owner)",
  )
  .option(
    "--include-repos <csv>",
    "Optional filter: only include these repos (comma-separated repo names or owner/repo)",
  )
  .option(
    "--exclude-repos <csv>",
    "Optional filter: exclude these repos (comma-separated repo names or owner/repo)",
  )
  .option(
    "--allow-empty-source",
    "Allow syncing even if source has 0 labels (dangerous when deletion is enabled)",
    false,
  )
  .option(
    "--delete-extra <true|false>",
    "Override config: delete labels on targets that are not present in the source",
    (value: string) => {
      const v = value.trim().toLowerCase();
      if (v === "true") return true;
      if (v === "false") return false;
      throw new Error("--delete-extra must be true or false");
    },
    undefined,
  )
  .action(async (opts: OptionValues, cmd: Command) => {
    const root = cmd.parent?.opts() as { config: string };
    const configPath = path.resolve(process.cwd(), root.config);

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN is required");
    }

    const config = await loadConfig(configPath);
    const octokit = createOctokit(token);

    const apply = Boolean(opts.apply);

    const deleteExtraOverride =
      typeof opts.deleteExtra === "boolean" ? (opts.deleteExtra as boolean) : undefined;

    const targets = await resolveTargets({ octokit, config, opts });
    const configToUse = { ...config, targets };

    await syncLabelsToTargets({
      octokit,
      config: configToUse,
      apply,
      allowEmptySource: Boolean(opts.allowEmptySource),
      deleteExtraOverride,
    });
  });

program
  .command("export")
  .description("Export labels from source repo to a file")
  .option("--out <path>", "Output file path", "labels-export.yml")
  .action(async (opts: OptionValues, cmd: Command) => {
    const root = cmd.parent?.opts() as { config: string };
    const configPath = path.resolve(process.cwd(), root.config);

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN is required");
    }

    const config = await loadConfig(configPath);
    const octokit = createOctokit(token);

    await exportLabelsFromSource({
      octokit,
      config,
      outPath: path.resolve(process.cwd(), opts.out),
    });
  });

program
  .command("targets")
  .description("List the target repositories after applying discovery and filters")
  .option(
    "--target-mode <config|discover>",
    "Choose targets from config file (config) or auto-discover repos owned by a user (discover)",
    "config",
  )
  .option(
    "--discover-owner <owner>",
    "When --target-mode=discover: discover repos owned by this user (defaults to config.source.owner)",
  )
  .option(
    "--include-repos <csv>",
    "Optional filter: only include these repos (comma-separated repo names or owner/repo)",
  )
  .option(
    "--exclude-repos <csv>",
    "Optional filter: exclude these repos (comma-separated repo names or owner/repo)",
  )
  .action(async (opts: OptionValues, cmd: Command) => {
    const root = cmd.parent?.opts() as { config: string };
    const configPath = path.resolve(process.cwd(), root.config);

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN is required");
    }

    const config = await loadConfig(configPath);
    const octokit = createOctokit(token);

    const targets = await resolveTargets({ octokit, config, opts });
    for (const t of targets) {
      process.stdout.write(`${t.owner}/${t.repo}\n`);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
