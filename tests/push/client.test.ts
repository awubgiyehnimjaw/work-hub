import { expect, test } from "vitest";
import { urlBase64ToUint8Array } from "@/lib/push/client";

// Fixture: 65 random bytes (the length of a real uncompressed EC public
// key, as VAPID keys are) encoded as base64url (Node's `Buffer.toString
// ("base64url")`) — chosen because its encoding contains both `-` and `_`
// and isn't a multiple of 4 characters long (so it needs padding restored),
// exercising both of the easy-to-get-wrong steps in one fixture.
const RAW_BYTES = [
  194, 156, 92, 89, 74, 176, 113, 60, 142, 182, 152, 79, 197, 157, 73, 38, 153, 187, 131, 95, 109,
  181, 225, 72, 227, 104, 84, 178, 66, 141, 200, 208, 60, 149, 138, 135, 35, 141, 11, 227, 232,
  125, 58, 18, 154, 52, 127, 244, 208, 74, 167, 140, 188, 160, 1, 191, 119, 212, 126, 241, 183,
  223, 105, 166, 183,
];
const BASE64URL =
  "wpxcWUqwcTyOtphPxZ1JJpm7g19tteFI42hUskKNyNA8lYqHI40L4-h9OhKaNH_00EqnjLygAb931H7xt99pprc";

test("urlBase64ToUint8Array decodes a base64url VAPID key to the exact original bytes", () => {
  const result = urlBase64ToUint8Array(BASE64URL);

  expect(Array.from(result)).toEqual(RAW_BYTES);
  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.length).toBe(65);
});

test("urlBase64ToUint8Array handles a key whose length is already a multiple of 4 (no padding needed)", () => {
  // 48 raw bytes base64url-encodes to exactly 64 characters, no `=` padding
  // required — covers the (4 - (len % 4)) % 4 === 0 branch explicitly.
  const bytes = Array.from({ length: 48 }, (_, i) => i * 5);
  const base64url = Buffer.from(bytes).toString("base64url");

  const result = urlBase64ToUint8Array(base64url);

  expect(Array.from(result)).toEqual(bytes);
});

test("urlBase64ToUint8Array round-trips every possible byte value (0-255)", () => {
  const bytes = Array.from({ length: 256 }, (_, i) => i);
  const base64url = Buffer.from(bytes).toString("base64url");

  const result = urlBase64ToUint8Array(base64url);

  expect(Array.from(result)).toEqual(bytes);
});
