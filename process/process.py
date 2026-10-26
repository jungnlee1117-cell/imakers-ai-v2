#!/usr/bin/env python3
"""수업 녹음 -> 카드 JSON (v1) 처리 부분.

features : 전사 파일 -> 전사 줄(이름 가림, 신뢰 표시) + 코드로 셀 수 있는 것 + AI 분석용 prompt.md
merge    : features + analysis.json(AI 분석 결과) -> card.json (스키마 검증)
run      : 소리 파일 -> 전사 -> features -> AI(API) -> merge  (API 호출 부분은 이 환경에서 시험하지 못함)
"""
import argparse, json, os, re, subprocess, sys, pathlib
import jsonschema

HERE = pathlib.Path(__file__).parent
SCHEMA = json.load(open(HERE / "card_schema.json", encoding="utf-8"))
MASK = "[아이]"

# ---------- 전사 읽기 ----------
def load_transcript(path):
    out = []
    for raw in open(path, encoding="utf-8"):
        m = re.match(r"\[(?:(\d+):)?(\d+):(\d\d)\]\s*(.*)", raw.strip())
        if not m:
            continue
        h, mi, s, text = int(m[1] or 0), int(m[2]), int(m[3]), m[4].strip()
        if text:
            out.append({"start_sec": h * 3600 + mi * 60 + s, "text": text})
    return out

# ---------- 아이 이름 가리기 ----------
_STOP = {"Hat", "Kick", "Wing", "Ping", "Don", "April", "August", "Mario", "Run"}
def _detector():
    import gender_guesser.detector as g
    from wordfreq import zipf_frequency
    return g.Detector(case_sensitive=False), zipf_frequency

def make_masker(teacher_names=(), roster=()):
    det, zf = _detector()
    teacher = {t.lower() for t in teacher_names} | {"miss", "ms", "mr"}
    roster = {r.lower() for r in roster}
    def is_name(w, nxt):
        lw = w.lower()
        if lw in teacher or w in _STOP:
            return False
        if lw in roster:
            return True
        if nxt == "'":                       # Don't, Let's
            return False
        return det.get_gender(w) != "unknown" and zf(lw, "en") < 5.0
    def rare_near_punct(w, text, m):
        """문장 중간의 낯선 대문자 단어가 쉼표·문장부호 옆에 있으면 부르는 이름으로 본다."""
        if w.lower() in teacher or zf(w.lower(), "en") >= 3.6:
            return False
        before = text[:m.start()].rstrip()
        after = text[m.end():].lstrip()
        sentence_start = (before == "") or before[-1] in ".!?"
        near = (before[-1:] in ",") or after[:1] in ",.!?(" or after == "" or re.match(r"one more time", after, re.I)
        return (not sentence_start or after[:1] in ",!?") and bool(near)
    def mask(text):
        def sub(m):
            w = m.group(0)
            nxt = text[m.end():m.end() + 1]
            return MASK if (is_name(w, nxt) or rare_near_punct(w, text, m)) else w
        out = re.sub(r"\b[A-Z][a-z]{2,}\b", sub, text)
        # 소문자로 받아쓴 이름: "Come on, sojin."
        def low(m):
            w = m.group(2)
            return m.group(1) + (MASK if zf(w.lower(), "en") < 3.0 else w)
        return re.sub(r"\b((?:Come on|Good job|Well done|Thank you|Hey|Look at|Wait),?\s+)([a-z]{3,10})\b(?=[,.!?]|$)", low, out)
    return mask

