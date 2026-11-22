/**
 * Redacts common secret-bearing URL path parameters before diagnostics retain
 * a path. This is a conservative heuristic, not a guarantee that arbitrary
 * application identifiers are non-sensitive.
 */
const sensitivePathLabels = /^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|key|secret|password|passwd|auth|authorization|session(?:id)?|sid|reset(?:[_-]?token)?|invite(?:[_-]?code)?|verification[_-]?code|email|phone|otp)$/i;
const emailLikeSegment = /^[^/?#@\s]+@[^/?#@\s]+\.[^/?#@\s]+$/;
// UUIDs commonly encode account, device, and transaction identifiers.
const uuidLikeSegment = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
// Avoid masking unformatted 8-digit dates/IDs. Require a prefix, separators,
// or a conventional 10+ digit international/national number for plain digits.
const phoneLikeSegment = /^\+?(?:\d[\s().-]*){7,15}$/;

function decodeSegment(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function isPhoneLike(value: string): boolean {
  if (!phoneLikeSegment.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return value.startsWith("+") || /[\s().-]/.test(value) || digits.length >= 10;
}

export function redactSensitivePath(pathname: string): string {
  const segments = pathname.split("/");
  for (let i = 0; i < segments.length; i++) {
    const decoded = decodeSegment(segments[i]);
    if (emailLikeSegment.test(decoded) || uuidLikeSegment.test(decoded) || isPhoneLike(decoded)) {
      segments[i] = "[redacted]";
      continue;
    }
    if (sensitivePathLabels.test(decoded)) {
      if (i + 1 < segments.length && segments[i + 1] !== "") segments[i + 1] = "[redacted]";
      continue;
    }
    if (/^[^=]+=[^=]+$/.test(decoded)) {
      const separator = decoded.indexOf("=");
      if (sensitivePathLabels.test(decoded.slice(0, separator))) {
        segments[i] = decoded.slice(0, separator) + "=[redacted]";
      }
    }
    if (/^[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(decoded)) {
      segments[i] = "[redacted]";
    }
  }
  return segments.join("/");
}
