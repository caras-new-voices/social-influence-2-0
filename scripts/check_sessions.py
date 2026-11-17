"""Checks chat sessions against a running app (default http://localhost:3000, or SI_BASE).

  npm run check:sessions

A question without a session starts one, follow-ups stay in it, a second chat is kept apart,
history lists the most recent chat first, rename and delete work, and an element chat from the
full-screen view is named after its element.
"""
import os
import json, urllib.request

B = os.environ.get("SI_BASE", "http://localhost:3000")


def call(path, body=None, method=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method or ("POST" if body is not None else "GET"))
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read().decode()


def chat(d, msg, sid=None):
    out = call("/api/chat", {"dashboardId": d, "message": msg, "sessionId": sid, "widgets": []} if sid else {"dashboardId": d, "message": msg, "widgets": []})
    evs = [json.loads(l) for l in out.splitlines() if l.strip()]
    return evs


ok = True
def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(("  ok  " if cond else "  FAIL") + " " + name + (f"  {detail}" if detail else ""))


d = json.loads(call("/api/dashboards", {"name": "Sessions test", "template": "starter", "scope": {"industry": "hair-removal", "focal": "Venus", "competitors": ["Estrid", "Veet"]}}))["dashboard"]["id"]
before = json.loads(call(f"/api/dashboards/{d}/sessions"))["sessions"]
check("a new dashboard has only its setup chat, if any", all(s["kind"] == "setup" for s in before), str([s["title"] for s in before]))

e1 = chat(d, "Which brand leads on TikTok?")
s1 = [e for e in e1 if e["type"] == "session"]
check("first question starts a session and announces it first", s1 and e1[0]["type"] == "session", s1[0]["session"]["title"] if s1 else "")
sid1 = s1[0]["session"]["id"]
e2 = chat(d, "And on Instagram?", sid1)
check("a follow-up with the session id stays in that session", not any(e["type"] == "session" for e in e2))
e3 = chat(d, "What are the main objections?")
sid2 = [e for e in e3 if e["type"] == "session"][0]["session"]["id"]
check("a question without a session id starts a second session", sid2 != sid1)

sess = json.loads(call(f"/api/dashboards/{d}/sessions"))["sessions"]
check("the most recently used chat is listed first", sess[0]["id"] == sid2, str([(s["title"], s["questions"]) for s in sess]))
q1 = [s for s in sess if s["id"] == sid1][0]["questions"]
check("question counts are per session", q1 == 2, f"first chat has {q1}")

m1 = json.loads(call(f"/api/sessions/{sid1}"))["messages"]
m2 = json.loads(call(f"/api/sessions/{sid2}"))["messages"]
check("messages are kept apart", all("objections" not in m["content"] for m in m1 if m["role"] == "user") and len([m for m in m2 if m["role"] == "user"]) == 1)

latest = json.loads(call(f"/api/dashboards/{d}/messages"))
check("the dashboard opens on its most recent chat", latest["session"]["id"] == sid2)

r = json.loads(call(f"/api/sessions/{sid1}", {"title": "TikTok and Instagram"}, "PATCH"))
check("rename", r["session"]["title"] == "TikTok and Instagram")

e4 = chat(d, "x", "s_from_another_dashboard")
check("an unknown session id starts a new session instead of failing", any(e["type"] == "session" for e in e4))

call(f"/api/sessions/{sid2}", None, "DELETE")
sess = json.loads(call(f"/api/dashboards/{d}/sessions"))["sessions"]
check("delete removes the chat", sid2 not in [s["id"] for s in sess])
try:
    call(f"/api/sessions/{sid2}")
    check("a deleted chat is gone", False)
except urllib.error.HTTPError as e:
    check("a deleted chat is gone", e.code == 404)

dash = json.loads(call(f"/api/dashboards/{d}"))
dash = dash.get("dashboard", dash)
w = dash["widgets"][1]
out = call("/api/chat", {"dashboardId": d, "message": "Explain what this shows", "widgets": [], "sessionKind": "element", "sessionWidgetId": w["id"]})
se = [json.loads(l) for l in out.splitlines() if l.strip() and json.loads(l)["type"] == "session"]
check("an element chat is named after its element", se and se[0]["session"]["title"].startswith("About: ") and se[0]["session"]["kind"] == "element", se[0]["session"]["title"] if se else "")

call(f"/api/dashboards/{d}", None, "DELETE")
print("all checks passed" if ok else "FAILED")
raise SystemExit(0 if ok else 1)
