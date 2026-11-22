# Diagnostic URL path redaction

Network State removes query strings, fragments, and embedded credentials from diagnostic URLs. When a user explicitly includes URL paths in telemetry or exports, the path redactor also masks several recognizable sensitive patterns:

- Values following common credential and identity labels (for example, `token`, `session`, `reset`, `email`, and `phone`).
- JWT-shaped path segments.
- Email-address-shaped path segments, including percent-encoded `@` and other encoded characters.
- Phone-number-shaped segments containing 7–15 digits, including common international prefixes and separators.

Email and phone-shaped values are redacted even when the route does not use an explicit sensitive label, because account identifiers and contact details are sometimes embedded directly in resource paths. Short numeric identifiers are retained to avoid hiding ordinary small resource IDs.

This is a best-effort safeguard, not a guarantee of anonymization. Arbitrary user IDs, application-specific identifiers, and phone numbers in unrecognized formats can still appear in a path. Some numeric identifiers may also resemble phone numbers and be redacted. Path inclusion remains opt-in; keep it disabled when paths are not needed for diagnosis.
