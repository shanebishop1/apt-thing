// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import type { InviteIdentity } from "@/lib/listings";
import { useIdentityRequestCoordinator } from "./useIdentityRequestCoordinator";

const identity: InviteIdentity & { inviteCode: string } = {
  groupId: "group-1",
  inviteCode: "invite-1",
  displayName: "Ari",
  identityToken: "token-1",
};

describe("useIdentityRequestCoordinator", () => {
  it("runs mutations in invocation order and applies successes in that order", async () => {
    const started: string[] = [];
    const completed: string[] = [];
    const first = deferred<void>();
    const second = deferred<void>();
    let coordinator: ReturnType<typeof useIdentityRequestCoordinator> | undefined;

    render(
      <CoordinatorProbe
        onReady={(nextCoordinator) => {
          coordinator = nextCoordinator;
        }}
      />,
    );
    await waitFor(() => expect(coordinator).toBeDefined());

    coordinator!.activateIdentity(identity);
    const firstRequest = coordinator!.execute(
      identity,
      "mutation",
      async () => {
        started.push("first");
        await first.promise;
      },
      { onSuccess: () => completed.push("first") },
    );
    const secondRequest = coordinator!.execute(
      identity,
      "mutation",
      async () => {
        started.push("second");
        await second.promise;
      },
      { onSuccess: () => completed.push("second") },
    );

    expect(started).toEqual(["first"]);
    first.resolve();
    await waitFor(() => expect(started).toEqual(["first", "second"]));
    expect(completed).toEqual(["first"]);

    second.resolve();
    await Promise.all([firstRequest, secondRequest]);
    expect(completed).toEqual(["first", "second"]);
  });

  it("aborts active loads and waits to start newer loads until mutations settle", async () => {
    const started: string[] = [];
    const completed: string[] = [];
    const initialLoad = deferred<void>();
    const mutation = deferred<void>();
    const newerLoad = deferred<void>();
    let initialLoadSignal: AbortSignal | undefined;
    let coordinator: ReturnType<typeof useIdentityRequestCoordinator> | undefined;

    render(
      <CoordinatorProbe
        onReady={(nextCoordinator) => {
          coordinator = nextCoordinator;
        }}
      />,
    );
    await waitFor(() => expect(coordinator).toBeDefined());
    coordinator!.activateIdentity(identity);

    const initialLoadRequest = coordinator!.execute(
      identity,
      "load",
      async (signal) => {
        initialLoadSignal = signal;
        started.push("initial-load");
        await initialLoad.promise;
      },
      { onSuccess: () => completed.push("initial-load") },
    );
    const mutationRequest = coordinator!.execute(
      identity,
      "mutation",
      async () => {
        started.push("mutation");
        await mutation.promise;
      },
      { onSuccess: () => completed.push("mutation") },
    );
    const newerLoadRequest = coordinator!.execute(
      identity,
      "load",
      async () => {
        started.push("newer-load");
        await newerLoad.promise;
      },
      { onSuccess: () => completed.push("newer-load") },
    );

    expect(initialLoadSignal?.aborted).toBe(true);
    expect(started).toEqual(["initial-load", "mutation"]);

    mutation.resolve();
    await waitFor(() => expect(started).toEqual(["initial-load", "mutation", "newer-load"]));
    expect(completed).toEqual(["mutation"]);

    newerLoad.resolve();
    await Promise.all([initialLoadRequest, mutationRequest, newerLoadRequest]);
    expect(completed).toEqual(["mutation", "newer-load"]);
  });
});

function CoordinatorProbe({
  onReady,
}: {
  onReady: (coordinator: ReturnType<typeof useIdentityRequestCoordinator>) => void;
}) {
  const coordinator = useIdentityRequestCoordinator();

  useEffect(() => {
    onReady(coordinator);
  }, [coordinator, onReady]);

  return null;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
