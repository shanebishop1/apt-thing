"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunHistoryState } from "./RunHistoryPanel";
import { describeRequestError, getIdentityKey } from "./saved-list-state";
import { loadRunHistory, type GroupSession } from "./shared-listings-client";

export function useRunHistory(identity: GroupSession | undefined, active: boolean) {
  const [state, setState] = useState<RunHistoryState>({ status: "loading" });
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const identityKey = identity ? getIdentityKey(identity) : undefined;
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const refresh = useCallback(() => {
    const activeIdentity = identityRef.current;
    if (!activeIdentity) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) => ({ status: "loading", history: current.history }));

    loadRunHistory(activeIdentity, { signal: controller.signal }).then(
      (history) => {
        if (!controller.signal.aborted) setState({ status: "ready", history });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          status: "error",
          error: describeRequestError(error, "Could not load this group's run history."),
          history: current.history,
        }));
      },
    );
  }, []);

  useEffect(() => {
    setState({ status: "loading" });
  }, [identityKey]);

  useEffect(() => {
    if (active && identityKey) refresh();
    return () => controllerRef.current?.abort();
  }, [active, identityKey, refresh]);

  return { state, refresh };
}
