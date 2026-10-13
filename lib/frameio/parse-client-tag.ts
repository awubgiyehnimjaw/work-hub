/**
 * Parses a Frame.io filename to extract the client tag from the last parenthesized group.
 *
 * @param filename - The filename to parse
 * @returns The text inside the last (...) group, trimmed, or null if no bracket group exists
 *
 * @example
 * parseClientTag("Final Cut (Lovelots).mp4") // "Lovelots"
 * parseClientTag("Draft (v2) Final (NLD).mov") // "NLD"
 * parseClientTag("final_cut.mp4") // null
 * parseClientTag("Cut ( That Place ).mp4") // "That Place"
 */
export function parseClientTag(filename: string): string | null {
  // Match all parenthesized groups
  const matches = Array.from(filename.matchAll(/\(([^)]*)\)/g));

  if (matches.length === 0) {
    return null;
  }

  // Get the last match and trim the content
  const lastMatch = matches[matches.length - 1];
  return lastMatch[1].trim();
}
