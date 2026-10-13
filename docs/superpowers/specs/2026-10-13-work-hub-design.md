# Work Hub — Design Doc

Date: 2026-10-13
Working name: "Work Hub" (placeholder, easy to rename)

## Intent and Why

Callum runs a content/video editing agency with 3-5 clients, plus his own
personal-brand content. Right now the signal that work is waiting for him
is fragile: his editor finishes a cut and sends a WhatsApp message saying
it's on Frame.io, and that message gets lost among everything else in his
chat. The result is two failure modes: he forgets to review a video that's
sitting ready, or he spends idle time unsure whether he actually has
anything to do at all.

Work Hub exists to be the one place Callum checks (or gets pinged by) to
know, at a glance, whether there's something that needs him right now —
and if there genuinely isn't, to suggest something that would still move
the business forward instead of leaving him idle.

This is a single-user tool, used only by Callum, on his iPhone and
MacBook.

## Goals

1. Within a few minutes of his editor uploading a new cut to the shared
   Frame.io project, Callum gets a push notification and a tagged review
   task ("Review — [Client]"), without relying on seeing a WhatsApp
   message.
2. One glance shows upcoming filming days, meetings, and events, pulled
   from his existing Google Calendar — he doesn't maintain a second
   calendar.
3. A simple list for loose to-dos that currently live only in his head
   (follow-ups, posts to publish, etc.).
4. When there is no pending review and no to-do due, the app surfaces one
   business-growth suggestion (e.g. "work on personal-brand content",
   "plan next month's agency content") instead of showing an empty
   screen.
5. One app, usable from both iPhone and MacBook, with no separate
   accounts or logins beyond Callum's own.
