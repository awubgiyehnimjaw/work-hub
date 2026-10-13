import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";

/**
 * Frame.io V4 API client for polling new review files.
 *
 * Verified (not guessed) shape of the file-listing endpoint:
 * `GET /v4/accounts/{account_id}/folders/{folder_id}/files`, header
 * `api-version: experimental`, response
 * `{ data: [{ id, name, created_at, type, view_url, ... }], links: { next? } }`.
 * There is no server-side "created after" filter, so we request
 * `sort=created_at_desc` and paginate via `links.next` until a page's
 * oldest `created_at` is at or before the requested cursor.
 *
 * ASSUMPTION (flagged per the task brief — not independently confirmed
 * beyond the brief's own note): the project-details endpoint used to
 * resolve `root_folder_id` is `GET /v4/accounts/{account_id}/projects/{project_id}`,
 * following the same `/v4/accounts/{account_id}/...` pattern as the files
 * endpoint. If this path is wrong, `listNewFiles` will fail fast (non-2xx
 * throws) rather than silently returning nothing.
 */

export interface FrameioFile {
  id: string;
  name: string;
  createdAt: string;
  viewUrl: string | null;
}

interface FrameioApiEntry {
  id: string;
  name: string;
  created_at: string;
  type: string;
  view_url?: string | null;
}

interface FrameioFilesResponse {
  data: FrameioApiEntry[];
  links?: { next?: string };
}

interface FrameioProjectResponse {
  data: {
    root_folder_id: string;
  };
}

const FRAMEIO_API_BASE = "https://api.frame.io/v4";

// Safety net against runaway recursion/pagination if a project's folder
// structure is unexpectedly deep or wide (e.g. an editor nests cuts many
// levels deep, or a misbehaving API keeps returning folders).
const MAX_FOLDER_DEPTH = 5;
const MAX_FOLDERS_VISITED = 50;

function requireEnv(name: "FRAMEIO_ACCOUNT_ID" | "FRAMEIO_PROJECT_ID"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

async function getAccessToken(): Promise<string> {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "frameio"));

  if (!row) {
    throw new Error(
      "Frame.io is not connected (no oauthTokens row for provider 'frameio')",
    );
  }

  return row.accessToken;
}

async function frameioFetch(url: string, accessToken: string): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "api-version": "experimental",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Frame.io API request failed: ${response.status} ${body}`);
  }

  return response;
}

async function getRootFolderId(accessToken: string): Promise<string> {
  const accountId = requireEnv("FRAMEIO_ACCOUNT_ID");
  const projectId = requireEnv("FRAMEIO_PROJECT_ID");

  const response = await frameioFetch(
    `${FRAMEIO_API_BASE}/accounts/${accountId}/projects/${projectId}`,
    accessToken,
  );
  const body = (await response.json()) as FrameioProjectResponse;
  return body.data.root_folder_id;
}

/** Fallback review-link builder, used only when the API's own `view_url` is null. */
export function buildFrameioUrl(fileId: string): string {
  return `https://app.frame.io/player/${fileId}`;
}

function toFrameioFile(entry: FrameioApiEntry): FrameioFile {
  return {
    id: entry.id,
    name: entry.name,
    createdAt: entry.created_at,
    viewUrl: entry.view_url ?? null,
  };
}

/**
 * Lists files created after `sinceISO`, across the Frame.io project's root
 * folder and any subfolders (editors organize cuts into subfolders), newest
 * first within each folder's own pagination.
 */
export async function listNewFiles(sinceISO: string): Promise<FrameioFile[]> {
  const accountId = requireEnv("FRAMEIO_ACCOUNT_ID");
  const accessToken = await getAccessToken();
  const rootFolderId = await getRootFolderId(accessToken);

  const files: FrameioFile[] = [];
  let foldersVisited = 0;
  const queue: Array<{ folderId: string; depth: number }> = [
    { folderId: rootFolderId, depth: 0 },
  ];

  while (queue.length > 0) {
    if (foldersVisited >= MAX_FOLDERS_VISITED) {
      break;
    }

    const next = queue.shift();
    if (!next) {
      break;
    }
    const { folderId, depth } = next;
    foldersVisited++;

    let pageUrl: string | null =
      `${FRAMEIO_API_BASE}/accounts/${accountId}/folders/${folderId}/files?sort=created_at_desc`;

    while (pageUrl) {
      const response = await frameioFetch(pageUrl, accessToken);
      const page = (await response.json()) as FrameioFilesResponse;

      for (const entry of page.data) {
        if (entry.type === "folder") {
          if (depth < MAX_FOLDER_DEPTH) {
            queue.push({ folderId: entry.id, depth: depth + 1 });
          }
          continue;
        }
        files.push(toFrameioFile(entry));
      }

      const oldestInPage = page.data.at(-1);
      if (!oldestInPage || oldestInPage.created_at <= sinceISO) {
        // Oldest entry on this page is already at/before the cursor —
        // no need to fetch an even-older page for this folder.
        break;
      }

      // `links.next` may be relative or absolute; resolve either way.
      pageUrl = page.links?.next
        ? new URL(page.links.next, FRAMEIO_API_BASE).toString()
        : null;
    }
  }

  // The final page fetched per folder may still mix entries older and
  // newer than the cursor (the per-page "oldest" check only tells us when
  // to stop paginating, not which individual entries to keep), so filter
  // precisely here.
  return files.filter((file) => file.createdAt > sinceISO);
}
