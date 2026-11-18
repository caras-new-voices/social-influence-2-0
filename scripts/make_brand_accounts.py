"""Drafts the list of brand-owned accounts per brand and writes it into data/seed/catalog.json
(each brand's "handles") and docs/brand-accounts-draft.md for a person to confirm.

  python3 -I scripts/make_brand_accounts.py

A post from a brand's own account is "brand-owned". Tom's earned share leaves those out, and the
supplied data has no such field. An account is taken as brand-owned when its name is the brand's
name (or one of the extra names below), alone or with an official-looking addition: a country,
"official", "global" and the like, or for destinations "visit", "tourism", "travel". Fan pages,
dealers, resellers and news sites do not match. The list is a draft: edit MANUAL below, run again,
commit both files.
"""
import gzip, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, "data", "seed")
norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())

# Extra account-name stems per brand, beyond the brand's own name.
STEMS = {
    "Venus": ["gillettevenus", "venusgillette"],
    "Estrid": ["heyestrid"],
    "Philips OneBlade": ["philips", "philipsoneblade", "oneblade"],
    "Wilkinson Sword": ["wilkinsonsword", "intuitionbywilkinsonsword", "intuitionwilkinsonsword", "wilkinson"],
    "MG (SAIC)": ["mgmotor", "mg"],
    "Mercedes-Benz": ["mercedesbenz"],
    "Head & Shoulders": ["headandshoulders", "headshoulders"],
    "K18 Hair": ["k18hair", "k18"],
    "Maker’s Mark": ["makersmark"],
    "Basil Hayden’s": ["basilhayden", "basilhaydens"],
    "Jack Daniel’s": ["jackdaniels"],
    "Jim Beam": ["jimbeam"],
    "Jose Cuervo": ["josecuervo", "josecuervotequila"],
    "Hornitos": ["hornitostequila"],
    "Sauza + Tres Generaciones": ["sauzatequila", "sauza", "tresgeneraciones"],
    "-196 + On The Rocks": ["minus196", "ontherockscocktails", "otrcocktails"],
    "Teremana + Espolon": ["teremana", "teremanatequila", "espolontequila", "espolon"],
    "High Noon": ["highnoonsunsips", "highnoon"],
    "Buffalo Trace": ["buffalotracedistillery"],
    "Woodford Reserve": ["woodfordreserve"],
    "Amazon Web Services": ["amazonwebservices", "aws", "awscloud"],
    "Google Cloud": ["googlecloud", "googlecloudplatform", "googlecloudtech"],
    "Oura": ["ouraring", "oura"],
    "Apple Watch": ["apple"],
    "Ooler (Sleepme)": ["sleepme", "ooler"],
    "Tempur-Pedic": ["tempurpedic", "tempur"],
    "Layla Sleep": ["laylasleep"],
    "Polène": ["polene", "poleneparis"],
    "Sandro": ["sandroparis"],
    "Maje": ["majeparis"],
    "AMI Paris": ["amiparis"],
    "Michael Kors": ["michaelkors"],
    "Charles & Keith": ["charleskeith", "charleskeithofficial"],
    "Ralph Lauren": ["ralphlauren", "poloralphlauren"],
    "Hugo Boss": ["hugoboss", "boss", "hugo"],
    "Polestar": ["polestarcars"],
    "New York Jets": ["nyjets"],
    "New York Giants": ["nygiants", "giants"],
    "Turks & Caicos": ["turksandcaicos", "turkscaicos"],
    "U.S. Virgin Islands": ["usvi", "usvirginislands"],
    "St. Lucia": ["stlucia", "saintlucia"],
    "St. Martin": ["stmartin", "stmaarten", "saintmartin"],
    "Curaçao": ["curacao"],
}
# Accounts a rule cannot find, and matches that are wrong. Edit after review.
MANUAL_ADD = {"Veet": ["veet.france", "veetfrance"]}
MANUAL_REMOVE = {"Venus": ["venusbeauty.ch"], "BMW": ["bmwautomotor"], "Oracle": ["oracle"], "Orion": ["orion"], "Apple Watch": ["apple"], "Hugo Boss": ["boss", "hugo"], "New York Giants": ["giants"], "Barbados": ["barbados"], "Guess": ["guess"]}
# "oracle", "orion", "guess" and the like as a bare username are often not the company; they are kept only where the posts show it is.
KEEP_BARE = {"Guess": ["guess"], "Oracle": ["oracle"]}

