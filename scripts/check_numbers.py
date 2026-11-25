"""Recalculates the default dashboard's headline numbers from the raw seed files, independently of
the app's SQL, and compares them with what a running app returns.

  python3 -I scripts/check_numbers.py [--base http://localhost:3000] [--focal Venus] [--market Germany]

It tests the arithmetic, not the labels: given the same labels, do share of voice, earned share,
momentum, engagement vs norm, the paid mix, the per-1,000 comment rates and the theme table come
out the same when computed a second way? It covers the live industry (hair removal), all time, with
every tracked brand in the selection. Numbers must match to the rounding the dashboard shows.

The paid, gifted and brand-owned rules are re-applied here from the same marker lists the app uses
(read out of src/lib/themes.ts), so a difference means the app applied them differently.
"""
import urllib.error, gzip, json, os, re, sys, urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, "data", "seed")
def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
BASE = arg("--base", os.environ.get("SI_BASE", "http://localhost:3000"))
IND = arg("--industry", "hair-removal")
_ind = [i for i in json.load(open(os.path.join(SEED, "catalog.json"), encoding="utf-8"))["industries"] if i["id"] == IND][0]
FOCAL = arg("--focal", _ind.get("suggestedFocal") or _ind["brands"][0]["name"])
MARKET = arg("--market")   # a creator country: recompute everything inside that market, as the market filter does
gz = lambda *p: json.load(gzip.open(os.path.join(SEED, *p), "rt", encoding="utf-8"))

