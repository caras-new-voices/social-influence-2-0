"""Transform the four IMAI social-listening CSV exports into compact seed files.

Usage: python3 -I scripts/build_seed.py <dir-with-csvs> [out-dir]
Expects: segments.csv, posts.csv, comments.csv, influencers.csv
Writes gzipped JSON arrays to data/seed/.
"""
import sys, json, gzip, math, os
import pandas as pd

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "seed")
os.makedirs(OUT, exist_ok=True)

BRANDS = {  # segment_id -> short display name, role
    520: ("Venus", "focal"),
    474: ("Estrid", "competitor"),
    478: ("Veet", "competitor"),
    522: ("Philips OneBlade", "competitor"),
    523: ("Wilkinson Sword", "competitor"),
    485: ("Mercadona", "competitor"),
}

def clean(v):
    if v is None: return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)): return None
    if isinstance(v, (pd.Timestamp,)): return v.isoformat()
    return v

def num(v):
    v = clean(v)
    return None if v is None else float(v)

def txt(v, n=600):
    v = clean(v)
    if v is None: return None
    s = str(v)
    return s[:n]

def jload(v):
    v = clean(v)
    if v is None: return {}
    try: return json.loads(v)
    except Exception: return {}

def dump(name, rows):
    path = os.path.join(OUT, name + ".json.gz")
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)
    print(f"{name}: {len(rows)} rows -> {os.path.getsize(path)/1024:.0f} KB")

# ---------- segments ----------
seg = pd.read_csv(f"{SRC}/segments.csv")
segments = []
for _, r in seg.iterrows():
    sid = int(r["id"]); short, role = BRANDS.get(sid, (r["name"], "competitor"))
    ai = jload(r["ai_insights"]); ci = jload(r["comment_insights"]); ag = jload(r["aggregated_stats"])
    plat = ai.get("platforms", {})
    stats = ag.get("stats", {})
    segments.append({
        "id": sid, "name": r["name"], "brand": short, "role": role,
        "scan_start_date": txt(r["scan_start_date"]),
        "insight_headline": (plat.get("all") or {}).get("headline"),
        "insight_framing": (plat.get("all") or {}).get("framing"),
        "insight_assess": (plat.get("all") or {}).get("assess"),
        "insight_act": (plat.get("all") or {}).get("act"),
        "insight_anticipate": (plat.get("all") or {}).get("anticipate"),
        "insights_by_platform": {k: {kk: vv for kk, vv in v.items() if kk in ("headline","framing","assess","act","anticipate")} for k, v in plat.items() if k != "all"},
        "comment_insights": ci.get("platforms"),
        "total_emv": num(stats.get("totalEmv")),
        "total_engagement": num(stats.get("totalEngagement")),
        "estimated_impressions": num(stats.get("estimatedImpressions")),
        "total_unique_influencers": num(stats.get("totalUniqueInfluencers")),
        "invested_budget_min": num(stats.get("investedBudgetMin")),
        "invested_budget_max": num(stats.get("investedBudgetMax")),
    })
dump("segments", segments)

# ---------- posts ----------
posts = pd.read_csv(f"{SRC}/posts.csv", low_memory=False)
rows = []
for _, r in posts.iterrows():
    cs = jload(r["computed_stats"]); raw = jload(r["rawData"])
    sid = int(r["segment_id"])
    spons = clean(r["isSponsored"])
    is_paid = bool(cs.get("is_paid")) or (str(spons).lower() == "true")
    rows.append({
        "post_id": int(r["post_id"]), "segment_id": sid, "brand": BRANDS.get(sid, (r["segment_name"],))[0],
        "influencer_id": int(r["influencer_id"]), "username": txt(r["username"], 120),
        "platform": r["platform"], "post_type": r["type"], "url": txt(r["url"], 500),
        "title": txt(r["title"], 300), "text": txt(r["text"], 1000),
        "published_at": txt(r["publishedAt"]),
        "likes": num(r["likeCount"]), "comments": num(r["commentCount"]), "shares": num(r["shareCount"]),
        "views": num(r["viewCount"]) if clean(r["viewCount"]) is not None else num(r["playCount"]),
        "saves": num(r["save_count"]),
        "engagement": num(cs.get("engagement")),
        "is_paid": is_paid,
        "tier": cs.get("tier"), "country": cs.get("country"), "language": cs.get("language"),
        "sentiment": cs.get("sentiment") or raw.get("sentiment"),
        "emv": num(cs.get("emv")), "followers": num(cs.get("followers")),
        "budget_min": num(cs.get("budget_min")), "budget_max": num(cs.get("budget_max")),
        "image_url": txt(r["imageUrl"], 500), "video_url": txt(r["videoUrl"], 500),
    })
dump("posts", rows)

# ---------- comments ----------
comments = pd.read_csv(f"{SRC}/comments.csv", low_memory=False)
rows = []
def dg(d, k):
    return d.get(k) if isinstance(d, dict) else None

def g(d, *path):
    for p in path:
        if not isinstance(d, dict): return None
        d = d.get(p)
    return clean(d) if not isinstance(d, (dict, list)) else d
