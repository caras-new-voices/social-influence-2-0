# Chat sessions: new chat and chat history

Status: plan, not built.

## 1. What we are solving

Each dashboard has one running conversation with the analyst. The only way to start fresh is "Clear", which deletes everything. People lose earlier answers they may want to reread, and long conversations get slower and more expensive, because the last 30 messages are sent with every question.

Wanted:

- Start a new chat at any time, without losing the old one.
- See earlier chats, reopen one, and carry on where it stopped.
- Do this without taking space from the dashboard.

## 2. What exists today

- `chat_messages` holds every message, keyed only by `dashboard_id`. There is no notion of a conversation.
- The analyst gets the last 30 messages of the dashboard as history (`HISTORY_ROWS` in `src/lib/claude.ts`).
- The chat panel is a fixed 380px column left of the dashboard (`.ws` in `workspace.css`). Below 1100px wide it stacks above the dashboard.
- The panel header has the title "Analyst", the tokens used and a "Clear" button.
- The full-screen element view (`FocusView`) has its own chat about one element. Those questions are not saved.
- Building a dashboard from a template writes a note into the chat ("I built this dashboard from the template and left out...").

## 3. Recommendation: the layout

The reference (Mixpanel's agent) gives history a permanent 560px column. Here that would leave the dashboard about half the screen, so history should not take space until someone asks for it.

**Chat panel header (always visible):**

- On the left, the current chat's title with a small arrow. Clicking it opens history, the same as the Mixpanel breadcrumb.
- On the right, three icon buttons with tooltips:
  - **New chat** (pencil-on-square icon).
  - **History** (clock icon).
  - **Panel width**, toggling between normal and wide.
- The tokens-used figure moves into the history view, where it belongs to a chat.
- The "Clear" button goes away. Deleting a chat moves into history.

**History opens inside the chat column, not beside it.** It slides over the conversation in the same 380px column, so the dashboard does not move or shrink:

- A search box at the top, shown when there are more than 8 chats.
- Chats grouped by Today, Yesterday, Last 7 days, Earlier.
- Each row shows the title, how long ago it was used, and the number of questions. The open chat is highlighted.
- Hovering a row shows a menu with Rename and Delete. Delete asks first.
- Clicking a row opens that chat and closes history. Escape or a back arrow returns to the open chat.

**Three panel widths,** remembered per browser:

- **Collapsed:** a 48px rail with the AI mark and the New chat and History icons. The dashboard gets almost the full width. This is new: today the chat cannot be hidden.
- **Normal:** 380px, as today.
- **Wide:** 560px, for reading long answers and tables. It also gives history room for longer titles.

**Very wide screens (1,600px and up):** a pin button in history keeps it open as a narrow 240px list between the chat and the dashboard. It is off by default. On smaller screens the pin is hidden.

**Narrow screens (under 1,100px):** the chat stacks above the dashboard as today, and history opens as a full-height sheet over the chat.

## 4. Recommendation: how sessions behave

- **Sessions belong to a dashboard.** A chat is about that dashboard's brands and period, so history lists only that dashboard's chats. A list across all dashboards can come later if it is asked for.
- **A new chat starts empty, with the starter cards** ("Not sure where to begin?" and the goals). The old chat stays in history.
- **The analyst only sees the open chat.** History sent to the model is the current session's messages, still capped at the last 30. A new chat therefore costs less per question.
- **Title:** the first question, cut to about 60 characters, with no extra model call. The person can rename it. An AI-written title can come later.
- **Empty chats are not saved.** A session is created when its first message is sent, so clicking New chat several times does not fill history.
- **Opening a dashboard opens its most recent chat.**
- **"Ask AI" and "Change this box" on an element** go into the open chat, so the conversation keeps its context.
- **The template build note** becomes the first message of a chat titled "Dashboard setup".
- **Full-screen element chats are saved** as their own sessions, titled "About: <element title>", so those answers are no longer lost. They show in history with a small element tag.

## 5. Data and API

Database (`src/lib/schema.ts`; no `VIEWS_VERSION` bump, as no view changes):

- New table `chat_sessions`: `id`, `dashboard_id`, `title`, `kind` (`chat`, `setup` or `element`), `widget_id` (for element chats), `created_at`, `updated_at`.
- `chat_messages` gets a `session_id` column and an index on `(session_id, id)`.
- Migration: for each dashboard with messages, create one session titled from its first question (or "Dashboard setup" when it only holds the template note) and attach the messages to it. Run once, guarded by an `app_meta` key. Test it on real Postgres, not only PGlite.

API:

- `GET /api/dashboards/[id]/sessions`: the list for history (id, title, kind, updated_at, question count).
- `GET /api/sessions/[sid]/messages`: one chat's messages.
- `PATCH /api/sessions/[sid]`: rename.
- `DELETE /api/sessions/[sid]`: delete a chat and its messages.
- `POST /api/chat` takes an optional `sessionId`. Without one it creates a session and returns its id in the first streamed event, so the panel can switch to it.
- The existing `DELETE /api/dashboards/[id]/messages` stays for now and deletes all chats of the dashboard.

Token usage: each message already records its usage, so the history view can show tokens per chat with no new metering.

## 6. Work plan

1. Table, migration and the session-aware history in `claude.ts` (both the Claude and the OpenAI paths).
2. Session routes and `sessionId` in `/api/chat`.
3. Chat panel header, history overlay, New chat, rename and delete.
4. Panel widths (collapsed, normal, wide) and the pinned history on very wide screens.
5. Saved element chats in the full-screen view.
6. Checks: extend `npm run check:scope` with a new-session check (a second chat does not see the first one's messages); browser check at 1,400px, 1,800px and phone width; one live-model test that a new chat starts without the old context; type check, lint and build.

## 7. Decisions, with my recommendation

- **History per dashboard or across all dashboards?** Per dashboard.
- **Title from the first question or written by the AI?** First question, renamable. It costs nothing and is predictable.
- **Keep "Clear"?** No. New chat plus delete in history covers it, and nothing is lost by accident.
- **Pinned history on wide screens?** Yes, off by default, only from 1,600px.
- **Save full-screen element chats?** Yes, as their own sessions.

## 8. Risks

- **Migration on live data.** Production has existing conversations. The migration must be idempotent and keep every message. Test on a copy in real Postgres first.
- **A streamed answer that arrives after the person has switched chats** must land in the chat it belongs to, not the one on screen. Key the stream to its session id.
- **Two browser tabs on one dashboard** can each start a chat. That is fine: sessions are independent.
