-- Invite codes are server-only configuration (GROUP_INVITE_CODES). The code seeded by 0001 is
-- public in git history, so replace the stored value with a non-credential placeholder. The
-- column stays NOT NULL UNIQUE for compatibility; nothing reads it for authorization.
UPDATE search_groups
SET invite_code = 'server-configured:' || id, updated_at = datetime('now')
WHERE invite_code = 'apt-g1';
