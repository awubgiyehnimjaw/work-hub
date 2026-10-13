import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";
import { buildFrameioUrl, listNewFiles } from "@/lib/frameio/client";

const ACCOUNT_ID = "acct-1";
const PROJECT_ID = "proj-1";

beforeAll(() => {
  process.env.FRAMEIO_ACCOUNT_ID = ACCOUNT_ID;
  process.env.FRAMEIO_PROJECT_ID = PROJECT_ID;
});

beforeEach(async () => {
  await db.delete(oauthTokens);
  await db.insert(oauthTokens).values({
    provider: "frameio",
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600_000),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function projectResponse(rootFolderId: string) {
  return jsonResponse({ data: { root_folder_id: rootFolderId } });
}

test("buildFrameioUrl returns the Frame.io player URL for a file id", () => {
  expect(buildFrameioUrl("file-abc")).toBe("https://app.frame.io/player/file-abc");
});

test("listNewFiles resolves the token and root folder, and hits the real V4 endpoints with the right auth", async () => {
  const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = input.toString();
    if (url === `https://api.frame.io/v4/accounts/${ACCOUNT_ID}/projects/${PROJECT_ID}`) {
      return projectResponse("root-folder-1");
    }
    if (url.startsWith(`https://api.frame.io/v4/accounts/${ACCOUNT_ID}/folders/root-folder-1/files`)) {
      return jsonResponse({
        data: [
          {
            id: "f1",
            name: "Cut (Lovelots).mp4",
            created_at: "2026-01-02T00:00:00.000Z",
            type: "file",
            view_url: "https://frame.io/view/f1",
          },
        ],
        links: {},
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await listNewFiles("2026-01-01T00:00:00.000Z");

  expect(result).toEqual([
    {
      id: "f1",
      name: "Cut (Lovelots).mp4",
      createdAt: "2026-01-02T00:00:00.000Z",
      viewUrl: "https://frame.io/view/f1",
    },
  ]);

  // Every call carries the real header shape documented in the brief.
  for (const call of fetchMock.mock.calls) {
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-access-token");
    expect(headers["api-version"]).toBe("experimental");
  }
});

test("listNewFiles paginates via links.next until a page's oldest created_at is at or before the cursor, filtering the final result precisely", async () => {
  const sinceISO = "2026-01-01T00:00:00.000Z";
  const filesPageUrl = `https://api.frame.io/v4/accounts/${ACCOUNT_ID}/folders/root-folder-1/files?sort=created_at_desc`;
  const nextPageUrl = `https://api.frame.io/v4/accounts/${ACCOUNT_ID}/folders/root-folder-1/files?sort=created_at_desc&page=2`;

  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/projects/")) {
      return projectResponse("root-folder-1");
    }
    if (url === filesPageUrl) {
      // Oldest entry on this page (f-new-2) is still after sinceISO, so
      // listNewFiles must fetch links.next for an older page.
      return jsonResponse({
        data: [
          { id: "f-new-1", name: "a.mp4", created_at: "2026-01-05T00:00:00.000Z", type: "file", view_url: null },
          { id: "f-new-2", name: "b.mp4", created_at: "2026-01-04T00:00:00.000Z", type: "file", view_url: null },
        ],
        links: { next: nextPageUrl },
      });
    }
    if (url === nextPageUrl) {
      // Oldest entry here (f-old-1) is at/before sinceISO, so pagination
      // must stop after this page (no further links.next should be hit).
      return jsonResponse({
        data: [
          { id: "f-old-1", name: "c.mp4", created_at: "2025-12-31T00:00:00.000Z", type: "file", view_url: null },
        ],
        links: { next: "https://api.frame.io/v4/should-not-be-fetched" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await listNewFiles(sinceISO);

  expect(result.map((f) => f.id).sort()).toEqual(["f-new-1", "f-new-2"]);
  expect(fetchMock.mock.calls.some((c) => c[0].toString().includes("should-not-be-fetched"))).toBe(
    false,
  );
});

test("listNewFiles recurses into type:'folder' entries to find files in subfolders", async () => {
  const sinceISO = "2020-01-01T00:00:00.000Z";

  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/projects/")) {
      return projectResponse("root-folder-1");
    }
    if (url.includes("/folders/root-folder-1/files")) {
      return jsonResponse({
        data: [
          { id: "subfolder-1", name: "Subfolder", created_at: "2026-01-05T00:00:00.000Z", type: "folder" },
          { id: "f-root", name: "Cut (NLD).mp4", created_at: "2026-01-04T00:00:00.000Z", type: "file", view_url: null },
        ],
        links: {},
      });
    }
    if (url.includes("/folders/subfolder-1/files")) {
      return jsonResponse({
        data: [
          { id: "f-sub", name: "Cut (ARC).mp4", created_at: "2026-01-03T00:00:00.000Z", type: "file", view_url: null },
        ],
        links: {},
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await listNewFiles(sinceISO);

  expect(result.map((f) => f.id).sort()).toEqual(["f-root", "f-sub"]);
});

test("listNewFiles caps traversal at MAX_FOLDER_DEPTH (5), never fetching a 7th-level folder", async () => {
  // A chain of folders f0 -> f1 -> f2 -> ... each containing one file and
  // one subfolder pointer. Root is depth 0, so folders at depth 0..5 (6
  // folders: f0..f5) are fetched, but f6 (depth 6) must never be.
  const sinceISO = "2020-01-01T00:00:00.000Z";

  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/projects/")) {
      return projectResponse("f0");
    }
    const match = url.match(/\/folders\/(f\d+)\/files/);
    if (!match) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    const folderId = match[1];
    const n = Number(folderId.slice(1));
    return jsonResponse({
      data: [
        { id: `file-at-${n}`, name: `Cut (Lovelots) ${n}.mp4`, created_at: "2026-01-01T00:00:00.000Z", type: "file", view_url: null },
        { id: `f${n + 1}`, name: `sub-${n + 1}`, created_at: "2026-01-01T00:00:00.000Z", type: "folder" },
      ],
      links: {},
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await listNewFiles(sinceISO);

  const fetchedFolderIds = fetchMock.mock.calls
    .map((c) => c[0].toString().match(/\/folders\/(f\d+)\/files/)?.[1])
    .filter((id): id is string => Boolean(id));

  expect(fetchedFolderIds.sort()).toEqual(["f0", "f1", "f2", "f3", "f4", "f5"]);
  expect(result.map((f) => f.id).sort()).toEqual(
    ["file-at-0", "file-at-1", "file-at-2", "file-at-3", "file-at-4", "file-at-5"].sort(),
  );
});

test("listNewFiles throws when Frame.io is not connected (no oauthTokens row)", async () => {
  await db.delete(oauthTokens);
  vi.stubGlobal("fetch", vi.fn());

  await expect(listNewFiles("2026-01-01T00:00:00.000Z")).rejects.toThrow(
    /not connected/i,
  );
});
