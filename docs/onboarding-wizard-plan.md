# Plan: guided onboarding ("Eight questions to build your dashboard")

Status: proposal, nothing built yet.

## 1. What we are solving

The New dashboard dialog asks a person to choose between template descriptions before they have seen anything. It is a wall of text, and none of the options involve the analyst, which is the thing that makes the product different. A new client should be able to say "help me" and end up with a dashboard that answers the eight strategic questions *for their situation*, having talked to the analyst for a few minutes.

Two changes:

1. **Simplify the dialog** to three plain choices, with the guided path first and recommended.
2. **Add the guided path**: an onboarding wizard in which the analyst walks through the eight questions one at a time, shows what the data says, asks one or two personalising questions per step, proposes the elements, and builds the dashboard as the person accepts them. It is a conversation with structure, not a form.

The wizard is also the first place the analyst earns usage-based revenue on day one: every step is an analyst turn.

## 2. The simplified New dashboard dialog

```
New dashboard                                                   Close

 ┌──────────────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
 │ ✦ Build it with the analyst  │ │ ▦ Start from a     │ │ ▢ Start blank      │
 │   Recommended · about 5 min  │ │   template         │ │                    │
 │ Answer eight questions and   │ │ A ready-made set   │ │ An empty canvas;   │
 │ get a dashboard made for you │ │ you can edit       │ │ ask for anything   │
 └──────────────────────────────┘ └────────────────────┘ └────────────────────┘
```

