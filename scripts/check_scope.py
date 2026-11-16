"""Brand scope check: against a running app, confirms that a dashboard only ever sees its own
brands through every entry point (element data, the analyst, coverage, reports, guided setup),
that templates adapt to posts-only industries, and that dashboards without a scope behave as
before. It creates a few test dashboards and deletes them.

  npm run check:scope                 (app on http://localhost:3000)
  BASE_URL=http://localhost:3001 python3 -I scripts/check_scope.py
"""
import json, os, sys, urllib.request, urllib.error, urllib.parse
BASE = os.environ.get('BASE_URL', 'http://localhost:3000').rstrip('/')
fails = []

def call(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type': 'application/json'}, method=method or ('POST' if body is not None else 'GET'))
    try:
        r = urllib.request.urlopen(req, timeout=300)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def js(path, body=None, method=None):
    s, t = call(path, body, method)
    return s, json.loads(t)

def check(name, ok, detail=''):
    print(('  ok   ' if ok else '  FAIL ') + name + (f'  {detail}' if detail else ''))
    if not ok: fails.append(name)

def rows(sql, scope=None, window=None):
    s, r = js('/api/widgets/data', {'sql': sql, 'scope': scope, 'window': window})
    return r.get('rows', []) if s == 200 else r

cat = js('/api/catalog')[1]['industries']
check('catalogue: ten industries, one live', len(cat) == 10 and sum(1 for i in cat if i['live']) == 1, ', '.join(f"{i['id']}({len(i['brands'])})" for i in cat))
check('catalogue: every brand has a description', all(b['description'] for i in cat for b in i['brands']))
check('catalogue: every industry has a summary and facts', all(i['summary'] and i['facts'] for i in cat))
live = next(i for i in cat if i['live'])
created = []
BRANDS = "SELECT brand, count(*)::int AS n FROM posts GROUP BY 1 ORDER BY 2 DESC"

# default (no scope) = the live industry, as before
r = rows(BRANDS)
check('no scope: the live industry\'s brands only', sorted(x['brand'] for x in r) == sorted(b['name'] for b in live['brands']), str(r)[:120])

for ind in cat:
    if ind['live'] or len(ind['brands']) < 3: continue
    by_posts = sorted(ind['brands'], key=lambda b: -b['posts'])
    focal, comps = by_posts[1]['name'], [by_posts[0]['name'], by_posts[2]['name']]
    scope = {'industry': ind['id'], 'focal': focal, 'competitors': comps}
    want = sorted([focal] + comps)
    r = rows(BRANDS, scope)
    ok = sorted(x['brand'] for x in r) == want
    r2 = rows("SELECT brand FROM posts_all GROUP BY 1 UNION SELECT brand FROM influencers GROUP BY 1 UNION SELECT brand FROM segments", scope)
    ok2 = sorted(x['brand'] for x in r2) == want
    r3 = rows("SELECT focal_brand() AS f, (SELECT count(*)::int FROM segments WHERE is_competitor(brand)) AS c, (SELECT string_agg(brand, '|') FROM segments WHERE role = 'focal') AS role_focal", scope)
    ok3 = r3 and r3[0]['f'] == focal and r3[0]['c'] == 2 and r3[0]['role_focal'] == focal
    check(f"{ind['id']}: posts, posts_all, influencers, segments keep to the 3 chosen brands", ok and ok2, str(r)[:100])
    check(f"{ind['id']}: focal_brand, is_competitor and role follow the choice", bool(ok3), str(r3)[:120])

# a scope cannot name brands from another industry, or the raw tables
other = next(i for i in cat if not i['live'])
s, r = js('/api/dashboards', {'name': 'bad', 'template': 'blank', 'scope': {'industry': other['id'], 'focal': live['brands'][0]['name'], 'competitors': []}})
check('creating with a company from another industry is refused', s == 400, f'{s} {str(r)[:80]}')
if s == 201: created.append(r['dashboard']['id'])
mixed = {'industry': other['id'], 'focal': other['brands'][0]['name'], 'competitors': [live['brands'][0]['name'], other['brands'][1]['name']]}
r = rows(BRANDS, mixed)
check('competitors from another industry are dropped', sorted(x['brand'] for x in r) == sorted([other['brands'][0]['name'], other['brands'][1]['name']]), str(r)[:120])
r = rows("SELECT count(*) FROM posts_raw", mixed)
check('raw tables cannot be queried', isinstance(r, dict) and 'error' in r, str(r)[:100])

# a dashboard from the starter template for a posts-only industry
ind = next(i for i in cat if i['id'] == other['id'])
scope = ind['defaultScope']
scope = {**scope, 'competitors': scope['competitors'][:4]}
s, r = js('/api/dashboards', {'name': 'Scope test', 'template': 'starter', 'scope': scope})
check('starter dashboard created for a posts-only industry', s == 201 and r['dashboard']['scope'] == scope, str(r)[:160] if s != 201 else '')
d = r['dashboard']; created.append(d['id'])
titles = [w['title'] for w in d['widgets'] if w['type'] == 'section']
check('sections are renumbered with the comment sections left out', titles[:3] == ['1. How are we doing?', '2. What is working?', '3. What should we do next?'] and not any('audience say' in t for t in titles), ' | '.join(titles))
msgs = js(f"/api/dashboards/{d['id']}/messages")[1]['messages']
check('the chat explains what was left out', bool(msgs) and 'no comments' in msgs[0]['content'], msgs[0]['content'][:160] if msgs else 'no message')
empty = []
for w in d['widgets']:
    if not w.get('sql'): continue
    rr = rows(w['sql'], scope)
    if isinstance(rr, dict): empty.append(f"{w['title']}: ERROR {rr.get('error', '')[:80]}")
    elif not rr: empty.append(w['title'])
    else:
        seen = {x.get('brand') for x in rr if x.get('brand')}
        if seen - set([scope['focal']] + scope['competitors']): empty.append(f"{w['title']}: foreign brands {seen}")
check('every element returns rows, only for the chosen brands', not empty, '; '.join(empty))

# the analyst runs inside the dashboard's scope
s, t = call('/api/chat', {'dashboardId': d['id'], 'message': 'Which brand leads on TikTok?', 'widgets': []})
evs = [json.loads(l) for l in t.splitlines() if l.strip()]
wid = [e for e in evs if e['type'] == 'widget']
brands = {x.get('brand') for e in wid for x in (e.get('data') or [])}
check('analyst: proposals only contain the chosen brands', bool(wid) and brands <= set([scope['focal']] + scope['competitors']), str(sorted(b for b in brands if b))[:160])
s, t = call('/api/chat', {'dashboardId': d['id'], 'message': 'What are the main objections?', 'widgets': []})
evs = [json.loads(l) for l in t.splitlines() if l.strip()]
sqls = [e['sql'] for e in evs if e['type'] == 'query']
check('demo analyst does not answer from comments when there are none', all(' comments' not in q.lower().replace('p.comments', '') for q in sqls), str(sqls)[:140])

# coverage, reports, guided setup follow the scope
q = urllib.parse.quote(json.dumps(scope))
cov = js(f'/api/coverage?scope={q}')[1]
check('coverage is the selection\'s own months', [m['month'] for m in cov['months']] == ind['months'] and cov['comments'] == 0, f"{cov['posts']} posts, months {[m['month'] for m in cov['months']]}")
rep = js(f"/api/dashboards/{d['id']}/reports")[1]
check('reports list the selection\'s months', [x['month'] for x in rep['rows']] == list(reversed(ind['months'])), str([x['month'] for x in rep['rows']]))
s, w = js('/api/wizard/start', {'scope': scope})
created.append(w['dashboard']['id'])
order = w['dashboard']['onboarding']['order']
check('guided setup for posts-only brands asks only what the data can answer', order == ['driving', 'partners'], str(order))
check('guided setup returns the workspace of the chosen brands', [b['name'] for b in w['workspace']['brands']][0] == scope['focal'] and w['workspace']['hasComments'] is False)
dfn = js(f"/api/wizard/start?dashboard={w['dashboard']['id']}")[1]
check('guided setup intro names the company and says comments are missing', scope['focal'] in dfn['intro'] and 'no audience comments' in dfn['intro'], dfn['intro'][:150])
evs = [json.loads(l) for l in call('/api/wizard/step', {'dashboardId': w['dashboard']['id'], 'stepId': 'driving', 'answers': w['dashboard']['onboarding']['answers'], 'mode': 'propose'})[1].splitlines() if l.strip()]
wid = [e for e in evs if e['type'] == 'widget']
check('guided setup step proposes elements with data', len(wid) >= 2 and all(e.get('data') for e in wid), f"{len(wid)} proposals")
s, wl = js('/api/wizard/start', {'scope': live['defaultScope']})
created.append(wl['dashboard']['id'])
check('guided setup for the live industry keeps all eight questions', len(wl['dashboard']['onboarding']['order']) == 8)

# changing the brands of an existing dashboard
new_scope = {**scope, 'competitors': scope['competitors'][:1]}
s, r = js(f"/api/dashboards/{d['id']}", {'scope': new_scope}, 'PUT')
check('brands can be changed on an existing dashboard', s == 200 and r['dashboard']['scope'] == new_scope and len(r['dashboard']['widgets']) == len(d['widgets']))
s, r = js(f"/api/dashboards/{d['id']}", {'scope': {'industry': 'nope', 'focal': 'x', 'competitors': []}}, 'PUT')
check('an unknown industry is refused', s == 400)

# old dashboards (no scope) behave as before
s, r = js('/api/dashboards', {'name': 'Legacy test', 'template': 'eran'})
created.append(r['dashboard']['id'])
check('a dashboard created without a scope gets the live default', r['dashboard']['scope'] == live['defaultScope'] and sum(1 for w in r['dashboard']['widgets'] if w['type'] != 'section') == 31, str(r['dashboard']['scope'])[:120])
s, r = js('/api/dashboards', {'name': 'Eran posts-only', 'template': 'eran', 'scope': scope})
created.append(r['dashboard']['id'])
n = sum(1 for w in r['dashboard']['widgets'] if w['type'] != 'section')
check("Eran's template on posts-only brands keeps only the post-based elements", 0 < n < 31 and not any(' comments' in (w.get('sql') or '').lower().replace('p.comments', '').replace('sum(comments', '') and 'from comments' in (w.get('sql') or '').lower() for w in r['dashboard']['widgets']), f'{n} elements')

for i in created: call(f'/api/dashboards/{i}', method='DELETE')
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall checks passed')
sys.exit(1 if fails else 0)
