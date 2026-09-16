import { stableHash } from "../utils/ids";

/** Daily-loop record ids are derived from their inputs so a re-run rewrites the same rows. */
export function stableId(value: string): string {
  return `daily-loop-${stableHash(value)}`;
}
