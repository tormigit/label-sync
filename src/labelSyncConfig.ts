import { promises as fs } from "fs";
import YAML from "yaml";

export type RepoRef = {
  owner: string;
  repo: string;
};

export type LabelSyncOptions = {
  deleteExtraLabels?: boolean;
  allowEmptySource?: boolean;
};

export type LabelSyncConfig = {
  source: RepoRef;
  targets: RepoRef[];
  options?: LabelSyncOptions;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertRepoRef(value: unknown, field: string): asserts value is RepoRef {
  const v = value as RepoRef;
  if (!v || typeof v !== "object") {
    throw new Error(`${field} must be an object with { owner, repo }`);
  }
  if (!isNonEmptyString(v.owner) || !isNonEmptyString(v.repo)) {
    throw new Error(`${field}.owner and ${field}.repo are required`);
  }
}

export async function loadConfig(configPath: string): Promise<LabelSyncConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = YAML.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config file is invalid");
  }

  const cfg = parsed as LabelSyncConfig;

  assertRepoRef(cfg.source, "source");

  if (!Array.isArray(cfg.targets) || cfg.targets.length === 0) {
    throw new Error("targets must be a non-empty array");
  }

  cfg.targets.forEach((t, i) => assertRepoRef(t, `targets[${i}]`));

  return cfg;
}
