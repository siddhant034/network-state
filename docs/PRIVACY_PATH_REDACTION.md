# Diagnostic URL path redaction

Network State removes query strings, fragments, and embedded credentials from diagnostic URLs. When a user explicitly includes URL paths in telemetry or exports, the path redactor also masks several recognizable sensitive patterns:

- Values following common credential and identity labels (for example, `token`, `session`, `reset`, `email`, and `phone`).
- JWT-shaped path segments.
- Email-address-shaped path segments, including percent-encoded `@` and other encoded characters.

Email-shaped values are redacted even when the route does not use an explicit `/email/:value` pattern, because account identifiers are often embedded directly in resource paths.

This is a best-effort safeguard, not a guarantee of anonymization. Arbitrary user IDs, phone numbers without a recognized label, organization names, and other application-specific identifiers can still appear in a path. Path inclusion remains opt-in; keep it disabled when paths are not needed for diagnosis.
