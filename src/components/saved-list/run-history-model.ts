import type {
  BriefingRunHistoryContract,
  BriefingRunHistoryRun,
  EvidenceStoragePointer,
  SourceCoverageSummary,
} from "../../lib/agent-contracts";
import { formatLabel } from "./listing-presentation";

export type RunHistoryArtifactPointer = {
  id: string;
  label: string;
  ownerLabel: string;
  storageKey: string;
  contentType?: string;
};

export type RunHistoryPanelRunModel = {
  runId: string;
  heading: string;
  cadence: BriefingRunHistoryRun["cadence"];
  trigger: BriefingRunHistoryRun["trigger"];
  status: BriefingRunHistoryRun["status"];
  statusLabel: string;
  startedLabel: string;
  completedLabel: string;
  isLatest: boolean;
  counts: BriefingRunHistoryRun["counts"];
  apiMatchedCount: number;
  checkedOrScrapedCount: number;
  checkedOrScrapedLabel: string;
  skippedCount: number;
  aiCallCount: number;
  aiOutputLabel: string;
  sourceCoverage: SourceCoverageSummary[];
  failures: SourceCoverageSummary[];
  providerMetadata: string[];
  providerDetails: string[];
  artifactPointers: RunHistoryArtifactPointer[];
  candidateSummaries: BriefingRunHistoryRun["candidateSummaries"];
};

export type RunHistoryPanelModel = {
  runs: RunHistoryPanelRunModel[];
};

export function createRunHistoryPanelModel(
  history: BriefingRunHistoryContract,
): RunHistoryPanelModel {
  const latestRunId = history.latestRun.runId;
  const runs = [...history.runs]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map((run) => {
      const sourceCoverage = run.sourceCoverage.filter(
        (coverage) => !isSyntheticFixtureCoverage(coverage),
      );
      const artifactPointers = createRunArtifactPointers(run, sourceCoverage);
      const failures = sourceCoverage.filter((coverage) => coverage.status === "failed");
      const counts = { ...run.counts, sourceFailures: failures.length };
      const checkedCount = sourceCoverage.reduce(
        (total, coverage) => total + coverage.checkedCount,
        0,
      );
      const aiCallCount = run.providerMetadata.length;
      const skippedCount = run.counts.candidatesSkippedSeen + run.counts.candidatesSkippedTriaged;
      const checkedOrScrapedLabel =
        checkedCount > 0 ? String(checkedCount) : "Not separately recorded";

      return {
        runId: run.runId,
        heading: createRunHistoryHeading(run),
        cadence: run.cadence,
        trigger: run.trigger,
        status: run.status,
        statusLabel: formatLabel(run.status),
        startedLabel: formatDateTimeLabel(run.startedAt),
        completedLabel: run.completedAt ? formatDateTimeLabel(run.completedAt) : "Still running",
        isLatest: run.runId === latestRunId,
        counts,
        apiMatchedCount: counts.candidatesFound,
        checkedOrScrapedCount: checkedCount,
        checkedOrScrapedLabel,
        skippedCount,
        aiCallCount,
        aiOutputLabel: `${counts.confirmedMatches} yes / ${counts.reviewNeeded} review / ${counts.rejected} no`,
        sourceCoverage,
        failures,
        providerMetadata: uniqueNonEmpty(
          run.providerMetadata.map((metadata) => `${metadata.provider} / ${metadata.model}`),
        ),
        providerDetails: run.providerMetadata.map((metadata) =>
          uniqueNonEmpty([
            metadata.status,
            metadata.purpose,
            metadata.promptVersion ?? "",
            metadata.schemaValidation ? `schema ${metadata.schemaValidation}` : "",
          ]).join(" / "),
        ),
        artifactPointers,
        candidateSummaries: run.candidateSummaries,
      } satisfies RunHistoryPanelRunModel;
    });

  return {
    runs,
  };
}

function createRunHistoryHeading(run: BriefingRunHistoryRun): string {
  if (run.cadence === "manual") {
    return "Manual import catch-up";
  }
  if (run.cadence === "hourly") {
    return "Hourly-ready smoke run";
  }

  return "Daily scheduled search";
}

function createRunArtifactPointers(
  run: BriefingRunHistoryRun,
  sourceCoverage: SourceCoverageSummary[],
): RunHistoryArtifactPointer[] {
  const pointers = uniquePointers([
    ...run.rawArtifactPointers.filter((pointer) => !isSyntheticFixturePointer(pointer)),
    ...sourceCoverage.flatMap((coverage) => coverage.rawArtifactPointers),
    ...run.candidateSummaries.flatMap((candidate) => candidate.evidenceSummary.rawArtifactPointers),
  ]).filter((pointer) => !isSyntheticFixturePointer(pointer));

  return pointers.map((pointer, index) => {
    const id = `artifact-${slugify(run.runId)}-${index}`;

    return {
      id,
      label: `${pointer.owner.toUpperCase()} pointer`,
      ownerLabel: pointer.owner.toUpperCase(),
      storageKey: pointer.key,
      contentType: pointer.contentType,
    };
  });
}

function uniquePointers(pointers: EvidenceStoragePointer[]): EvidenceStoragePointer[] {
  const byKey = new Map<string, EvidenceStoragePointer>();

  for (const pointer of pointers) {
    byKey.set(`${pointer.owner}:${pointer.key}`, pointer);
  }

  return [...byKey.values()];
}

function isSyntheticFixtureCoverage(coverage: SourceCoverageSummary): boolean {
  return (
    coverage.source.startsWith("fixture-") || coverage.failureCode?.startsWith("fixture-") === true
  );
}

function isSyntheticFixturePointer(pointer: EvidenceStoragePointer): boolean {
  return pointer.key.includes("source-failure") || pointer.key.includes("fixture-");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueNonEmpty(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function formatDateTimeLabel(value: string) {
  return value.slice(0, 16).replace("T", " ");
}
