# Telegram AI Chat — Design

## Intent and why

Right now the Telegram bot does exactly one thing: every message Callum sends (voice or text) gets classified as a to-do, a content idea, or "unclear," and the bot either stores it and confirms, or says it couldn't tell what he meant. There's no way to just ask it something.

Callum wants a second mode: real conversation. He wants to be able to ask it general questions like any AI chatbot, and — more importantly for daily use — ask it things grounded in his own app data ("what to-dos do I have," "what videos am I posting soon") and have it take simple actions for him ("mark the dentist to-do as done"), all without having to signal in advance which mode he's in. The bot should figure out on its own whether an incoming message is something to capture or something to talk about.

## Goals

- Any message that isn't a clear "create a to-do" or "create a content idea" falls through to a chat handler, automatically — no command, no prefix, exactly like the existing capture flow already works today.
- The chat handler can hold a real conversation: general-knowledge questions get answered like a normal AI chatbot would.
- It can also answer questions grounded in the app's own data: active to-dos, the posting schedule, pending Frame.io reviews, upcoming calendar events, and logged content ideas — the answers must come from the real data, never be invented.
- It can take simple actions through chat: marking a to-do, a review, or a posting-schedule entry as done. If what he means is ambiguous (two to-dos could both be "the dentist thing"), it asks instead of guessing.
- It remembers the last few messages in a chat, so a natural follow-up like "what about tomorrow instead?" works without Callum having to repeat himself.
- Voice messages work exactly the same way they already do for capture — transcribed first, then handled identically to a typed message.

## Non-goals

- No new write actions beyond "mark done" on the three domains above. No deleting, editing, or snoozing through chat — those stay as app/capture-flow-only actions for now.
- No change at all to the existing to-do/content-idea creation flow. It keeps working exactly as it does today, untouched.
- No long-term memory. The bot doesn't need to recall something Callum asked three days ago — only the last handful of messages in the current back-and-forth.
- No new users. The existing `TELEGRAM_ALLOWED_CHAT_IDS` allowlist still gates who can talk to the bot at all.

## Anti-goals

Would make this a failure even if it "technically works":

- The bot stating something about a to-do, review, deadline, or client as fact when it didn't actually come from a real app query — the single most important thing to get right, given how much of this app already depends on never fabricating data.
- A "mark as done" action firing on the wrong item because the bot guessed instead of asking when the match was ambiguous.
- Breaking or changing the behavior of the existing to-do/content-idea capture flow in any way.

## Constraints

- Must use the existing Groq integration (`lib/groq/client.ts`) — no new paid API, consistent with why this project moved off OpenAI in the first place.
- Must reuse the existing `isAllowedChatId` gate; no new auth surface.
- Single-user-scale app — no need to optimize for concurrent conversations or high message volume.

## Approaches considered

- **Two-stage, additive (chosen).** The existing classifier (`parseCaptureMessage`) stays exactly as it is. Its "unclear" outcome — already the signal for "this isn't a to-do or content idea" — becomes the trigger for a new, separate chat handler, instead of today's fixed "couldn't tell what you meant" reply. The chat handler uses tool-calling: Groq is given a set of functions (read to-dos, read posting schedule, mark a to-do done, etc.) and decides for itself which ones to call, in up to a few steps, before replying in natural language.
- **Full unified rewrite (rejected).** Replace the classifier entirely with one tool-calling agent that handles everything, including to-do/content-idea creation as just two more tools. Architecturally tidier long-term, but it means rewriting already-shipped, tested logic (including the due-date parsing Callum relies on) for no functional gain he asked for — pure regression risk for no benefit.

## Decided (from the conversation with Callum)

- Automatic routing — no explicit command or prefix to enter "chat mode."
- Short-term memory only: the last few messages in that chat, not a persistent long-term memory.
- Full read scope: to-dos, posting schedule, reviews, calendar, and content ideas are all fair game to ask about.
- The bot can take actions (not just answer questions) — confirmed explicitly, starting with "mark as done" across to-dos/reviews/posting-schedule entries.

