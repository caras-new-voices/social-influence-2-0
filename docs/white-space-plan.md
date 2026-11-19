# Plan: making white space show in the report

Written 19 November 2026 as a plan, and built the same day. Two rules were added during the build: a brand with more than half of a theme's posts owns it whatever its size, and a rewarded theme that is under a third unprompted is "brand-seeded" and not white space. See `docs/quality-gate.md`.

## The problem

Tom's brief defines white space as "where the audience rewards content but no brand has moved in". Its test is: engagement at 1.2 times the norm or more, 30 or more posts, and no brand above 25% of the posts.

On the live hair removal data that test finds nothing, and the "own it" list and the white-space briefs both say "none". The reason is the third part of the test. We track six brands, and three of them hold 35%, 30% and 25% of all posts. A brand that size is above 25% of almost any theme just by being big. So the test cannot pass, whatever the audience does.

An empty white-space section reads as "there is no opportunity". That is not true, and it is the cheapest place to build salience.

## What the data shows today

I ran three other ways of asking "has a brand moved in?" on the hair removal data.

- **Shaving routine and how-to.** Engagement is about twice the norm. The largest brand has 35% of its posts, which is exactly its share of all posts. Nobody leads it beyond their size. Under the brief's rule it fails (35% is above 25%). It is the clearest white space we have.
- **Hauls, gift sets and empties.** Engagement is about four times the norm. Estrid has 80% of the posts, so it fails any share test. But only 7% of those posts are the brand's own or paid. The rest are fans. No brand has put content behind it.
- **Men's and unisex grooming.** Engagement is well above the norm. One brand has 80% of the posts, and only 14% are brand-led.
- **Everything shower and body care ritual.** Above the norm, and the leader's share is only a little over its size.

So there is white space. The current test cannot see it.

## The plan

### 1. Judge "owns it" against the brand's size, not a fixed 25%

A brand owns a theme when it has clearly more of it than its size would give it. The measure is the brand's share of the theme divided by its share of all posts. Call it the lead. A lead of 1.0 means the brand is there in proportion to its size. A lead of 1.5 means it has half as much again.

The rule becomes: rewarded (1.2 times the norm, 30 or more posts) and no brand with a lead of 1.5 or more on at least 20 posts of the theme.

When ten or more brands are tracked, the brief's own 25% rule works, so we keep it there. The report says which rule it used.

### 2. Add a second kind: "rewarded, and no brand is behind it"

This is the brief's own words taken literally. A theme counts when it is rewarded and fewer than 15% of its posts are brand-owned or paid. The conversation is running on unprompted posts. A brand that briefs creators into it is the first to move in.

It needs the corrected paid and brand-owned flags, which we now have.

### 3. Grade every theme, so the section is never empty

Each theme with 30 or more posts gets one of four labels, with the numbers beside it:

- **Open:** rewarded, and nobody leads it beyond their size.
- **Unclaimed:** rewarded, and almost none of it is brand-led.
- **Contested:** rewarded, and two or more brands lead it.
- **Owned by X:** one brand leads it. Fight elsewhere, or attack it on purpose.

The "own it" list takes Open and Unclaimed themes, best first. If there are none, it shows the closest ones and says how far they are from open. It never just says "none".

### 4. White space per market

A theme owned overall can be open in one market. One table: for each of the five largest markets, the themes that are Open or Unclaimed there. The same rule, run inside the market. The 30-post minimum applies inside the market, so small markets will show little.

### 5. One "white-space map" that gathers every kind

The brief promises the brand lead a white-space map. Question 2 has six kinds of white space we can answer, and today they sit in six separate boxes. One summary box at the top of section 2 names the best opening of each kind:

- the most open theme;
- the topic people comment on more than creators post about;
- the question asked most that nobody answers;
- the benefit praised more than it is claimed;
- the market with the most comments per creator;
- the platform where we are furthest behind rivals.

Each line carries its proof and links to the box below it. The seventh kind, culture, stays marked as not yet possible.

### 6. A brief for each white space

Already built: once a theme qualifies, "Briefs for the white space" gives it a way to tell it, creators, a paid audience and keywords. With the new rules it will have themes to brief.

### 7. White space in the monthly report

A short section on the Reports page, for all markets or one:

- themes that became open or unclaimed this month;
- themes that closed, and which brand moved in;
- open themes we were told about and have or have not moved into, tied to the "acted on" list.

This is what turns the white-space list from a one-off into something to track.

## What it would show on today's data

With rules 1 and 2, the hair removal list would have about four themes instead of none: one Open (shaving routine and how-to), two Unclaimed (hauls and gift sets; men's and unisex grooming), and one borderline. These numbers come from one test query. They will be checked again when it is built.

## Checks before it goes live

- The number check recalculates every lead, every brand-led share and every label from the raw files.
- The template check runs for all ten industries, including ones with two or three brands, where a lead means less.
- A hand read of 20 posts in each theme called Open or Unclaimed, to confirm the theme is real and the posts are not adverts in disguise.
- The Method page gains the two rules and their thresholds.

## What is weaker

- An undisclosed partnership looks unprompted. A theme can look Unclaimed while a brand is quietly paying for it.
- With two or three brands tracked, "lead beyond size" is a blunt measure. The report will say how many brands the rule rests on.
- Theme tags agree with the judge 78% of the time in hair removal. White space inherits that.

## Decisions for Tom

1. Is "nobody leads it beyond their size" an acceptable reading of "no brand owns it" when few brands are tracked? The thresholds proposed are a lead of 1.5.
2. Should Unclaimed count as white space? A theme can be 80% one brand's fans and still have no brand behind it.
3. The line for "brand-led": under 15% of posts owned or paid.

## What needs data we do not have

- **The whole category, not six brands.** The brief's share of voice is "brand posts divided by category posts". With a category-wide export, the 25% rule works as written and white space becomes much richer.
- **A culture export.** The brief's largest white space is a culture where the category's problem comes up and brands appear in under 5% of posts.

## Order and size

Steps 1 to 3 are one change to the theme tables and the "own it" list. Step 5 is one new box. Steps 4 and 7 are one table and one Reports section. All of it is on data we hold. I would build 1, 2, 3 and 5 first, then 4 and 7.
