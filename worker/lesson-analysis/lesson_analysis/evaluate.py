"""映像と文字起こしの数値を時間でそろえ、決まりに沿って観点ごとの振り返りを作る（AI は使わない）。

出力の形は、AI で作る場合と同じ JSON に固定する（summary / scores / strengths / improvements / notable_moments）。
どのコメントにも、時刻つきの根拠を付ける。根拠が見つからない観点は、そう書く。
"""

from __future__ import annotations

import re
from typing import Any

from .rules import DEFAULT_RUBRIC


def clock(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def merge_series(transcript: dict[str, Any], video: dict[str, Any] | None) -> list[dict[str, Any]]:
    """10秒ごとの行に、文字起こしと映像の数値をまとめる。
    「画面共有＋話している人」の録画は、生徒が話すと生徒の映像に切り替わるので、
    生徒のほうが長く話していた10秒は、先生の映像の数値を入れない。
    """
    rows: dict[int, dict[str, Any]] = {}
    for item in transcript["series"]:
        rows[item["t_sec"]] = dict(item)
    for item in (video or {}).get("series", []):
        row = rows.setdefault(item["t_sec"], {"t_sec": item["t_sec"]})
        if row.get("student_talk_ratio", 0) > row.get("teacher_talk_ratio", 0):
            continue
        for key in ("presence", "gaze_camera", "movement", "gesture", "screen_share"):
            row[key] = item[key]
    keys = ["t_sec", "presence", "gaze_camera", "movement", "gesture", "screen_share", "teacher_talk_ratio", "student_talk_ratio", "wpm", "student_turns", "chat_messages"]
    return [{key: rows[t].get(key) for key in keys} for t in sorted(rows)]


def _first_match(cues: list[dict[str, Any]], patterns: list[str], start: float = 0, end: float = float("inf")):
    compiled = [re.compile(pattern) for pattern in patterns]
    for cue in cues:
        if start <= cue["time"] < end and any(pattern.search(cue["text"]) for pattern in compiled):
            return cue
    return None


def _level(value: float, thresholds: list[float]) -> int:
    for index, threshold in enumerate(thresholds):
        if value >= threshold:
            return 4 - index
    return 1


def _quote(text: str) -> str:
    return text if len(text) <= 60 else text[:60] + "…"


def evaluate(transcript: dict[str, Any], series: list[dict[str, Any]], rules: dict[str, Any], rubric: list[dict[str, str]] | None = None) -> dict[str, Any]:
    rubric = rubric or DEFAULT_RUBRIC
    summary = transcript["summary"]
    cues = transcript["teacher_cues"]
    duration = float(transcript["duration_sec"] or 0)
    minutes10 = max(duration / 600, 0.1)
    scores: list[dict[str, Any]] = []
    strengths: list[dict[str, str]] = []
    improvements: list[dict[str, str]] = []

    def add(criterion: str, level: int, comment: str, evidence: list[dict[str, str]], good: str | None, tip: tuple[str, str] | None, time: float | None):
        scores.append({"criterion": criterion, "level": level, "comment": comment, "evidence": evidence})
        if level >= 3 and good and time is not None:
            strengths.append({"text": good, "time": clock(time)})
        if level <= 2 and tip:
            improvements.append({"text": tip[0], "time": clock(time if time is not None else 0), "suggestion": tip[1]})

    # 導入
    intro = _first_match(cues, rules["intro_patterns"], 0, float(rules["intro_late_seconds"]))
    if intro:
        at = intro["time"]
        level = 4 if at <= rules["intro_good_seconds"] else 3 if at <= rules["intro_ok_seconds"] else 2
        add("導入", level, f"{clock(at)}に、ねらいを示す言葉がありました。", [{"time": clock(at), "quote": _quote(intro["text"])}],
            "授業のはじめに、今日のねらいを示しています。", ("ねらいを示すのが少し遅めでした。", "最初の3分以内に「今日は〜ができるようになる」と伝えてみてください。"), at)
    else:
        add("導入", 1, f"最初の{int(rules['intro_late_seconds']) // 60}分に、ねらいやめあてを示す言葉が見つかりませんでした。", [],
            None, ("ねらいを示す言葉が見つかりませんでした。", "授業のはじめに、今日のねらい・めあてを言葉で伝えてみてください。"), 0)

    # 発問
    questions = transcript["questions"]
    per10 = len(questions) / minutes10
    waited = [question for question in questions if question["wait_seconds"] is not None and question["wait_seconds"] >= rules["wait_ok_seconds"]]
    wait_share = len(waited) / len(questions) if questions else 0
    level = _level(per10, rules["questions_per_10min"])
    if level >= 3 and wait_share < 0.3:
        level -= 1
    short = sorted((question for question in questions if question["wait_seconds"] is not None), key=lambda question: question["wait_seconds"])[:2]
    picked = list({question["time"]: question for question in waited[:2] + short}.values())[:3]
    evidence = [{"time": clock(question["time"]), "quote": _quote(question["quote"])} for question in sorted(picked, key=lambda question: question["time"])]
    add("発問", level,
        f"問いかけは{len(questions)}回（10分あたり{per10:.1f}回）。{rules['wait_ok_seconds']}秒以上待てたのは{len(waited)}回（{round(wait_share * 100)}%）、"
        f"待ち時間の中央値は{summary['median_wait_seconds'] if summary['median_wait_seconds'] is not None else '—'}秒です。",
        evidence,
        "問いかけのあと、生徒が考える時間をとれています。" if waited else "問いかけを多く入れています。",
        ("問いかけのあとの待ち時間が短めです。" if questions else "問いかけがほとんどありませんでした。",
         "問いかけたら、心の中で3つ数えてから次に進んでみてください。" if questions else "説明の区切りごとに、生徒に1つ問いかけてみてください。"),
        (waited[0]["time"] if waited and level >= 3 else short[0]["time"] if short else questions[0]["time"] if questions else None))

    # 生徒の参加
    activity = summary["student_turns"] + summary["chat_messages"]
    per10 = activity / minutes10
    level = _level(per10, rules["participation_per_10min"])
    busiest = sorted(series, key=lambda row: (row.get("student_turns") or 0) + (row.get("chat_messages") or 0), reverse=True)
    busiest = [row for row in busiest if (row.get("student_turns") or 0) + (row.get("chat_messages") or 0) > 0][:3]
    def before_quote(t: float) -> str:
        # その10秒が始まる前の、先生の最後の発言（生徒が反応したきっかけ）
        previous = [cue for cue in cues if cue["time"] <= t]
        return _quote(previous[-1]["text"]) if previous else ""
    add("生徒の参加", level,
        f"生徒の発言は{summary['student_turns']}回（{summary['student_speakers']}人）、チャットは{summary['chat_messages']}件で、10分あたり{per10:.1f}回です。",
        [{"time": clock(row["t_sec"]), "quote": before_quote(row["t_sec"])} for row in busiest],
        "生徒が話したり書き込んだりする場面をつくれています。",
        ("生徒が話す・書き込む場面が少なめでした。", "チャットで答えを書いてもらう、指名して一言話してもらうなど、短い参加の場面を足してみてください。"),
        busiest[0]["t_sec"] if busiest else None)

    # 説明の分かりやすさ
    wpm = summary["wpm"]
    longest = summary["longest_monologue"]
    points = 1
    if wpm is not None and rules["wpm_min"] <= wpm <= rules["wpm_max"]:
        points += 1
    if longest and longest["seconds"] <= rules["long_monologue_seconds"] * 5 / 3:
        points += 1
    if longest and longest["seconds"] <= rules["long_monologue_seconds"]:
        points += 1
    longest_cue = _first_match(cues, [r"."], longest["start"], longest["end"] + 1) if longest else None
    speed = "—" if wpm is None else f"{wpm}字/分"
    add("説明の分かりやすさ", min(4, points),
        f"話す速さは{speed}（目安{rules['wpm_min']}〜{rules['wpm_max']}）。続けて話した最長は"
        + (f"{clock(longest['start'])}からの{round(longest['seconds'] / 60, 1)}分です。" if longest else "記録がありません。"),
        [{"time": clock(longest["start"]), "quote": _quote(longest_cue["text"])}] if longest and longest_cue else [],
        "説明を区切りながら進めています。",
        ("一方的な説明が長く続いた場面がありました。" if longest and longest["seconds"] > rules["long_monologue_seconds"] else "話す速さが目安から外れていました。",
         "3分を目安に区切り、問いかけや確認を1つはさんでみてください。" if longest and longest["seconds"] > rules["long_monologue_seconds"] else "大事なところは少しゆっくり話してみてください。"),
        longest["start"] if longest else None)

    # 時間配分
    tail = duration - 600
    wrap = _first_match(cues, rules["summary_patterns"], max(0, tail), float("inf"))
    if wrap:
        level = 4 if wrap["time"] <= duration - 120 else 3
        add("時間配分", level, f"{clock(wrap['time'])}に、まとめに入る言葉がありました。", [{"time": clock(wrap["time"]), "quote": _quote(wrap["text"])}],
            "終わりの時間までに、まとめに入れています。", ("まとめが終わりぎりぎりでした。", "終わりの5分前には、まとめに入ってみてください。"), wrap["time"])
    else:
        earlier = _first_match(cues, rules["summary_patterns"], max(0, duration - 1200), max(0, tail))
        add("時間配分", 2 if earlier else 1,
            "最後の10分に、まとめに入る言葉が見つかりませんでした。" + (f"{clock(earlier['time'])}にそれらしい言葉があります。" if earlier else ""),
            [{"time": clock(earlier["time"]), "quote": _quote(earlier["text"])}] if earlier else [],
            None, ("まとめの場面が見つかりませんでした。", "最後に「今日のポイントは〜」と、まとめを言葉にしてみてください。"), max(0, tail))

    # 観点の並びを、設定の順にそろえる（設定にない観点は出さない）
    order = [item["criterion"] for item in rubric]
    scores = [score for name in order for score in scores if score["criterion"] == name]

    moments: list[dict[str, str]] = []
    for silence in transcript["silences"][:3]:
        moments.append({"time": clock(silence["start"]), "description": f"{round(silence['seconds'])}秒、だれも話していない時間がありました（画面共有での作業などかもしれません）。"})
    for monologue in transcript["monologues"][:2]:
        moments.append({"time": clock(monologue["start"]), "description": f"先生が{round(monologue['seconds'] / 60, 1)}分続けて話しました。"})
    for row in busiest[:2]:
        moments.append({"time": clock(row["t_sec"]), "description": "生徒の発言・チャットが増えました。"})
    moments.sort(key=lambda moment: moment["time"])

    talk = summary["teacher_talk_ratio"]
    text = [
        f"{round(duration / 60)}分の授業で、先生が話していた割合は{round((talk or 0) * 100)}%でした。",
        f"問いかけは{summary['questions']}回、生徒の発言は{summary['student_turns']}回（{summary['student_speakers']}人）、チャットは{summary['chat_messages']}件です。",
    ]
    low = [score["criterion"] for score in scores if score["level"] <= 2]
    text.append(f"振り返りのポイントは「{'」「'.join(low[:2])}」です。" if low else "どの観点も目安に届いています。")
    return {
        "summary": "".join(text),
        "scores": scores,
        "strengths": strengths,
        "improvements": improvements,
        "notable_moments": moments,
    }


def events_from(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    """画面のグラフに印を付ける出来事（問いかけ・長い説明・沈黙）。"""
    events: list[dict[str, Any]] = []
    for question in transcript["questions"]:
        events.append({"t_sec": round(question["time"], 1), "type": "question", "detail": {"wait_seconds": question["wait_seconds"], "student_answered": question["student_answered"], "quote": question["quote"]}})
    for monologue in transcript["monologues"]:
        events.append({"t_sec": monologue["start"], "type": "long_monologue", "detail": {"seconds": monologue["seconds"]}})
    for silence in transcript["silences"]:
        events.append({"t_sec": silence["start"], "type": "silence", "detail": {"seconds": silence["seconds"]}})
    return sorted(events, key=lambda event: event["t_sec"])
