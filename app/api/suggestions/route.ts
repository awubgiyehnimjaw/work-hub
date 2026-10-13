import { NextResponse } from "next/server";
import { pickSuggestion } from "@/lib/suggestions/pick";

/**
 * Idle-time suggestion for the dashboard. This route always answers —
 * gating it on `GET /api/tasks` returning an empty list (so it's only
 * shown when Callum has nothing urgent to do) is the dashboard's decision
 * to make, not this endpoint's.
 */
export async function GET() {
  const suggestion = await pickSuggestion(new Date());
  return NextResponse.json(suggestion);
}
