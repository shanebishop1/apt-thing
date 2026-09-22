export type ProviderAttempt = {
  operation?: string;
  model?: string;
  attempt: number;
  status?: number;
  outcome: "response" | "timeout" | "network-error";
  durationMs: number;
};

type RequestPolicy = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  onAttempt?: (attempt: ProviderAttempt) => void;
};

export const PROVIDER_RETRY_POLICY = { maxRetries: 1, retryDelayMs: 250 } as const;
const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const maxRetryDelayMs = 2000;
const maxResponseBytes = 8 * 1024 * 1024;

/** Server-only, bounded transport for retry-safe acquisition and model-generation calls. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  policy: RequestPolicy = {},
) {
  const fetchImpl = policy.fetchImpl ?? fetch;
  for (let attempt = 1; ; attempt += 1) {
    init.signal?.throwIfAborted();
    const started = Date.now();
    const controller = new AbortController();
    const cancel = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("provider-request-timeout")),
      policy.timeoutMs ?? 20000,
    );
    let removeAbortListener = () => {};
    const aborted = new Promise<never>((_, reject) => {
      const listener = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", listener, { once: true });
      removeAbortListener = () => controller.signal.removeEventListener("abort", listener);
    });
    let response: Response | undefined;
    let failure: unknown;
    try {
      response = await Promise.race([
        fetchImpl(input, { ...init, signal: controller.signal }).then((result) =>
          bufferResponse(result, controller.signal),
        ),
        aborted,
      ]);
      policy.onAttempt?.({
        attempt,
        status: response.status,
        outcome: "response",
        durationMs: Date.now() - started,
      });
    } catch (error) {
      failure = error;
      policy.onAttempt?.({
        attempt,
        outcome: controller.signal.aborted ? "timeout" : "network-error",
        durationMs: Date.now() - started,
      });
    } finally {
      clearTimeout(timeout);
      removeAbortListener();
      init.signal?.removeEventListener("abort", cancel);
    }
    init.signal?.throwIfAborted();
    const delay = retryDelay(response, policy.retryDelayMs ?? PROVIDER_RETRY_POLICY.retryDelayMs);
    const retry =
      attempt <= PROVIDER_RETRY_POLICY.maxRetries &&
      delay <= maxRetryDelayMs &&
      (response
        ? transientStatuses.has(response.status)
        : !(failure instanceof Error && failure.message === "provider-response-too-large"));
    if (!retry) {
      if (response) return response;
      throw failure;
    }
    await waitForRetry(delay, init.signal);
  }
}

async function bufferResponse(response: Response, signal: AbortSignal): Promise<Response> {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) {
        void reader.cancel().catch(() => {});
        throw new Error("provider-response-too-large");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function retryDelay(response: Response | undefined, fallback: number): number {
  const header = response?.headers.get("retry-after");
  if (!header) return fallback;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) ? Math.max(fallback, delay) : fallback;
}

function waitForRetry(delay: number, signal?: AbortSignal | null) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
