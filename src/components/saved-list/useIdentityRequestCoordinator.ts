import { useCallback, useEffect, useRef } from "react";
import type { InviteIdentity } from "@/lib/listings";
import { getIdentityKey } from "./saved-list-state";

type RequestKind = "load" | "mutation";

type RequestContext = {
  controller: AbortController;
  identityKey: string;
  kind: RequestKind;
  cancelled: boolean;
};

type RequestHandlers<T> = {
  onSuccess: (result: T) => void;
  onError?: (error: unknown) => void;
  onFinally?: () => void;
};

export function useIdentityRequestCoordinator() {
  const mountedRef = useRef(false);
  const currentIdentityKeyRef = useRef<string | undefined>(undefined);
  const activeLoadRef = useRef<RequestWork | undefined>(undefined);
  const pendingLoadRef = useRef<RequestWork | undefined>(undefined);
  const activeMutationRef = useRef<RequestWork | undefined>(undefined);
  const mutationQueueRef = useRef<RequestWork[]>([]);

  const abortAllRequests = useCallback(() => {
    const requests = [
      activeLoadRef.current,
      pendingLoadRef.current,
      activeMutationRef.current,
      ...mutationQueueRef.current,
    ];
    activeLoadRef.current = undefined;
    pendingLoadRef.current = undefined;
    activeMutationRef.current = undefined;
    mutationQueueRef.current = [];

    requests.forEach((work) => {
      if (work) abortWork(work);
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      abortAllRequests();
      currentIdentityKeyRef.current = undefined;
    };
  }, [abortAllRequests]);

  const activateIdentity = useCallback(
    (nextIdentity: InviteIdentity | undefined) => {
      const nextKey = nextIdentity ? getIdentityKey(nextIdentity) : undefined;
      const changed = currentIdentityKeyRef.current !== nextKey;

      if (changed) {
        abortAllRequests();
      }

      currentIdentityKeyRef.current = nextKey;
      return changed;
    },
    [abortAllRequests],
  );

  const isCurrentIdentity = useCallback((identity: InviteIdentity) => {
    return mountedRef.current && currentIdentityKeyRef.current === getIdentityKey(identity);
  }, []);

  const execute = useCallback(
    function execute<T>(
      activeIdentity: InviteIdentity,
      kind: RequestKind,
      task: (signal: AbortSignal) => Promise<T>,
      handlers: RequestHandlers<T>,
    ): Promise<void> {
      if (!isCurrentIdentity(activeIdentity)) {
        return Promise.resolve();
      }

      const request: RequestContext = {
        controller: new AbortController(),
        identityKey: getIdentityKey(activeIdentity),
        kind,
        cancelled: false,
      };

      return new Promise<void>((resolve) => {
        const work: RequestWork = {
          request,
          task: task as (signal: AbortSignal) => Promise<unknown>,
          handlers: handlers as RequestHandlers<unknown>,
          resolve,
          settled: false,
        };

        if (kind === "mutation") {
          enqueueMutation(work);
        } else {
          enqueueLoad(work);
        }
      });
    },
    [isCurrentIdentity],
  );

  function isCurrentRequest(request: RequestContext): boolean {
    return (
      mountedRef.current &&
      !request.cancelled &&
      currentIdentityKeyRef.current === request.identityKey
    );
  }

  function enqueueLoad(work: RequestWork) {
    abortActiveLoad();
    if (pendingLoadRef.current) {
      abortWork(pendingLoadRef.current);
      pendingLoadRef.current = undefined;
    }

    if (activeMutationRef.current || mutationQueueRef.current.length > 0) {
      pendingLoadRef.current = work;
      return;
    }

    startLoad(work);
  }

  function enqueueMutation(work: RequestWork) {
    abortActiveLoad();
    mutationQueueRef.current.push(work);
    drainMutations();
  }

  function startLoad(work: RequestWork) {
    if (!isCurrentRequest(work.request)) {
      abortWork(work);
      return;
    }

    activeLoadRef.current = work;
    void runLoad(work);
  }

  function drainMutations() {
    if (activeMutationRef.current) return;

    const nextMutation = mutationQueueRef.current.shift();
    if (nextMutation) {
      if (nextMutation.request.cancelled || !isCurrentRequest(nextMutation.request)) {
        abortWork(nextMutation);
        drainMutations();
        return;
      }

      activeMutationRef.current = nextMutation;
      void runMutation(nextMutation);
      return;
    }

    const pendingLoad = pendingLoadRef.current;
    pendingLoadRef.current = undefined;
    if (pendingLoad) startLoad(pendingLoad);
  }

  async function runLoad(work: RequestWork) {
    try {
      const result = await work.task(work.request.controller.signal);
      if (isCurrentRequest(work.request) && !work.request.controller.signal.aborted) {
        work.handlers.onSuccess(result);
      }
    } catch (error) {
      if (
        isCurrentRequest(work.request) &&
        !work.request.controller.signal.aborted &&
        !isAbortError(error)
      ) {
        work.handlers.onError?.(error);
      }
    } finally {
      if (activeLoadRef.current === work) activeLoadRef.current = undefined;
      if (isCurrentRequest(work.request)) work.handlers.onFinally?.();
      settleWork(work);
    }
  }

  async function runMutation(work: RequestWork) {
    try {
      const result = await work.task(work.request.controller.signal);
      if (isCurrentRequest(work.request) && !work.request.controller.signal.aborted) {
        work.handlers.onSuccess(result);
      }
    } catch (error) {
      if (
        isCurrentRequest(work.request) &&
        !work.request.controller.signal.aborted &&
        !isAbortError(error)
      ) {
        work.handlers.onError?.(error);
      }
    } finally {
      const wasActiveMutation = activeMutationRef.current === work;
      if (wasActiveMutation) activeMutationRef.current = undefined;
      if (isCurrentRequest(work.request)) work.handlers.onFinally?.();
      settleWork(work);
      if (wasActiveMutation && !work.request.cancelled) drainMutations();
    }
  }

  function abortActiveLoad() {
    const activeLoad = activeLoadRef.current;
    if (!activeLoad) return;
    activeLoadRef.current = undefined;
    abortWork(activeLoad);
  }

  function abortWork(work: RequestWork) {
    work.request.cancelled = true;
    work.request.controller.abort();
    settleWork(work);
  }

  function settleWork(work: RequestWork) {
    if (work.settled) return;
    work.settled = true;
    work.resolve();
  }

  return { activateIdentity, execute, isCurrentIdentity };
}

type RequestWork = {
  request: RequestContext;
  task: (signal: AbortSignal) => Promise<unknown>;
  handlers: RequestHandlers<unknown>;
  resolve: () => void;
  settled: boolean;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
