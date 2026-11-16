"""Token usage check: runs one interaction of every kind against a running app and checks that
the usage log, the statement and the balance agree.

  npm run check:usage                 (app on http://localhost:3000)
  BASE_URL=http://localhost:3001 python3 -I scripts/check_usage.py
  python3 -I scripts/check_usage.py --drain   also spends the balance to zero to check the hard stop

It spends tokens and adds test rows to the usage log, so run it against a local database only.
"""
import json, os, sys, urllib.request, urllib.error
BASE = os.environ.get('BASE_URL', 'http://localhost:3000').rstrip('/')
DRAIN = '--drain' in sys.argv
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

def stream(path, body):
    s, t = call(path, body)
    return [json.loads(l) for l in t.splitlines() if l.strip()]

def check(name, ok, detail=''):
    print(('  ok   ' if ok else '  FAIL ') + name + (f'  {detail}' if detail else ''))
    if not ok: fails.append(name)

def balance(dash=None):
    return js('/api/usage/balance' + (f'?dashboard={dash}' if dash else ''))[1]

b0 = balance()
print('start balance', b0['balance'])
d = js('/api/wizard/start', {})[1]['dashboard']
dash = d['id']
spent = 0
seen = []

def turn(kind, path, body):
    global spent
    before = balance()['balance']
    evs = stream(path, body)
    u = [e for e in evs if e['type'] == 'usage']
    check(f'{kind}: usage event emitted', len(u) == 1, json.dumps(u[0]['usage']) if u else str([e['type'] for e in evs][-4:]))
    if not u: return
    us = u[0]['usage']
    types = [e['type'] for e in evs]
    check(f'{kind}: usage comes just before done', types[-2:] == ['usage', 'done'])
    check(f'{kind}: total = in + out', us['total'] == us['input'] + us['output'] and us['total'] > 0)
    after = balance()['balance']
    check(f'{kind}: balance dropped by total', before - after == us['total'] and us['balance'] == after, f'{before} -> {after}')
    spent += us['total']; seen.append(kind)

chat = {'dashboardId': dash, 'widgets': []}
turn('chat', '/api/chat', {**chat, 'message': 'Which platform drives the most engagement?'})
turn('scan', '/api/chat', {**chat, 'message': 'Where should I start?', 'instruction': 'Scan the data and give three observations.', 'kind': 'scan'})
turn('ask_element', '/api/chat', {**chat, 'message': 'Explain "Posts"', 'instruction': 'Explain the element Posts.', 'kind': 'ask_element'})
turn('explain_change', '/api/chat', {**chat, 'message': 'Explain the change in "Posts"', 'instruction': 'Explain the change in Posts.', 'kind': 'explain_change'})

answers = {'competitors': [], 'view': 'month', 'goal': 'risk', 'steps': {'driving': {'choices': {}}}}
turn('wizard_step', '/api/wizard/step', {'dashboardId': dash, 'stepId': 'driving', 'answers': answers, 'mode': 'propose'})
turn('wizard_discuss', '/api/wizard/step', {'dashboardId': dash, 'stepId': 'driving', 'answers': answers, 'mode': 'discuss', 'text': 'Only creators over 10K followers'})

# stored chat message carries the usage
msgs = js(f'/api/dashboards/{dash}/messages')[1]['messages']
check('history: last assistant message has usage', any(m.get('usage') for m in msgs if m['role'] == 'assistant'), f"{sum(1 for m in msgs if m.get('usage'))} of {len(msgs)} messages")

# month review
s, rep = js(f'/api/dashboards/{dash}/reports')
months = [r['month'] for r in rep.get('rows', rep.get('months', []))] if s == 200 else []
if not months:
    cov = js('/api/coverage')[1] if call('/api/coverage')[0] == 200 else {}
    months = [m['month'] for m in cov.get('months', [])][-2:]
month = months[0] if months else '2026-03'
before = balance()['balance']
s, r = js(f'/api/dashboards/{dash}/reports/{month}?force=1', {})
u = ((r.get('report') or {}).get('data') or {}).get('usage')
check('month_review: usage stored on the review', s == 200 and bool(u), json.dumps(u) if u else f'{s} {str(r)[:160]}')
if u:
    after = balance()['balance']
    check('month_review: balance dropped by total', before - after == u['total'], f'{before} -> {after}')
    spent += u['total']; seen.append('month_review')

# query assistant
sql = "SELECT platform, count(*) AS posts FROM posts GROUP BY 1 ORDER BY 2 DESC"
for mode, req in (('explain', None), ('modify', 'top 3 only')):
    before = balance()['balance']
    s, r = js('/api/sql-assist', {'mode': mode, 'sql': sql, 'request': req or '', 'dashboardId': dash, 'widget': {'title': 'Posts by platform', 'type': 'bar', 'x': 'platform', 'y': 'posts'}})
    u = r.get('usage')
    check(f'sql_assist {mode}: usage returned', s == 200 and bool(u), json.dumps(u) if u else f'{s} {str(r)[:200]}')
    if u:
        after = balance()['balance']
        check(f'sql_assist {mode}: balance dropped by total', before - after == u['total'], f'{before} -> {after}')
        spent += u['total']
