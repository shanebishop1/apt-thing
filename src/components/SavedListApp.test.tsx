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

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
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
    const getCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).includes("/api/group/listings?") &&
        (init as RequestInit | undefined)?.method === undefined,
    );
    expect(getCall).toBeTruthy();
    expect(String(getCall?.[0])).toBe(
      `/api/group/listings?groupId=${encodeURIComponent(defaultSearchGroup.id)}`,
    );
    const headers = new Headers((getCall?.[1] as RequestInit | undefined)?.headers);
    expect(headers.get("X-Invite-Code")).toBe("apt-g1");
    expect(headers.get("X-Display-Name")).toBe("Ari");

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
      inviteCode: "apt-g1",
      displayName: "Ari",
    });
  });

  it("ignores an older identity response after switching display names", async () => {
    const user = userEvent.setup();
    const oldListing = buildListing("old-listing", "Old identity apartment");
    const newListing = buildListing("new-listing", "New identity apartment");
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("FeatureServer")) {
        return Promise.resolve(jsonResponse({ type: "FeatureCollection", features: [] }));
      }

      const displayName = new Headers(init?.headers).get("X-Display-Name");
      return displayName === "Old" ? oldResponse.promise : newResponse.promise;
    });

    render(<SavedListApp />);
    await submitIdentity(user, "Old");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const displayNameInput = screen.getByLabelText("Display name");
    await user.clear(displayNameInput);
    await user.type(displayNameInput, "New");
    fireEvent.submit(screen.getByRole("form", { name: "Active group identity" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).includes("/api/group/listings?") &&
            new Headers((init as RequestInit | undefined)?.headers).get("X-Display-Name") === "New",
        ),
      ).toBe(true);
    });
    newResponse.resolve(jsonResponse({ ok: true, snapshot: snapshot([newListing]) }));
    await user.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByRole("heading", { name: newListing.title })).toBeTruthy();

    oldResponse.resolve(jsonResponse({ ok: true, snapshot: snapshot([oldListing]) }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: newListing.title })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: oldListing.title })).toBeNull();
    });
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
    await user.click(screen.getByLabelText("Add listing"));
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
      inviteCode: "apt-g1",
      displayName: "Ari",
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

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function submitIdentity(user: ReturnType<typeof userEvent.setup>, displayName: string) {
  await user.type(screen.getByLabelText("Invite code"), "apt-g1");
  await user.type(screen.getByLabelText("Display name"), displayName);
  fireEvent.submit(screen.getByRole("form", { name: "Invite identity" }));
}
