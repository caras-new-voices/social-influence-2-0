"""How closely does the reader used for new imports agree with the labels the dashboards started with?

  python3 -I scripts/check_live_reader.py [--base http://localhost:3000] [--industry hair-removal] [--posts 200] [--comments 300]

New posts and comments are read by the app itself (src/lib/live-classify.ts), in one reading. The
seed labels were made offline in several readings. This takes a random sample of rows whose seed
labels are known, has the app read them again through /api/classify/preview (nothing is stored),
and counts how often the two agree. Needs the app running with an OpenAI key; set IMPORT_TOKEN in
the environment when the app requires it.

Agreement with the seed labels is not accuracy: both can be wrong the same way. It says whether a
later import is labelled like the first data, which is what month-to-month comparisons need.
"""
import gzip, json, os, random, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, "data", "seed")
def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
BASE = arg("--base", os.environ.get("SI_BASE", "http://localhost:3000"))
IND = arg("--industry", "hair-removal")
N_POSTS, N_COMMENTS = int(arg("--posts", "200")), int(arg("--comments", "300"))
gz = lambda *p: json.load(gzip.open(os.path.join(SEED, *p), "rt", encoding="utf-8"))
has = lambda *p: os.path.exists(os.path.join(SEED, *p))

def call(body):
    headers = {"Content-Type": "application/json", "User-Agent": "qa-check"}
    if os.environ.get("IMPORT_TOKEN"): headers["Authorization"] = "Bearer " + os.environ["IMPORT_TOKEN"]
    req = urllib.request.Request(BASE + "/api/classify/preview", data=json.dumps(body).encode(), headers=headers)
    return json.loads(urllib.request.urlopen(req, timeout=600).read().decode())

rnd = random.Random(int(arg("--seed", "7")))
labels = gz("labels", IND + ".json.gz")
themes, hooks = labels["themes"], labels["hooks"]
name = lambda t: themes[t - 1] if t > 0 else "Other" if t == 0 else "Unknown"
lab = {(r[0], r[1]): r for r in labels["rows"]}
disc = {}
if has("disclosure", IND + ".json.gz"):
    d = gz("disclosure", IND + ".json.gz"); disc = {(r[0], r[1]): d["values"][r[2]] for r in d["rows"]}
prod = gz("product_labels", IND + ".json.gz") if has("product_labels", IND + ".json.gz") else None
pline = {(r[0], r[1]): (prod["products"][r[2]] if r[2] >= 2 else None) for r in prod["posts"]} if prod else {}
cline = {(r[0], r[1]): (prod["products"][r[2]] if r[2] >= 2 else None) for r in prod["comments"]} if prod else {}

results = []
def line(what, ok, n, note=""):
    results.append((what, ok, n)); print(f"  {what}: {ok} of {n} ({100 * ok // max(1, n)}%){note}")

keys = rnd.sample(sorted(lab), min(N_POSTS, len(lab)))
got = {(r["segment_id"], r["post_id"]): r for r in call({"industry": IND, "posts": [{"segment_id": k[0], "post_id": k[1]} for k in keys]})["posts"]}
seen = [k for k in keys if k in got]
print(f"{IND}: {len(seen)} of {len(keys)} sampled posts read")
# The same theme, or the app's theme is one the seed lists as also fitting (or the other way round).
fits = lambda k: got[k]["theme"] == name(lab[k][2]) or got[k]["theme"] in [themes[a - 1] for a in lab[k][3]] or name(lab[k][2]) in got[k]["also"]
line("theme, exactly the same", sum(got[k]["theme"] == name(lab[k][2]) for k in seen), len(seen))
line("theme, the same or listed as also fitting", sum(fits(k) for k in seen), len(seen))
line("hook", sum((got[k]["hook"] or "") == (hooks[lab[k][4] - 1] if lab[k][4] > 0 else "") for k in seen), len(seen))
line("about the brand: kept or left out", sum((got[k]["about"] == "no") == (lab[k][5] == "no") for k in seen), len(seen))
if disc: line("disclosure: paid, gifted or neither", sum((got[k]["disclosure"] or "none") == (disc.get(k) or "none") for k in seen), len(seen))
if prod:
    pk = [k for k in seen if k in pline]
    line("product line", sum(got[k]["product"] == pline[k] for k in pk), len(pk))

if has("comment_labels", IND + ".json.gz"):
    cl = gz("comment_labels", IND + ".json.gz")
    cm = {(r[0], r[1]): r for r in cl["rows"]}
    texts = {(c["segment_id"], c["comment_id"]) for c in gz("comments.json.gz") if len(c.get("text") or "") >= 2}
    ckeys = rnd.sample(sorted(k for k in cm if k in texts), min(N_COMMENTS, len(cm)))
    cgot = {(r["segment_id"], r["comment_id"]): r for r in call({"industry": IND, "comments": [{"segment_id": k[0], "comment_id": k[1]} for k in ckeys]})["comments"]}
    cseen = [k for k in ckeys if k in cgot]
    print(f"{IND}: {len(cseen)} of {len(ckeys)} sampled comments read")
    on = lambda a: a in ("brand", "category")
    line("comment counted as about the brand or category, or not", sum(on(cgot[k]["about"]) == on(cl["about"][cm[k][2]]) for k in cseen), len(cseen))
    both = [k for k in cseen if on(cgot[k]["about"]) and on(cl["about"][cm[k][2]])]
    line("attribute (comments both count as brand comments)", sum((cgot[k]["attribute"] or "none") == (cl["attributes"][cm[k][3]] if cm[k][3] > 0 else "none") for k in both), len(both))
    twice = [k for k in both if len(cm[k]) > 4 and cm[k][4] in (0, 1)]
    line("buying signal", sum(cgot[k]["buying"] == (cm[k][4] == 1) for k in twice), len(twice))
    if prod: line("product line of a comment", sum(cgot[k]["product"] == cline.get(k) for k in both), len(both))

low = [w for w, ok, n in results if n and 100 * ok / n < 85 and w != "theme, exactly the same"]
print("Below 85%: " + "; ".join(low) if low else "Every line is at 85% or more.")
raise SystemExit(1 if low else 0)