seen.append('sql_assist')

# voice report
before = balance()['balance']
s, r = js('/api/usage/voice', {'dashboardId': dash, 'label': 'Voice: Posts', 'input': 1200, 'output': 800, 'responses': 3, 'durationMs': 42000})
check('voice: recorded', s == 200 and r['usage']['total'] == 2000 and before - balance()['balance'] == 2000)
spent += 2000; seen.append('voice')

# log, ledger, balance agree
b1 = balance(dash)
check('balance: start - end = sum of usage lines', b0['balance'] - b1['balance'] == spent, f"{b0['balance']} - {b1['balance']} vs {spent}")
check('balance: dashboard month total = spent on this dashboard', b1.get('dashboardMonth') == spent, f"{b1.get('dashboardMonth')} vs {spent}")
ev = js(f'/api/usage/events?dashboard={dash}&limit=100')[1]
rows = ev.get('events', ev.get('rows', []))
kinds = sorted({e['kind'] for e in rows})
check('log: every kind present for the dashboard', set(seen) <= set(kinds), ', '.join(kinds))
check('log: sum of events = spent', sum(int(e['total_tokens']) for e in rows) == spent, str(sum(int(e['total_tokens']) for e in rows)))
st = js('/api/usage/ledger')[1]
srows = st.get('rows', st.get('statement', st if isinstance(st, list) else []))
check('statement: has rows and newest balance = balance', bool(srows) and int(srows[0].get('balance_after', srows[0].get('balance', -1))) == b1['balance'], str(srows[0])[:200] if srows else str(st)[:200])
s, csv = call(f'/api/usage/events?dashboard={dash}&format=csv')
check('csv export', s == 200 and csv.count('\n') >= len(rows), csv.splitlines()[0][:120])
sm = js('/api/usage/summary')[1]
check('summary: totals and by-kind', sm['totals']['tokens'] > 0 and len(sm['byKind']) >= 5, f"{sm['totals']['interactions']} interactions, {sm['totals']['tokens']} tokens, est share {sm['totals']['estimatedShare']:.2f}")

# top-up
s, r = js('/api/usage/top-up', {'tokens': 250000})
check('top-up: +250,000', s == 200 and r['balance'] == b1['balance'] + 250000, str(r)[:160])
s, r = js('/api/usage/top-up', {'tokens': -5})
check('top-up: rejects a negative amount', s == 400, f'{s} {r}')
s, r = js('/api/usage/top-up', {'tokens': 10**9})
check('top-up: rejects more than the maximum', s == 400, f'{s} {r}')

if DRAIN:
    print('drain to zero')
    left = balance()['balance']
    while left > 0:
        take = min(left, 5_000_000)
        js('/api/usage/voice', {'dashboardId': None, 'label': 'test drain', 'input': take, 'output': 0})
        left = balance()['balance']
    b = balance()
    check('zero: balance says out', b['out'] and b['balance'] <= 0, str(b))
    evs = stream('/api/chat', {**chat, 'message': 'Anything?'})
    check('zero: chat refuses with out_of_tokens', any(e['type'] == 'error' and e.get('code') == 'out_of_tokens' for e in evs) and not any(e['type'] in ('text', 'usage') for e in evs), str(evs)[:200])
    evs = stream('/api/wizard/step', {'dashboardId': dash, 'stepId': 'driving', 'answers': answers, 'mode': 'propose'})
    check('zero: wizard refuses', any(e.get('code') == 'out_of_tokens' for e in evs))
    s, r = js('/api/sql-assist', {'mode': 'explain', 'sql': sql, 'widget': {'title': 'x', 'type': 'bar'}})
    check('zero: query assistant refuses', s >= 400 and 'out of tokens' in r.get('error', '').lower(), f'{s} {r}')
    s, r = js(f'/api/dashboards/{dash}/reports/{month}?force=1', {})
    check('zero: month review refuses', s >= 400 and 'out of tokens' in r.get('error', '').lower(), f'{s} {str(r)[:120]}')
    s, r = js('/api/voice/session', {'widget': {'id': 'w', 'type': 'kpi', 'title': 'x', 'sql': 'SELECT 1 AS value', 'layout': {'x': 0, 'y': 0, 'w': 3, 'h': 2}}, 'rows': []})
    check('zero: voice session refuses', s >= 400 and 'out of tokens' in r.get('error', '').lower(), f'{s} {str(r)[:120]}')
    check('zero: balance unchanged by refusals', balance()['balance'] == b['balance'])
    s, r = js('/api/usage/top-up', {'tokens': 1_000_000})
    evs = stream('/api/chat', {**chat, 'message': 'And now?'})
    check('zero: after a top-up the analyst answers again', any(e['type'] == 'usage' for e in evs), str(balance()))

call(f'/api/dashboards/{dash}', method='DELETE')
after_delete = js('/api/usage/events?limit=5')[1]
check('log survives deleting the dashboard', len(after_delete.get('events', after_delete.get('rows', []))) > 0)
print('\nFAILED: ' + ', '.join(fails) if fails else '\nall checks passed')
sys.exit(1 if fails else 0)
