# Plan: token usage, balance and monitoring

Status: proposal, nothing built yet.

## 1. What we are solving

The commercial model is a monthly platform fee plus usage of the AI analyst. Today the product records nothing about that usage. This plan adds four things:

1. **A usage log**: every interaction with the model is recorded with its tokens.
2. **Tokens shown at the moment of use**: every answer says how many tokens it took and what is left.
3. **A token balance on the account**: a total, what has been used, what remains, and, because this is a demo, a button to add more.
4. **A usage page**: where the tokens went, by day, by kind of interaction, by dashboard, with the full log.

It is a demo of the billing model, so no payment is taken. The structure is the real one, so swapping the "add tokens" button for a payment later changes one endpoint.

## 2. Where the product uses the model today

Every call site below is captured. Nothing else in the product calls a model.

| Interaction | Where it runs | Usage data available |
|---|---|---|
| Chat with the analyst (up to 8 tool rounds per turn) | `runChatTurn` in `src/lib/claude.ts`, Claude or OpenAI | Per round, from the provider. Summed per turn. |
| "Ask AI" and "Explain the change" on an element | Same chat turn, with an instruction | Same |
| "Where should I start?" scan | Same chat turn | Same |
| Guided setup: each question, and each free-text message | `POST /api/wizard/step`, same chat turn | Same |
| Month in review, manual and automatic | `generateMonthReview` in `src/lib/reports.ts` via `complete()` | From the response |
| Query assistant in the element editor (explain, modify) | `src/lib/sql-assist.ts` via `complete()` | From the response |
| Voice explanation of an element | OpenAI realtime session, runs in the browser | Each spoken response reports usage to the browser, which must send it to the server |
| Demo mode (no model key configured) | Scripted answers | None: tokens are estimated |

Two details matter for accuracy:

- **OpenAI streaming** only reports usage when asked (`stream_options: { include_usage: true }`). The plan turns that on.
- **Demo mode** has no real tokens. To keep the demo coherent, usage is estimated from the length of the instruction and the reply (characters ÷ 4) and marked as estimated everywhere it is shown. Production may be running in demo mode today, so this path is not an edge case.

## 3. The unit

One unit everywhere: **tokens, as the model reports them** (input plus output). The log keeps the breakdown: input, output, and cached input.

A weighted "credit" (output tokens cost roughly five times input tokens) would track our real cost more closely, but it is harder to explain and the request is to show tokens. The log stores the breakdown and an estimated cost per event, so a move to weighted credits later needs no data migration.

## 4. Data model

Two tables. The log says what happened; the ledger says what the account has.

**`usage_events`**: one row per interaction.

| Column | Meaning |
|---|---|
| `id`, `created_at` | |
| `dashboard_id` | Which dashboard it belongs to (null for none) |
| `kind` | `chat`, `ask_element`, `explain_change`, `scan`, `wizard_step`, `wizard_discuss`, `month_review`, `sql_assist`, `voice` |
| `label` | What was asked, first 120 characters |
| `provider`, `model` | `claude`, `openai` or `demo`, and the model id |
| `input_tokens`, `output_tokens`, `cached_tokens`, `total_tokens` | As reported, summed over the rounds of the turn |
| `rounds`, `tool_calls` | How many model rounds and tool calls the turn took |
| `duration_ms` | Wall time |
| `estimated` | True in demo mode |
| `automatic` | True when no person triggered it (the month in review written when a month completes) |
| `cost_usd` | Estimate from a per-model price table kept in code |
| `message_id` | The chat message it produced, when there is one |

**`token_ledger`**: one row per change to the balance.

| Column | Meaning |
|---|---|
| `id`, `created_at` | |
| `kind` | `grant` (the starting allowance), `top_up` (the demo button), `usage` (one per usage event), `adjustment` |
| `tokens` | Signed: positive adds, negative spends |
| `usage_event_id` | For `usage` rows |
| `note` | "Starting allowance", "Added 1M tokens (demo)" |
| `balance_after` | Running balance, so the ledger reads like a statement |

The balance is the sum of the ledger. The account is the workspace: one balance for everyone, because there is no sign-in yet. With sign-in, events gain a `user_id` and the page gains a per-person breakdown; nothing else changes.

A new workspace starts with a grant (proposed: 1,000,000 tokens). Existing workspaces get the same grant when the migration first runs.

## 5. Capturing usage

One function, `recordUsage(event)`, writes the event and its ledger row in one transaction and returns the new balance. Every call site goes through it.

