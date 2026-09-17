"use client";

import { useState, type ToggleEvent } from "react";
import { RefreshCw } from "lucide-react";
import type { PersistedRunHistory } from "@/lib/run-history-store";
import { formatLabel } from "./listing-presentation";
import { createRunHistoryPanelModel } from "./run-history-model";

export type RunHistoryState =
  | { status: "loading"; history?: PersistedRunHistory | undefined }
  | { status: "error"; error: string; history?: PersistedRunHistory | undefined }
  | { status: "ready"; history: PersistedRunHistory };

export function RunHistoryPanel({
  state,
  onRefresh,
}: {
  state: RunHistoryState;
  onRefresh: () => void;
}) {
  const model = state.history ? createRunHistoryPanelModel(state.history) : { runs: [] };
  const [expandedRunId, setExpandedRunId] = useState<string | undefined>();
  const handleRunToggle = (runId: string, event: ToggleEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open) {
      setExpandedRunId(runId);
      return;
    }

    setExpandedRunId((currentRunId) => (currentRunId === runId ? undefined : currentRunId));
  };

  return (
    <section className="run-history-card" aria-label="Agent run history">
      <header className="run-history-header">
        <div>
          <p className="eyebrow">Run history</p>
          <h2>Runs</h2>
        </div>
        <button
          type="button"
          className="run-history-refresh"
          onClick={onRefresh}
          disabled={state.status === "loading"}
          aria-label="Refresh run history"
          title="Refresh run history"
        >
          <RefreshCw className="nav-icon" aria-hidden="true" />
        </button>
      </header>

      {state.status === "error" ? (
        <div className="run-history-notice" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={onRefresh}>
            Retry
          </button>
        </div>
      ) : null}

      {state.status === "loading" && !state.history ? (
        <output className="run-history-notice">Loading run history…</output>
      ) : null}

      {state.status === "ready" && model.runs.length === 0 ? (
        <output className="run-history-notice run-history-empty">
          <strong>No runs recorded yet</strong>
          <span className="run-history-notice-text">
            Runs appear here once a manual or scheduled daily search run is saved to this
            group&apos;s shared list.
          </span>
        </output>
      ) : null}

      {model.runs.length === 0 ? null : (
        <div className="run-table" aria-label="Agent runs table">
          <div className="run-table-head" aria-hidden="true">
            <span>Started</span>
            <span>Status</span>
            <span>Trigger</span>
            <span>Candidates</span>
            <span>Source checks</span>
            <span>Outcome</span>
          </div>
          {model.runs.map((run) => (
            <details
              key={run.runId}
              className="run-history-item"
              open={expandedRunId === run.runId}
              onToggle={(event) => handleRunToggle(run.runId, event)}
            >
              <summary>
                <span className="run-cell run-start-cell">
                  <span className={`run-status-dot ${run.status}`} aria-label={run.statusLabel} />
                  <span>
                    <strong>{run.startedLabel}</strong>
                    <small>
                      {run.isLatest ? "Latest run" : run.heading} · {run.modeLabel}
                    </small>
                  </span>
                </span>
                <span className="run-cell">
                  <span className={`run-status-badge ${run.status}`}>{run.statusLabel}</span>
                </span>
                <span className="run-cell">
                  <strong>{formatLabel(run.cadence)}</strong>
                  <small>{formatLabel(run.trigger)}</small>
                </span>
                <span className="run-cell">
                  <strong>{run.apiMatchedCount}</strong>
                  <small>candidate matches found</small>
                </span>
                <span className="run-cell">
                  <strong>{run.checkedOrScrapedLabel}</strong>
                  <small>source records checked</small>
                </span>
                <span className="run-cell run-output-cell">
                  <strong>{run.aiOutputLabel}</strong>
                  <small>
                    {run.aiCallCount} {run.aiAttemptsLabel}
                  </small>
                </span>
              </summary>

              <div className="run-history-detail">
                {run.briefingSummary ? (
                  <section className="run-history-section" aria-label={`${run.heading} briefing`}>
                    <h4>Briefing</h4>
                    <p>{run.briefingSummary}</p>
                  </section>
                ) : null}

                <section className="run-history-section" aria-label={`${run.heading} count notes`}>
                  <h4>How to read the counts</h4>
                  <p>
                    Source checks are records inspected by source adapters. Candidate matches are
                    the smaller set that became run candidates, so source checks can be higher than
                    matches. AI attempts are recorded provider attempts, not necessarily one call
                    per listing.
                  </p>
                </section>

                <section className="run-detail-grid" aria-label={`${run.heading} pipeline counts`}>
                  <RunMetric label="Candidate matches found" value={String(run.apiMatchedCount)} />
                  <RunMetric label="Source records checked" value={run.checkedOrScrapedLabel} />
                  <RunMetric
                    label="Skipped prior"
                    value={`${run.skippedCount} (seen ${run.skipped.seen}, saved ${run.skipped.saved}, rejected ${run.skipped.rejected}, triaged ${run.skipped.triaged})`}
                  />
                  <RunMetric label="Material changes" value={String(run.materialChanges)} />
                  <RunMetric label="Seen-memory updates" value={String(run.memoryUpdates)} />
                  <RunMetric label="Completed" value={run.completedLabel} />
                  <RunMetric
                    label={
                      run.modeLabel === "Fixture mode"
                        ? "Simulated AI attempts"
                        : "AI attempts recorded"
                    }
                    value={String(run.aiCallCount)}
                  />
                  <RunMetric label="Triaged" value={String(run.counts.candidatesTriaged)} />
                  <RunMetric label="Source failures" value={String(run.counts.sourceFailures)} />
                </section>

                <section className="run-output-grid" aria-label={`${run.heading} AI output`}>
                  <RunMetric label="Meets criteria" value={String(run.counts.confirmedMatches)} />
                  <RunMetric label="Needs review" value={String(run.counts.reviewNeeded)} />
                  <RunMetric label="Does not meet criteria" value={String(run.counts.rejected)} />
                </section>

                <section
                  className="run-history-section"
                  aria-label={`${run.heading} output listings`}
                >
                  <h4>Output listings</h4>
                  {run.candidateSummaries.length === 0 ? (
                    <p>No candidate output recorded for this run.</p>
                  ) : (
                    <div className="run-output-list">
                      {run.candidateSummaries.map((candidate) => (
                        <article key={`${run.runId}-${candidate.listingId}`}>
                          <span>{formatLabel(candidate.bucket)}</span>
                          <strong>{candidate.title}</strong>
                          <small>{candidate.suggestedAction}</small>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <section
                  className="run-history-section"
                  aria-label={`${run.heading} source coverage`}
                >
                  <h4>Source/API coverage</h4>
                  <div className="run-source-list">
                    {run.sourceCoverage.length === 0 ? (
                      <p>No source coverage recorded for this run.</p>
                    ) : null}
                    {run.sourceCoverage.map((coverage) => (
                      <article
                        key={`${run.runId}-${coverage.source}`}
                        className={`run-source ${coverage.status}`}
                      >
                        <div>
                          <strong>{coverage.source}</strong>
                          <span>{formatLabel(coverage.status)}</span>
                        </div>
                        <p>
                          {coverage.candidateCount} API match(es), {coverage.checkedCount} checked,{" "}
                          {coverage.rawArtifactPointers.length} storage pointer(s)
                          {coverage.failureCode ? ` · ${coverage.failureCode}` : ""}
                        </p>
                        {coverage.failureMessage ? <p>{coverage.failureMessage}</p> : null}
                      </article>
                    ))}
                  </div>
                </section>

                <section
                  className="run-history-section"
                  aria-label={`${run.heading} provider metadata`}
                >
                  <h4>AI calls</h4>
                  {run.providerCalls.length === 0 ? (
                    <p>No AI call metadata recorded for this run.</p>
                  ) : (
                    <ul>
                      {run.providerCalls.map((call) => (
                        <li key={`${run.runId}-provider-${call.label}`}>
                          <strong>{call.label}</strong>
                          {call.detail ? ` · ${call.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section
                  className="run-history-section"
                  aria-label={`${run.heading} storage pointers`}
                >
                  <h4>Stored pointers</h4>
                  {run.artifactPointers.length === 0 ? (
                    <p>No storage pointers recorded for this run.</p>
                  ) : (
                    <>
                      <p>
                        These are references to the evidence the run kept. They are not openable
                        files yet because there is no viewer for them.
                      </p>
                      <div className="artifact-pointer-grid">
                        {run.artifactPointers.map((artifact) => (
                          <div id={artifact.id} key={artifact.id} className="artifact-pointer-row">
                            <span>{artifact.label}</span>
                            <strong>{artifact.storageKey}</strong>
                            {artifact.contentType ? <small>{artifact.contentType}</small> : null}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function RunMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="run-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
