import { describe, expect, it } from "vitest";
import { redactSensitivePath } from "./url-redaction";

describe("redactSensitivePath", () => {
  it.each([
    ["/users/123/profile", "/users/123/profile"],
    ["/session/private-id/dashboard", "/session/[redacted]/dashboard"],
    ["/reset/one-time-token", "/reset/[redacted]"],
    ["/token=secret-value/users/123", "/token=[redacted]/users/123"],
    ["/%61ccess_token/abc123/resource", "/%61ccess_token/[redacted]/resource"],
    ["/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturevalue1234567890", "/[redacted]"]
  ])("redacts %s", (input, expected) => {
    expect(redactSensitivePath(input)).toBe(expected);
  });

  it("does not throw for malformed percent escapes", () => {
    expect(redactSensitivePath("/%ZZ/session/secret")).toBe("/%ZZ/session/[redacted]");
  });
});