def call(path, body=None, method=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json", "User-Agent": "qa-check"}, method=method or ("POST" if body is not None else "GET"))
    try:
        return json.loads(urllib.request.urlopen(req, timeout=300).read().decode())
    except urllib.error.HTTPError as e:   # a box whose query fails answers 400 with the reason
        try: return {"error": json.loads(e.read().decode()).get("error", f"HTTP {e.code}")}
        except Exception: return {"error": f"HTTP {e.code}"}

# ---------------------------------------------------------------- the data, corrected a second way
catalog = json.load(open(os.path.join(SEED, "catalog.json"), encoding="utf-8"))
ind = [i for i in catalog["industries"] if i["id"] == IND][0]
handles = {b["name"]: {h.lower() for h in b.get("handles", [])} for b in ind["brands"]}
brands = [b["name"] for b in ind["brands"]]

src = open(os.path.join(ROOT, "src", "lib", "themes.ts"), encoding="utf-8").read()
def markers(name):
    body = re.search(r"const %s = \[(.*?)\]\.join" % name, src, re.S).group(1)
    items = [json.loads('"' + m + '"') for m in re.findall(r'"((?:[^"\\]|\\.)*)"', body)]
    return re.compile("|".join(items).replace("\\m", "\\b").replace("\\M", "\\b"))
PAID, NOT_PAID, GIFTED, AFFILIATE = markers("PAID_MARKERS"), markers("NOT_PAID_MARKERS"), markers("GIFTED_MARKERS"), markers("AFFILIATE_MARKERS")

labels = gz("labels", IND + ".json.gz")
themes, hooks = labels["themes"], labels["hooks"]
lab = {(r[0], r[1]): r for r in labels["rows"]}
disc = {(r[0], r[1]): gz("disclosure", IND + ".json.gz")["values"][r[2]] for r in gz("disclosure", IND + ".json.gz")["rows"]}
ts = lambda s: datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S") if s else None

posts = []
post_country = {}
for p in gz("posts.json.gz"):
    post_country[(p["segment_id"], p["post_id"])] = p.get("country")
    if MARKET and p.get("country") != MARKET: continue
    key = (p["segment_id"], p["post_id"])
    l = lab.get(key)
    if l and l[5] == "no": continue                      # not about the brand: left out of everything
    text = (p.get("text") or "").lower()
    d = disc.get(key)
    if p.get("text") and PAID.search(text): d = "paid"
    if d == "paid" and NOT_PAID.search(text): d = None
    if d is None and p.get("text") and GIFTED.search(text): d = "gifted"
    if d is None and l and l[4] > 0 and hooks[l[4] - 1] == "Giveaway or competition": d = "gifted"
    # What the caption says wins over the bare flag; a shop post is affiliate unless the caption carries an advert marker.
    affiliate = bool(p.get("text")) and bool(AFFILIATE.search(text)) and not (PAID.search(text) and not NOT_PAID.search(text))
    by_caption = d == "paid" and not affiliate
    by_flag = bool(p.get("is_paid")) and not affiliate and d != "gifted" and not by_caption
    paid = by_caption or by_flag
    reach_f = (p["platform"] == "instagram" and p["post_type"] == "image") or not (p.get("views") or 0)
    posts.append({**p, "at": ts(p.get("published_at")), "paid": paid, "flag_only": by_flag, "affiliate": affiliate, "gifted": d == "gifted" and not affiliate,
                  "owned": (p.get("username") or "").lower() in handles.get(p["brand"], set()),
                  "theme": themes[l[2] - 1] if l and l[2] > 0 else None,
                  "basis": "f" if reach_f else "v", "reach": (p.get("followers") if reach_f else p.get("views")) or 0})
for p in posts: p["earned"] = not (p["paid"] or p["gifted"] or p["owned"] or p["affiliate"])

cl = gz("comment_labels", IND + ".json.gz")
kept_posts = {(p["segment_id"], p["post_id"]) for p in posts}
cmeta = {(r[0], r[1]): r for r in cl["rows"]}
comments = []
for c in gz("comments.json.gz"):
    if MARKET and post_country.get((c["segment_id"], c["post_id"])) != MARKET: continue   # a comment takes its post's market
    r = cmeta.get((c["segment_id"], c["comment_id"]))
    about = cl["about"][r[2]] if r else None
    if about is not None and about not in ("brand", "category"): continue   # brand comments only (unclassified ones stay in)
    comments.append({**c, "at": ts(c.get("published_at")), "about": about, "attribute": cl["attributes"][r[3]] if r and r[3] > 0 else None,
                     "buying": (r[4] == 1) if r else (c.get("purchase_intent_type") is not None)})

# ---------------------------------------------------------------- the measures, computed here
dated = [p["at"] for p in posts if p["at"]]
if not dated: raise SystemExit(f"No posts for {IND}{' in ' + MARKET if MARKET else ''}: check the spelling of --market.")
end = max(dated) + timedelta(seconds=1); start = max(dated) - timedelta(days=90); prev = start - (end - start)
cur = [p for p in posts if p["at"] and start <= p["at"] < end]
before = [p for p in posts if p["at"] and prev <= p["at"] < start]

norm = defaultdict(lambda: [0.0, 0.0])
for p in posts:
    if p["reach"] > 0:
        k = (p["platform"], p.get("tier") or "", p["basis"]); norm[k][0] += p.get("engagement") or 0; norm[k][1] += p["reach"]
def vs(group):
    eng = exp = 0.0
    for p in group:
        k = (p["platform"], p.get("tier") or "", p["basis"])
        rate = norm[k][0] / norm[k][1] if norm[k][1] else 0
        if p["reach"] > 0 and rate > 0: eng += p.get("engagement") or 0; exp += p["reach"] * rate
    return eng / exp if exp else None
of = lambda group, b: [p for p in group if p["brand"] == b]
neg = lambda c: c.get("sentiment") == "negative" or c.get("objection_category") is not None

checks = []
def check(name, mine, theirs, tol=0.006):
    # The dashboard rounds what it shows; allow half a unit of the last digit shown (0, 1 or 2 decimals).
    shown = len(repr(float(theirs)).split(".")[1].rstrip("0")) if theirs is not None else 0
    slack = 0.5 * 10 ** -shown + 1e-9 if shown <= 2 else 0
    ok = (mine is None and theirs is None) or (mine is not None and theirs is not None and abs(mine - theirs) <= max(slack, tol * max(1, abs(theirs))))
    checks.append((ok, name, mine, theirs))

scope = {"industry": IND, "focal": FOCAL, "competitors": [b for b in brands if b != FOCAL]}
dash = call("/api/dashboards", {"name": "QA numbers (safe to delete)", "template": "tom8", "scope": scope})["dashboard"]
got = {}
for w in dash["widgets"]:
    if not w.get("sql"): continue
    res = call("/api/widgets/data", {"sql": w["sql"], "scope": scope, **({"window": {"market": MARKET}} if MARKET else {})})
    # A box whose query fails must fail the check, not pass it with nothing to compare.
    if "rows" not in res: checks.append((False, f"box \"{w['title']}\" runs", "rows", str(res.get("error"))[:120]))
    got[w["title"]] = res.get("rows", [])
call(f"/api/dashboards/{dash['id']}", None, "DELETE")

bad = [c for c in checks if not c[0]]
if bad or not got.get("Our eight measures"):
    for ok, name, mine, theirs in bad: print(f"  FAILED {name}: {theirs}")
    raise SystemExit("A box did not run, so nothing was compared.")
kpi = {r["label"]: r for r in got["Our eight measures"]}
us, us_b = of(cur, FOCAL), of(before, FOCAL)
div = lambda a, b: a / b if b else None   # nothing in the period: the dashboard shows an empty value
check("KPI share of voice", div(len(us), len(cur)), kpi["Share of voice"]["value"])
check("KPI share of voice, period before", len(us_b) / len(before) if before else None, kpi["Share of voice"]["compare"])
check("KPI engagement vs norm", vs(us), kpi["Engagement vs norm"]["value"])
check("KPI momentum", len(us) / len(us_b) - 1 if len(us_b) >= 3 else None, kpi["Momentum"]["value"])
check("KPI earned share", div(sum(p["earned"] for p in us), len(us)), kpi["Earned share"]["value"])
cc = [c for c in comments if c["brand"] == FOCAL and c["at"] and start <= c["at"] < end]
# The comment measures are shown only with 200 or more brand comments in the period: the rule is checked both ways.
checks.append(((len(cc) >= 200) == ("Purchase intent per 1K" in kpi), "KPI comment measures shown only with 200+ brand comments", len(cc), "shown" if "Purchase intent per 1K" in kpi else "hidden"))
if "Purchase intent per 1K" in kpi:
    check("KPI purchase intent per 1K", 1000 * sum(c["buying"] for c in cc) / len(cc), kpi["Purchase intent per 1K"]["value"])
    check("KPI praise per 1K", 1000 * sum(c.get("sentiment") == "positive" for c in cc) / len(cc), kpi["Praise per 1K"]["value"])
    check("KPI objections per 1K", 1000 * sum(neg(c) for c in cc) / len(cc), kpi["Objections per 1K"]["value"])

for r in got["The same measures for every tracked brand"]:
    b = r["brand"]; g, gb = of(cur, b), of(before, b)
    check(f"{b}: posts", len(g), r["posts"], 0)
    check(f"{b}: creators", len({p['influencer_id'] for p in g if p.get('influencer_id') is not None}), r["creators"], 0)
    check(f"{b}: share of voice %", 100 * len(g) / len(cur), r["share of voice %"], 0.004)
    check(f"{b}: engagement rate %", 100 * sum(p.get("engagement") or 0 for p in g) / max(1e-9, sum(p["reach"] for p in g)), r["engagement rate %"], 0.02)
    check(f"{b}: engagement vs norm", vs(g), r["engagement vs norm"], 0.01)
    if r["momentum %"] is not None: check(f"{b}: momentum %", 100 * (len(g) / len(gb) - 1), r["momentum %"], 0.01)
    check(f"{b}: earned share %", 100 * sum(p["earned"] for p in g) / len(g), r["earned share %"], 0.02)

if "Share of voice, four ways" in got:
    allp = posts   # all time, like the box
    tv = sum(p.get("views") or 0 for p in allp); te = sum(p.get("engagement") or 0 for p in allp)
    tc = len({p["influencer_id"] for p in allp if p.get("influencer_id") is not None})
    for r in got["Share of voice, four ways"]:
        g = of(allp, r["brand"])
        check(f"four ways {r['brand']}: posts %", 100 * len(g) / len(allp), r["share of posts %"], 0.004)
        if tv: check(f"four ways {r['brand']}: views %", 100 * sum(p.get("views") or 0 for p in g) / tv, r["share of views %"], 0.004)
        check(f"four ways {r['brand']}: creators %", 100 * len({p['influencer_id'] for p in g if p.get('influencer_id') is not None}) / max(1, tc), r["share of creators %"], 0.004)
        if te: check(f"four ways {r['brand']}: engagements %", 100 * sum(p.get("engagement") or 0 for p in g) / te, r["share of engagements %"], 0.004)
    checks.append((len(got["Share of voice, four ways"]) == len({p["brand"] for p in allp}), "four ways: one row per brand with posts", len({p["brand"] for p in allp}), len(got["Share of voice, four ways"])))

mix = defaultdict(int)
for p in posts: mix[(p["brand"], "Brand-owned" if p["owned"] else "Paid: platform label only" if p["flag_only"] else "Paid: disclosed in the caption" if p["paid"] else "Affiliate or shop" if p["affiliate"] else "Gifted" if p["gifted"] else "Earned")] += 1
for r in got["Earned, gifted, affiliate, paid and brand-owned posts"]: check(f"mix {r['brand']} {r['kind']}", mix[(r["brand"], r["kind"])], r["value"], 0)

# Comment boxes are built into a dashboard only when our brand has 200 brand comments over all time and all markets.
# (Inside a market or a period the page hides a box whose sample is too small; that is the page's job, not the query's.)
ours_bc = sum(1 for c in comments if c["brand"] == FOCAL)
if not MARKET: checks.append(((ours_bc >= 200) == ("What the audience says, per tracked brand" in got), "comment boxes built only with 200+ brand comments of ours", ours_bc, "built" if "What the audience says, per tracked brand" in got else "left out"))
for r in got.get("What the audience says, per tracked brand", []):
    g = [c for c in comments if c["brand"] == r["brand"]]
    check(f"{r['brand']}: brand comments", len(g), r["brand comments"], 0)
    check(f"{r['brand']}: intent per 1K", 1000 * sum(c["buying"] for c in g) / len(g), r["intent per 1K"], 0.002)
    check(f"{r['brand']}: praise per 1K", 1000 * sum(c.get("sentiment") == "positive" for c in g) / len(g), r["praise per 1K"], 0.002)
    check(f"{r['brand']}: objections per 1K", 1000 * sum(neg(c) for c in g) / len(g), r["objections per 1K"], 0.002)

share = div(len(us), len(cur))
for r in got["Themes: momentum and engagement vs norm"]:
    t = r["theme"]; g = [p for p in cur if p["theme"] == t]; gb = [p for p in before if p["theme"] == t]
    v = vs(g); mom = len(g) / len(gb) - 1 if len(gb) >= 3 else None
    check(f"theme {t}: posts", len(g), r["posts"], 0)
    check(f"theme {t}: engagement vs norm", v, r["engagement vs norm"], 0.01)
    if r["momentum %"] is not None: check(f"theme {t}: momentum %", 100 * mom, r["momentum %"], 0.01)
    check(f"theme {t}: our share of posts %", 100 * len(of(g, FOCAL)) / len(g), r["our share of posts %"], 0.02)
    vv = v or 0
    status = ("early signal" if vv >= 1.5 and mom is not None and mom < 0.2 else "winning" if vv >= 1.2 and mom is not None and mom > 0 else
              "peaking" if mom is not None and mom >= 0.5 and vv < 1 else "above norm" if vv >= 1.2 else "below norm" if vv < 0.8 else "steady")
    checks.append((status == r["status"], f"theme {t}: status", status, r["status"]))

for r in got.get("What people love and hate, by attribute", []):
    a = r["attribute"].split(":")[0].split(" ")[0].lower()
    g = [c for c in comments if c["brand"] == FOCAL]; ga = [c for c in g if c["attribute"] == a]
    if not ga:   # nobody mentions it: the dashboard leaves the cell empty, which is right
        checks.append((r["our praise per 1K"] is None and r["our objections per 1K"] is None, f"attribute {a}: empty when nobody mentions it", None, r["our praise per 1K"])); continue
    check(f"attribute {a}: our praise per 1K", 1000 * sum(c.get("sentiment") == "positive" for c in ga) / len(g), r["our praise per 1K"], 0.004)
    check(f"attribute {a}: our objections per 1K", 1000 * sum(neg(c) for c in ga) / len(g), r["our objections per 1K"], 0.004)

# Product lines and claimed benefits (all time, like the boxes).
if os.path.exists(os.path.join(SEED, "product_labels", IND + ".json.gz")) and "What people say, by product" in got:
    pl = gz("product_labels", IND + ".json.gz")
    pprod = {(r[0], r[1]): (pl["products"][r[2]] if r[2] >= 2 else None, {a for i, a in enumerate(pl["attributes"]) if r[3] & (1 << i)}) for r in pl["posts"]}
    cprod = {(r[0], r[1]): pl["products"][r[2]] for r in pl["comments"] if r[2] >= 2}
    line = lambda p: pprod.get((p["segment_id"], p["post_id"]), (None, set()))[0]
    claims = lambda p: pprod.get((p["segment_id"], p["post_id"]), (None, set()))[1]
    # Every line with 20 or more posts must be there, and no other.
    expect = defaultdict(int)
    for p in posts:
        if line(p): expect[(p["brand"], line(p))] += 1
    expect = {k for k, n in expect.items() if n >= 20}
    shown = {(r["brand"], r["product"]) for r in got["What people say, by product"]}
    checks.append((expect == shown, "product lines shown are exactly those with 20+ posts", sorted(expect - shown)[:3], sorted(shown - expect)[:3]))
    for r in got["What people say, by product"]:
        g = [p for p in posts if p["brand"] == r["brand"] and line(p) == r["product"]]
        gc = [c for c in comments if c["brand"] == r["brand"] and cprod.get((c["segment_id"], c["comment_id"])) == r["product"]]
        name = f"product {r['brand']} {r['product']}"
        check(f"{name}: posts", len(g), r["posts"], 0)
        check(f"{name}: engagement vs norm", vs(g), r["engagement vs norm"], 0.01)
        check(f"{name}: brand comments", len(gc), r["brand comments"], 0)
        checks.append(((len(gc) >= 200) == (r["praise per 1K"] is not None), f"{name}: rates shown only with 200+ brand comments", len(gc), r["praise per 1K"]))
        if r["praise per 1K"] is not None:
            check(f"{name}: praise per 1K", 1000 * sum(c.get("sentiment") == "positive" for c in gc) / len(gc), r["praise per 1K"], 0.002)
            check(f"{name}: objections per 1K", 1000 * sum(neg(c) for c in gc) / len(gc), r["objections per 1K"], 0.002)
            check(f"{name}: buying signals per 1K", 1000 * sum(c["buying"] for c in gc) / len(gc), r["buying signals per 1K"], 0.002)
    for title, who, col in (("Benefits nobody claims", None, "posts claiming it"), ("Are we saying what people value?", FOCAL, "our posts claiming it")):
        if title not in got: continue   # the box needs a minimum of posts with a claim
        gp = [p for p in posts if who is None or p["brand"] == who]
        gcm = [c for c in comments if (who is None or c["brand"] == who) and c["attribute"] and c.get("sentiment") == "positive"]
        all_claims = sum(len(claims(p)) for p in gp)
        for r in got[title]:
            a = r["attribute"].split(":")[0].split(" ")[0].lower()
            n = sum(a in claims(p) for p in gp); k = sum(c["attribute"] == a for c in gcm)
            check(f"{title} {a}: posts claiming", n, r[col], 0)
            check(f"{title} {a}: comments praising", k, r["comments praising it"], 0)
            if gcm and all_claims: check(f"{title} {a}: gap, points", 100 * k / len(gcm) - 100 * n / all_claims, r["gap, points"], 0.004)

    # Objections by product: is it getting worse? The latest 90 days of comments against the 90 days before.
    title = "Objections by product, ours and rivals'"
    if title in got:
        pc = [c for c in comments if cprod.get((c["segment_id"], c["comment_id"])) and c["at"]]
        last = max(c["at"] for c in pc)
        for r in got[title]:
            g = [c for c in pc if c["brand"] == r["brand"] and cprod[(c["segment_id"], c["comment_id"])] == r["product"]]
            now = [c for c in g if c["at"] > last - timedelta(days=90)]
            was = [c for c in g if last - timedelta(days=180) < c["at"] <= last - timedelta(days=90)]
            name = f"objection trend {r['brand']} {r['product']}"
            checks.append(((len(now) >= 50) == (r["per 1K, latest 90 days"] is not None), f"{name}: latest shown only with 50+ comments", len(now), r["per 1K, latest 90 days"]))
            checks.append(((len(was) >= 50) == (r["per 1K, the 90 days before"] is not None), f"{name}: before shown only with 50+ comments", len(was), r["per 1K, the 90 days before"]))
            rn = sum(neg(c) for c in now) / len(now) if len(now) >= 50 else None
            rw = sum(neg(c) for c in was) / len(was) if len(was) >= 50 else None
            if rn is not None: check(f"{name}: latest per 1K", 1000 * rn, r["per 1K, latest 90 days"], 0.002)
            if rw is not None: check(f"{name}: before per 1K", 1000 * rw, r["per 1K, the 90 days before"], 0.002)
            d = None if rn is None or rw is None else "getting worse" if rn >= 1.2 * rw and rn > 0 else "getting better" if rn <= 0.8 * rw else "steady"
            checks.append((d == r["direction"], f"{name}: direction", d, r["direction"]))
    # What people wish existed, by product: requests counted again, lines with 3+.
    title = "What people wish existed, by product"
    if title in got:
        wish = defaultdict(list)
        for c in comments:
            line_c = cprod.get((c["segment_id"], c["comment_id"]))
            if line_c and c["about"] == "brand" and c.get("feature_request_type"): wish[(c["brand"], line_c)].append(c)
        expect = {k for k, v in wish.items() if len(v) >= 3}
        shown = {(r["brand"], r["product"]) for r in got[title]}
        checks.append((expect == shown, "wishes: lines shown are exactly those with 3+ requests", sorted(expect - shown)[:3], sorted(shown - expect)[:3]))
        for r in got[title]:
            g = wish.get((r["brand"], r["product"]), [])
            kinds = defaultdict(int)
            for c in g: kinds[c["feature_request_type"]] += 1
            top = sorted(kinds.items(), key=lambda x: (-x[1], x[0]))[0] if kinds else (None, 0)
            check(f"wishes {r['brand']} {r['product']}: requests", len(g), r["requests"], 0)
            check(f"wishes {r['brand']} {r['product']}: likes", sum(c.get("likes") or 0 for c in g), r["likes"], 0)
            check(f"wishes {r['brand']} {r['product']}: of the top kind", top[1], r["of that kind"], 0)
            checks.append((top[0] == r["asked for most"], f"wishes {r['brand']} {r['product']}: kind asked for most", top[0], r["asked for most"]))

# Price and wishes, read a second time (scripts/classify_extras.py): counted again from the file.
if os.path.exists(os.path.join(SEED, "extra_labels", IND + ".json.gz")):
    ex = gz("extra_labels", IND + ".json.gz")
    pview = {(r[0], r[1]): (r[2], r[3] or None) for r in ex["prices"]}
    wish = {(r[0], r[1]): r[2] for r in ex["wishes"]}
    priced = [c for c in comments if c["attribute"] == "price" and (c["segment_id"], c["comment_id"]) in pview]
    view = lambda c: pview[(c["segment_id"], c["comment_id"])][0]
    versus = lambda c: pview[(c["segment_id"], c["comment_id"])][1]
    title = "How each brand's price is judged"
    if title in got:
        checks.append(({b for b in brands if len(of(priced, b)) >= 10} == {r["brand"] for r in got[title]}, "price: brands shown are exactly those with 10+ price comments", None, len(got[title])))
        for r in got[title]:
            g = of(priced, r["brand"])
            check(f"price {r['brand']}: price comments", len(g), r["price comments"], 0)
            for col, v in (("too expensive %", "expensive"), ("good value %", "good"), ("asks the price %", "asks"), ("other %", "other")):
                check(f"price {r['brand']}: {col}", 100 * sum(view(c) == v for c in g) / len(g) if g else None, r[col], 0.02)
    title = "What people measure the price against"
    if title in got:
        pairs = defaultdict(list)
        for c in priced:
            if versus(c): pairs[(c["brand"], versus(c))].append(c)
        for r in got[title]:
            g = pairs.get((r["brand"], r["measured against"]), [])
            name = f"price of {r['brand']} against {r['measured against']}"
            check(f"{name}: comments", len(g), r["comments"], 0)
            check(f"{name}: say too expensive", sum(view(c) == "expensive" for c in g), r["say too expensive"], 0)
            check(f"{name}: say good value", sum(view(c) == "good" for c in g), r["say good value"], 0)
        big = {k for k, v in pairs.items() if len(v) >= 2}
        if len(got[title]) < 20: checks.append((big == {(r["brand"], r["measured against"]) for r in got[title]}, "price: pairs shown are exactly those with 2+ comments", len(big), len(got[title])))
    title = "What people wish existed, by attribute"
    if title in got:
        real = [c for c in comments if c["about"] == "brand" and c.get("feature_request_type") and (c["segment_id"], c["comment_id"]) in wish]
        key = lambda label: {"Look,": "design", "Something": "other"}.get(label.split(" ")[0], label.split(":")[0].split(" ")[0].lower())
        check("wishes by attribute: all of them are in the table", len(real), sum(r["our comments"] + r["rivals' comments"] for r in got[title]), 0)
        for r in got[title]:
            g = [c for c in real if wish[(c["segment_id"], c["comment_id"])] == key(r["the wish is about"])]
            check(f"wish about {key(r['the wish is about'])}: our comments", len(of(g, FOCAL)), r["our comments"], 0)
            check(f"wish about {key(r['the wish is about'])}: rivals' comments", len(g) - len(of(g, FOCAL)), r["rivals' comments"], 0)
            check(f"wish about {key(r['the wish is about'])}: likes", sum(c.get("likes") or 0 for c in g), r["likes"], 0)

# Platforms each theme under-uses: a platform's share of the theme against its share of all themed posts.
title = "Platforms each theme under-uses"
if title in got:
    tp = [p for p in posts if p["theme"] and p.get("platform")]
    for r in got[title]:
        g = [p for p in tp if p["theme"] == r["theme"]]; gp = [p for p in g if p["platform"] == r["platform"]]
        allp = sum(1 for p in tp if p["platform"] == r["platform"]) / len(tp)
        name = f"platform {r['theme']} on {r['platform']}"
        check(f"{name}: posts", len(gp), r["posts"], 0)
        check(f"{name}: our posts", len(of(gp, FOCAL)), r["our posts"], 0)
        check(f"{name}: share of the theme %", 100 * len(gp) / len(g), r["share of the theme's posts %"], 0.02)
        check(f"{name}: platform's share of all %", 100 * allp, r["platform's share of all themed posts %"], 0.02)
        check(f"{name}: under-used by", 100 * (allp - len(gp) / len(g)), r["under-used by, points"], 0.02)
        check(f"{name}: engagement vs norm", vs(gp), r["engagement vs norm"], 0.01)
        checks.append((len(g) >= 30 and len(gp) >= 5 and (vs(gp) or 0) >= 1.2 and len(gp) / len(g) < allp, f"{name}: passes the rule", True, True))
    if len(got[title]) < 12:
        want = set()
        for t in {p["theme"] for p in tp}:
            g = [p for p in tp if p["theme"] == t]
            for pf in {p["platform"] for p in g}:
                gp = [p for p in g if p["platform"] == pf]
                if len(g) >= 30 and len(gp) >= 5 and (vs(gp) or 0) >= 1.2 and len(gp) / len(g) < sum(1 for p in tp if p["platform"] == pf) / len(tp): want.add((t, pf))
        checks.append((want == {(r["theme"], r["platform"]) for r in got[title]}, "platforms: every pair that passes the rule is shown, and no other", len(want), len(got[title])))

# Audiences by age and gender: creators with a known audience, grouped, and each group's share of comments against its share of creators.
title = "Audiences by age and gender: conversation against creators"
if title in got:
    aud = {}
    for i in gz("influencers.json.gz"):
        ages = i.get("audience_ages")
        if i.get("audience_female") is None or not isinstance(ages, dict) or not ages: continue
        f = i["audience_female"]
        age = sorted(ages.items(), key=lambda x: (-float(x[1]), x[0]))[0][0]
        aud[(i["segment_id"], i["influencer_id"])] = ("Mostly women" if f >= 0.6 else "Mostly men" if f <= 0.4 else "Mixed") + ", " + age
    grp = defaultdict(list)
    for p in posts:
        k = aud.get((p["segment_id"], p.get("influencer_id")))
        if k and not p["owned"]: grp[k].append(p)
    names = lambda g: {p["username"] for p in g if p.get("username")}
    tc = sum(len(names(g)) for g in grp.values()); tm = sum(p.get("comments") or 0 for g in grp.values() for p in g)
    checks.append(({k for k, g in grp.items() if len(names(g)) >= 5} == {r["audience"] for r in got[title]}, "audiences: groups shown are exactly those with 5+ creators", len(grp), len(got[title])))
    for r in got[title]:
        g = grp.get(r["audience"], []); cm = sum(p.get("comments") or 0 for p in g)
        check(f"audience {r['audience']}: creators", len(names(g)), r["creators"], 0)
        check(f"audience {r['audience']}: our creators", len(names(of(g, FOCAL))), r["our creators"], 0)
        check(f"audience {r['audience']}: posts", len(g), r["posts"], 0)
        check(f"audience {r['audience']}: comments per post", cm / len(g) if g else None, r["comments per post"], 0.002)
        if tm: check(f"audience {r['audience']}: gap, points", 100 * cm / tm - 100 * len(names(g)) / tc, r["gap, points"], 0.02)

# ---------------------------------------------------------------- the brief's other rules, each worked out again
# Brief: "Our share in the theme minus our overall share, in points", for themes above the norm.
if "Where we are missing from winning themes" in got and share is not None:
    seen = set()
    for r in got["Where we are missing from winning themes"]:
        t = r["theme"]; seen.add(t); g = [p for p in cur if p["theme"] == t]
        check(f"missing {t}: gap pts", 100 * (len(of(g, FOCAL)) / len(g) - share), r["gap pts"], 0.004)
    expect = set()
    for t in {p["theme"] for p in cur if p["theme"]}:
        g = [p for p in cur if p["theme"] == t]; v = vs(g)
        if len(g) >= 30 and v is not None and v >= 1.2 and len(of(g, FOCAL)) / len(g) < share: expect.add(t)
    if len(seen) < 12: checks.append((expect == seen, "missing from winning themes: exactly the themes above the norm where we are under our share", sorted(expect - seen)[:3], sorted(seen - expect)[:3]))

# Brief: "Themes ranked by engagement vs norm × purchase intent".
by_post = defaultdict(list)
for c in comments: by_post[(c["segment_id"], c["post_id"])].append(c)
if "Conversations that sell, not just engage" in got:
    for r in got["Conversations that sell, not just engage"]:
        g = [p for p in posts if p["theme"] == r["theme"]]
        cs = [c for p in g for c in by_post.get((p["segment_id"], p["post_id"]), [])]
        rate = 1000 * sum(c["buying"] for c in cs) / len(cs); v = vs(g)
        check(f"sells {r['theme']}: brand comments", len(cs), r["brand comments"], 0)
        check(f"sells {r['theme']}: intent per 1K", rate, r["intent per 1K"], 0.002)
        check(f"sells {r['theme']}: sell score", rate * (v if v is not None else 1), r["sell score"], 0.01)
    scores = [r["sell score"] for r in got["Conversations that sell, not just engage"]]
    checks.append((scores == sorted(scores, reverse=True), "conversations that sell: ranked by the sell score", "descending", scores[:4]))

# Brief: "Months at 2× the 3-month average, the post behind it, and whether it was paid".
if "What spiked, and why" in got:
    month = lambda d: (d.year, d.month)
    eng = defaultdict(float); cnt = defaultdict(int); top = {}
    for p in posts:
        if not p["at"]: continue
        k = (p["brand"], month(p["at"])); eng[k] += p.get("engagement") or 0; cnt[k] += 1
        if k not in top or (p.get("engagement") or 0) > (top[k].get("engagement") or 0): top[k] = p
    spikes = {}
    for b in brands:
        ms = sorted(m for (bb, m) in eng if bb == b)
        for i, m in enumerate(ms):
            if i < 3: continue
            base = sum(eng[(b, x)] for x in ms[i - 3:i]) / 3
            if base > 0 and eng[(b, m)] >= 2 * base and cnt[(b, m)] >= 5: spikes[(b, f"{m[0]}-{m[1]:02d}")] = eng[(b, m)] / base
    rows = got["What spiked, and why"]
    for r in rows:
        k = (r["brand"], r["month"])
        checks.append((k in spikes, f"spike {k}: is a month at twice the three before", k in spikes, True))
        if k in spikes:
            check(f"spike {k}: times the usual", spikes[k], r["times the usual"], 0.006)
            t = top[(r["brand"], (int(r["month"][:4]), int(r["month"][5:])))]
            kind = "brand-owned" if t["owned"] else "paid" if t["paid"] else "affiliate" if t["affiliate"] else "gifted" if t["gifted"] else "earned"
            checks.append((kind == r["kind"], f"spike {k}: kind of the post behind it", kind, r["kind"]))
    if len(rows) < 12: checks.append((len(rows) == len(spikes), "spikes: every spike month is listed", len(spikes), len(rows)))

# Brief: "Frequency × likes on the comment": each objection counts once plus its likes.
if "Objections that matter most" in got:
    ours = [c for c in comments if c["brand"] == FOCAL and neg(c)]
    key = lambda c: (c["attribute"] or "other")
    for r in got["Objections that matter most"]:
        a = r["attribute"].split(":")[0].split(" ")[0].lower()
        g = [c for c in ours if key(c) == a]
        check(f"objection {a}: objections", len(g), r["objections"], 0)
        check(f"objection {a}: weight", len(g) + sum(c.get("likes") or 0 for c in g), r["weight"], 0)

# Brief: "Their objection rate minus ours, attribute by attribute".
if "Where rivals are weak and we are strong" in got:
    tot = {b: sum(1 for c in comments if c["brand"] == b) for b in brands}
    def orate(b, a): return 1000 * sum(1 for c in comments if c["brand"] == b and c["attribute"] == a and neg(c)) / tot[b] if tot[b] else None
    for r in got["Where rivals are weak and we are strong"]:
        a = r["attribute"].split(":")[0].split(" ")[0].lower()
        check(f"weak {a}: ours per 1K", orate(FOCAL, a) or 0, r["ours per 1K"], 0.004)
        check(f"weak {a}: theirs per 1K", orate(r["weakest rival"], a), r["theirs per 1K"], 0.004)
        rivals = [(orate(b, a), b) for b in brands if b != FOCAL and tot[b] >= 200 and sum(1 for c in comments if c["brand"] == b and c["attribute"] == a) >= 5]
        checks.append((bool(rivals) and abs(max(rivals)[0] - orate(r["weakest rival"], a)) < 1e-9, f"weak {a}: the rival named is the weakest", max(rivals)[1] if rivals else None, r["weakest rival"]))

# Brief: "The purchase-intent rate in their comments, against the category".
if "Who drives buying" in got:
    cat_rate = 1000 * sum(c["buying"] for c in comments) / len(comments)
    for r in got["Who drives buying"]:
        ps = [p for p in posts if p["brand"] == FOCAL and p.get("username") == r["creator"] and p.get("platform") == r["platform"] and not p["owned"]]
        cs = [c for p in ps for c in by_post.get((p["segment_id"], p["post_id"]), []) if c["brand"] == FOCAL]
        rate = 1000 * sum(c["buying"] for c in cs) / len(cs)
        check(f"buying {r['creator']}: intent per 1K", rate, r["intent per 1K"], 0.002)
        check(f"buying {r['creator']}: times the category rate", rate / cat_rate, r["times the category rate"], 0.02)

# Brief: "Creators whose views are growing with engagement vs norm above 1.5".
if "Rising creators" in got:
    for r in got["Rising creators"]:
        now = [p for p in cur if p["brand"] == FOCAL and p.get("username") == r["creator"] and p.get("platform") == r["platform"] and not p["owned"]]
        was = [p for p in before if p["brand"] == FOCAL and p.get("username") == r["creator"] and p.get("platform") == r["platform"] and not p["owned"]]
        vn, vb, v = sum(p.get("views") or 0 for p in now), sum(p.get("views") or 0 for p in was), vs(now)
        check(f"rising {r['creator']}: views now", vn, r["views now"], 0)
        checks.append((vn > vb and v is not None and v >= 1.5, f"rising {r['creator']}: views up and at 1.5 times the norm", (vn, vb, v), "listed"))

# Brief: purchase intent "per 1,000 comments, against the category".
if "Buying signals per 1,000 brand comments" in got:
    for r in got["Buying signals per 1,000 brand comments"]:
        g = [c for c in comments if c["brand"] == r["brand"]]
        check(f"buying signals {r['brand']}", 1000 * sum(c["buying"] for c in g) / len(g), r["value"], 0.002)

# Brief: "A topic's share of comments minus its share of posts".
if "Content gap, in points" in got:
    themed = [p for p in posts if p["theme"]]
    tc = sum(p.get("comments") or 0 for p in themed)
    for r in got["Content gap, in points"]:
        g = [p for p in themed if p["theme"] == r["theme"]]
        check(f"content gap {r['theme']}", 100 * sum(p.get("comments") or 0 for p in g) / tc - 100 * len(g) / len(themed), r["value"], 0.006)

# The measures market by market: the brief says markets compare like for like. The norm is the one across all markets in view.
if "The measures, market by market" in got:
    for r in got["The measures, market by market"]:
        m = r["market"]; g = [p for p in cur if p.get("country") == m]; mine = of(g, FOCAL); was = [p for p in before if p.get("country") == m and p["brand"] == FOCAL]
        check(f"market {m}: our posts", len(mine), r["our posts"], 0)
        check(f"market {m}: share of voice %", 100 * len(mine) / len(g), r["share of voice %"], 0.004)
        check(f"market {m}: engagement vs norm", vs(mine), r["engagement vs norm"], 0.01)
        check(f"market {m}: earned share %", div(100 * sum(p["earned"] for p in mine), len(mine)), r["earned share %"], 0.02)
        if r["momentum %"] is not None: check(f"market {m}: momentum %", 100 * (len(mine) / len(was) - 1), r["momentum %"], 0.01)
        cs_ = [c for c in comments if c["brand"] == FOCAL and c["at"] and start <= c["at"] < end and post_country.get((c["segment_id"], c["post_id"])) == m]
        check(f"market {m}: our brand comments", len(cs_), r["our brand comments"], 0)
        checks.append(((len(cs_) >= 200) == (r["intent per 1K"] is not None), f"market {m}: comment measures only with 200+ brand comments", len(cs_), r["intent per 1K"]))
        if r["intent per 1K"] is not None: check(f"market {m}: intent per 1K", 1000 * sum(c["buying"] for c in cs_) / len(cs_), r["intent per 1K"], 0.002)

# White space: every theme graded again from the posts (all time, like the box).
title = "Every theme, graded: open, unclaimed, contested or owned"
if title in got:
    themed = [p for p in posts if p["theme"]]
    size = {b: len(of(themed, b)) / len(themed) for b in brands}
    few = len(brands) < 10
    seen = set()
    for r in got[title]:
        t = r["theme"]; seen.add(t); g = [p for p in themed if p["theme"] == t]
        by = sorted(((len(of(g, b)), b) for b in brands if of(g, b)), key=lambda x: (-x[0], x[1]))
        n, leader = by[0]
        owners = [b for k, b in by if k / len(g) > 0.25 and (not few or (k / len(g)) / size[b] >= 1.5 or k / len(g) > 0.5)]
        led = sum(p["owned"] or p["paid"] for p in g) / len(g)
        v = vs(g)
        free = sum(p["earned"] for p in g) / len(g)
        state = ("Not rewarded" if v is None or v < 1.2 else "Brand-seeded" if free < 0.33 else "Open" if not owners else "Unclaimed" if led < 0.15 else "Contested" if len(owners) >= 2
                 else "Owned by us" if owners[0] == FOCAL else "Owned by " + owners[0])
        check(f"white space {t}: posts", len(g), r["posts"], 0)
        check(f"white space {t}: largest brand share %", 100 * n / len(g), r["largest brand share %"], 0.02)
        check(f"white space {t}: its lead", (n / len(g)) / size[leader], r["its lead"], 0.01)
        check(f"white space {t}: brand-owned or paid %", 100 * led, r["brand-owned or paid %"], 0.02)
        check(f"white space {t}: unprompted %", 100 * free, r["unprompted %"], 0.02)
        checks.append((leader == r["largest brand"], f"white space {t}: largest brand", leader, r["largest brand"]))
        checks.append((state == r["state"], f"white space {t}: state", state, r["state"]))
    expect = {t for t in {p["theme"] for p in themed} if sum(1 for p in themed if p["theme"] == t) >= 30}
    checks.append((expect == seen, "white space: every theme with 30+ posts is graded, and no other", sorted(expect - seen)[:3], sorted(seen - expect)[:3]))

# Who switches to whom: flows counted from the file, all time.
if os.path.exists(os.path.join(SEED, "switch_labels", IND + ".json.gz")) and "Who switches to whom" in got:
    kept = {(c["segment_id"], c["comment_id"]) for c in comments}
    flows = defaultdict(lambda: [0, 0])
    for seg, cid, kind, frm, to in gz("switch_labels", IND + ".json.gz")["rows"]:
        if (seg, cid) in kept: flows[(frm, to)][0 if kind == "switched" else 1] += 1
    rows = got["Who switches to whom"]
    for r in rows:
        f = flows.get((r["from"], r["to"]), [0, 0])
        check(f"switch {r['from']} to {r['to']}: say they switched", f[0], r["say they switched"], 0)
        check(f"switch {r['from']} to {r['to']}: say it is better", f[1], r["say it is better"], 0)
    big = {k for k, v in flows.items() if sum(v) >= 3}
    if len(rows) < 30: checks.append((big == {(r["from"], r["to"]) for r in rows}, "switching flows shown are exactly those with 3+ comments", len(big), len(rows)))

bad = [c for c in checks if not c[0]]
for ok, name, mine, theirs in bad: print(f"  DIFFERENT {name}: recalculated {mine}, dashboard shows {theirs}")
print(f"{len(checks) - len(bad)} of {len(checks)} numbers match ({BASE}, {FOCAL} against {len(brands) - 1} competitors, all time{', ' + MARKET + ' only' if MARKET else ''})")
raise SystemExit(1 if bad else 0)
