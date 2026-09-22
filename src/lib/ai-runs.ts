/** Server-only opt-in for paid discovery/extraction. Read at execution time. */
export type AiRunsEnv = { AI_RUNS_ENABLED?: string };

export function areAiRunsEnabled(env?: AiRunsEnv): boolean {
  const value = env?.AI_RUNS_ENABLED ?? process.env.AI_RUNS_ENABLED;
  return ["true", "1", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export class AiRunsDisabled extends Error {
  constructor() {
    super("ai-runs-disabled");
    this.name = "AiRunsDisabled";
  }
}
