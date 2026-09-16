"use client";

import type { FormEvent } from "react";
import type { InviteIdentity } from "@/lib/listings";
import type { IdentityFormState } from "./saved-list-state";

type InviteIdentityFormProps = {
  mode: "gate" | "settings";
  identityForm: IdentityFormState;
  identity?: InviteIdentity;
  message: string;
  onChange: (field: keyof IdentityFormState, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function InviteIdentityForm({
  mode,
  identityForm,
  identity,
  message,
  onChange,
  onSubmit,
}: InviteIdentityFormProps) {
  if (mode === "gate") {
    return (
      <section className="settings-card" aria-label="Invite gate">
        <div className="panel-heading settings-heading">
          <div>
            <p className="eyebrow">Private roommate search</p>
            <h1>Enter your invite</h1>
          </div>
          <p>Enter the shared invite code and your display name to load the apartment list.</p>
        </div>
        <IdentityForm
          mode={mode}
          identityForm={identityForm}
          identity={identity}
          message={message}
          onChange={onChange}
          onSubmit={onSubmit}
        />
      </section>
    );
  }

  return (
    <section className="settings-card" aria-label="Settings">
      <div className="panel-heading settings-heading">
        <div>
          <h2>Settings</h2>
        </div>
      </div>
      <IdentityForm
        mode={mode}
        identityForm={identityForm}
        identity={identity}
        message={message}
        onChange={onChange}
        onSubmit={onSubmit}
      />
    </section>
  );
}

function IdentityForm({
  mode,
  identityForm,
  identity,
  message,
  onChange,
  onSubmit,
}: InviteIdentityFormProps) {
  const isGate = mode === "gate";

  return (
    <form
      className="settings-form"
      aria-label={isGate ? "Invite identity" : "Active group identity"}
      onSubmit={onSubmit}
    >
      <label className="settings-field">
        Invite code
        <input
          autoCapitalize="none"
          autoComplete="off"
          value={identityForm.inviteCode}
          onChange={(event) => onChange("inviteCode", event.target.value)}
          required={isGate}
        />
      </label>
      <label className="settings-field">
        Display name
        <input
          autoComplete={isGate ? "name" : undefined}
          value={identityForm.displayName}
          onChange={(event) => onChange("displayName", event.target.value)}
          required={isGate}
        />
      </label>
      <button type="submit">{isGate ? "Enter shared list" : "Save identity"}</button>
      <div className="settings-status" role="status" aria-live="polite">
        <span className="eyebrow">{isGate ? "Access required" : "Current workspace"}</span>
        <strong>
          {isGate ? "No active group" : identity ? identity.groupId : "No active group"}
        </strong>
        <p>
          {isGate
            ? message || "Enter a valid invite code and display name to continue."
            : identity
              ? `Saving as ${identity.displayName}`
              : "Enter a valid invite code."}
        </p>
      </div>
    </form>
  );
}
