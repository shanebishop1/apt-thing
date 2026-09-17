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
  const [loadedIdentityKey, setLoadedIdentityKey] = useState(identityKey);

  // `refresh` stays referentially stable so callers can pass it straight to a button and
  // to an effect; it reads the current identity through this ref instead of closing over it.
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  // Switching group drops the previous group's history rather than showing it as this
  // group's. Adjusting during render lands the reset in the same commit as the new key.
  if (identityKey !== loadedIdentityKey) {
    setLoadedIdentityKey(identityKey);
    setState({ status: "loading" });
  }

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
    if (active && identityKey) refresh();
    return () => controllerRef.current?.abort();
  }, [active, identityKey, refresh]);

  return { state, refresh };
}
