# Changelog

## [0.1.1] - 2026-07-27

### Fixed
- `consumeConfirmation` now rejects expired confirmation tokens itself instead of relying entirely on the `ConfirmationStore` implementation to filter them, so custom stores that don't evict expired records can't have stale tokens replayed.
- `getLogger()` no longer locks in the first caller's `debug` flag for the life of the process — the shared logger's level now updates on every call, so a later `guard()` instance with a different `debug` setting is respected.

## [0.1.0] - 2026-05-30

### Added
- Initial release: `guard()` / `createGuardedHandler()` middleware for MCP tool calls
- Policy helpers: `allow`, `deny`, `requireConfirmation` with glob matching
- Token-bucket rate limiting (global + per-tool)
- Two-phase confirmation tokens (5-minute TTL, pluggable store)
- JSONL audit sink (`stdout` / `file` / custom) with hashed args by default
- PII redaction on tool results (email, phone, credit card)
