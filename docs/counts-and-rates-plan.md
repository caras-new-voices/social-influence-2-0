# Counts and rates: saying which is which

## The problem

The dashboards mix absolute numbers (posts, comments, creators) with rates (share of voice, engagement against the norm, praise per 1,000 comments). They looked the same, and changes were shown the same way. A share of voice moving from 27% to 31% showed as "▲ 15%", which reads as if it were a count. A table showed "30.7" under "share of voice %" next to "1,000" under "posts".

## The rule

Every number is one of these kinds:

- **Count:** an absolute number. Posts, comments, creators, views.
- **Share:** a percentage of a whole. Share of voice, organic share.
- **Change:** a percent change of a count against the period before. Momentum.
- **Difference:** a gap between two shares or scores, in points. Content gap, "vs our average pts".
- **Ratio:** one number against another, where 1.0 means equal. Vs norm, "times our average".
- **Rate:** an average or a per-unit figure. Per 1,000 comments, per post, net sentiment.
- **Amount:** money. Fees, costs.

How each is shown:

- Counts stay plain ("1,000"). A change in a count is a percent ("▲ 12%").
- Shares carry "%" ("30.7%"). A change in a share is in percentage points ("▲ 4.2 pts"), never a percent of a percent.
- Changes carry a sign ("+204%"). Differences carry "pts" ("+12 pts").
- Ratios carry "×" ("1.62×"). A change in a ratio is in the same unit ("▲ 0.12×").
- Rates are rounded to what matters ("592", "58.7", "0.034"). A change in a rate is in its own unit ("▲ 1.3").

## As built

- `src/lib/format.ts`: `columnKind` reads a table column's kind from its name; `kpiKind` reads a KPI tile's kind from its format and label; `formatByKind` and `describeChange` show values and changes as above. Two new formats, `ratio` and `points`.
- Tables: cells carry their unit when the element sets no format. Hovering a number column's header says what kind it is.
- KPI tiles: a small tag after the value says Count, Share, Change, Difference, Ratio, Rate or Amount. Changes follow the rule above.
- Period comparison tables: counts and amounts keep "Δ" and "Δ%". Shares, rates and ratios show only the change, in points or their own unit.
- Chart tooltips in comparison mode follow the same rule.
- The analyst and the month reviews are told to say whether a number is a count or a rate, give every rate its base, and describe share changes in points. Tested with the live model: it reported "−232 posts (−99.1%)" next to "share of voice +44.4 points (from 22.2% to 66.7%)", and "774.5 per 1,000, based on 13,658 comments".
- Tom's template: "Vs norm" uses the ratio format, "Content gap" the points format, and the product priority grid's "against our average" column is now "vs our average pts" (it was a difference in points, not a ratio).

## Naming rule for new columns

The table formats a cell from its column name, so name number columns this way (the analyst is told the same):

- End shares with % and give them as 0 to 100: "share of voice %".
- End percent changes of a count with "change %" or "momentum %".
- Write "vs norm" or "times ..." for ratios.
- Write "pts" for differences between shares.
- Write "per 1K ..." or "per post" for rates.
- Plain names ("posts", "creators") are counts.

## Not done

- Chart axes still show plain numbers; the unit is in the element's title or subtitle.
- KPI tiles on very narrow layouts (eight tiles in one row) have little room; the tag sits after the value and fits at the current sizes.
