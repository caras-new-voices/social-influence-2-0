# Accuracy of the product and claim tags

Written by `scripts/classify_products.py judge`. Two models agreeing is not proof, but where they disagree a person should look.

## Hair removal and shaving

Judge: gpt-5.5, reading blind with the same instructions. First reading: gpt-5.4-mini.

- Post product line: the judge agrees on 220 of 240 posts (91%).
- Where the first reading named a product line, the judge names the same one on 133 of 141 (94%).
- Claim "price": first reading 32, judge 40, both 29. Of the first reading's, the judge confirms 90%.
- Claim "efficacy": first reading 66, judge 65, both 48. Of the first reading's, the judge confirms 72%.
- Claim "ease": first reading 49, judge 55, both 44. Of the first reading's, the judge confirms 89%.
- Claim "durability": first reading 8, judge 8, both 6. Of the first reading's, the judge confirms 75%.
- Claim "safety": first reading 50, judge 51, both 44. Of the first reading's, the judge confirms 88%.
- Claim "service": first reading 11, judge 13, both 7. Of the first reading's, the judge confirms 63%.
- Comment product line: the judge agrees on 210 of 240 comments (87%).
- Where the first reading named a product line for a comment, the judge names the same one on 151 of 162 (93%).
