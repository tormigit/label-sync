import { promises as fs } from "fs";
import path from "path";
import YAML from "yaml";
import type { Octokit } from "@octokit/rest";
import type { LabelSyncConfig, RepoRef } from "./labelSyncConfig";

export type NormalizedLabel = {
  name: string;
  color: string;
  description: string | null;
};

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeColor(color: string): string {
  const c = color.trim();
  return c.startsWith("#") ? c.slice(1).toLowerCase() : c.toLowerCase();
}

function normalizeLabel(label: {
  name: string;
  color: string;
  description?: string | null;
}): NormalizedLabel {
  return {
    name: label.name,
    color: normalizeColor(label.color),
    description: label.description ?? null,
  };
}

async function listAllLabels(octokit: Octokit, repo: RepoRef): Promise<NormalizedLabel[]> {
  const perPage = 100;
  let page = 1;
  const out: NormalizedLabel[] = [];

  for (;;) {
    const res = await octokit.issues.listLabelsForRepo({
      owner: repo.owner,
      repo: repo.repo,
      per_page: perPage,
      page,
    });

    const items = res.data.map(
      (l: { name: string; color: string; description: string | null }) =>
        normalizeLabel({ name: l.name, color: l.color, description: l.description }),
    );

    out.push(...items);

    if (res.data.length < perPage) {
      break;
    }

    page += 1;
  }

  return out;
}

function labelsEqual(a: NormalizedLabel, b: NormalizedLabel): boolean {
  return a.name === b.name && a.color === b.color && (a.description ?? null) === (b.description ?? null);
}

function toMap(labels: NormalizedLabel[]): Map<string, NormalizedLabel> {
  const m = new Map<string, NormalizedLabel>();
  for (const l of labels) {
    m.set(nameKey(l.name), l);
  }
  return m;
}

async function ensureLabel(
  octokit: Octokit,
  repo: RepoRef,
  desired: NormalizedLabel,
  existing: NormalizedLabel | undefined,
  apply: boolean,
): Promise<{ action: "create" | "update" | "noop"; name: string }>
{
  if (!existing) {
    if (apply) {
      await octokit.issues.createLabel({
        owner: repo.owner,
        repo: repo.repo,
        name: desired.name,
        color: desired.color,
        description: desired.description ?? undefined,
      });
    }
    return { action: "create", name: desired.name };
  }

  if (labelsEqual(desired, existing)) {
    return { action: "noop", name: desired.name };
  }

  if (apply) {
    await octokit.issues.updateLabel({
      owner: repo.owner,
      repo: repo.repo,
      name: existing.name,
      color: desired.color,
      description: desired.description ?? undefined,
    });
  }

  return { action: "update", name: desired.name };
}

async function deleteLabel(
  octokit: Octokit,
  repo: RepoRef,
  name: string,
  apply: boolean,
): Promise<void> {
  if (!apply) {
    return;
  }

  await octokit.issues.deleteLabel({
    owner: repo.owner,
    repo: repo.repo,
    name,
  });
}

export async function exportLabelsFromSource(params: {
  octokit: Octokit;
  config: LabelSyncConfig;
  outPath: string;
}): Promise<void> {
  const labels = await listAllLabels(params.octokit, params.config.source);

  const ext = path.extname(params.outPath).toLowerCase();

  if (ext === ".json") {
    await fs.writeFile(params.outPath, JSON.stringify(labels, null, 2) + "\n", "utf8");
    return;
  }

  const doc = YAML.stringify(labels);
  await fs.writeFile(params.outPath, doc, "utf8");
}

export async function syncLabelsToTargets(params: {
  octokit: Octokit;
  config: LabelSyncConfig;
  apply: boolean;
  allowEmptySource: boolean;
  deleteExtraOverride?: boolean;
}): Promise<void> {
  const deleteExtraConfig = Boolean(params.config.options?.deleteExtraLabels);
  const allowEmptySourceConfig = Boolean(params.config.options?.allowEmptySource);

  const deleteExtra = params.deleteExtraOverride ?? deleteExtraConfig;
  const allowEmptySource = params.allowEmptySource || allowEmptySourceConfig;

  const sourceLabels = await listAllLabels(params.octokit, params.config.source);

  {
    const seen = new Map<string, string>();
    for (const l of sourceLabels) {
      const k = nameKey(l.name);
      const prev = seen.get(k);
      if (prev && prev !== l.name) {
        throw new Error(
          `Source repo contains duplicate labels differing only by case/whitespace: '${prev}' and '${l.name}'`,
        );
      }
      seen.set(k, l.name);
    }
  }

  if (deleteExtra && sourceLabels.length === 0 && !allowEmptySource) {
    throw new Error(
      "Source repo has 0 labels; refusing to run destructive sync. Add labels to source or pass --allow-empty-source.",
    );
  }

  const sourceMap = toMap(sourceLabels);

  for (const target of params.config.targets) {
    const targetLabels = await listAllLabels(params.octokit, target);
    const targetMap = toMap(targetLabels);

    const creates: string[] = [];
    const updates: string[] = [];

    for (const desired of sourceLabels) {
      const existing = targetMap.get(nameKey(desired.name));
      const res = await ensureLabel(params.octokit, target, desired, existing, params.apply);
      if (res.action === "create") {
        creates.push(res.name);
      } else if (res.action === "update") {
        updates.push(res.name);
      }
    }

    const deletes: string[] = [];

    if (deleteExtra) {
      for (const existing of targetLabels) {
        if (!sourceMap.has(nameKey(existing.name))) {
          await deleteLabel(params.octokit, target, existing.name, params.apply);
          deletes.push(existing.name);
        }
      }
    }

    const header = `${target.owner}/${target.repo}`;
    process.stdout.write(
      `${header}: create=${creates.length} update=${updates.length} delete=${deletes.length} mode=${params.apply ? "apply" : "dry-run"}\n`,
    );
  }
}
