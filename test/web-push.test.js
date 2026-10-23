import test from "node:test";
import assert from "node:assert/strict";
import { buildLoginPushPayload, validPushSubscription } from "../utils/web-push.js";

test("web push subscriptions require a trusted HTTPS push service and valid keys", () => {
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/example",
    keys: { p256dh: "A".repeat(65), auth: "B".repeat(22) },
  };
  assert.equal(validPushSubscription(subscription), true);
  assert.equal(validPushSubscription({ ...subscription, endpoint: "http://fcm.googleapis.com/fcm/send/example" }), false);
  assert.equal(validPushSubscription({ ...subscription, endpoint: "https://127.0.0.1/private" }), false);
  assert.equal(validPushSubscription({ ...subscription, endpoint: "https://example.com/push" }), false);
  assert.equal(validPushSubscription({ ...subscription, keys: { ...subscription.keys, auth: "bad" } }), false);
});

test("login push payload includes shared location and time, and opens FixLab sessions", () => {
  const payload = JSON.parse(buildLoginPushPayload({ device: "Firefox on Linux", location: "Kigali, Rwanda", time: "2026-10-21 12:00:00" }));
  assert.equal(payload.title, "FixLab — New sign-in detected");
  assert.match(payload.body, /Kigali, Rwanda/);
  assert.match(payload.body, /Firefox on Linux/);
  assert.match(payload.body, /2026-10-21 12:00:00 UTC/);
  assert.equal(payload.url, "/dashboard/sessions");
  assert.doesNotMatch(JSON.stringify(payload), /password|otp|token|secret/i);
  const withoutLocation = JSON.parse(buildLoginPushPayload({ device: "Firefox on Linux", time: "now" }));
  assert.match(withoutLocation.body, /Location unavailable/);
});
