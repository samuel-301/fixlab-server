import test from "node:test";
import assert from "node:assert/strict";
import {
  clearGeoIpCacheForTests,
  resolveClientLocationAsync,
  storedLocationFrom,
} from "../utils/geolocation.js";

const originalFetch = globalThis.fetch;
const originalToken = process.env.IPINFO_TOKEN;

test("maps IPinfo root-level fields into the saved session location shape", async () => {
  clearGeoIpCacheForTests();
  process.env.IPINFO_TOKEN = "test-ipinfo-token";
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => ({
        ip: "8.8.8.8",
        city: "Mountain View",
        region: "California",
        country: "US",
        loc: "37.386,-122.0838",
        timezone: "America/Los_Angeles",
      }),
    };
  };

  try {
    const location = await resolveClientLocationAsync("8.8.8.8");
    assert.equal(requestedUrl.origin, "https://ipinfo.io");
    assert.equal(requestedUrl.pathname, "/8.8.8.8");
    assert.equal(requestedUrl.searchParams.get("token"), "test-ipinfo-token");
    assert.equal(location.city, "Mountain View");
    assert.equal(location.region, "California");
    assert.equal(location.countryCode, "US");
    assert.equal(location.country, "United States");
    assert.equal(location.latitude, 37.386);
    assert.equal(location.longitude, -122.0838);
    assert.equal(location.timezone, "America/Los_Angeles");
    assert.equal(location.source, "ipinfo.io");

    const saved = storedLocationFrom({ geolocation: location, ip: "8.8.8.8" });
    assert.equal(saved.location, "Mountain View, California, United States");
    assert.equal(saved.geolocation.source, "ipinfo.io");
  } finally {
    globalThis.fetch = originalFetch;
    clearGeoIpCacheForTests();
    if (originalToken === undefined) delete process.env.IPINFO_TOKEN;
    else process.env.IPINFO_TOKEN = originalToken;
  }
});

test("returns an unavailable location when IPinfo responds with an error", async () => {
  clearGeoIpCacheForTests();
  process.env.IPINFO_TOKEN = "test-ipinfo-token";
  globalThis.fetch = async () => ({ ok: false, status: 429 });

  try {
    const location = await resolveClientLocationAsync("1.1.1.1");
    assert.equal(location.source, "unavailable");
    assert.equal(location.display, null);
    assert.equal(location.ip, "1.1.1.1");
  } finally {
    globalThis.fetch = originalFetch;
    clearGeoIpCacheForTests();
    if (originalToken === undefined) delete process.env.IPINFO_TOKEN;
    else process.env.IPINFO_TOKEN = originalToken;
  }
});
