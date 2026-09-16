"use client";

import type { ListingCandidate } from "@/lib/listings";

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function formatMoney(value?: number) {
  if (value === undefined) {
    return "Rent TBD";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatAverageRent(listing: Pick<ListingCandidate, "rent" | "bedrooms">) {
  if (listing.rent === undefined || listing.bedrooms === undefined || listing.bedrooms <= 0) {
    return "?";
  }

  return formatMoney(listing.rent / listing.bedrooms);
}

export function formatListingAddedAge(createdAt: string) {
  const createdTime = new Date(createdAt).getTime();

  if (!Number.isFinite(createdTime)) {
    return "TBD";
  }

  const dayInMilliseconds = 24 * 60 * 60 * 1000;
  const ageDays = Math.max(0, Math.floor((Date.now() - createdTime) / dayInMilliseconds));

  return `${ageDays} ${ageDays === 1 ? "day" : "days"}`;
}

export function formatLabel(value: string) {
  return value.replace(/[-_]/g, " ");
}
