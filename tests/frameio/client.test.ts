import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";
import { buildFrameioUrl, listNewFiles } from "@/lib/frameio/client";
import { refreshFrameioToken } from "@/lib/frameio/oauth";

const ACCOUNT_ID = "acct-1";
const PROJECT_ID = "proj-1";

// `refreshFrameioToken` lives in oauth.ts; client.ts calls it when the
// stored token is at/near expiry. Mocked here so refresh-triggering tests
// can assert it was called without needing a real Adobe token endpoint —
// tests of the refresh implementation itself live in oauth.test.ts. Tests
// below that use a token far from expiry never trigger it, so this mock is
// inert for them.
vi.mock("@/lib/frameio/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/frameio/oauth")>(
    "@/lib/frameio/oauth",
  );
  return {
    ...actual,
    refreshFrameioToken: vi.fn(),
  };
});

const mockRefreshFrameioToken = refreshFrameioToken as unknown as ReturnType<typeof vi.fn>;

beforeAll(() => {
  process.env.FRAMEIO_ACCOUNT_ID = ACCOUNT_ID;
  process.env.FRAMEIO_PROJECT_ID = PROJECT_ID;
});

beforeEach(async () => {
  mockRefreshFrameioToken.mockReset().mockResolvedValue(undefined);
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

  expect(result.truncated).toBe(false);
  expect(result.files).toEqual([
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

test("listNewFiles paginates via links.next past the file cutoff, filtering the final result precisely", async () => {
  const sinceISO = "2026-01-01T00:00:00.000Z";
  const filesPageUrl = `https://api.frame.io/v4/accounts/${ACCOUNT_ID}/folders/root-folder-1/files?sort=created_at_desc`;
  const nextPageUrl = `https://api.frame.io/v4/accounts/${ACCOUNT_ID}/folders/root-folder-1/files?sort=created_at_desc&page=2`;

  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/projects/")) {
      return projectResponse("root-folder-1");
    }
    if (url === filesPageUrl) {
      return jsonResponse({
        data: [
          { id: "f-new-1", name: "a.mp4", created_at: "2026-01-05T00:00:00.000Z", type: "file", view_url: null },
          { id: "f-new-2", name: "b.mp4", created_at: "2026-01-04T00:00:00.000Z", type: "file", view_url: null },
        ],
        links: { next: nextPageUrl },
      });
    }
    if (url === nextPageUrl) {
      // Oldest entry here (f-old-1) is at/before sinceISO. Pagination still
      // continues past this page (folder discovery is decoupled from the
      // file cutoff — see the dedicated test below) but no further folder
      // or file entries exist here, so there's nothing more to find.
      return jsonResponse({
        data: [
          { id: "f-old-1", name: "c.mp4", created_at: "2025-12-31T00:00:00.000Z", type: "file", view_url: null },
        ],
        links: {},
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await listNewFiles(sinceISO);

  expect(result.files.map((f) => f.id).sort()).toEqual(["f-new-1", "f-new-2"]);
  expect(result.truncated).toBe(false);
});

test("listNewFiles discovers a subfolder on a later page even though page 1's oldest file is already before the cursor", async () => {
  // Regression test for the bug where pagination stopped as soon as a
  // page's oldest FILE was at/before the cursor — which meant a subfolder
  // listed on a later page (subfolders sort by their own creation time,
  // not by their newest file) was never discovered, and a video uploaded
  // into it later would never be seen by any future poll either.
  const sinceISO = "2026-01-10T00:00:00.000Z";
  const filesPageUrl = `https://api.frame.io/v4/accounts/${ACCOUNT_ID}/folders/root-folder-1/files?sort=created_at_desc`;
  const nextPageUrl = `https://api.frame.io/v4/accounts/${ACCOUNT_ID}/folders/root-folder-1/files?sort=created_at_desc&page=2`;

  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/projects/")) {
      return projectResponse("root-folder-1");
    }
    if (url === filesPageUrl) {
      // Page 1: recent loose files in the root, whose oldest entry is
      // already at/before the cursor. A buggy implementation would stop
      // paginating right here.
      return jsonResponse({
        data: [
          { id: "loose-1", name: "a.mp4", created_at: "2026-01-12T00:00:00.000Z", type: "file", view_url: null },
          { id: "loose-2", name: "b.mp4", created_at: "2026-01-01T00:00:00.000Z", type: "file", view_url: null },
        ],
        links: { next: nextPageUrl },
      });
    }
    if (url === nextPageUrl) {
      // Page 2: an old per-client subfolder, created long before the
      // cursor, that must still be discovered and visited.
      return jsonResponse({
        data: [
          { id: "old-subfolder", name: "Lovelots", created_at: "2025-01-01T00:00:00.000Z", type: "folder" },
        ],
        links: {},
      });
    }
    if (url.includes("/folders/old-subfolder/files")) {
      return jsonResponse({
        data: [
          { id: "f-in-subfolder", name: "Cut (Lovelots).mp4", created_at: "2026-01-11T00:00:00.000Z", type: "file", view_url: null },
        ],
        links: {},
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await listNewFiles(sinceISO);

  expect(result.files.map((f) => f.id).sort()).toEqual(["f-in-subfolder", "loose-1"]);
  expect(result.truncated).toBe(false);
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

  expect(result.files.map((f) => f.id).sort()).toEqual(["f-root", "f-sub"]);
  expect(result.truncated).toBe(false);
});

test("listNewFiles caps traversal at MAX_FOLDER_DEPTH (5), never fetching a 7th-level folder, and reports truncated", async () => {
  // A chain of folders f0 -> f1 -> f2 -> ... each containing one file and
  // one subfolder pointer. Root is depth 0, so folders at depth 0..5 (6
  // folders: f0..f5) are fetched, but f6 (depth 6) must never be.
  const sinceISO = "2020-01-01T00:00:00.000Z";

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
  expect(result.files.map((f) => f.id).sort()).toEqual(
    ["file-at-0", "file-at-1", "file-at-2", "file-at-3", "file-at-4", "file-at-5"].sort(),
  );
  // f6 was discovered (listed as a folder entry on f5's page) but never
  // visited because of the depth cap — this must be signaled, not silent.
  expect(result.truncated).toBe(true);
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("MAX_FOLDER_DEPTH"));

  warnSpy.mockRestore();
});

test("listNewFiles reports truncated and warns when MAX_FOLDERS_VISITED is hit", async () => {
  const sinceISO = "2020-01-01T00:00:00.000Z";
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  // Root folder fans out into 60 subfolders (more than MAX_FOLDERS_VISITED
  // = 50), each of which is otherwise empty.
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/projects/")) {
      return projectResponse("root-folder-1");
    }
    if (url.includes("/folders/root-folder-1/files")) {
      return jsonResponse({
        data: Array.from({ length: 60 }, (_, i) => ({
          id: `sub-${i}`,
          name: `sub-${i}`,
          created_at: "2026-01-01T00:00:00.000Z",
          type: "folder",
        })),
        links: {},
      });
    }
    const match = url.match(/\/folders\/(sub-\d+)\/files/);
    if (match) {
      return jsonResponse({ data: [], links: {} });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await listNewFiles(sinceISO);

  expect(result.truncated).toBe(true);
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("MAX_FOLDERS_VISITED"));

  // root + 49 subfolders = 50 total folders visited (MAX_FOLDERS_VISITED).
  const visitedSubfolders = fetchMock.mock.calls
    .map((c) => c[0].toString().match(/\/folders\/(sub-\d+)\/files/)?.[1])
    .filter((id): id is string => Boolean(id));
  expect(visitedSubfolders).toHaveLength(49);

  warnSpy.mockRestore();
});

test("listNewFiles caps pagination at MAX_PAGES_PER_FOLDER for a single folder and reports truncated", async () => {
  const sinceISO = "2020-01-01T00:00:00.000Z";
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  // A folder whose `links.next` chain never ends (e.g. the server ignored
  // `sort=created_at_desc`, so the file-cutoff optimization never kicks in
  // either) — must still terminate via the hard page cap.
  let pageCount = 0;
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/projects/")) {
      return projectResponse("root-folder-1");
    }
    if (url.includes("/folders/root-folder-1/files")) {
      pageCount++;
      return jsonResponse({
        data: [
          { id: `f-page-${pageCount}`, name: "a.mp4", created_at: "2026-01-01T00:00:00.000Z", type: "file", view_url: null },
        ],
        links: { next: `https://api.frame.io/v4/accounts/${ACCOUNT_ID}/folders/root-folder-1/files?page=${pageCount + 1}` },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await listNewFiles(sinceISO);

  expect(pageCount).toBe(20);
  expect(result.truncated).toBe(true);
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("MAX_PAGES_PER_FOLDER"));

  warnSpy.mockRestore();
});

test("listNewFiles throws when Frame.io is not connected (no oauthTokens row)", async () => {
  await db.delete(oauthTokens);
  vi.stubGlobal("fetch", vi.fn());

  await expect(listNewFiles("2026-01-01T00:00:00.000Z")).rejects.toThrow(
    /not connected/i,
  );
});

test("listNewFiles refreshes the access token when it is within 5 minutes of expiring, before making any Frame.io request", async () => {
  await db
    .update(oauthTokens)
    .set({ expiresAt: new Date(Date.now() + 60_000) }) // 1 minute left, under the 5-minute buffer
    .where(eq(oauthTokens.provider, "frameio"));

  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/projects/")) {
      return projectResponse("root-folder-1");
    }
    return jsonResponse({ data: [], links: {} });
  });
  vi.stubGlobal("fetch", fetchMock);

  await listNewFiles("2026-01-01T00:00:00.000Z");

  expect(mockRefreshFrameioToken).toHaveBeenCalledTimes(1);
});

test("listNewFiles does not refresh the access token when it still has more than 5 minutes left", async () => {
  // beforeEach already seeds a token expiring in 1 hour.
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/projects/")) {
      return projectResponse("root-folder-1");
    }
    return jsonResponse({ data: [], links: {} });
  });
  vi.stubGlobal("fetch", fetchMock);

  await listNewFiles("2026-01-01T00:00:00.000Z");

  expect(mockRefreshFrameioToken).not.toHaveBeenCalled();
});
