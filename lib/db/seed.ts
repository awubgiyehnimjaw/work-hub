import { db } from "./client";
import { clients, suggestions } from "./schema";

const KNOWN_CLIENT_TAGS = [
  "Lovelots",
  "Lesamai",
  "That Place",
  "HappyFish",
  "NLD",
  "ARC",
  "Ulti",
] as const;

const SUGGESTION_SEED: Array<{
  category: "ulti" | "arc" | "general";
  text: string;
}> = [
  // Ulti (personal brand)
  {
    category: "ulti",
    text: "Film or batch-film new personal-brand content",
  },
  {
    category: "ulti",
    text: "Repurpose a past video/post that performed well into a new format",
  },
  { category: "ulti", text: "Reply to comments/DMs on recent posts" },
  {
    category: "ulti",
    text: "Review Ulti's content calendar for gaps in the next 2 weeks",
  },

  // ARC (agency content)
  { category: "arc", text: "Plan next month's agency content themes" },
  { category: "arc", text: "Draft a post showcasing a recent client result" },
  {
    category: "arc",
    text: "Update the agency portfolio/demo reel with a recent cut",
  },

  // Business development
  { category: "general", text: "Reach out to a warm lead who's gone quiet" },
  {
    category: "general",
    text: "Ask a happy client for a referral or testimonial",
  },
  {
    category: "general",
    text: "Review current client roster for anyone close to needing a check-in",
  },
  {
    category: "general",
    text: "Look back at the posting/edit-schedule sheet for anything falling behind",
  },
];

export async function seedClients(): Promise<void> {
  for (const tag of KNOWN_CLIENT_TAGS) {
    await db
      .insert(clients)
      .values({
        tag,
        displayName: tag,
        recognized: true,
        lastActivityAt: null,
      })
      .onConflictDoNothing({ target: clients.tag });
  }
}

export async function seedSuggestions(): Promise<void> {
  for (const suggestion of SUGGESTION_SEED) {
    await db
      .insert(suggestions)
      .values({
        category: suggestion.category,
        text: suggestion.text,
        active: true,
        lastPickedAt: null,
      })
      .onConflictDoNothing({ target: suggestions.text });
  }
}