# ---------- 믿기 어려운 줄 ----------
_NONLATIN = re.compile(r"[؀-ۿऀ-ॿЀ-ӿ฀-๿぀-ヿ一-鿿֐-׿]")
_PROFANE = re.compile(r"\b(shut up|shit|fuck\w*|penis|bitch|damn)\b", re.I)
_STOCK = re.compile(r"(see you in the next video|thanks for watching|please subscribe|subtitles by|amara\.org)", re.I)
_SOUND = re.compile(r"^[\(\[][^)\]]{1,60}[\)\]]\s*([\(\[][^)\]]{1,60}[\)\]]\s*)*$")
def judge_line(text):
    """(trusted, reason, kind) kind: speech | non_speech | excluded"""
    if _SOUND.match(text) or "BLANK_AUDIO" in text:
        return False, "소리 표시(말이 아님)", "non_speech"
    if _NONLATIN.search(text):
        return False, "다른 언어로 잘못 인식된 줄로 보여 제외했습니다.", "excluded"
    if _STOCK.search(text):
        return False, "수업과 무관한 문구로 인식된 줄(영상·기기 소리로 보임)이라 제외했습니다.", "excluded"
    if _PROFANE.search(text):
        return False, "부적절한 단어로 인식됐지만 오인식 가능성이 있어 제외했습니다. 재생해서 확인이 필요합니다.", "excluded"
    return True, "", "speech"

# ---------- 코드로 셀 수 있는 것 ----------
PRAISE = [
    ("Good job!", r"\bgood job\b"), ("Well done!", r"\bwell done\b"), ("Excellent!", r"\bexcellent\b"),
    ("Perfect!", r"\bperfect\b"), ("Very good!", r"\bvery good\b"), ("That's it!", r"\bthat'?s it\b"),
    ("That's better!", r"\bthat'?s better\b"), ("Nice save!", r"\bnice save\b"), ("Nice try!", r"\bnice try\b"),
    ("Nice pass!", r"\bnice pass\b"), ("What a goal!", r"\bwhat a goal\b"), ("Great job!", r"\bgreat (job|work|listening)\b"),
    ("Amazing!", r"\bamazing\b"), ("Thanks for being honest.", r"\bthanks for being honest\b"),
]
RULEQ = re.compile(r"(Can (?:I|you|we) [^?]{3,90}\?)(?=\s*[^?]{0,15}?\b(?:No|Nope)\b|\s*Can (?:I|you|we) )")

def code_features(lines):
    praise, seen = [], set()
    rules, rseen = [], set()
    for i, ln in enumerate(lines):
        if not ln["trusted"]:
            continue
        t = ln["text"]
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        joined = t + (" " + nxt["text"] if nxt and nxt["trusted"] and nxt["start_sec"] - ln["start_sec"] <= 8 else "")
        for label, rx in PRAISE:
            for m in re.finditer(rx, t, re.I):
                praise.append({"expression": label, "at_sec": ln["start_sec"]})
        for m in RULEQ.finditer(joined):
            if m.start() >= len(t):   # 다음 줄에서 시작한 질문은 그 줄에서 센다
                continue
            q = m.group(1).strip()
            rules.append({"expression": q, "at_sec": ln["start_sec"]})
    uniq = lambda ev: list({e["expression"].lower(): e for e in reversed(ev)}.values())[::-1]
    return {"praise_events": praise, "praise_unique": sorted(uniq(praise), key=lambda e: e["at_sec"]),
            "rule_events": rules, "rule_unique": sorted(uniq(rules), key=lambda e: e["at_sec"])}

