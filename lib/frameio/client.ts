import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";
import { refreshFrameioToken } from "@/lib/frameio/oauth";

/**
 * Frame.io V4 API client for polling new review files.
 *
 * Verified (not guessed, confirmed against the live API) shape of the
 * folder-listing endpoint:
 * `GET /v4/accounts/{account_id}/folders/{folder_id}/children`, header
 * `api-version: experimental`, response
 * `{ data: [{ id, name, created_at, type, view_url, ... }], links: { next? } }`.
 * This must be `/children`, not the sibling `/files` endpoint — confirmed by
 * direct testing that `/files` returns ONLY file entries (never folders),
 * so a folder containing nothing but subfolders (the common case: an editor
 * organizes every cut into a dated or per-client subfolder, with nothing
 * loose at the root) looks completely empty through `/files` and the
 * traversal below would never discover anything to recurse into. There is
 * no server-side "created after" filter, so we request `sort=created_at_desc`
 * and paginate via `links.next`.
 *
 * Folder discovery and file collection are deliberately decoupled: a
 * subfolder can be created long before the files inside it, so folders
 * sort differently from "when was this folder's newest file uploaded".
 * Gating pagination on the file cutoff alone can permanently hide a
 * subfolder that happens to sit on a later page (e.g. the root folder has
 * enough recent loose files to fill page 1 past the cursor, while an old
 * per-client subfolder sits on page 2). So pagination within a folder
 * continues — to keep discovering folder entries — independently of the
 * file cutoff, bounded only by `MAX_PAGES_PER_FOLDER` (and the overall
 * traversal is bounded by `MAX_FOLDERS_VISITED` / `MAX_FOLDER_DEPTH`).
 * Since pagination no longer stops at the cutoff, there is no longer any
 * benefit to an early-stop on file *collection* either — every page fetched
 * for folder-discovery purposes has every one of its file entries pushed
 * into the result unconditionally. The server's `sort=created_at_desc` is
 * not trusted (and a per-page early-stop on top of an untrusted sort would
 * risk silently dropping an out-of-order newer file on a later page), so
 * the final `files.filter` below — a numeric `Date.parse` comparison, never
 * a raw string compare — is the single source of truth for the cutoff.
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

export interface ListNewFilesResult {
  files: FrameioFile[];
  /**
   * True if any safety cap (folder depth, folders visited, or pages fetched
   * for a single folder) was hit this run, meaning some part of the
   * project's folder tree was not actually looked at. Callers must not
   * advance their poll cursor past a truncated run — doing so would
   * permanently skip whatever lived past the cap.
   */
  truncated: boolean;
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

// Safety nets against runaway recursion/pagination if a project's folder
// structure is unexpectedly deep or wide (e.g. an editor nests cuts many
// levels deep, or a misbehaving API keeps returning folders/pages).
const MAX_FOLDER_DEPTH = 5;
const MAX_FOLDERS_VISITED = 50;
const MAX_PAGES_PER_FOLDER = 20;

// Refresh proactively once the stored access token is within this long of
// expiring, rather than waiting for a request to fail with a 401 — Adobe
// access tokens are short-lived (~1 hour), so a bare poll interval of a few
// minutes would otherwise eventually straddle an expiry.
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

function requireEnv(name: "FRAMEIO_ACCOUNT_ID" | "FRAMEIO_PROJECT_ID"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

async function getOauthTokensRow() {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "frameio"));

  if (!row) {
    throw new Error(
      "Frame.io is not connected (no oauthTokens row for provider 'frameio')",
    );
  }

  return row;
}

