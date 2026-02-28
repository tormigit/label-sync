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

function orderingBaseName(desiredName: string): string {
  const m = /^\d{2}-(.+)$/.exec(desiredName.trim());
  return (m ? m[1] : desiredName).trim();
}

function desiredDescriptionForBaseName(baseName: string): string | null {
  const n = baseName.trim();
  const k = n.toLowerCase();

  if (/^extratag\d+$/i.test(n)) {
    return "";
  }

  if (k === "important") return "High priority.";
  if (k === "idea") return "New idea or proposal.";
  if (k === "documentation") return "Documentation updates.";
  if (k === "improvement") return "Enhancement/improvement.";
  if (k === "not important") return "Low priority.";
  if (k === "wordpress demand") return "WordPress-related request.";
  if (k === "pro-version") return "Pro/version-related work.";
  if (k === "milestone") return "Milestone tracking.";
  if (k === "bug") return "Bug report.";
  if (k === "help wanted") return "Help wanted.";
  if (k === "question") return "Question/support.";
  if (k === "wontfix") return "Won't fix.";
  if (k === "duplicate") return "Duplicate.";

  return null;
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

 const DEFAULT_ORDERING_COLOR = "ededed";

type RenameOp = { from: string; to: string };

function buildOrderingMapping(orderingNames: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const desired of orderingNames) {
    const base = orderingBaseName(desired);
    const baseKey = nameKey(base);
    if (m.has(baseKey)) {
      const prev = m.get(baseKey);
      throw new Error(
        `ordering.names contains multiple entries for the same base label '${base}': '${prev}' and '${desired}'`,
      );
    }
    m.set(baseKey, desired);
  }
  return m;
}

async function applyOrderingRenamesToRepo(params: {
  octokit: Octokit;
  repo: RepoRef;
  apply: boolean;
  orderingNames: string[];
}): Promise<{ renames: RenameOp[] }>
{
  buildOrderingMapping(params.orderingNames);
  const labels = await listAllLabels(params.octokit, params.repo);
  const labelMap = toMap(labels);

  const planned: RenameOp[] = [];

  for (const desiredName of params.orderingNames) {
    const desiredKey = nameKey(desiredName);
    const baseName = orderingBaseName(desiredName);
    const baseKey = nameKey(baseName);

    if (desiredKey === baseKey) {
      continue;
    }

    const hasDesired = labelMap.has(desiredKey);
    const baseLabel = labelMap.get(baseKey);

    if (!baseLabel || hasDesired) {
      continue;
    }

    planned.push({ from: baseLabel.name, to: desiredName });

    if (params.apply) {
      await params.octokit.issues.updateLabel({
        owner: params.repo.owner,
        repo: params.repo.repo,
        name: baseLabel.name,
        new_name: desiredName,
      });

      labelMap.delete(baseKey);
      labelMap.set(desiredKey, { ...baseLabel, name: desiredName });
    }
  }

  // Detect conflicts (both base and desired exist) to avoid silent assignment splits.
  for (const desiredName of params.orderingNames) {
    const desiredKey = nameKey(desiredName);
    const baseName = orderingBaseName(desiredName);
    const baseKey = nameKey(baseName);

    if (desiredKey === baseKey) {
      continue;
    }

    const desiredExists = labelMap.get(desiredKey);
    const baseExists = labelMap.get(baseKey);

    if (desiredExists && baseExists) {
      throw new Error(
        `${params.repo.owner}/${params.repo.repo}: both '${baseExists.name}' and '${desiredExists.name}' exist; cannot auto-apply ordering. Delete/merge one of them first.`,
      );
    }
  }

  return { renames: planned };
}

function computeCanonicalSourceLabelsFromOrdering(params: {
  sourceLabels: NormalizedLabel[];
  orderingNames: string[];
}): NormalizedLabel[] {
  buildOrderingMapping(params.orderingNames);
  const sourceMap = toMap(params.sourceLabels);
  const usedKeys = new Set<string>();
  const ordered: NormalizedLabel[] = [];

  for (const desiredName of params.orderingNames) {
    const baseName = orderingBaseName(desiredName);
    const baseKey = nameKey(baseName);

    const desiredKey = nameKey(desiredName);

    const derivedDescription = desiredDescriptionForBaseName(baseName);

    const label = sourceMap.get(desiredKey) ?? sourceMap.get(baseKey);
    if (!label) {
      ordered.push({
        name: desiredName,
        color: DEFAULT_ORDERING_COLOR,
        description: derivedDescription !== null ? derivedDescription : null,
      });
      continue;
    }

    usedKeys.add(nameKey(label.name));
    ordered.push({
      ...label,
      name: desiredName,
      description: derivedDescription !== null ? derivedDescription : label.description,
    });
  }

  const rest = params.sourceLabels
    .filter((l) => !usedKeys.has(nameKey(l.name)))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...ordered, ...rest];
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

  const orderingNames = params.config.ordering?.names ?? [];
  const orderingEnabled = orderingNames.length > 0;

  if (orderingEnabled && params.config.ordering?.applyToSource) {
    const res = await applyOrderingRenamesToRepo({
      octokit: params.octokit,
      repo: params.config.source,
      apply: params.apply,
      orderingNames,
    });
    if (res.renames.length > 0) {
      process.stdout.write(
        `${params.config.source.owner}/${params.config.source.repo}: renames=${res.renames.length} mode=${params.apply ? "apply" : "dry-run"}\n`,
      );
    }
  }

  const sourceLabelsRaw = await listAllLabels(params.octokit, params.config.source);
  const sourceLabels = orderingEnabled
    ? computeCanonicalSourceLabelsFromOrdering({ sourceLabels: sourceLabelsRaw, orderingNames })
    : sourceLabelsRaw;

  if (orderingEnabled && params.config.ordering?.applyToSource) {
    const sourceExisting = await listAllLabels(params.octokit, params.config.source);
    const sourceExistingMap = toMap(sourceExisting);

    let sourceUpdates = 0;
    let sourceCreates = 0;

    for (const desired of sourceLabels) {
      const existing = sourceExistingMap.get(nameKey(desired.name));
      const res = await ensureLabel(params.octokit, params.config.source, desired, existing, params.apply);
      if (res.action === "create") {
        sourceCreates += 1;
      } else if (res.action === "update") {
        sourceUpdates += 1;
      }
    }

    if (sourceCreates > 0 || sourceUpdates > 0) {
      process.stdout.write(
        `${params.config.source.owner}/${params.config.source.repo}: create=${sourceCreates} update=${sourceUpdates} (descriptions) mode=${params.apply ? "apply" : "dry-run"}\n`,
      );
    }
  }

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
    if (orderingEnabled) {
      const res = await applyOrderingRenamesToRepo({
        octokit: params.octokit,
        repo: target,
        apply: params.apply,
        orderingNames,
      });
      if (res.renames.length > 0) {
        process.stdout.write(
          `${target.owner}/${target.repo}: renames=${res.renames.length} mode=${params.apply ? "apply" : "dry-run"}\n`,
        );
      }
    }

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
