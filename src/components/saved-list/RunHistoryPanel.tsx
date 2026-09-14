"use client";

import { useState, type ToggleEvent } from "react";
import type { BriefingRunHistoryContract } from "../../lib/agent-contracts";
import { formatLabel } from "./listing-presentation";
import { createRunHistoryPanelModel } from "./run-history-model";

export function RunHistoryPanel({ history }: { history: BriefingRunHistoryContract }) {
  const model = createRunHistoryPanelModel(history);
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
      </header>

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
                  <small>{run.isLatest ? "Latest run" : run.heading}</small>
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
                <small>{run.aiCallCount} AI attempt(s) recorded</small>
              </span>
            </summary>

            <div className="run-history-detail">
              <section className="run-history-section" aria-label={`${run.heading} count notes`}>
                <h4>How to read the counts</h4>
                <p>
                  Source checks are records inspected by source adapters. Candidate matches are the
                  smaller set that became run candidates, so source checks can be higher than
                  matches. AI attempts are recorded provider attempts, not necessarily one call per
                  listing.
                </p>
              </section>

              <section className="run-detail-grid" aria-label={`${run.heading} pipeline counts`}>
                <RunMetric label="Candidate matches found" value={String(run.apiMatchedCount)} />
                <RunMetric label="Source records checked" value={run.checkedOrScrapedLabel} />
                <RunMetric label="Skipped prior" value={String(run.skippedCount)} />
                <RunMetric label="AI attempts recorded" value={String(run.aiCallCount)} />
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
                {run.providerMetadata.length === 0 ? (
                  <p>No AI call metadata recorded for this run.</p>
                ) : (
                  <ul>
                    {run.providerMetadata.map((metadata, index) => (
                      <li key={`${run.runId}-provider-${metadata}-${index}`}>
                        <strong>{metadata}</strong>
                        {run.providerDetails[index] ? ` · ${run.providerDetails[index]}` : ""}
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
                      These are D1 storage keys for evidence metadata rows retained by the run. They
                      are not openable files yet because there is no artifact viewer route.
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
