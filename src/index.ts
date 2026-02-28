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

    await syncLabelsToTargets({
      octokit,
      config,
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
