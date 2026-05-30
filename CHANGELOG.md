# Changelog

## [0.1.0] - 2026-05-30

### Added
- Initial release: `guard()` / `createGuardedHandler()` middleware for MCP tool calls
- Policy helpers: `allow`, `deny`, `requireConfirmation` with glob matching
- Token-bucket rate limiting (global + per-tool)
- Two-phase confirmation tokens (5-minute TTL, pluggable store)
- JSONL audit sink (`stdout` / `file` / custom) with hashed args by default
- PII redaction on tool results (email, phone, credit card)