# ---------- features 단계 ----------
def cmd_features(a):
    meta = json.load(open(a.meta, encoding="utf-8"))
    mask = make_masker(meta.get("teacher_names", ["Rachel"]), meta.get("roster", []))
    work = pathlib.Path(a.out); work.mkdir(parents=True, exist_ok=True)
    lines = []
    for ln in load_transcript(a.transcript):
        trusted, reason, kind = judge_line(ln["text"])
        lines.append({"start_sec": ln["start_sec"], "text": mask(ln["text"]), "trusted": trusted,
                      **({"reason": reason} if reason else {}), "_kind": kind})
    feats = code_features(lines)
    feats["excluded_by_code"] = [{"at_sec": l["start_sec"], "reason": f'"{l["text"][:60]}" → {l["reason"]}'} for l in lines if l["_kind"] == "excluded"]
    json.dump([{k: v for k, v in l.items() if k != "_kind"} for l in lines], open(work / "transcript_lines.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump({"meta": meta, "features": feats}, open(work / "features.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    open(work / "prompt.md", "w", encoding="utf-8").write(build_prompt(meta, lines, feats, a.plan))
    print(f"lines={len(lines)} untrusted={sum(1 for l in lines if not l['trusted'])} praise={len(feats['praise_unique'])} rule_q={len(feats['rule_unique'])} masked={sum(l['text'].count(MASK) for l in lines)}")

def mmss(s): return f"{s//60}:{s%60:02d}"

def build_prompt(meta, lines, feats, plan_path):
    plan = open(plan_path, encoding="utf-8").read() if plan_path else None
    tr = "\n".join(f"[{mmss(l['start_sec'])}] {l['text']}" + ("" if l["trusted"] else "  <<믿기 어려운 줄: 평가에 쓰지 말 것>>") for l in lines)
    return f"""당신은 어린이 체육 수업 코치입니다. 아래 전사본(음성인식 결과)으로 선생님의 수업 코칭 카드 내용을 만드세요.

## 규칙
1. 점수·순위·등급을 만들지 않는다. 잘한 장면과 "이렇게 해 보면 좋은 장면"을 구체적으로 쓴다. 훈육은 잘함/못함이 아니라 제안으로 쓴다.
2. 전사본은 음성인식 결과라 틀릴 수 있다. "<<믿기 어려운 줄>>"은 평가에 쓰지 않는다. 들리는 것만으로 판단하고 추측하지 않는다.
3. 같은 소리의 영어(your/you're, knee/knees)는 문장 오류로 세지 않는다.
4. 아이 이름은 이미 [아이]로 가려져 있다. 출력에도 아이 이름을 쓰지 않는다.
5. 시각은 초(정수). 장면에는 전사본에 실제로 있는 시각만 쓴다.
6. 말투: 선생님을 존중하는 존댓말. 한 문장 25단어 이내.
7. language_mode 가 english 일 때만 english_phrases 를 쓴다. type: error=확실한 문장 오류, tip=더 쉽게 말하는 다듬기 제안, check=음성인식 의심.

## 수업 정보
{json.dumps({k: v for k, v in meta.items() if k not in ('roster',)}, ensure_ascii=False)}

## 코드가 이미 센 것 (참고만, 다시 세지 말 것)
- 칭찬 표현: {', '.join(e['expression'] for e in feats['praise_unique']) or '없음'}
- 규칙을 질문으로 안내한 횟수: {len(feats['rule_events'])}

## 출력 (JSON 하나만, 설명 없이)
{{
 "flow": {{"note": "수업 흐름에 대한 한두 문장", "segments": [{{"start_sec": 0, "end_sec": 145, "label": "...", "kind": "main|normal|control"}}]}},
 "english_phrases": {{"note": "...", "items": [{{"at_sec": 0, "heard": "...", "suggested": "...", "reason": "...", "type": "error|tip|check"}}]}},
 "area_reviews": [{{"area": "flow|english|interaction|discipline|safety{'|plan' if plan else ''}",
   "good": [{{"title": "...", "text": "...", "evidence": [{{"at_sec": 0, "quote": "전사본에 있는 말 그대로"}}]}}],
   "improve": [{{"title": "...", "text": "...", "evidence": [{{"at_sec": 0, "quote": "..."}}], "example": {{"say": "바로 써 볼 말이나 방법", "why": "왜 좋은지"}}}}]}}],
 "child_care_expressions": [{{"expression": "...", "at_sec": 0}}],
 "practice": [{{"id": "s1", "say": "...", "why": "...", "is_task": false}}],
 "extra_excluded": [{{"at_sec": 0, "reason": "..."}}],
 "wait_segments": 0,
 "question_segments": 0{', "plan_adherence": {"status": "done", "planned": [], "actual": [], "missing": [], "note": ""}' if plan else ''}
}}
- segments 는 처음(0초)부터 마지막까지 빈틈 없이 이어 쓴다. kind: main=아이들이 움직인 활동, normal=설명·준비·정리, control=훈육·재정비.
- area_reviews: 영역마다 잘한 점 0~2개, 개선할 점 0~2개. 개선할 점이 없으면 비워 둔다(억지로 채우지 않는다). 영역: flow=수업 흐름, english=영어 표현, interaction=아이와의 상호작용, discipline=훈육, safety=안전·주목.
- 모든 항목에는 evidence(근거)가 1~3개 있어야 한다. quote 는 전사본의 말을 그대로(조금 줄여도 됨) 옮기고, at_sec 은 그 말이 있는 줄의 시각이다. 전사본에 없는 말을 쓰면 그 항목은 카드에서 빠진다.
- 개선할 점에는 반드시 example(바로 써 볼 말이나 방법)을 붙인다. "<<믿기 어려운 줄>>"은 근거로 쓰지 않는다.
- practice 3~4개(마지막 하나는 수업 뒤 체크하는 과제여도 좋다).
- child_care_expressions: 아이 상태를 묻거나 기분을 받아 주거나 기다릴 시간을 알려 주는 말(전사본에 있는 그대로).
- wait_segments: 같은 대기·정지 지시가 반복된 구간 수. question_segments: 아이 반응을 끌어낸 질문 구간 수.
{('## 월간 계획안'+chr(10)+plan) if plan else ''}
## 전사본
{tr}
"""


# ---------- 근거 검증 ----------
def _norm(t):
    t = t.lower().replace("(…반복)", " ").replace("…", " ")
    t = re.sub(r"[^0-9a-z가-힣\[\]아이]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()

def evidence_ok(lines, ev):
    """근거로 쓴 말이 그 시각 근처의 전사본에 실제로 있는지."""
    at = ev["at_sec"]
    near = [l for l in lines if at - 8 <= l["start_sec"] <= at + 3]
    prev = [l for l in lines if l["start_sec"] <= at]
    if prev and prev[-1] not in near:
        near.append(prev[-1])
    blob = _norm(" ".join(l["text"] for l in sorted(near, key=lambda l: l["start_sec"])))
    q = _norm(ev["quote"])
    return bool(q) and q in blob

def pieces_ok(lines, at, text):
    """'…'로 줄인 인용도 조각마다 확인한다."""
    parts = [p for p in re.split(r"…|\.\.\.", text) if len(_norm(p).split()) >= 2]
    return bool(parts) and all(evidence_ok(lines, {"at_sec": at, "quote": p}) for p in parts)

def verify_reviews(reviews, lines, dropped):
    out = []
    for r in reviews:
        nr = {"area": r["area"], "good": [], "improve": []}
        for kind in ("good", "improve"):
            for f in r.get(kind, []):
                ok = [e for e in f["evidence"] if evidence_ok(lines, e)]
                if not ok:
                    dropped.append({"area": r["area"], "kind": kind, "title": f["title"], "reason": "근거로 쓴 말이 전사본에 없음"})
                    continue
                nr[kind].append({**f, "evidence": ok})
        out.append(nr)
    return out

# ---------- merge 단계 ----------
def kind_len(segs, k): return sum(s["end_sec"] - s["start_sec"] for s in segs if s["kind"] == k)

def cmd_merge(a):
    work = pathlib.Path(a.work)
    fm = json.load(open(work / "features.json", encoding="utf-8")); meta, F = fm["meta"], fm["features"]
    an = json.load(open(a.analysis, encoding="utf-8"))
    mask = make_masker(meta.get("teacher_names", ["Rachel"]), meta.get("roster", []))
    def walk(x):   # AI가 아이 이름을 남겼을 때를 대비한 한 번 더 가리기
        if isinstance(x, str): return mask(x)
        if isinstance(x, list): return [walk(i) for i in x]
        if isinstance(x, dict): return {k: walk(v) for k, v in x.items()}
        return x
    an = walk(an)
    lines = json.load(open(work / "transcript_lines.json", encoding="utf-8"))
    dropped = []
    if "area_reviews" in an:
        an["area_reviews"] = verify_reviews(an["area_reviews"], lines, dropped)
        # v1.0 화면이 읽는 interaction 은 area_reviews 에서 만든다(상호작용·훈육·안전)
        scenes = lambda kind: [{"title": f["title"], "at_sec": [e["at_sec"] for e in f["evidence"]], "text": f["text"]}
                               for r in an["area_reviews"] if r["area"] in ("interaction", "discipline", "safety") for f in r[kind]]
        an["interaction"] = {"good": scenes("good"), "improve": scenes("improve")}
    if "english_phrases" in an:
        for it in an["english_phrases"]["items"]:
            if it["type"] != "check" and not pieces_ok(lines, it["at_sec"], it["heard"]):
                it["type"] = "check"
                it["reason"] = "전사본에서 이 말을 찾지 못했습니다. 직접 확인해 주세요. " + it["reason"]
                dropped.append({"area": "english", "kind": "downgraded_to_check", "title": it["heard"][:40], "reason": "heard 가 전사본에 없음"})
    segs = an["flow"]["segments"]
    total = sum(s["end_sec"] - s["start_sec"] for s in segs)
    moved = kind_len(segs, "main")
    pct = round(moved / total * 100) if total else 0
    lead = f"막대의 길이는 시간 비율입니다. 설명과 정리를 뺀, 아이들이 움직인 시간이 {pct}%({moved//60}분 {moved%60}초)였습니다."
    errs = sum(1 for i in an.get("english_phrases", {}).get("items", []) if i["type"] == "error")
    pu = F["praise_unique"]
    metrics = [
        {"id": "move", "label": "움직인 시간 비율", "value": pct, "unit": "%", "better": "up", "tolerance": 5, "compare": True},
        {"id": "praise", "label": "칭찬 표현 (확인된 것)", "value": len(F["praise_events"]), "unit": "회", "better": "up", "tolerance": 3,
         "sub": " · ".join(dict.fromkeys(mmss(e["at_sec"]) for e in F["praise_events"])) , "compare": True},
        {"id": "wait", "label": "대기 지시 반복 구간", "value": an.get("wait_segments", 0), "unit": "구간", "better": "down", "tolerance": 1, "compare": False},
        {"id": "rule", "label": "규칙을 질문으로 물은 횟수", "value": len(F["rule_events"]), "unit": "회", "better": "up", "tolerance": 1, "compare": False},
        {"id": "q", "label": "아이 반응을 끌어낸 질문 구간", "value": an.get("question_segments", 0), "unit": "구간", "better": "up", "tolerance": 3, "compare": True},
    ]
    if meta.get("language_mode") == "english":
        metrics.append({"id": "gr", "label": "문장 오류 후보", "value": errs, "unit": "건", "better": "down", "tolerance": 1, "compare": True})
    skill = [{"skill_id": "praise", **e} for e in pu] + \
            [{"skill_id": "rule_as_question", **e} for e in F["rule_unique"]] + \
            [{"skill_id": "child_care", **e} for e in an.get("child_care_expressions", [])]
    card = {
        "schema_version": "1.1" if "area_reviews" in an else "1.0",
        "lesson": {"date": meta["date"], "class_name": meta["class_name"], "sport": meta["sport"],
                   "language_mode": meta["language_mode"], "duration_sec": meta["duration_sec"], "source": meta["source"]},
        "flow": {"lead": lead, "note": an["flow"]["note"], "segments": segs},
        "interaction": an["interaction"],
        "plan_adherence": an.get("plan_adherence", {"status": "not_linked"}),
        "metrics": metrics,
        "excluded_lines": sorted(F["excluded_by_code"] + an.get("extra_excluded", []), key=lambda e: e["at_sec"]),
        "practice": an["practice"],
        "skill_events": skill,
    }
    if "area_reviews" in an:
        card["area_reviews"] = an["area_reviews"]
    if dropped:
        json.dump(dropped, open(str(a.out) + ".dropped.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("근거 검증에서 빠지거나 낮춘 항목:", len(dropped))
    if meta.get("language_mode") == "english" and "english_phrases" in an:
        card["english_phrases"] = an["english_phrases"]
    jsonschema.validate(card, SCHEMA, format_checker=jsonschema.FormatChecker())
    json.dump(card, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("card.json 검증 통과 ·", a.out)

# ---------- run (전사 + API) ----------
def cmd_run(a):
    work = pathlib.Path(a.out); work.mkdir(parents=True, exist_ok=True)
    tr = work / "transcript.txt"
    subprocess.run([sys.executable, "-I", a.transcriber, a.audio, str(tr)], check=True)
    cmd_features(argparse.Namespace(transcript=str(tr), meta=a.meta, out=str(work), plan=a.plan))
    import anthropic
    client = anthropic.Anthropic()
    prompt = open(work / "prompt.md", encoding="utf-8").read()
    usage = {"model": os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5"), "calls": 0,
             "input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
    def save_usage():
        json.dump(usage, open(work / "usage.json", "w", encoding="utf-8"), indent=1)
    for attempt in range(3):
        # thinking 토큰도 max_tokens 안에서 쓰이므로 넉넉히 두고, 긴 응답의 시간 초과를 피하려 스트리밍으로 받는다.
        with client.beta.messages.stream(model=usage["model"], max_tokens=64000,
                                         betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                                         messages=[{"role": "user", "content": prompt}]) as stream:
            msg = stream.get_final_message()
        usage["calls"] += 1
        for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"):
            usage[k] += getattr(msg.usage, k, None) or 0
        save_usage()
        if msg.stop_reason == "refusal":
            sys.exit("분석 요청이 거절되었습니다.")
        if msg.stop_reason == "max_tokens":
            sys.exit(f"분석 결과가 max_tokens(64000)에서 잘렸습니다. 출력 {msg.usage.output_tokens}토큰.")
        txt = "".join(b.text for b in msg.content if b.type == "text")  # 앞에 thinking 블록이 올 수 있다
        try:
            an = json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
            json.dump(an, open(work / "analysis.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            return cmd_merge(argparse.Namespace(work=str(work), analysis=str(work / "analysis.json"), out=str(work / "card.json")))
        except (ValueError, jsonschema.ValidationError) as e:
            print("재시도:", e)
    sys.exit("분석 결과를 3번 시도했지만 올바른 JSON 이 나오지 않았습니다.")

if __name__ == "__main__":
    p = argparse.ArgumentParser(); sp = p.add_subparsers(dest="c", required=True)
    f = sp.add_parser("features"); f.add_argument("--transcript", required=True); f.add_argument("--meta", required=True); f.add_argument("--out", required=True); f.add_argument("--plan")
    m = sp.add_parser("merge"); m.add_argument("--work", required=True); m.add_argument("--analysis", required=True); m.add_argument("--out", required=True)
    r = sp.add_parser("run"); r.add_argument("--audio", required=True); r.add_argument("--meta", required=True); r.add_argument("--out", required=True); r.add_argument("--plan"); r.add_argument("--transcriber", default="scripts/transcribe_v2.py")
    a = p.parse_args()
    {"features": cmd_features, "merge": cmd_merge, "run": cmd_run}[a.c](a)
