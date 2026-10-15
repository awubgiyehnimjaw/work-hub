import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { isUniqueConstraintViolation } from "@/lib/db/pg-errors";
import { suggestionCategoryEnum, suggestions } from "@/lib/db/schema";

type SuggestionCategory = (typeof suggestionCategoryEnum.enumValues)[number];
const VALID_CATEGORIES = new Set<string>(suggestionCategoryEnum.enumValues);

interface PatchPayload {
  text?: string;
  category?: SuggestionCategory;
  active?: boolean;
}

function parsePatchPayload(body: unknown): PatchPayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { text, category, active } = body as Record<string, unknown>;
  const update: PatchPayload = {};

  if (text !== undefined) {
    if (typeof text !== "string" || text.trim().length === 0) {
      return null;
    }
    update.text = text.trim();
  }
  if (category !== undefined) {
    if (typeof category !== "string" || !VALID_CATEGORIES.has(category)) {
      return null;
    }
    update.category = category as SuggestionCategory;
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") {
      return null;
    }
    update.active = active;
  }

  if (Object.keys(update).length === 0) {
    return null;
  }
  return update;
}

/** Edits a suggestion's text/category, or toggles it active/inactive. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const payload = parsePatchPayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Body must include at least one of { text, category, active }" },
      { status: 400 },
    );
  }

  try {
    const [updated] = await db
      .update(suggestions)
      .set(payload)
      .where(eq(suggestions.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }
    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    if (isUniqueConstraintViolation(error, "suggestions_text_unique")) {
      return NextResponse.json(
        { error: "A suggestion with that exact text already exists" },
        { status: 409 },
      );
    }
    throw error;
  }
}

/** Permanently removes a suggestion — not a soft-delete, since the
 * `active` flag already covers "stop showing this without losing it". */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [deleted] = await db.delete(suggestions).where(eq(suggestions.id, id)).returning();

  if (!deleted) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
