"""Turn per-brand post exports into seed packs, one per industry.

Usage: python3 -I scripts/build_packs.py <raw-dir> [--cap 1000]

<raw-dir> holds one folder per export (the "source" of an industry in data/seed/catalog.json),
each with <month>/<Brand>.csv files of creator posts. Every brand is sampled at random (fixed
seed, so the build is repeatable) down to --cap posts, mapped to the app's posts and influencers
columns, and written to data/seed/packs/<industry id>.json.gz. The catalog says which CSV is
which brand; this script contains no brand names.
"""
import csv, gzip, hashlib, json, os, random, re, sys

csv.field_size_limit(10**9)
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(os.path.dirname(HERE), "data", "seed")
RAW = sys.argv[1]
CAP = int(sys.argv[sys.argv.index("--cap") + 1]) if "--cap" in sys.argv else 1000
COUNTRIES = json.load(open(os.path.join(HERE, "country_names.json"), encoding="utf-8"))
PLATFORM = {"ig": "instagram", "tt": "tiktok", "yt": "youtube"}
POST_TYPE = {"video": "video", "photo": "image"}

def hid(*parts):
    """A stable 52-bit id (safe as a JSON number) for ids that are strings in the export."""
    return int(hashlib.sha1(":".join(parts).encode()).hexdigest()[:13], 16)

def num(v):
    if v is None or v == "": return None
    try: return float(v)
    except ValueError: return None

def tier(f):
    if f is None: return None
    return "nano" if f < 5_000 else "micro" if f < 50_000 else "mid" if f < 250_000 else "macro" if f < 1_000_000 else "mega"

def handle(r):
    u = (r.get("username") or "").strip()
    if u: return u[:120]
    m = re.search(r"tiktok\.com/@([^/?]+)", r.get("link") or "")
    return (m.group(1) if m else r["user_id"])[:120]

catalog = json.load(open(os.path.join(SEED, "catalog.json"), encoding="utf-8"))
os.makedirs(os.path.join(SEED, "packs"), exist_ok=True)
total = 0
for n_ind, ind in enumerate(catalog["industries"]):
    if not ind.get("pack"): continue
    src = os.path.join(RAW, ind["source"])
    files = {}
    for d, _, fs in os.walk(src):
        for f in fs:
            if f.endswith(".csv"): files[f[:-4]] = os.path.join(d, f)
    segments, posts, influencers = [], [], {}
    for n_brand, b in enumerate(ind["brands"]):
        seg_id = 1000 + n_ind * 100 + n_brand + 1
        path = files.pop(b["source"], None)
        if not path: sys.exit(f"{ind['id']}: no CSV for {b['source']!r}")
        seen, rows = set(), []
        with open(path, newline="", encoding="utf-8", errors="replace") as fh:
            for r in csv.DictReader(fh):
                k = (r["platform"], r["post_id"])
                if k in seen: continue
                seen.add(k); rows.append(r)
        exported = len(rows)
        rng = random.Random(f"{ind['id']}/{b['name']}")
        if exported > CAP: rows = rng.sample(rows, CAP)
        rows.sort(key=lambda r: r["created"])
        for r in rows:
            plat = PLATFORM.get(r["platform"], r["platform"])
            fol = num(r["followers"])
            likes, comments, shares, saves = num(r["likes"]), num(r["comments"]), num(r["shares"]), num(r["saves"])
            views = num(r["views"]) if num(r["views"]) is not None else num(r["plays"])
            inf_id = hid(r["platform"], r["user_id"])
            user = handle(r)
            country = COUNTRIES.get(r["geo"], r["geo"]) if r["geo"] else "Unknown"
            posts.append({
                "post_id": hid(r["platform"], r["post_id"]), "segment_id": seg_id, "brand": b["name"],
                "influencer_id": inf_id, "username": user, "platform": plat, "post_type": POST_TYPE.get(r["type"], r["type"]),
                "url": (r["link"] or None) and r["link"][:500], "text": (r["text"] or None) and r["text"][:600],
                "published_at": r["created"],
                "likes": likes, "comments": comments, "shares": shares, "views": views, "saves": saves,
                "engagement": sum(v or 0 for v in (likes, comments, shares, saves)),
                "is_paid": r["sponsored"] == "true", "tier": tier(fol), "country": country, "language": "unknown", "followers": fol,
            })
            key = (seg_id, inf_id)
            cur = influencers.get(key)
            if cur is None or (fol or 0) > (cur["followers"] or 0):
                influencers[key] = {
                    "segment_id": seg_id, "brand": b["name"], "influencer_id": inf_id, "username": user,
                    "fullname": ((r.get("display_name") or "").strip() or None) and r["display_name"].strip()[:160],
                    "network": plat, "url": ((r.get("profile_url") or "") or None) and r["profile_url"][:300],
                    "followers": fol, "country": country, "has_report": False,
                }
        # exported: posts in the export for the month (exports stop at 20,000); kept: posts in this pack.
        segments.append({"id": seg_id, "brand": b["name"], "exported": exported, "kept": len(rows)})
    if files: print(f"  note: {ind['id']} has CSVs not in the catalog: {sorted(files)}")
    months = sorted({p["published_at"][:7] for p in posts})
    pack = {"id": ind["id"], "months": months, "segments": segments, "posts": posts, "influencers": list(influencers.values())}
    out = os.path.join(SEED, "packs", ind["id"] + ".json.gz")
    with gzip.open(out, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(pack, f, ensure_ascii=False, separators=(",", ":"))
    total += len(posts)
    print(f"{ind['id']:20s} {len(segments):2d} brands {len(posts):6d} posts {len(influencers):6d} creators {months} -> {os.path.getsize(out) / 1e6:.1f} MB")
print("total posts", total)
