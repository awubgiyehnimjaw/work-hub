import { expect, test } from "vitest";
import { parseClientTag } from "@/lib/frameio/parse-client-tag";

test("extracts tag from a normal filename", () => {
  expect(parseClientTag("Final Cut (Lovelots).mp4")).toBe("Lovelots");
});

test("extracts the last bracket group when there are multiple", () => {
  expect(parseClientTag("Draft (v2) Final (NLD).mov")).toBe("NLD");
});

test("returns null when there is no bracket group", () => {
  expect(parseClientTag("final_cut.mp4")).toBeNull();
});

test("trims whitespace inside the brackets", () => {
  expect(parseClientTag("Cut ( That Place ).mp4")).toBe("That Place");
});
