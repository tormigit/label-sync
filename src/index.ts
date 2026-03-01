#!/usr/bin/env node

import { Command, type OptionValues } from "commander";
import dotenv from "dotenv";
import path from "path";
import { loadConfig } from "./labelSyncConfig";
import { createOctokit } from "./octokit";
import { exportLabelsFromSource, syncLabelsToTargets } from "./sync";

dotenv.config();

const program = new Command();

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

    const parseCsv = (value: unknown): string[] => {
      if (typeof value !== "string") return [];
      return value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    };

    const matchesRepoSelector = (selector: string, owner: string, repo: string): boolean => {
      const s = selector.trim();
      if (s.length === 0) return false;
      const sKey = s.toLowerCase();
      const repoKey = repo.toLowerCase();
      const fullKey = `${owner}/${repo}`.toLowerCase();
      if (sKey === repoKey) return true;
      if (sKey === fullKey) return true;
      return false;
    };

    const includeSelectors = parseCsv(opts.includeRepos);
    const excludeSelectors = parseCsv(opts.excludeRepos);

    const filterTargets = (
      targets: Array<{ owner: string; repo: string }>,
    ): Array<{ owner: string; repo: string }> => {
      let out = targets;

      if (includeSelectors.length > 0) {
        out = out.filter((t) =>
          includeSelectors.some((s) => matchesRepoSelector(s, t.owner, t.repo)),
        );
      }

      if (excludeSelectors.length > 0) {
        out = out.filter((t) =>
          !excludeSelectors.some((s) => matchesRepoSelector(s, t.owner, t.repo)),
        );
      }

      return out;
    };

    const targetMode = String(opts.targetMode ?? "config").trim().toLowerCase();
    let configToUse = config;

    if (targetMode !== "config" && targetMode !== "discover") {
      throw new Error("--target-mode must be config or discover");
    }

    if (targetMode === "discover") {
      const discoverOwnerRaw = typeof opts.discoverOwner === "string" ? opts.discoverOwner : "";
      const discoverOwner = (discoverOwnerRaw || config.source.owner).trim();
      if (!discoverOwner) {
        throw new Error("--discover-owner is required when --target-mode=discover");
      }

      const perPage = 100;
      let page = 1;
      const repos: Array<{ owner?: { login?: string | null } | null; name: string }> = [];

      for (;;) {
        const res = await octokit.repos.listForAuthenticatedUser({
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

      const discovered = repos
        .filter((r: { owner?: { login?: string | null } | null; name: string }) => {
          const login = r.owner?.login ?? "";
          return login.trim().toLowerCase() === discoverOwner.toLowerCase();
        })
        .map((r: { owner?: { login?: string | null } | null; name: string }) => ({
          owner: (r.owner?.login ?? "").trim(),
          repo: r.name,
        }))
        .filter(
          (t: { owner: string; repo: string }) =>
            !(
              t.owner.toLowerCase() === config.source.owner.toLowerCase() &&
              t.repo.toLowerCase() === config.source.repo.toLowerCase()
            ),
        )
        .filter((t: { owner: string; repo: string }) => t.owner.length > 0 && t.repo.length > 0);

      const filtered = filterTargets(discovered);
      if (filtered.length === 0) {
        throw new Error("Target discovery resulted in 0 repositories after filtering");
      }

      configToUse = { ...config, targets: filtered };
    } else {
      const filtered = filterTargets(config.targets);
      if (filtered.length === 0) {
        throw new Error("Target filtering resulted in 0 repositories");
      }
      configToUse = { ...config, targets: filtered };
    }

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

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