- **Chat turns** (Claude and OpenAI paths): sum usage across the rounds of the turn, record once at the end, attach the totals to the stored chat message so history shows them.
- **`complete()`** returns usage alongside the text; the month in review and the query assistant record it with their kind.
- **Voice**: the browser collects usage from each response and posts it to `POST /api/usage/voice` when the session ends (and on page unload). The server records one event per session.
- **Demo mode**: the estimate described in section 2, `estimated = true`.
- **Failures**: a turn that fails after using tokens is still recorded (the tokens were spent), with the error noted in the label.

The kind comes from the caller: the chat route already knows whether a turn is a plain question, an element question, a comparison explanation, the scan or a wizard step.

## 6. Tokens at the moment of use

Every place a person talks to the model shows what it took.

- **Chat, Ask AI, Explain the change, the scan**: a line under each answer: `1,842 tokens · 312 in, 1,530 out · 987K left`. It arrives as a new `usage` event on the existing stream just before `done`, and it is stored with the message, so reloading the chat shows the same line. In demo mode it reads `about 1,840 tokens (estimated)`.
- **Guided setup**: the same line under the analyst's text on each question; the summary screen shows the total for the whole setup.
- **Month in review**: a footer on the review: `Written with 6,210 tokens`.
- **Query assistant**: a line under its answer in the element editor.
- **Voice**: a line when the session ends.
- **Header**: a balance pill next to the bell on every page, `987K tokens`. It updates the moment a turn finishes, turns amber under 10 percent of the last top-up, and red at zero. Clicking it opens a small panel: balance, used today, used this month, "Add tokens", and a link to the usage page.
- **Chat header on a dashboard**: `This dashboard: 48K tokens this month`.

## 7. Running low and running out

