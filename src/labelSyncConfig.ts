import { promises as fs } from "fs";
import YAML from "yaml";

export type RepoRef = {
  owner: string;
  repo: string;
};

export type LabelOrderingConfig = {
  applyToSource?: boolean;
  names?: string[];
};

export type LabelSyncOptions = {
  deleteExtraLabels?: boolean;
  allowEmptySource?: boolean;
};

export type LabelSyncConfig = {
  source: RepoRef;
  targets: RepoRef[];
  ordering?: LabelOrderingConfig;
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

function assertOrdering(value: unknown, field: string): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`${field} must be an object`);
  }

  const v = value as LabelOrderingConfig;

  if (v.applyToSource !== undefined && typeof v.applyToSource !== "boolean") {
    throw new Error(`${field}.applyToSource must be a boolean`);
  }

  if (v.names !== undefined) {
    if (!Array.isArray(v.names)) {
      throw new Error(`${field}.names must be an array of strings`);
    }
    const seen = new Set<string>();
    for (let i = 0; i < v.names.length; i += 1) {
      if (!isNonEmptyString(v.names[i])) {
        throw new Error(`${field}.names[${i}] must be a non-empty string`);
      }
      const key = v.names[i].trim().toLowerCase();
      if (seen.has(key)) {
        throw new Error(`${field}.names contains duplicates (case-insensitive): '${v.names[i]}'`);
      }
      seen.add(key);
    }
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

  if (!Array.isArray(cfg.targets)) {
    cfg.targets = [];
  }

  if (!Array.isArray(cfg.targets)) {
    throw new Error("targets must be an array");
  }

  cfg.targets.forEach((t, i) => assertRepoRef(t, `targets[${i}]`));

  assertOrdering(cfg.ordering, "ordering");

  return cfg;
}
