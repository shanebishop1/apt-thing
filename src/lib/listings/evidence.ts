import type { EvidencePointer, FieldProvenance, ImageEvidence, ListingDraft } from "./domain";
import { MAX_IMAGES_PER_LISTING } from "./config";
import { EDITABLE_LISTING_FIELDS } from "./domain";
import { createId } from "./identity";

export function capImageEvidence(images: ImageEvidence[]): ImageEvidence[] {
  return images.slice(0, MAX_IMAGES_PER_LISTING).map((image, index) => ({
    ...image,
    role: index === 0 ? "primary" : image.role,
    sentToAi: true,
  }));
}

export function createSourceEvidencePointer(
  groupId: string,
  sourceUrl: string,
  capturedAt: string,
): EvidencePointer {
  return {
    id: createId(`${groupId}:evidence:${sourceUrl}`),
    groupId,
    kind: "source-page",
    sourceUrl,
    storage: {
      owner: "d1",
      scope: "authoritative-relational",
      groupScoped: true,
    },
    d1Table: "listing_evidence",
    quote: sourceUrl,
    capturedAt,
  };
}

const editableProvenanceFields = new Set<string>(EDITABLE_LISTING_FIELDS);

export function createFieldProvenanceFromDraft(
  draft: ListingDraft,
  updatedAt: string,
): FieldProvenance[] {
  return Object.entries(draft)
    .filter(([field, value]) => editableProvenanceFields.has(field) && value !== undefined)
    .map(([field, value]) => ({
      field: field as FieldProvenance["field"],
      source: "ai-extracted" as const,
      originalValue: String(value),
      updatedAt,
    }));
}
