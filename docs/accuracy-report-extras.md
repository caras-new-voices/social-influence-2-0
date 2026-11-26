# Accuracy of the wish and price readings

Written by `scripts/classify_extras.py judge`. Judge: gpt-5.5, blind, same instructions. First reading: gpt-5.4.

## Hair removal and shaving

- Wishes: the judge names the same attribute (or none) on 112 of 124 (90%). It agrees on whether the comment is a product request at all on 117 of 124 (94%).
- Price: the judge reads the same view (expensive, good value, a question, other) on 254 of 300 (84%). It agrees on what the price is measured against (nothing, the brand's own products, a tracked brand, something else) on 274 of 300 (91%).
- Paid posts: the judge reads the same how a comment takes a paid post: trusts it, points it out or distrusts it (or does not react to it) on 267 of 300 (89%). It agrees on whether the comment counts at all on 278 of 300 (92%).
- Loyalty: the judge reads the same the kind of loyalty (or none) on 276 of 300 (92%). It agrees on whether the comment counts at all on 279 of 300 (93%).
- Safety: the judge reads the same the kind of harm or worry (or none) on 268 of 300 (89%). It agrees on whether the comment counts at all on 280 of 300 (93%).