- Three cards, one line of description each, an icon, and no SQL-flavoured vocabulary. The first card is pre-selected.
- Name and description move *out* of the first screen. The template and blank paths ask for a name on a second, small step (prefilled "Venus, <month> <year>"); the guided path asks at the end, when the person knows what they built.
- "Start from a template" expands in place to the template list (Default, Eran's template, and any future ones) with one line each. The registry in `src/lib/templates.ts` already drives this.
- Keyboard: Enter creates with the selected card; Escape closes.

## 3. The wizard

Route: `/dashboard/new/guided` (a full page, not a modal, so it can be resumed from a link and does not fight the dashboard list for space). It creates a blank dashboard on the first step so proposals have somewhere to go, and redirects to `/dashboard/:id` at the end.

### 3.1 Flow

| Step | Title | What happens |
|---|---|---|
| 0 | Let's set up your dashboard | The analyst introduces itself with real numbers ("I have 6,168 creator posts and 31,688 comments about Venus and five competitors, Oct 2025 to Sep 2026"). Three quick choices: which competitors to track (chips, all preselected), the default view (latest complete month, recommended, or all time), and the person's goal (chips: Launch, Retention, Competitive pressure, Risk, Not sure). "Not sure" opens free text: "Tell me what you are trying to find out" and the analyst replies with which of the eight questions matter most for that, which also sets the order of the steps. |
| 1 to 8 | One strategic question each (Eran's eight) | See 3.2. |
| 9 | Your dashboard is ready | Summary of what was built per question, the period and comparison defaults, the name field (prefilled from goal and month), and "Open dashboard". The whole conversation is saved as the dashboard's chat history, so the person can keep going from where they stopped. |

The order of steps 1 to 8 defaults to Eran's order. When the goal is known, the analyst moves the two or three most relevant questions first (Risk → "pushing back on" and "unanswered questions" first; Launch → "what to build" and "emerging needs" first). The person can see the full list in the left rail and jump.

### 3.2 One step, in detail

Each of the eight steps follows the same shape so it is fast to learn:

1. **The question**, large, as the heading: "What is driving the conversation about us right now?"
2. **What the data says**, written by the analyst in two or three sentences with numbers, from one or two quick queries scoped by the earlier answers ("In August, TikTok carried 71% of your engagement; three creators drove a third of it; Instagram images got the warmest reactions.").
3. **Personalise it**, one or two choices with chips and an optional free-text line. The choices are specific to the question (see 3.3), never generic.
4. **Proposed elements**, one to three live preview cards (the existing `ProposalCard`), already filtered by the person's choices. Each has Add, Adjust (free text, re-proposes in place) and Skip. "Add all" is the primary button.
5. **Next**. If the person adds nothing, the step records "skipped" and the summary offers to fill it later with the defaults.

A "Build the rest for me" link is visible from step 3 onwards: the analyst adds the default elements for the remaining questions, personalised with the answers so far, and jumps to the summary. This caps the time investment at the person's patience.

### 3.3 The eight questions and their personalisation

| # | Question (as shown) | Personalising choices (chips) | Default elements (from Eran's template, personalised) |
|---|---|---|---|
| 1 | What is driving the conversation about us right now? | Channels to watch (TikTok, Instagram, YouTube); creator sizes that matter (nano to mega); paid, organic or both | KPI row vs previous period; creators driving it; channels; creatives |
| 2 | Where does the conversation show real intent to buy, and from whom? | Intent stages to count (explicit only, or include aspirational and conditional); show blockers yes/no | Intent by platform; whose audiences want to buy; intent verbatims |
| 3 | What does the audience love that we should keep doing? | Which formats to compare (platform × format); include loyalty signals | Positive topics; warmest formats; loyalty signals; fan verbatims |
| 4 | What is the audience ignoring or pushing back on? | Objection categories to track (quality, price, availability, trust…); include sponsorship perception | Objections; sponsorship perception; ignored formats; objection verbatims |
| 5 | What are people asking that nobody is answering yet? | Only questions with zero replies, or all; minimum likes | Unanswered topics; questions verbatim |
| 6 | What product or service is the conversation asking us to build? | Request types (variant, feature, format, size…) | Feature requests by type; requests verbatim; blockers to remove |
| 7 | What new need is emerging that no brand owns yet? | Category-wide or own audience only; which competitors to include | Emerging needs across the category; category-wide requests; question topics over time |
| 8 | Which creators, brands and partners are already in our conversation, and who should we partner with? | Partner types (creators, adjacent brands, retailers); minimum followers; exclude competitors | Creators to partner with; brands the audience loves; competitors in the conversation; category creators |

The chips are not free-form filters invented by the model; they map to known columns, so the personalised SQL is predictable and the demo mode can build it without an LLM.

### 3.4 Discuss with the analyst at any step

Under the chips there is always a text box: "Or tell me what you want to see". It is a normal analyst turn scoped to the current question, with the person's earlier answers in context. The analyst can answer, propose, or ask back. This is the "option to discuss with AI" and it is available without leaving the wizard.

## 4. How it works underneath

### 4.1 Wizard definition (`src/lib/wizard.ts`)

A static, typed list of steps: id, question, the personalising choices (each a key, label, chip options and the SQL fragment each option maps to), the default element recipes (references into `ERAN_SECTIONS` plus a `personalise(answers)` function that rewrites their SQL: platform filters, tier filters, intent stages, objection categories, competitor list, minimum likes), and the "what the data says" query for the step. Everything the demo mode needs lives here; the LLM path uses the same definitions as grounding so its proposals stay inside the schema.

### 4.2 A wizard mode for the chat turn (`src/lib/claude.ts`)

`runChatTurn` gains `wizard?: { stepId, answers, goal }`. In that mode the instruction sent to the model is built from the step definition: the question, the person's choices, the earlier answers, the default recipes as "start from these and adapt them", and a strict output contract: two or three sentences of "what the data says" with numbers, then one to three `propose_widget` calls, then no follow-ups. The existing streaming events (`text`, `query`, `widget`, `done`) are enough; the wizard UI renders them with the same components as the chat. Demo mode: `mockWizardTurn` writes the sentences from the step's query and proposes the personalised default recipes, so the whole wizard works in demo.

### 4.3 State and persistence

- `dashboards.onboarding jsonb`: `{ version, goal, order, answers: { [stepId]: { choices, text, added: widgetIds[], skipped } }, currentStep, startedAt, completedAt }`. Saved after every step. A dashboard whose onboarding is unfinished shows a "Resume setup (step 4 of 8)" banner on its page, and the dashboard list card shows "Setup in progress".
- Accepted elements are added to the dashboard immediately through the existing create and update APIs, laid out per question using `layoutSections` from `templates.ts` (one section header per question, in the chosen order). Elements the person adjusts replace the proposal in place.
- The period defaults chosen in step 0 are written to `dashboards.period` so the dashboard opens on the right month with comparison on.
- The conversation is stored as the dashboard's chat history through `storeMessage`, so the analyst remembers the onboarding in later chats and the person can scroll back to it.

### 4.4 Latency

Each step is one analyst turn (two or three queries plus proposals), five to twelve seconds with an LLM. To hide that: stream the "what the data says" text as it arrives; prefetch the next step's turn as soon as the person lands on a step (abort if they change an answer that affects it); show the previous step's proposals immediately as skeletons. Demo mode is instant.

### 4.5 UI (`src/components/OnboardingWizard.tsx` and `wizard.css`)

- Left rail: the eight questions as a checklist with status (done, skipped, current), the goal and competitors chosen, and "Build the rest for me".
- Main column: question heading, analyst text, chips, proposals, free text, Back and Next. Progress bar across the top ("Question 3 of 8"). Everything keyboard-navigable; chips are toggle buttons with `aria-pressed`.
- Reuses `ProposalCard`, `Markdown`, the toast and confirm components, and the IMAI tokens. No new dependencies.
- Mobile: the rail collapses to the progress bar; chips wrap; proposals stack.

### 4.6 Entry points

- The New dashboard dialog (first card).
- The empty state of the dashboard list ("Create your first dashboard" becomes the guided path).
- The chat's "Not sure where to begin?" box on a blank dashboard gains "Set it up with eight questions", which starts the wizard for that dashboard.

### 4.7 Measurement and billing hooks

- Funnel events (started, step viewed, chips chosen, proposal added or adjusted or skipped, build-the-rest, finished, resumed) to the analytics sink of choice; locally, a `usage_events` table so the funnel can be read in SQL.
- Each wizard turn is recorded like any analyst turn (dashboard id, kind `wizard`, step id, tokens in and out, model). This is the counter the usage-based billing reads later; the wizard does not need billing to exist to ship.

## 5. Copy guidelines

- Questions are shown in the first person plural, as the client would say them ("about us", "our"), which is how Eran wrote them.
- The analyst speaks in short sentences with numbers, never "insights" or "leverage". Two or three sentences per step, then stop.
- Chip labels are nouns, five words at most. The free-text prompt is always "Or tell me what you want to see".
- Buttons: Add all, Add, Adjust, Skip, Next, Back, Build the rest for me, Open dashboard.

## 6. Work plan

| Phase | Scope | Touches | Estimate |
|---|---|---|---|
| A. Dialog | Three-card dialog, name on a second step, template list in place, empty-state entry point | `DashboardList.tsx`, `globals.css` | 0.5 day |
| B. Wizard engine | `wizard.ts` step definitions with personalisers for all eight questions, `wizard` mode in `runChatTurn` with the output contract, demo-mode wizard turn, `dashboards.onboarding` column and save API, `POST /api/wizard/step` (runs a step, streams events), tests of the personalised SQL against the dataset for every chip combination | `src/lib/wizard.ts`, `claude.ts`, `schema.ts`, `dashboards.ts`, new API route | 2 to 3 days |
| C. Wizard UI | Page, rail, step view, proposals with Add/Adjust/Skip, free-text discuss, Build the rest, summary with name and Open, resume banner, keyboard and mobile | `OnboardingWizard.tsx`, `wizard.css`, `Workspace.tsx` (banner), `page.tsx` for the route | 2 to 3 days |
| D. Polish | Goal-based ordering, prefetching the next step, funnel and usage events, copy pass, screenshots for the promo video | `wizard.ts`, `OnboardingWizard.tsx`, new `usage_events` | 1 to 2 days |

Phases A and B can run in parallel; C depends on B. Total about six to eight working days for one person.

## 7. Decisions to take before building

- **Page or modal.** The plan says page, for resumability and room. If the team prefers staying on the dashboard list, the same component works in a full-screen modal; resume then needs a link anyway.
- **How much the LLM may change the SQL.** The plan limits personalisation to the chip-mapped columns plus free-text adjustments that go through the normal propose-and-preview loop. Letting the model rewrite everything freely makes demo mode impossible and proposals less predictable.
- **Default view for new dashboards.** Recommended: latest complete month with comparison to the previous month, because the wizard's "what the data says" sentences read better about a month than about all time. Can be switched in step 0.
- **Question order by goal.** The mapping from goals to question order is editorial; the table in 3.1 is a first draft to review with Eran.
- **Who else sees the onboarding conversation.** It becomes part of the dashboard's chat, visible to everyone with the dashboard. Fine for the proof of concept; with auth, it should be attributed to the person who ran it.
