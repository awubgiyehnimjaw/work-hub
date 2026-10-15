import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { isUniqueConstraintViolation } from "@/lib/db/pg-errors";
import { suggestionCategoryEnum, suggestions } from "@/lib/db/schema";

type SuggestionCategory = (typeof suggestionCategoryEnum.enumValues)[number];

const VALID_CATEGORIES = new Set<string>(suggestionCategoryEnum.enumValues);

function isValidCategory(value: unknown): value is SuggestionCategory {
  return typeof value === "string" && VALID_CATEGORIES.has(value);
}

/**
 * Full suggestions list for the management UI (every row, active or not) —
 * distinct from `GET /api/suggestions`, which only ever returns the single
 * picked suggestion for the dashboard. Living at `/all` rather than making
 * the list the plain `GET /api/suggestions` response keeps that existing
 * dashboard contract untouched.
 */
export async function GET() {
  const rows = await db
    .select()
    .from(suggestions)
    .orderBy(asc(suggestions.category), asc(suggestions.text));
  return NextResponse.json(rows);
}

interface CreatePayload {
  category: SuggestionCategory;
  text: string;
}

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { category, text } = body as Record<string, unknown>;
  if (!isValidCategory(category)) {
    return null;
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }
  return { category, text: text.trim() };
}

/** Adds a new growth suggestion, active by default, never auto-picked yet. */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const payload = parseCreatePayload(body);
  if (!payload) {
    return NextResponse.json(
      {
        error: `Body must be { category: ${suggestionCategoryEnum.enumValues.join(" | ")}, text: string }`,
      },
      { status: 400 },
    );
  }

  try {
    const [created] = await db
      .insert(suggestions)
      .values({ category: payload.category, text: payload.text, active: true })
      .returning();
    return NextResponse.json(created, { status: 201 });
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
