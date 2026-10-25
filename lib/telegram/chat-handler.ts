import { formatLocalDateTime, runToolCallingAgent, type ToolCallRequest, type ToolDefinition, type ToolDispatcher } from "@/lib/groq/client";
import {
  listActiveReviews,
  listActiveTodos,
  listContentIdeas,
  listDueSoonPostingScheduleEntries,
  listUpcomingCalendarEvents,
  markPostingScheduleEntryDone,
  markReviewDone,
  markTodoDone,
} from "@/lib/telegram/chat-tools";
import { sendMessage } from "@/lib/telegram/client";
import { appendMessage, getRecentMessages } from "@/lib/telegram/conversation-memory";

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_active_todos",
    description: "Lists Callum's active to-dos, each with an id, title, and due date (or null).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_active_reviews",
    description: "Lists Callum's active Frame.io review tasks, each with an id, title, and client name (or null).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_due_soon_posting_schedule_entries",
    description: "Lists posting-schedule entries due within 3 days or already overdue, each with an entryKey, client, video, post date, and urgency status.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_upcoming_calendar_events",
    description: "Lists calendar events in the next 14 days, each with an id, title, start, and end time.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_content_ideas",
    description: "Lists logged content ideas, each with an id, client name (or null), and text — optionally filtered to one client.",
    parameters: {
      type: "object",
      properties: { clientId: { type: "string", description: "Optional client id to filter the ideas to." } },
      required: [],
    },
  },
  {
    name: "mark_todo_done",
    description: "Marks one to-do as done, given its id from a prior list_active_todos call.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "The to-do's id." } },
      required: ["id"],
    },
  },
  {
    name: "mark_review_done",
    description: "Marks one review task as done, given its id from a prior list_active_reviews call.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "The review task's id." } },
      required: ["id"],
    },
  },
  {
    name: "mark_posting_schedule_entry_done",
    description: "Marks one posting-schedule entry as done, given its entryKey from a prior list_due_soon_posting_schedule_entries call.",
    parameters: {
      type: "object",
      properties: { entryKey: { type: "string", description: "The entry's entryKey." } },
      required: ["entryKey"],
    },
  },
];

function buildSystemPrompt(now: Date): string {
  return [
    `Callum's local time right now is ${formatLocalDateTime(now)} (Asia/Singapore).`,
    "You are chatting with Callum inside Telegram. You have tools that read and update his own app data: to-dos, the posting schedule, Frame.io review tasks, his calendar, and logged content ideas.",
    "General-knowledge questions are fine to answer directly from what you already know.",
    "Never state a fact about Callum's to-dos, posting schedule, reviews, calendar, or content ideas unless it came from a tool call you made in this exchange — never guess or invent app data.",
    "You can only mark an existing to-do, review task, or posting-schedule entry as done — you cannot create a new to-do or content idea, and you cannot edit, reschedule, snooze, or delete anything. If Callum asks for any of that, say plainly that you can't and tell him to resend it the normal way instead (a message starting with \"to do\" for a to-do, or \"content idea for <client>\" for a content idea).",
    "Never say something was done, added, marked, or changed unless a tool call you made in this exchange actually reported success — if a tool reports it couldn't find or complete something, say so plainly instead of pretending it worked.",
    "When asked to mark something done and more than one active item plausibly matches, ask which one instead of guessing.",
    "Only end a reply with a question when you genuinely need Callum to answer something before you can continue — don't add a question as a sign-off or pleasantry.",
    "Keep replies short — this is a Telegram chat, not an essay.",
  ].join("\n");
}

/**
 * Executes one tool call. For the three write tools, a truthy/void
 * success also sends its own immediate Telegram confirmation — before
 * this returns the tool result back into the agent loop — so the DB
 * change and Callum's confirmation never come apart, independent of
 * whether the rest of the loop goes on to complete cleanly.
 */
async function dispatchToolCall(chatId: number, now: Date, call: ToolCallRequest): Promise<string> {
  switch (call.name) {
    case "list_active_todos":
      return JSON.stringify(await listActiveTodos(now));
    case "list_active_reviews":
      return JSON.stringify(await listActiveReviews(now));
    case "list_due_soon_posting_schedule_entries":
      return JSON.stringify(await listDueSoonPostingScheduleEntries(now));
    case "list_upcoming_calendar_events":
      return JSON.stringify(await listUpcomingCalendarEvents(now));
    case "list_content_ideas": {
      const args = JSON.parse(call.arguments) as { clientId?: string | null };
      return JSON.stringify(await listContentIdeas(args.clientId ?? null));
    }
    case "mark_todo_done": {
      const args = JSON.parse(call.arguments) as { id: string };
      const done = await markTodoDone(args.id, now);
      if (done) {
        await sendMessage(chatId, "✅ Done.");
      }
      return JSON.stringify({ success: done });
    }
    case "mark_review_done": {
      const args = JSON.parse(call.arguments) as { id: string };
      const done = await markReviewDone(args.id, now);
      if (done) {
        await sendMessage(chatId, "✅ Marked as done.");
      }
      return JSON.stringify({ success: done });
    }
    case "mark_posting_schedule_entry_done": {
      const args = JSON.parse(call.arguments) as { entryKey: string };
      const done = await markPostingScheduleEntryDone(args.entryKey);
      if (done) {
        await sendMessage(chatId, "✅ Marked as done.");
      }
      return JSON.stringify({ success: done });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${call.name}` });
  }
}

/**
 * Handles one Telegram message in AI-chat mode: grounds the model with
 * the last 10 turns of conversation memory and the tool set above, runs
 * the agent loop, sends the final reply, and logs both sides of the
 * exchange. Never throws — on any internal failure, logs it and falls
 * back to a safe reply, same contract as the webhook's own `replySafely`.
 */
export async function handleChatMessage(chatId: number, text: string, now: Date): Promise<void> {
  try {
    const history = await getRecentMessages(chatId, 10);
    const dispatch: ToolDispatcher = (call) => dispatchToolCall(chatId, now, call);

    const finalReply = await runToolCallingAgent(
      buildSystemPrompt(now),
      history.map((message) => ({ role: message.role, content: message.content })),
      text,
      TOOL_DEFINITIONS,
      dispatch,
    );

    await sendMessage(chatId, finalReply);
    // Two independent `new Date()` calls (not both reusing `now`), same as
    // the capture flow's own conversation-memory logging — guarantees the
    // assistant row's timestamp is strictly after the user row's, so
    // `getRecentMessages`'s chronological ordering is never ambiguous
    // between the two halves of the same exchange.
    await appendMessage(chatId, "user", text, new Date());
    await appendMessage(chatId, "assistant", finalReply, new Date());
  } catch (error) {
    console.error("chat handler: failed to produce a reply", error);
    try {
      await sendMessage(chatId, "Something went wrong — try again.");
    } catch (sendError) {
      console.error("chat handler: failed to send the fallback reply", sendError);
    }
  }
}
