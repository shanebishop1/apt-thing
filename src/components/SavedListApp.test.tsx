// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedListingSnapshot } from "./saved-list/shared-listings-client";
import { SavedListApp } from "./SavedListApp";
import { defaultSearchGroup, type ListingCandidate } from "../lib/listings";
import { fixtureListings } from "../lib/fixtures";

vi.mock("leaflet", () => {
  const chain = () => ({
    addTo() {
      return this;
    },
    bindPopup() {
      return this;
    },
    on() {
      return this;
    },
    remove() {},
  });

  return {
    circleMarker: chain,
    divIcon: () => ({}),
    geoJSON: chain,
    layerGroup: chain,
    map: () => ({ fitBounds() {}, invalidateSize() {}, remove() {} }),
    marker: chain,
    tileLayer: chain,
  };
});

const fetchMock = vi.fn();
const validInviteCode = "user-entered-invite-code";

beforeEach(() => {
  localStorage.clear();
  sessionRequests = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "/api/group/session" ? sessionResponse(init) : fetchMock(input, init),
  );
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).includes("FeatureServer")) {
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }

    return jsonResponse({ ok: true, snapshot: snapshot([]) });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SavedListApp identity and shared listing behavior", () => {
  it("keeps the invite gate first, then loads a snapshot with authenticated headers", async () => {
    const user = userEvent.setup();
    const listing = buildListing("loaded-listing", "Loaded shared apartment");

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("FeatureServer")) {
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }

      if (String(input).includes(`/api/group/listings/${listing.id}`)) {
        return jsonResponse({
          ok: true,
          snapshot: snapshot([
            {
              ...listing,
              reviewStatus: "interested",
              display: { ...listing.display, reviewStatus: "interested" },
            },
          ]),
        });
      }

      return jsonResponse({ ok: true, snapshot: snapshot([listing]) });
    });

    render(<SavedListApp />);
    expect(screen.getByRole("region", { name: "Invite gate" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Saved listing review queue" })).toBeNull();

    await submitIdentity(user, "Ari");

    expect(await screen.findByRole("heading", { name: listing.title })).toBeTruthy();
    expect(sessionRequests).toEqual([{ inviteCode: validInviteCode, displayName: "Ari" }]);
    const getCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === "/api/group/listings" &&
        (init as RequestInit | undefined)?.method === undefined,
    );
    expect(getCall).toBeTruthy();
    const getInit = getCall?.[1] as RequestInit;
    expect(getInit.credentials).toBe("same-origin");
    expect(new Headers(getInit.headers).has("X-Invite-Code")).toBe(false);
    expect(JSON.parse(localStorage.getItem("apt-thing:v1:invite-identity")!)).toMatchObject({
      inviteCode: validInviteCode,
      displayName: "Ari",
      groupId: defaultSearchGroup.id,
    });

    await user.click(screen.getByRole("button", { name: `Selected ${listing.title}` }));
    await user.click(
      screen.getByRole("button", { name: `Change review status for ${listing.title}` }),
    );
    await user.click(screen.getByRole("option", { name: "interested" }));

    expect(await screen.findByText("Status updated to interested.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Change review status for ${listing.title}` }).textContent,
    ).toContain("interested");
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === `/api/group/listings/${listing.id}` &&
        (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    if (!patchCall) throw new Error("status request was not sent");
    expect(JSON.parse((patchCall[1] as RequestInit).body as string)).toEqual({
      mutation: "status",
      status: "interested",
      revision: 1,
    });
  });

  it("reports a stale status change as a conflict and adopts the server's current listing", async () => {
    const user = userEvent.setup();
    const listing = buildListing("conflict-listing", "Contested apartment");
    const current = {
      ...listing,
      reviewStatus: "touring" as const,
      revision: 2,
      display: { ...listing.display, reviewStatus: "touring" as const },
    };
    const patchBodies: Array<Record<string, unknown>> = [];

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("FeatureServer")) {
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }

      if (init?.method === "PATCH") {
        patchBodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
        return patchBodies.length === 1
          ? jsonResponse(
              {
                ok: false,
                error: "listing-revision-conflict",
                listing: current,
                snapshot: snapshot([current]),
              },
              409,
            )
          : jsonResponse({ ok: true, snapshot: snapshot([{ ...current, revision: 3 }]) });
      }

      return jsonResponse({ ok: true, snapshot: snapshot([listing]) });
    });

    render(<SavedListApp />);
    await submitIdentity(user, "Ari");
    await screen.findByRole("heading", { name: listing.title });
    await user.click(screen.getByRole("button", { name: `Selected ${listing.title}` }));
    const statusButton = () =>
      screen.getByRole("button", { name: `Change review status for ${listing.title}` });

    await user.click(statusButton());
    await user.click(screen.getByRole("option", { name: "interested" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Someone else changed that listing first/,
    );
    expect(screen.queryByText("Status updated to interested.")).toBeNull();
    expect(statusButton().textContent).toContain("touring");

    await user.click(statusButton());
    await user.click(screen.getByRole("option", { name: "interested" }));

    await waitFor(() => expect(patchBodies).toHaveLength(2));
    expect(patchBodies.map((body) => body.revision)).toEqual([1, 2]);
  });

  it("reports a listing removed by someone else without claiming success", async () => {
    const user = userEvent.setup();
    const listing = buildListing("removed-listing", "Removed apartment");

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("FeatureServer")) {
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }
      if (init?.method === "PATCH") {
        return jsonResponse({ ok: false, error: "listing-not-found", snapshot: snapshot([]) }, 404);
      }
      return jsonResponse({ ok: true, snapshot: snapshot([listing]) });
    });

    render(<SavedListApp />);
    await submitIdentity(user, "Ari");
    await screen.findByRole("heading", { name: listing.title });
    await user.click(screen.getByRole("button", { name: `Selected ${listing.title}` }));
    await user.click(
      screen.getByRole("button", { name: `Change review status for ${listing.title}` }),
    );
    await user.click(screen.getByRole("option", { name: "interested" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /That listing was removed by someone else/,
    );
    expect(screen.queryByRole("heading", { name: listing.title })).toBeNull();
  });

  it("ignores an older identity response after switching display names", async () => {
    const user = userEvent.setup();
    const oldListing = buildListing("old-listing", "Old identity apartment");
    const newListing = buildListing("new-listing", "New identity apartment");
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    let snapshotLoads = 0;

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("FeatureServer")) {
        return Promise.resolve(jsonResponse({ type: "FeatureCollection", features: [] }));
      }

      snapshotLoads += 1;
      return snapshotLoads === 1 ? oldResponse.promise : newResponse.promise;
    });

    render(<SavedListApp />);
    await submitIdentity(user, "Old");
    await waitFor(() => expect(snapshotLoads).toBe(1));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const displayNameInput = screen.getByLabelText("Display name");
    await user.clear(displayNameInput);
    await user.type(displayNameInput, "New");
    fireEvent.submit(screen.getByRole("form", { name: "Active group identity" }));

    await waitFor(() => expect(snapshotLoads).toBe(2));
    expect(sessionRequests.map((body) => body.displayName)).toEqual(["Old", "New"]);
    newResponse.resolve(jsonResponse({ ok: true, snapshot: snapshot([newListing]) }));
    await user.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByRole("heading", { name: newListing.title })).toBeTruthy();

    oldResponse.resolve(jsonResponse({ ok: true, snapshot: snapshot([oldListing]) }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: newListing.title })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: oldListing.title })).toBeNull();
    });
  });

  it("keeps the invite gate and stores nothing when the server rejects the invite", async () => {
    const user = userEvent.setup();

    render(<SavedListApp />);
    await user.type(screen.getByLabelText("Invite code"), "apt-g1");
    await user.type(screen.getByLabelText("Display name"), "Ari");
    fireEvent.submit(screen.getByRole("form", { name: "Invite identity" }));

    expect(await screen.findByText("Invite code or display name is invalid.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Invite gate" })).toBeTruthy();
    expect(localStorage.getItem("apt-thing:v1:invite-identity")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/group/listings", expect.anything());
  });

  it("restores a stored identity through a new session and re-establishes it after a 401", async () => {
    const listing = buildListing("restored-listing", "Restored apartment");
    localStorage.setItem(
      "apt-thing:v1:invite-identity",
      JSON.stringify({ inviteCode: validInviteCode, displayName: "Ari" }),
    );
    let loads = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("FeatureServer")) {
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }
      loads += 1;
      return loads === 1
        ? jsonResponse({ ok: false, error: "session-invalid" }, 401)
        : jsonResponse({ ok: true, snapshot: snapshot([listing]) });
    });

    render(<SavedListApp />);

    expect(await screen.findByRole("heading", { name: listing.title })).toBeTruthy();
    expect(sessionRequests).toHaveLength(2);
    expect(loads).toBe(2);
  });

  it("sends identity and URL on create, then selects the created listing and message", async () => {
    const user = userEvent.setup();
    const createdListing = buildListing("created-listing", "Created from source URL");

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("FeatureServer")) {
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }

      const method = (init as RequestInit | undefined)?.method;
      if (method === "POST" && String(input) === "/api/group/listings") {
        return jsonResponse({
          ok: true,
          snapshot: snapshot([createdListing]),
          result: { kind: "created", listing: createdListing, extraction: { ok: true } },
        });
      }

      if (method === "POST" && String(input).includes("/api/group/listings/")) {
        return jsonResponse({ ok: true, snapshot: snapshot([createdListing]) });
      }

      return jsonResponse({ ok: true, snapshot: snapshot([]) });
    });

    render(<SavedListApp />);
    await submitIdentity(user, "Ari");
    await user.click(await screen.findByLabelText("Add listing"));
    const urlInput = screen.getByPlaceholderText("https://streeteasy.com/building/...");
    await user.type(urlInput, "https://example.com/listing");
    fireEvent.submit(urlInput.closest("form") as HTMLFormElement);

    expect(await screen.findByRole("heading", { name: createdListing.title })).toBeTruthy();
    expect(
      screen
        .getAllByRole("status")
        .some((node) => node.textContent?.includes("extracted and saved")),
    ).toBe(true);
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === "/api/group/listings" &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    if (!postCall) throw new Error("create request was not sent");
    expect(JSON.parse((postCall[1] as RequestInit).body as string)).toEqual({
      url: "https://example.com/listing",
    });
  });

  it("opens the mobile listing detail and closes it with Escape", async () => {
    const user = userEvent.setup();
    const listing = buildListing("overlay-listing", "Overlay apartment");

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("FeatureServer")) {
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }

      return jsonResponse({ ok: true, snapshot: snapshot([listing]) });
    });

    render(<SavedListApp />);
    await submitIdentity(user, "Ari");
    await screen.findByRole("heading", { name: listing.title });

    await user.click(screen.getByRole("button", { name: `Selected ${listing.title}` }));
    const detailShell = screen.getByRole("article", { name: "Listing detail panel" }).parentElement;
    expect(detailShell?.className).toContain("mobile-detail-open");

    await user.keyboard("{Escape}");
    expect(detailShell?.className).not.toContain("mobile-detail-open");
  });
});