6. A review task can be snoozed ("remind me in 2 hours" / "tomorrow
   morning") instead of just sitting there unaddressed or getting
   ignored.
7. A review task that's sat unactioned for 2+ days is visually flagged,
   so nothing quietly goes stale without Callum noticing.
8. Idle-time suggestions include a data-driven nudge when a specific
   client has gone quiet (no upload/review activity in 3+ weeks), not
   just the static seed list.
9. A simple history log of reviewed videos per client over time, so
   Callum can see patterns (who's quiet, who's heavy) or show a client
   how much work has gone into their account.
10. A fast way to add a to-do from the phone with minimal taps, so an
    idea isn't lost between having it and properly opening the app.

## Non-Goals

- Replacing Frame.io's review/commenting tools. Callum still adds his
  actual comments inside Frame.io; Work Hub just tells him a video is
  waiting and deep-links him there.
- Replacing Google Calendar. Work Hub reads it, doesn't create a second
  source of truth for events.
- Pulling in or replacing the Google Sheet that tracks posting/edit
  schedules. Callum is keeping that as-is (making his own copy to use
  separately). Could be revisited later if it turns out to matter.
- Any multi-user functionality. Clients and the editor never log into
  this; it's Callum's personal command center.
- Duplicating Google Calendar's own event reminders. Work Hub displays
  the agenda; it doesn't re-notify for events Google already alerts on.

## Anti-Goals (would be a failure even if "technically working")

- Notifications that are unreliable or easy to miss defeats the entire
  point — this is the one thing it absolutely has to get right.
- Becoming "yet another inbox" Callum has to remember to check would
  recreate the original problem.
- Mishandling client names/business info, since this holds real client
  and business data (it should sit behind a passcode, not be an open
  public page).
- Making Callum change how he actually reviews videos (still Frame.io)
  or how his editor works (still WhatsApp + Frame.io uploads, just named
  with the client at the end per the new convention).

## Constraints / Things to Validate Early

- The Frame.io project is the editor's account, not Callum's — Callum is
  a project member, not an Account Owner or Content Admin. Frame.io's V4
  API restricts webhook creation to Owners/Content Admins, so Work Hub
  cannot use real-time webhooks without the editor's direct involvement.
  Confirmed via Frame.io's own docs. Work Hub instead polls the project
  using Callum's own member-level API access — no admin rights or
  editor involvement needed, at the cost of a few minutes' delay instead
  of instant.
- Google Calendar integration needs a Google Cloud project with the
  Calendar read-only scope, OAuth-consented once by Callum.
- Filenames carry the client tag in brackets at the end, e.g.
  `Final Cut (Lovelots).mp4`. Known tags today: Lovelots, Lesamai, That
  Place, HappyFish, NLD (clients), ARC (Callum's own agency content),
  Ulti (Callum's personal-brand content). This list will change over
  time — an unrecognized bracketed tag should still create a review task,
  just flagged as unrecognized rather than silently dropped or guessed
  at, so nothing falls through.
- Being a PWA, Work Hub cannot provide an iPhone/Mac home-screen widget
  showing a glance view without opening the app, and cannot receive
  shared content from other apps (e.g. a WhatsApp share-sheet action) on
  iOS, since Safari doesn't support that for web apps. Both are accepted
  trade-offs of the PWA approach, not oversights.

## Decisions Made (Callum's, from this conversation)

- Push notifications are required — not optional, not "just leave it in
  the app."
- One shared Frame.io project across all 3-5 clients; client identified
  by a bracketed tag at the end of the filename (editor has agreed to
  start doing this) — see client list above.
- Google Calendar is the source of truth for events; no desire to track
  events anywhere else.
- The posting/edit-schedule Google Sheet stays separate for now.
- Idle-time suggestions should be grounded in things Callum actually does
  to grow the business: personal-brand content, planning agency content,
  general business growth — not a generic productivity-tip list.
- This is for Callum only, not clients or his editor.
- Callum has no technical background and wants the whole thing built for
  him — all technology choices below are Claude's call.

## Decisions Made (Claude's calls — how it gets built)

- **Progressive Web App**, not a native Swift app. Built with Next.js,
  installable to the Home Screen on both iPhone and Mac via Safari/Chrome.
  Reasoning: one codebase covers both platforms, no Apple Developer
  Program membership or App Store review needed, and iOS/macOS Safari
  (16.4+) deliver real push notifications to installed PWAs even when the
  app isn't open — the notification requirement doesn't actually require
  going native.
- **Push delivery** via the standard Web Push protocol (VAPID keys), not
  Apple Push Notification service directly.
- **Frame.io detection** via periodic polling (every 2-5 minutes) using
  Callum's own account access to the shared project, not a webhook —
  webhooks need Account Owner/Content Admin rights, which Callum doesn't
  have on his editor's account. Polling needs nothing from the editor
  beyond the existing filename convention, and the delay is short enough
  not to recreate the original problem. If the editor is ever willing to
  set up a webhook on his own account, this can be swapped for real-time
  delivery later without changing anything else.
- **Google Calendar** via a periodic read-only fetch (roughly every 15
  minutes) rather than Google's push "watch" channels, which expire every
  7 days and need renewal — not worth the complexity for a calendar
  display that isn't the primary notification path.
- **Scheduling**: both the Frame.io poll and the Calendar fetch are
  triggered by a free external scheduler (e.g. a scheduled GitHub Actions
  workflow or cron-job.org) calling a protected endpoint, rather than
  relying on Vercel's own cron feature — keeps everything on free tiers
  regardless of Vercel's cron limits.
- **Backend**: Next.js API routes deployed on Vercel (handles the Frame.io
  poll endpoint, the Calendar fetch endpoint, and serving the app).
- **Database**: a small hosted Postgres instance (Neon) for tasks,
  to-dos, growth-suggestion list, and push subscriptions. Chosen for
  being free at this scale and requiring no server management.
- **Access control**: a single passcode-protected session, not a full
  user-account system — this is one person's app, but it holds client
  data and needs a public URL for the Frame.io webhook, so it can't be
  wide open.
- **Idle-time suggestions**: a curated, editable list, shown round-robin
  or at random when the queue is empty — a fixed list rather than
  generated fresh each time, so it stays predictable and never invents
  something nonsensical. Callum asked for this seed list to include
  Claude's own additions, not just his three original examples, so it's
  grounded in the agency/personal-brand context from this conversation:

  *Ulti (personal brand):*
  - Film or batch-film new personal-brand content
  - Repurpose a past video/post that performed well into a new format
  - Reply to comments/DMs on recent posts
  - Review Ulti's content calendar for gaps in the next 2 weeks

  *ARC (agency content):*
  - Plan next month's agency content themes
  - Draft a post showcasing a recent client result
  - Update the agency portfolio/demo reel with a recent cut

  *Business development:*
  - Reach out to a warm lead who's gone quiet
  - Ask a happy client for a referral or testimonial
  - Review current client roster for anyone close to needing a check-in
  - Look back at the posting/edit-schedule sheet for anything falling
    behind

  All editable/removable in-app later — this is a starting point, not
  fixed content.
- **Marking review tasks done**: a manual checkbox/swipe in-app for v1,
  rather than trying to detect that Callum has already commented in
  Frame.io (more reliable, much simpler). Completed tasks are kept
  (status + timestamp), not deleted, forming the per-client history log.
- **Snoozing**: a `snoozed_until` timestamp on the task; a snoozed task
  drops out of the active queue and reappears (with a fresh notification)
  once that time passes.
- **Aging flag**: a task older than 2 days (unactioned, not snoozed) gets
  a visual flag — simple age threshold, no new infrastructure needed.
- **Client-quiet nudge**: a `last_activity_at` per client, updated
  whenever a review task is created or completed for them. If it's been
  3+ weeks, that's injected as a suggestion alongside the static
  growth-suggestion list.
- **Quick-add for to-dos**: a prominent quick-add control that opens
  straight to a focused text input, minimal taps. Not a true OS
  share-sheet integration — iOS Safari doesn't support PWAs receiving
  shared content from other apps (confirmed: no Web Share Target support
  on iOS), so "share this WhatsApp message into Work Hub" isn't possible
  on iPhone. This is the closest realistic equivalent.

## What's Left to the Builder (implementation-time calls, non-blocking)

- Exact visual layout of the three views (review queue, calendar agenda,
  to-do + suggestion) — mobile-first, plain, uncluttered.
- Exact passcode/session implementation details.
- Exact rotation logic for growth suggestions (round-robin vs. random vs.
  weighting by recency).
- Minor hosting/config choices not called out above.