## Left to the builder (my calls — flag if any of these are wrong)

- **Routing mechanism**: the webhook's existing `unclear` branch from `parseCaptureMessage` calls the new chat handler instead of sending the fixed "couldn't tell what you meant" reply. `parseCaptureMessage` itself is not modified. One exception: if the bot's own last message in the conversation-memory table (see below) was a clarifying question it asked within the last ~10 minutes, the next incoming message skips the classifier entirely and goes straight to the chat handler. Without this, a short reply like "the dentist one" answering the bot's own disambiguation question risks being misclassified by `parseCaptureMessage` as a fresh to-do and silently swallowed into the untouched capture flow instead of continuing the conversation — exactly the kind of wrong-guess-instead-of-asking outcome this feature exists to avoid, just one layer up.
- **Capture flow also writes to conversation memory**: when the existing to-do/content-idea capture flow successfully creates something, the webhook additionally logs that exchange (the original message, and the confirmation reply) into the same conversation-memory table the chat handler reads from — two extra inserts in the webhook's existing success path, not a change to `parseCaptureMessage` or the creation logic itself. Without this, a natural sequence like "add buy milk to todo" (captured) → "actually make that due Friday" (routed to chat, since it's not a fresh creation) would give the chat handler no memory of the to-do that was just made, breaking exactly the kind of follow-up this feature is supposed to support.
- **A write tool confirms immediately, not just at the end of the loop**: when a write tool (mark a to-do/review/posting-schedule entry done) actually executes successfully, it sends its own short Telegram confirmation right then, rather than relying solely on the agent loop's eventual final reply. The loop can still continue afterward for a natural wrap-up, but if something goes wrong later in the same loop (a Groq API error, a malformed response, hitting the round cap), Callum has already been told the action happened — the database change and the confirmation he sees are never allowed to come apart.
- **Tool-calling model**: `openai/gpt-oss-120b` (already used for parsing) — Groq's own materials describe it as built for tool use, and it's OpenAI-compatible, so the same tool-calling shape this app already knows how to speak should apply directly. This needs one empirical smoke-test (a real API call with a trivial tool) before the rest of the feature is built on top of it, the same way the current model name was confirmed against Groq's real `/v1/models` response rather than trusted from docs.
- **Conversation memory**: a new DB table storing each message (chat id, role, content, timestamp) for every chat turn — both what Callum sent and what the bot replied. The handler reads back the last ~10 rows for that chat id as context. No pruning/expiry job — storage is trivial at this volume, so the table just grows.
- **Tool surface**:
  - Read: active to-dos (with due dates and ids), posting-schedule entries due soon (reusing the existing due-soon window/logic), active review tasks, calendar events in the next 14 days, content ideas (optionally filtered by client).
  - Write: mark a to-do done, mark a review done, mark a posting-schedule entry done — each reusing the exact same underlying logic the app's own UI buttons already call, not reimplemented.
  - Every read tool's result includes the row's id, so a "mark done" follow-up tool call can reference the exact row the model just saw — this is how "mark the dentist to-do as done" resolves: the model calls the to-do-list tool first, finds the matching title, then calls the complete-tool with that id. If more than one to-do plausibly matches, the system prompt instructs the model to ask which one rather than pick.
- **Agent loop**: the handler calls Groq, and if the response includes tool calls, executes them and calls Groq again with the results appended, looping until it returns a plain text reply (capped at a handful of rounds so a confused loop can't run forever).
- **System prompt instructions**: explicit, strong wording that the model must never state a fact about Callum's to-dos, schedule, or clients unless it came from an actual tool call in this exchange — general-knowledge questions are fine to answer directly, but anything about his own data must be looked up, never guessed.
- **Reply style**: short, like the rest of this bot's replies — this is a Telegram chat, not an essay.
