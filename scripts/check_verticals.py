"""Starter template on every vertical, as a person gets it: the suggested company against the
default competitors, and a small selection (the company and three competitors). It checks what
each element returns, not just that it returns something: the headline tiles are filled, share
of voice shows every selected brand, the trend has the company's line and at most seven lines,
tables have rows, nothing shows a brand outside the selection, and sections stay numbered 1, 2, 3.
It creates test dashboards and deletes them.

  npm run check:verticals             (app on http://localhost:3000)
  python3 -I scripts/check_verticals.py --keep ids.json   keep the default-selection dashboards
                                                           and write their ids (for a browser pass)
"""
import json, os, sys, urllib.request, urllib.error, urllib.parse
BASE = os.environ.get('BASE_URL', 'http://localhost:3000').rstrip('/')
KEEP = sys.argv[sys.argv.index('--keep') + 1] if '--keep' in sys.argv else None
problems, notes = [], []

def call(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type': 'application/json'}, method=method or ('POST' if body is not None else 'GET'))
    try:
        r = urllib.request.urlopen(req, timeout=300); return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')

def rows(sql, scope, window=None):
    s, r = call('/api/widgets/data', {'sql': sql, 'scope': scope, 'window': window})
    return (r.get('rows', []), None) if s == 200 else ([], r.get('error', f'HTTP {s}'))

def month_window(m):
    y, mo = int(m[:4]), int(m[5:7])
    ny, nm = (y + 1, 1) if mo == 12 else (y, mo + 1)
    return {'start': f'{m}-01', 'end': f'{ny:04d}-{nm:02d}-01'}

cat = call('/api/catalog')[1]['industries']
keep = {}
for ind in cat:
    full = ind['defaultScope']
    # The month to test: the latest one with a real amount of posts, not a trailing sliver.
    q = urllib.parse.quote(json.dumps(full))
    months = call(f'/api/coverage?scope={q}')[1]['months']
    top = max((m['posts'] for m in months), default=0)
    month = [m['month'] for m in months if m['posts'] >= max(1, 0.1 * top)][-1]
    by_posts = [b['name'] for b in sorted(ind['brands'], key=lambda b: -b['posts']) if b['name'] != full['focal'] and b['kind'] != 'topic']
    small = {**full, 'competitors': by_posts[:3]}
    print(f"\n=== {ind['name']} ({ind['id']}): {full['focal']} ===")
    for label, scope in (('default selection', full), ('company + 3', small)):
        if label == 'company + 3' and len(full['competitors']) <= 3: continue
        s, r = call('/api/dashboards', {'name': f"TEST {ind['id']} {label}", 'template': 'starter', 'scope': scope})
        if s != 201: problems.append(f"{ind['id']} {label}: create failed {s} {r}"); continue
        d = r['dashboard']
        if label == 'default selection': keep[ind['id']] = d['id']
        allowed = set([scope['focal']] + scope['competitors'])
        sections = [w['title'] for w in d['widgets'] if w['type'] == 'section']
        els = [w for w in d['widgets'] if w.get('sql')]
        nums = [int(t.split('.')[0]) for t in sections if t[0].isdigit()]
        if nums != list(range(1, len(nums) + 1)): problems.append(f"{ind['id']} {label}: section numbers {nums}")
        msgs = call(f"/api/dashboards/{d['id']}/messages")[1]['messages']
        print(f"  {label}: {1 + len(scope['competitors'])} brands, {len(els)} elements, sections: {' | '.join(sections)}")
        if not ind['live'] and not (msgs and 'left out' in msgs[0]['content']): problems.append(f"{ind['id']} {label}: no note about what was left out")
        windows = [('all time', None)] + ([(month, month_window(month))] if label == 'default selection' else [])
        for wl, win in windows:
            line = []
            for w in els:
                rr, err = rows(w['sql'], scope, win)
                t = w['title']
                if err: problems.append(f"{ind['id']} {label} [{wl}] {t}: ERROR {err[:120]}"); continue
                foreign = {x.get('brand') for x in rr if x.get('brand')} - allowed
                if foreign: problems.append(f"{ind['id']} {label} [{wl}] {t}: brands outside the selection {sorted(foreign)}")
                if not rr: problems.append(f"{ind['id']} {label} [{wl}] {t}: no rows"); continue
                if t == 'At a glance':
                    vals = {x['label']: (x['value'], x.get('compare')) for x in rr}
                    missing = [k for k in ('Posts', 'Creators', 'Engagement', 'Views', 'Eng. per 1K followers') if vals.get(k, (None,))[0] in (None, 0)]
                    if missing: problems.append(f"{ind['id']} {label} [{wl}] At a glance: empty tiles {missing}")
                    if 'Intent per 1K comments' in vals and not ind['comments']: problems.append(f"{ind['id']} {label}: intent tile shown without comments")
                    nocmp = all(v[1] in (None, 0) for v in vals.values())
                    line.append(f"KPIs {len(vals)}" + (' (no previous period)' if nocmp else ''))
                    if nocmp and wl == 'all time': notes.append(f"{ind['id']}: headline tiles have nothing to compare with (one month of data)")
                elif t == 'Share of voice':
                    got = {x['brand'] for x in rr}
                    have_posts = {b['name'] for b in ind['brands'] if b['name'] in allowed and b['posts'] > 0}
                    if got != have_posts: problems.append(f"{ind['id']} {label} [{wl}] Share of voice: {len(got)} brands shown, {len(have_posts)} selected with posts")
                    flat = len(rr) > 1 and len({x['value'] for x in rr}) == 1
                    sampled = {b['name'] for b in ind['brands'] if b['sourcePosts'] and b['sourcePosts'] > b['posts']}
                    capped = sum(1 for x in rr if x['brand'] in sampled)
                    line.append(f"share of voice {len(rr)} brands" + (f" ({capped} sampled)" if capped > 1 else ''))
                    if capped > 1 and wl == 'all time' and label == 'default selection': notes.append(f"{ind['id']}: {capped} of {len(rr)} brands are samples capped at the same size, so share of voice between them is flat")
                elif t == 'Engagement over time':
                    buckets = sorted({x['bucket'] for x in rr}); series = {x['brand'] for x in rr}
                    if scope['focal'] not in series: problems.append(f"{ind['id']} {label} [{wl}] Engagement over time: the company has no line")
                    if len(series) > 7: problems.append(f"{ind['id']} {label} [{wl}] Engagement over time: {len(series)} lines")
                    if len(buckets) < 3: problems.append(f"{ind['id']} {label} [{wl}] Engagement over time: only {len(buckets)} points")
                    line.append(f"trend {len(buckets)} points x {len(series)} lines")
                elif t in ('Our top posts', 'Creators driving our conversation', 'Creators already talking about us'):
                    if len(rr) < 5: notes.append(f"{ind['id']} {label} [{wl}] {t}: only {len(rr)} rows")
                    line.append(f"{t.split()[0].lower()} {t.split()[1]} {len(rr)}")
                elif t == 'Where our content lands':
                    if len(rr) < 2: notes.append(f"{ind['id']} {label} [{wl}] {t}: only {len(rr)} bar")
                    line.append(f"formats {len(rr)}")
                elif t == 'Paid versus organic':
                    if len(rr) < 2: problems.append(f"{ind['id']} {label} [{wl}] Paid versus organic: {len(rr)} group")
                    line.append(f"paid/organic {len(rr)}")
                else:
                    line.append(f"{t[:22]} {len(rr)}")
            print(f"    [{wl}] " + '; '.join(line))
        if label != 'default selection' or not KEEP: call(f"/api/dashboards/{d['id']}", method='DELETE')

if KEEP: json.dump(keep, open(KEEP, 'w'))
print('\nNOTES (expected limits of the data):')
for n in sorted(set(notes)): print('  - ' + n)
print('\nPROBLEMS:' if problems else '\nNo problems found.')
for p in problems: print('  - ' + p)
sys.exit(1 if problems else 0)
