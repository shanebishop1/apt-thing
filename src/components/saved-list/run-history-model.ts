import type {
  BriefingRunHistoryRun,
  EvidenceStoragePointer,
  SourceCoverageSummary,
} from "@/lib/agent-contracts";
import type {
  PersistedRunHistory,
  PersistedRunHistoryRun,
  PersistedRunSkipCounts,
} from "@/lib/run-history-store";
import { withDefined } from "@/lib/utils/records";
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
  modeLabel: string;
  startedLabel: string;
  completedLabel: string;
  isLatest: boolean;
  counts: BriefingRunHistoryRun["counts"];
  apiMatchedCount: number;
  checkedOrScrapedCount: number;
  checkedOrScrapedLabel: string;
  skippedCount: number;
  skipped: PersistedRunSkipCounts;
  materialChanges: number;
  memoryUpdates: number;
  briefingSummary?: string;
  aiCallCount: number;
  aiAttemptsLabel: string;
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

export function createRunHistoryPanelModel(history: PersistedRunHistory): RunHistoryPanelModel {
  const runs = [...history.runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const latestRunId = runs[0]?.runId;

  return {
    runs: runs.map((run) => {
      const sourceCoverage = run.sourceCoverage;
      const artifactPointers = createRunArtifactPointers(run, sourceCoverage);
      const failures = sourceCoverage.filter((coverage) => coverage.status === "failed");
      const counts = { ...run.counts, sourceFailures: failures.length };
      const checkedCount = sourceCoverage.reduce(
        (total, coverage) => total + coverage.checkedCount,
        0,
      );
      const skippedCount =
        run.skipped.seen + run.skipped.saved + run.skipped.rejected + run.skipped.triaged;

      return withDefined<RunHistoryPanelRunModel>({
        runId: run.runId,
        heading: createRunHistoryHeading(run),
        cadence: run.cadence,
        trigger: run.trigger,
        status: run.status,
        statusLabel: formatLabel(run.status),
        modeLabel: run.mode === "fixture" ? "Fixture mode" : "Live-safe mode",
        startedLabel: formatDateTimeLabel(run.startedAt),
        completedLabel: run.completedAt ? formatDateTimeLabel(run.completedAt) : "Still running",
        isLatest: run.runId === latestRunId,
        counts,
        apiMatchedCount: counts.candidatesFound,
        checkedOrScrapedCount: checkedCount,
        checkedOrScrapedLabel: checkedCount > 0 ? String(checkedCount) : "None recorded",
        skippedCount,
        skipped: run.skipped,
        materialChanges: run.materialChanges,
        memoryUpdates: run.memoryUpdates,
        briefingSummary: run.briefingSummary,
        aiCallCount: run.providerMetadata.length,
        // Fixture-mode runs persist simulated provider metadata; never present it as real AI calls.
        aiAttemptsLabel:
          run.mode === "fixture"
            ? "simulated AI attempt(s), fixture mode"
            : "AI attempt(s) recorded",
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
      });
    }),
  };
}

function createRunHistoryHeading(run: PersistedRunHistoryRun): string {
  if (run.cadence === "manual") {
    return "Manual run";
  }
  if (run.cadence === "hourly") {
    return "Hourly run";
  }

  return run.trigger === "cron" ? "Daily scheduled search" : "Daily search";
}

function createRunArtifactPointers(
  run: BriefingRunHistoryRun,
  sourceCoverage: SourceCoverageSummary[],
): RunHistoryArtifactPointer[] {
  const pointers = uniquePointers([
    ...run.rawArtifactPointers,
    ...sourceCoverage.flatMap((coverage) => coverage.rawArtifactPointers),
    ...run.candidateSummaries.flatMap((candidate) => candidate.evidenceSummary.rawArtifactPointers),
  ]);

  return pointers.map((pointer, index) => {
    const id = `artifact-${slugify(run.runId)}-${index}`;

    return withDefined<RunHistoryArtifactPointer>({
      id,
      label: `${pointer.owner.toUpperCase()} pointer`,
      ownerLabel: pointer.owner.toUpperCase(),
      storageKey: pointer.key,
      contentType: pointer.contentType,
    });
  });
}

function uniquePointers(pointers: EvidenceStoragePointer[]): EvidenceStoragePointer[] {
  const byKey = new Map<string, EvidenceStoragePointer>();

  for (const pointer of pointers) {
    byKey.set(`${pointer.owner}:${pointer.key}`, pointer);
  }

  return [...byKey.values()];
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
