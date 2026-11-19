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

## Claimed benefits after the stricter second reading

Second reading: gpt-5.4 on every caption. Judge: gpt-5.5, blind, same instructions, 300 posts.

- Claim "price": ours 34, judge 42, both 34. The judge confirms 100% of ours, and we find 80% of the judge's. The two agree on 97% of posts.
- Claim "efficacy": ours 66, judge 82, both 66. The judge confirms 100% of ours, and we find 80% of the judge's. The two agree on 94% of posts.
- Claim "ease": ours 57, judge 71, both 56. The judge confirms 98% of ours, and we find 78% of the judge's. The two agree on 94% of posts.
- Claim "durability": ours 5, judge 9, both 5. The judge confirms 100% of ours, and we find 55% of the judge's. The two agree on 98% of posts.
- Claim "safety": ours 76, judge 84, both 76. The judge confirms 100% of ours, and we find 90% of the judge's. The two agree on 97% of posts.
- Claim "service": ours 28, judge 49, both 27. The judge confirms 96% of ours, and we find 55% of the judge's. The two agree on 92% of posts.
- Posts where every claim is the same: 235 of 300 (78%).
