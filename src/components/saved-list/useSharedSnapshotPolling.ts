import { useEffect, useRef } from "react";
import type { InviteIdentity } from "../../lib/listings";
import { getIdentityKey, sharedSnapshotPollMs } from "./saved-list-state";

type RefreshOptions = { silent?: boolean };
type RefreshSnapshot<T> = (identity: T, options?: RefreshOptions) => Promise<void>;

export function useSharedSnapshotPolling<T extends InviteIdentity>({
  hasHydrated,
  identity,
  refreshSnapshot,
}: {
  hasHydrated: boolean;
  identity: T | undefined;
  refreshSnapshot: RefreshSnapshot<T>;
}) {
  const refreshSnapshotRef = useRef(refreshSnapshot);
  refreshSnapshotRef.current = refreshSnapshot;

  const identityKey = identity ? getIdentityKey(identity) : undefined;

  useEffect(() => {
    if (!hasHydrated || !identity) {
      return;
    }

    const activeIdentity = identity;
    let stopped = false;
    let timeoutId: number | undefined;

    const canRefresh = () => document.visibilityState === "visible" && navigator.onLine;
    const schedule = (delay = sharedSnapshotPollMs) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        if (stopped) return;
        if (canRefresh()) {
          const scheduleAfterRefresh = () => {
            if (!stopped) schedule();
          };

          try {
            void refreshSnapshotRef
              .current(activeIdentity, { silent: true })
              .then(scheduleAfterRefresh, scheduleAfterRefresh);
          } catch {
            scheduleAfterRefresh();
          }
          return;
        }
        schedule();
      }, delay);
    };
    const refreshNow = () => {
      if (canRefresh()) {
        void refreshSnapshotRef.current(activeIdentity, { silent: true });
      }
    };

    schedule();
    window.addEventListener("focus", refreshNow);
    window.addEventListener("online", refreshNow);
    document.addEventListener("visibilitychange", refreshNow);

    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("online", refreshNow);
      document.removeEventListener("visibilitychange", refreshNow);
    };
  }, [hasHydrated, identityKey]);
}
