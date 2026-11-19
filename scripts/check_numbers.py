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
    comments.append({**c, "at": ts(c.get("published_at")), "attribute": cl["attributes"][r[3]] if r and r[3] > 0 else None,
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
