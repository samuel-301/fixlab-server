import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIp, isPublicIp, formatLocation, resolveClientLocation } from "../utils/geolocation.js";

test("normalizes bracketed IPv6 and IPv4-mapped IPv6", () => {
  assert.equal(normalizeIp("[2001:4860:4860::8888]"), "2001:4860:4860::8888");
  assert.equal(normalizeIp("::ffff:8.8.8.8"), "8.8.8.8");
  assert.equal(normalizeIp("not-an-ip"), null);
});

test("rejects non-public IPv4 and IPv6 ranges", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "203.0.113.5", "224.0.0.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  assert.equal(isPublicIp("8.8.8.8"), true);
  assert.equal(isPublicIp("2001:4860:4860::8888"), true);
});

test("formats readable locations and uses safe fallback labels", () => {
  assert.equal(formatLocation({ city: "Kigali", region: "Kigali", country: "Rwanda" }), "Kigali, Kigali, Rwanda");
  assert.equal(formatLocation({ country: "Rwanda" }), "Rwanda");
  assert.equal(formatLocation(null), "Location unavailable");
});

test("resolver never throws for missing/private IP and never fabricates location", () => {
  assert.equal(resolveClientLocation(undefined).source, "unavailable");
  assert.equal(resolveClientLocation("127.0.0.1").ip, null);
  const result = resolveClientLocation("203.0.113.20");
  assert.equal(result.ip, null);
  assert.equal(result.city, null);
});