function buildListing(id: string, title: string): ListingCandidate {
  const listing = fixtureListings[0]!;
  return {
    ...listing,
    id,
    title,
    groupId: defaultSearchGroup.id,
    revision: 1,
    reviewStatus: "new",
    triageBucket: "confirmed-match",
    display: { ...listing.display, title, reviewStatus: "new", triageBucket: "confirmed-match" },
  };
}

function snapshot(listings: ListingCandidate[]): SharedListingSnapshot {
  return {
    groupId: defaultSearchGroup.id,
    listings,
    actions: [],
    memory: [],
    updatedAt: "2026-09-14T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

let sessionRequests: Array<{ inviteCode: string; displayName: string }> = [];

function sessionResponse(init?: RequestInit): Response {
  const body = JSON.parse(String(init?.body)) as { inviteCode: string; displayName: string };
  sessionRequests.push(body);
  if (body.inviteCode !== validInviteCode) {
    return jsonResponse({ ok: false, error: "invalid-invite-code" }, 403);
  }
  return jsonResponse({
    ok: true,
    identity: {
      groupId: defaultSearchGroup.id,
      groupName: defaultSearchGroup.name,
      displayName: body.displayName.trim(),
      identityToken: `actor_${defaultSearchGroup.id}_${body.displayName.trim()}`,
    },
  });
}

async function submitIdentity(user: ReturnType<typeof userEvent.setup>, displayName: string) {
  await user.type(screen.getByLabelText("Invite code"), validInviteCode);
  await user.type(screen.getByLabelText("Display name"), displayName);
  fireEvent.submit(screen.getByRole("form", { name: "Invite identity" }));
}