for _, r in comments.iterrows():
    a = jload(r["analysis"])
    sid = int(r["segment_id"])
    pi = a.get("purchase_intent") or {}; ob = a.get("objection") or {}; cm = a.get("competitor_mention") or {}
    lo = a.get("loyalty") or {}; fq = a.get("faq_gap") or {}; fr = a.get("feature_request") or {}
    sc = a.get("safety_complaint") or {}; cb = a.get("crisis_backlash") or {}; pp = a.get("partnership_perception") or {}
    ba = a.get("brand_affinity") or {}; ea = a.get("engagement_authenticity") or {}; uc = a.get("use_case") or {}
    sent = a.get("sentiment")
    rows.append({
        "comment_id": int(r["comment_id"]), "segment_id": sid, "brand": BRANDS.get(sid, ("?",))[0],
        "post_id": int(r["post_id"]), "username": txt(r["username"], 120), "text": txt(r["text"], 1000),
        "likes": num(r["likes"]), "reply_count": num(r["reply_count"]), "published_at": txt(r["publishedAt"]),
        "sentiment": sent.lower() if isinstance(sent, str) else None,
        "sentiment_score": num(a.get("sentiment_score")), "emotion": a.get("emotion"), "language": a.get("language"),
        "topics": [str(t) for t in (a.get("topics") or []) if t][:8],
        "keywords": [str(t) for t in (a.get("keywords") or []) if t][:8],
        "toxicity": num(a.get("toxicity")), "spam_rate": num(a.get("spam_rate")), "moderation": a.get("moderation"),
        "automated_response": bool(a.get("automated_response")) if a.get("automated_response") is not None else None,
        "authenticity_score": num(ea.get("authenticity_score")), "authenticity_flag": ea.get("flag_reason"),
        "purchase_intent_type": pi.get("intent_type"), "purchase_intent_score": num(pi.get("score")), "purchase_blocker": pi.get("blocker"),
        "objection_category": ob.get("category"), "objection_context": ob.get("product_context"), "objection_phrase": ob.get("verbatim_phrase"),
        "competitor_name": cm.get("competitor_name"), "competitor_favored": cm.get("favored_side"), "competitor_mention_type": cm.get("mention_type"),
        "loyalty_type": lo.get("loyalty_type"), "loyalty_phrase": lo.get("verbatim_phrase"), "repeat_buyer": lo.get("repeat_buyer_flag"),
        "faq_topic": fq.get("topic"), "faq_phrase": fq.get("representative_phrasing"),
        "feature_request_type": fr.get("request_type"), "feature_request": fr.get("specific_request"),
        "safety_complaint_type": sc.get("complaint_type"), "safety_severity": sc.get("severity"),
        "crisis_risk_type": cb.get("risk_type"), "crisis_urgency": cb.get("urgency"), "crisis_phrase": cb.get("verbatim_phrase"),
        "partnership_perception": pp.get("perception_type"), "partnership_intensity": pp.get("intensity"),
        "brand_affinity_name": ba.get("brand_name"), "brand_affinity_category": ba.get("category_proximity"),
        "use_case": uc.get("use_case"), "use_case_segment": uc.get("segment_implied"),
        "caption_relevance": num(a.get("caption_relevance")),
    })
dump("comments", rows)

# ---------- influencers ----------
inf = pd.read_csv(f"{SRC}/influencers.csv", low_memory=False)
rows = []
def top(lst, key="weight", n=5, label="name", code=None):
    out = []
    for it in (lst or [])[:50]:
        if not isinstance(it, dict): continue
        out.append({"name": it.get(label) or it.get("code"), "weight": it.get(key)})
    out = [o for o in out if o["weight"] is not None]
    out.sort(key=lambda o: -o["weight"])
    return out[:n]
for _, r in inf.iterrows():
    rep = jload(r["report"]) if clean(r["report"]) and len(str(r["report"])) > 200 else {}
    if not rep and clean(r["short_report"]): rep = jload(r["short_report"])
    up = rep.get("user_profile") or {}
    af = ((rep.get("audience_followers") or {}).get("data")) or {}
    genders = {}
    for it in af.get("audience_genders") or []:
        if isinstance(it, dict) and it.get("code"): genders[str(it["code"]).lower()] = it.get("weight")
    ages = {}
    for it in af.get("audience_ages") or []:
        if isinstance(it, dict) and it.get("code"): ages[str(it["code"])] = it.get("weight")
    geo = top(((af.get("audience_geo") or {}).get("countries")), n=5)
    sid = int(r["segment_id"])
    rows.append({
        "segment_id": sid, "brand": BRANDS.get(sid, ("?",))[0], "influencer_id": int(r["influencer_id"]),
        "username": txt(r["username"], 120), "fullname": txt(r["fullname"], 160), "network": r["network"],
        "url": txt(r["url"], 400) or up.get("url"), "picture": txt(r["picture"], 600),
        "followers": num(r["followers"]) if clean(r["followers"]) is not None else num(up.get("followers")),
        "engagements": num(r["engagements"]) if clean(r["engagements"]) is not None else num(up.get("engagements")),
        "engagement_rate": num(r["engagement_rate"]) if clean(r["engagement_rate"]) is not None else num(up.get("engagement_rate")),
        "avg_views": num(r["avg_views"]) if clean(r["avg_views"]) is not None else num(up.get("avg_views")),
        "is_verified": bool(r["is_verified"]) if clean(r["is_verified"]) is not None else None,
        "imai_score": (lambda v: num((jload(v) or {}).get("total_score")) if isinstance(clean(v), str) and str(v).startswith("{") else num(v))(r["imaiScore"]),
        "country": dg(dg(up.get("geo"), "country"), "name"),
        "language": dg(up.get("language"), "name"),
        "ai_summary": txt(up.get("ai_summary") if isinstance(up.get("ai_summary"), str) else None, 1500),
        "has_report": bool(rep),
        "audience_female": genders.get("female"), "audience_male": genders.get("male"),
        "audience_ages": ages or None, "audience_countries": geo or None,
        "audience_credibility": num(af.get("audience_credibility")),
        "brand_safety_score": num(dg(up.get("brand_safety_analysis"), "brand_safety_score")),
        "avg_comment_sentiment": num(dg(up.get("comments_sentiment_analysis"), "avg_sentiment")),
    })
dump("influencers", rows)
print("done ->", OUT)