COUNTRY = "uk us usa de fr es it pt nl be ch at se no dk fi pl cz ro hu gr ie ca au mx br in jp kr cn tr ua ru eu emea latam mena global intl international europe deutschland germany france espana spain italia italy portugal nederland belgium belux greece norge sverige danmark suomi polska romania hungary ukraine switzerland austria canada mexico india japan america latinoamerica uki dach benelux nordics nordic cee anz".split()
OFFICIAL = "official offiziell oficial officiel hq inc tv cars auto motors motor group brand team life news studio store shop paris tequila whiskey bourbon distillery ring sleep hair beauty tech cloud developers developer learn academy events security motorsport".split()
DEST_PRE = "visit go travel discover explore tourism experience".split()
DEST_SUF = "tourism tourismboard travel tourismauthority touristboard government gov".split()
ADD = set(COUNTRY + OFFICIAL)

def owned(username, stems, destination):
    # A name with letters outside a-z (Cyrillic, Greek) is not an official handle; norm() would drop them.
    if re.search(r"[^\x00-\x7f]", username or ""): return False
    n = norm(username)
    for s in stems:
        if n == s: return True
        if n.startswith(s) and n[len(s):] in ADD: return True
        if n.endswith(s) and n[:-len(s)] in ADD: return True
        # two additions, such as "xpeng" + "motors" + "uk"
        if n.startswith(s):
            rest = n[len(s):]
            if any(rest.startswith(a) and rest[len(a):] in ADD for a in ADD if rest.startswith(a)): return True
        if destination:
            if any(n == p + s for p in DEST_PRE) or any(n == s + x for x in DEST_SUF) or any(n == p + "the" + s for p in DEST_PRE): return True
    return False

catalog = json.load(open(os.path.join(SEED, "catalog.json"), encoding="utf-8"))
doc = ["# Brand-owned accounts (draft to confirm)", "",
       "A post from one of these accounts counts as brand-owned. Brand-owned posts are left out of earned share and out of the creator lists.",
       "The list was drafted by rule from the account names in the data (`scripts/make_brand_accounts.py`). Please strike what is wrong and add what is missing.", ""]
total = 0
for ind in catalog["industries"]:
    posts = json.load(gzip.open(os.path.join(SEED, "packs", ind["pack"] + ".json.gz"), "rt", encoding="utf-8"))["posts"] if ind.get("pack") else json.load(gzip.open(os.path.join(SEED, "posts.json.gz"), "rt", encoding="utf-8"))
    destination = ind["id"] in ("caribbean-tourism", "nation-brand")
    doc += [f"## {ind['name']}", ""]
    for b in ind["brands"]:
        stems = [s for s in {norm(b["name"]), *STEMS.get(b["name"], [])} if len(s) >= 2]
        counts = {}
        for p in posts:
            if p["brand"] == b["name"] and p.get("username"): counts[p["username"]] = counts.get(p["username"], 0) + 1
        remove = {norm(x) for x in MANUAL_REMOVE.get(b["name"], [])} - {norm(x) for x in KEEP_BARE.get(b["name"], [])}
        names = [u for u in counts if (owned(u, stems, destination) and norm(u) not in remove) or u in MANUAL_ADD.get(b["name"], [])]
        if destination: names = [u for u in names if norm(u) not in stems]  # a bare place name is rarely the tourist board
        names.sort(key=lambda u: -counts[u])
        b["handles"] = sorted({u.lower() for u in names})
        n = sum(counts[u] for u in names)
        total += n
        doc.append(f"- **{b['name']}** ({n} of {sum(counts.values())} posts): " + (", ".join(f"{u} ({counts[u]})" for u in names) if names else "none found"))
    doc.append("")
text = json.dumps(catalog, ensure_ascii=False, indent=2)
# Lists of plain strings stay on one line, as the file had them.
text = re.sub(r"\[\s*((?:\"(?:[^\"\\\\]|\\\\.)*\"\s*,\s*)*\"(?:[^\"\\\\]|\\\\.)*\")\s*\]", lambda m: "[" + re.sub(r"\s*\n\s*", " ", m.group(1)) + "]", text)
open(os.path.join(SEED, "catalog.json"), "w", encoding="utf-8").write(text + "\n")
open(os.path.join(ROOT, "docs", "brand-accounts-draft.md"), "w", encoding="utf-8").write("\n".join(doc) + "\n")
print("brand-owned posts found:", total)
