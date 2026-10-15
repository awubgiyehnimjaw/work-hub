import { expect, test } from "vitest";
import { timingSafeEqual } from "@/lib/auth/timing-safe-equal";

test("true for equal strings", () => {
  expect(timingSafeEqual("abc", "abc")).toBe(true);
});

test("false for different strings of the same length", () => {
  expect(timingSafeEqual("abc", "abd")).toBe(false);
});

test("false for different lengths", () => {
  expect(timingSafeEqual("abc", "ab")).toBe(false);
});