- **Low balance** (under 10 percent): the pill turns amber and the chat shows a one-line notice with "Add tokens".
- **Zero**: a turn is not started. The chat shows a card, "You are out of tokens", with the "Add tokens" button and nothing is charged. A turn already running is allowed to finish, so the balance can dip below zero by one turn.
- **Automatic work**: the month in review that is written when a month completes is skipped at zero and offered as a manual button instead.
- Everything that does not use the model (dashboards, periods, comparison, imports, reports' numbers) keeps working at zero.

## 8. Adding tokens (demo)

A dialog from the header panel and from the usage page: three packs (proposed 250K, 1M, 5M) and a custom amount. Confirming writes a `top_up` row to the ledger and updates the pill. The dialog says plainly "Demo: no payment is taken."

The endpoint (`POST /api/usage/top-up`) is on by default and can be turned off with an environment variable (`DEMO_TOPUP=0`), so a deployment shown to a real client cannot be topped up for free by accident. When real billing arrives, this endpoint becomes the payment webhook's handler and the dialog becomes a checkout.

## 9. The usage page

A new page, `/usage`, with a "Usage" item in the sidebar under Dataset.

- **Top row**: tokens left; used this month; used today; interactions this month; average tokens per interaction; estimated cost this month.
- **Tokens per day**: stacked bars by kind for the last 30 days, with top-ups marked on the axis.
- **Where they went**: three small breakdowns: by kind (which features burn tokens), by dashboard (turns, tokens, share, last used, link), by model.
- **The log**: every interaction, newest first: time, dashboard, kind, what was asked, model, input, output, total, cost, and an "estimated" or "automatic" tag. Filters for dashboard, kind and date; CSV export for invoicing.
- **The statement**: the ledger: grants, top-ups and daily usage totals with the balance after each.
- **A period filter** on the whole page: this month, last month, last 30 days, all time.
- "Add tokens" at the top right.

Charts follow the existing chart components and palette; the page prints cleanly like the reports page.

## 10. API

| Endpoint | Purpose |
|---|---|
| `GET /api/usage/balance` | Balance, used today, used this month, low-balance flag. Polled by the header pill and refreshed after each turn. |
| `GET /api/usage/summary?from&to` | The tiles, the daily series and the three breakdowns |
| `GET /api/usage/events?dashboard&kind&from&to&cursor` | The log, paged; `format=csv` for export |
| `GET /api/usage/ledger` | The statement |
| `POST /api/usage/top-up` | Demo top-up |
| `POST /api/usage/voice` | Usage reported by a voice session |

## 11. What the numbers mean, stated on the page

- Tokens are the provider's own counts. Output includes the model's reasoning tokens where the provider bills them.
- Cached input tokens are shown separately; they count toward the total at face value in this version.
- Cost is an estimate from a price table in the code. It needs updating when model prices or the configured model change.
- In demo mode every number is an estimate from text length, and is labelled so.

## 12. Work plan

| Phase | Scope | Estimate |
|---|---|---|
| A. Capture and ledger | The two tables and migration with the starting grant; `recordUsage`; usage from Claude and OpenAI chat turns, `complete()`, demo-mode estimates; kinds passed from every caller; balance check before a turn; price table | 1.5 days |
| B. At the moment of use | The `usage` stream event and the line under answers in chat, wizard, review and query assistant; header pill and panel; low and out-of-tokens states; add-tokens dialog and endpoint | 1 to 1.5 days |
| C. Usage page | Summary, daily chart, breakdowns, log with filters and CSV, statement, period filter, sidebar item | 1.5 days |
| D. Voice and proof | Voice usage reporting; a test script that runs one interaction of every kind and checks the log, the ledger and the balance agree; production build | 0.5 to 1 day |

About five working days. A and B are the part a client sees in a demo; C is what finance sees.

## 13. Decisions to take before building

- **Starting allowance and pack sizes.** Proposed 1,000,000 to start; packs of 250K, 1M and 5M. A typical chat turn with a real model is 5,000 to 20,000 tokens, so 1M is roughly 50 to 200 turns.
- **Hard stop at zero, or warn and continue?** Recommendation: hard stop for new turns, with the add-tokens button on the same card. It makes the model visible in a demo, which is the point.
- **Do automatic month reviews draw from the balance?** Recommendation: yes, tagged "automatic" in the log, and skipped at zero.
- **Show estimated cost in dollars to the client?** Recommendation: show tokens to everyone and keep the dollar estimate on the usage page only, behind the same access as the page. Cost is our number, not theirs.
- **Do demo-mode estimates spend the balance?** Recommendation: yes, so the demo behaves like the real thing, with the "estimated" label.
- **Raw tokens or weighted credits.** Recommendation: raw tokens now, as asked; the log keeps enough to switch.

## 14. Out of scope

Real payments and invoices; per-person usage (needs sign-in); per-client price plans; alerts by email. Each is a small addition on this structure.

## 15. As built

Built with the recommended answers to section 13: 1,000,000 tokens to start (`STARTING_TOKENS`), packs of 250K, 1M and 5M, a hard stop at zero for new turns, automatic month reviews draw from the balance and are skipped at zero, tokens shown everywhere with the dollar estimate on the usage page only, demo-mode estimates spend the balance, raw tokens as the unit.

| Part | Where |
|---|---|
| Shared types, kinds, formatting, the browser refresh event | `src/lib/usage-shared.ts` |
| Recording, balance, top-up, summary, log, statement, CSV, price table | `src/lib/usage.ts` |
| Tables `usage_events` and `token_ledger`, `chat_messages.usage`, the starting grant | `src/lib/schema.ts` |
| Chat and guided-setup turns: balance check, per-round counts from Claude and OpenAI, demo estimates, the `usage` stream event | `runChatTurn` in `src/lib/claude.ts` |
| Month reviews and the query assistant | `complete()` and `recordEstimate()` in `src/lib/llm.ts`, called from `src/lib/reports.ts` and `src/lib/sql-assist.ts` |
| Voice: the browser sums `response.done` usage and reports it when the session ends | `src/components/VoiceAgent.tsx`, `POST /api/usage/voice` |
| API | `GET /api/usage/balance`, `summary`, `events` (`format=csv`), `ledger`; `POST /api/usage/top-up`, `voice` |
| The line under answers, the header pill, the low and out-of-tokens states | `src/components/Tokens.tsx` |
| The top-up dialog | `src/components/AddTokensDialog.tsx` |
| The usage page | `src/app/usage/page.tsx`, `src/components/UsageView.tsx`, `src/app/usage.css` |
| The check | `scripts/check_usage.py` (`npm run check:usage`, add `--drain` for the hard stop) |

Differences from the plan and known limits:

- The balance is the sum of the ledger; each ledger row stores the balance after it, so the statement needs no recalculation.
- A turn that starts with tokens left is allowed to finish, so the balance can go slightly below zero. The next turn is refused.
- The chat header shows the tokens the dashboard has used this month. The guided setup shows the same number on its last page.
- The usage log keeps its rows when a dashboard is deleted; the page shows "Deleted dashboard".
- Days and months are counted in UTC.
- Voice usage is reported by the browser when the session ends. A tab that is closed mid-session can lose that report.
- Cached input tokens count at face value. The cost estimate uses list prices and ignores cache discounts.
- The top-up endpoint has no sign-in, like the rest of the proof of concept. Set `DEMO_TOPUP=0` to turn it off.
- The Claude and OpenAI counting paths follow the providers' documented usage fields, but were verified end to end in demo mode only (no model key in the build environment). Check the first real answers against the provider's console.
