import { and, eq, isNull } from "drizzle-orm";
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

// Known real-world billing profiles for clients that already exist in the
// `clients` table — the actual company legal names/addresses Callum
// invoices, filled in once from real data.
const CLIENT_BILLING_PROFILES: Array<{
  tag: string;
  legalName: string;
  addressLine1: string;
  addressLine2: string;
  attention: string;
}> = [
  {
    tag: "Lovelots",
    legalName: "LOVELOTS DIAMOND PTE LTD",
    addressLine1: "181 Orchard Road",
    addressLine2: "#04-02, Singapore 238896",
    attention: "Account Department",
  },
  {
    tag: "That Place",
    legalName: "TIC TOC KOPI PTE LTD",
    addressLine1: "207 Henderson Road",
    addressLine2: "#01-01, Singapore 159550",
    attention: "Account Department",
  },
  {
    tag: "HappyFish",
    legalName: "HAPPY FISH SWIM SCHOOL PTE LTD",
    addressLine1: "102F Pasir Panjang Road",
    addressLine2: "#05-03, Singapore 118530",
    attention: "Account Department",
  },
];

/**
 * Fills in the billing-profile fields (legalName/addressLine1/
 * addressLine2/attention) for the three known real clients above — but
 * only when `legalName` is still null. That guard is what makes this both
 * idempotent (safe to re-run on every `db:seed`) and non-destructive: it
 * never overwrites a profile Callum has since edited by hand through the
 * app, since any such edit sets `legalName` to a non-null value.
 */
export async function seedClientBillingProfiles(): Promise<void> {
  for (const profile of CLIENT_BILLING_PROFILES) {
    await db
      .update(clients)
      .set({
        legalName: profile.legalName,
        addressLine1: profile.addressLine1,
        addressLine2: profile.addressLine2,
        attention: profile.attention,
      })
      .where(and(eq(clients.tag, profile.tag), isNull(clients.legalName)));
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
