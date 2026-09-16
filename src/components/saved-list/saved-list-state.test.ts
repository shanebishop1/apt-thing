import { describe, expect, it } from "vitest";
import { describeRequestError, invalidIdentityMessage } from "./saved-list-state";
import { SharedListingRequestError } from "./shared-listings-client";

describe("describeRequestError", () => {
  it("translates known request codes into plain sentences", () => {
    expect(
      describeRequestError(new SharedListingRequestError("d1-binding-missing", 500), "fallback"),
    ).toBe("The shared database is not set up on the server yet.");
    expect(
      describeRequestError(new SharedListingRequestError("session-invalid", 401), "fallback"),
    ).toBe("Your session expired. Enter the invite code again.");
    expect(
      describeRequestError(new SharedListingRequestError("invalid-invite-code", 403), "fallback"),
    ).toBe(invalidIdentityMessage);
  });

  it("passes through server-authored messages that read as sentences", () => {
    const feedback = "Only http:// and https:// apartment listing URLs can be saved.";

    expect(describeRequestError(new Error(feedback), "fallback")).toBe(feedback);
  });

  it("keeps unknown codes visible alongside the caller's fallback", () => {
    expect(describeRequestError(new Error("brand-new-code"), "Could not save that.")).toBe(
      "Could not save that. (brand-new-code)",
    );
  });

  it("reports a failed fetch as a connection problem", () => {
    expect(describeRequestError(new TypeError("Failed to fetch"), "fallback")).toBe(
      "Could not reach the server. Check your connection and try again.",
    );
  });

  it("falls back when there is no message to show", () => {
    expect(describeRequestError(undefined, "fallback")).toBe("fallback");
    expect(describeRequestError(new Error("  "), "fallback")).toBe("fallback");
  });
});
