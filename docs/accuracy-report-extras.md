# Accuracy of the wish and price readings

Written by `scripts/classify_extras.py judge`. Judge: gpt-5.5, blind, same instructions. First reading: gpt-5.4.

## Hair removal and shaving

- Wishes: the judge names the same attribute (or none) on 113 of 124 (91%). It agrees on whether the comment is a product request at all on 117 of 124 (94%).
- Price: the judge reads the same view (expensive, good value, a question, other) on 258 of 300 (86%). It agrees on what the price is measured against (nothing, the brand's own products, a tracked brand, something else) on 264 of 300 (88%).
