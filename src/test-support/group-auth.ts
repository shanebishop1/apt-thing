import { defaultSearchGroup } from "../lib/listings";

/** Test-only invite code. It is never configured for any deployment. */
export const TEST_INVITE_CODE = "test-only-invite-code-not-deployed";
export const TEST_GROUP_INVITE_CODES = `${defaultSearchGroup.id}=${TEST_INVITE_CODE}`;
