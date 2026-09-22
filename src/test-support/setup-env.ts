import { TEST_GROUP_INVITE_CODES } from "./group-auth";

// Protected routes fail closed without server-side invite configuration; tests opt out per case.
process.env.GROUP_INVITE_CODES = TEST_GROUP_INVITE_CODES;
// Provider integration tests use mocked transports; production defaults to off.
process.env.AI_RUNS_ENABLED = "true";