async function getAccessToken(): Promise<string> {
  const row = await getOauthTokensRow();

  const isNearOrPastExpiry =
    row.expiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS <= Date.now();
  if (!isNearOrPastExpiry) {
    return row.accessToken;
  }

  await refreshFrameioToken();
  const refreshed = await getOauthTokensRow();
  return refreshed.accessToken;
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

interface FolderQueueEntry {
  folderId: string;
  depth: number;
}

/**
 * Fetches every page of one folder's file listing. Folder entries found on
 * ANY page are always queued (subject to the depth cap) — pagination for a
 * folder is never cut short by the file cutoff, only by running out of
 * pages or hitting `MAX_PAGES_PER_FOLDER`. Every file entry on every page
 * fetched is pushed into `files` unconditionally (pagination already
 * continues regardless of the cutoff for folder-discovery purposes, so an
 * early stop on collection alone would save no HTTP requests — it would
 * only risk silently dropping a file); the caller's final filter is the only
 * place the cutoff is enforced.
 *
 * Returns true if any safety cap was hit while processing this folder.
 */
async function fetchFolderFiles(
  folder: FolderQueueEntry,
  accountId: string,
  accessToken: string,
  files: FrameioFile[],
  queue: FolderQueueEntry[],
): Promise<boolean> {
  const { folderId, depth } = folder;
  let truncated = false;
  let pagesFetched = 0;

  let pageUrl: string | null =
    `${FRAMEIO_API_BASE}/accounts/${accountId}/folders/${folderId}/children?sort=created_at_desc`;

  while (pageUrl) {
    if (pagesFetched >= MAX_PAGES_PER_FOLDER) {
      console.warn(
        `listNewFiles: hit MAX_PAGES_PER_FOLDER (${MAX_PAGES_PER_FOLDER}) for folder ${folderId} ` +
          `(depth ${depth}); the remaining pages of this folder (and any subfolders listed on ` +
          `them) were not visited this run.`,
      );
      truncated = true;
      break;
    }
    pagesFetched++;

    const response = await frameioFetch(pageUrl, accessToken);
    const page = (await response.json()) as FrameioFilesResponse;

    for (const entry of page.data) {
      if (entry.type === "folder") {
        if (depth < MAX_FOLDER_DEPTH) {
          queue.push({ folderId: entry.id, depth: depth + 1 });
        } else {
          console.warn(
            `listNewFiles: folder ${entry.id} discovered at depth ${depth + 1} exceeds ` +
              `MAX_FOLDER_DEPTH (${MAX_FOLDER_DEPTH}); it was not visited this run.`,
          );
          truncated = true;
        }
        continue;
      }

      // Every file entry on every page fetched is collected unconditionally
      // — pagination already continues regardless of the cutoff (for
      // folder-discovery purposes), so stopping collection early here would
      // save no HTTP requests, and the server's assumed sort order isn't
      // trusted enough to use it to skip pushing an entry. The final
      // `files.filter` in `listNewFiles` (a numeric `Date.parse` compare,
      // never a raw string compare) is the single source of truth for what
      // counts as "new".
      files.push(toFrameioFile(entry));
    }

    pageUrl = page.links?.next
      ? new URL(page.links.next, FRAMEIO_API_BASE).toString()
      : null;
  }

  return truncated;
}

/**
 * Lists files created after `sinceISO`, across the Frame.io project's root
 * folder and any subfolders (editors organize cuts into subfolders), newest
 * first within each folder's own pagination.
 */
export async function listNewFiles(sinceISO: string): Promise<ListNewFilesResult> {
  const accountId = requireEnv("FRAMEIO_ACCOUNT_ID");
  const accessToken = await getAccessToken();
  const rootFolderId = await getRootFolderId(accessToken);
  const sinceMs = Date.parse(sinceISO);

  const files: FrameioFile[] = [];
  let foldersVisited = 0;
  let truncated = false;
  const queue: FolderQueueEntry[] = [{ folderId: rootFolderId, depth: 0 }];

  while (queue.length > 0) {
    if (foldersVisited >= MAX_FOLDERS_VISITED) {
      console.warn(
        `listNewFiles: hit MAX_FOLDERS_VISITED (${MAX_FOLDERS_VISITED}); ${queue.length} ` +
          `folder(s) still queued were not visited this run.`,
      );
      truncated = true;
      break;
    }

    const next = queue.shift();
    if (!next) {
      break;
    }
    foldersVisited++;

    const folderTruncated = await fetchFolderFiles(
      next,
      accountId,
      accessToken,
      files,
      queue,
    );
    if (folderTruncated) {
      truncated = true;
    }
  }

  // Every page fetched (across every folder) had all of its file entries
  // collected unconditionally, so `files` here mixes entries older and
  // newer than the cursor — this filter is what actually enforces the
  // cutoff, numerically, never as a raw string compare.
  return {
    files: files.filter((file) => Date.parse(file.createdAt) > sinceMs),
    truncated,
  };
}
