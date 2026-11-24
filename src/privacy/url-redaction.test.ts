import { describe, expect, it } from "vitest";
import { redactSensitivePath } from "./url-redaction";

describe("redactSensitivePath", () => {
  it.each([
    ["/users/123/profile", "/users/123/profile"],
    ["/session/private-id/dashboard", "/session/[redacted]/dashboard"],
    ["/reset/one-time-token", "/reset/[redacted]"],
    ["/token=secret-value/users/123", "/token=[redacted]/users/123"],
    ["/%61ccess_token/abc123/resource", "/%61ccess_token/[redacted]/resource"],
    ["/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturevalue1234567890", "/[redacted]"],
    ["/users/alex@example.com/profile", "/users/[redacted]/profile"],
    ["/users/alex%2Balerts%40example.com/profile", "/users/[redacted]/profile"],
    ["/contact/not-an-email/profile", "/contact/not-an-email/profile"],
    ["/customers/%2B1%20(415)%20555-2671/profile", "/customers/[redacted]/profile"],
    ["/contacts/555-0101/details", "/contacts/[redacted]/details"],
    ["/users/123456/profile", "/users/123456/profile"],
    ["/orders/20261123/details", "/orders/20261123/details"],
    ["/accounts/550e8400-e29b-41d4-a716-446655440000/settings", "/accounts/[redacted]/settings"],
    ["/devices/%7B550E8400-E29B-41D4-A716-446655440000%7D/status", "/devices/[redacted]/status"],
    ["/versions/1.2.3/release", "/versions/1.2.3/release"]
  ])("redacts %s", (input, expected) => {
    expect(redactSensitivePath(input)).toBe(expected);
  });

  it("does not throw for malformed percent escapes", () => {
    expect(redactSensitivePath("/%ZZ/session/secret")).toBe("/%ZZ/session/[redacted]");
  });
});
