"""文字起こしから、話し方とやり取りを数値にする（AI は使わない）。

- 話者を「先生」と「生徒」に分ける。生徒の名前は外に出さず、「生徒A」などに置き換える。
- 生徒の発言の本文は数えるのに使うだけで、結果には入れない（根拠の引用は先生の発言だけ）。
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from .vtt import ChatMessage, Cue


def normalize_name(value: str) -> str:
    return re.sub(r"[\s　]+", "", unicodedata.normalize("NFKC", value or "")).lower()


def _letters(index: int) -> str:
    """0→A, 25→Z, 26→AA"""
    text = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        text = chr(65 + rest) + text
    return text


@dataclass
class Turn:
    role: str  # teacher / student / unknown
    speaker: str
    start: float
    end: float
    chars: int
    cues: list[Cue] = field(default_factory=list)


def classify_speakers(cues: list[Cue], teacher_names: list[str] | None) -> tuple[dict[str, str], str]:
    """話者名 → teacher / student / unknown。登録の先生名に当てはまらなければ、いちばん長く話した人を先生とする。"""
    talk: dict[str, float] = {}
    for cue in cues:
        if cue.speaker:
            talk[cue.speaker] = talk.get(cue.speaker, 0.0) + max(0.0, cue.end - cue.start)
    names = [normalize_name(name) for name in (teacher_names or []) if normalize_name(name)]
    teachers = {
        speaker for speaker in talk
        if any(name in normalize_name(speaker) or normalize_name(speaker) in name for name in names if len(normalize_name(speaker)) >= 2)
    }
    method = "registered_name"
    if not teachers and talk:
        teachers = {max(talk, key=lambda speaker: talk[speaker])}
        method = "most_talk"
    roles = {speaker: ("teacher" if speaker in teachers else "student") for speaker in talk}
    return roles, method if talk else "no_speaker"


def build_turns(cues: list[Cue], roles: dict[str, str], gap: float) -> list[Turn]:
    """同じ人の続けての発言（間が gap 秒未満）を1回の発言にまとめる。"""
    turns: list[Turn] = []
    for cue in cues:
        role = roles.get(cue.speaker, "unknown") if cue.speaker else "unknown"
        last = turns[-1] if turns else None
        if last and last.speaker == cue.speaker and role == last.role and cue.start - last.end < gap:
            last.end = max(last.end, cue.end)
            last.chars += len(cue.text)
            last.cues.append(cue)
        else:
            turns.append(Turn(role=role, speaker=cue.speaker, start=cue.start, end=cue.end, chars=len(cue.text), cues=[cue]))
    return turns


def _overlap(start: float, end: float, bin_start: float, bin_end: float) -> float:
    return max(0.0, min(end, bin_end) - max(start, bin_start))


def analyze_transcript(
    cues: list[Cue],
    rules: dict[str, Any],
    teacher_names: list[str] | None = None,
    duration: float | None = None,
    chat: list[ChatMessage] | None = None,
) -> dict[str, Any]:
    bin_seconds = float(rules["bin_seconds"])
    roles, method = classify_speakers(cues, teacher_names)
    last_end = max((cue.end for cue in cues), default=0.0)
    total = max(duration or 0.0, last_end)
    bins = max(1, math.ceil(total / bin_seconds)) if total else 0

    # 生徒の仮名（はじめて話した順）
    aliases: dict[str, str] = {}
    for cue in cues:
        if roles.get(cue.speaker) == "student" and cue.speaker not in aliases:
            aliases[cue.speaker] = f"生徒{_letters(len(aliases))}"

    teacher_seconds = [0.0] * bins
    teacher_chars = [0.0] * bins
    student_seconds = [0.0] * bins
    student_turns = [0] * bins
    chats = [0] * bins
    for cue in cues:
        role = roles.get(cue.speaker, "unknown") if cue.speaker else "unknown"
        length = max(0.0, cue.end - cue.start)
        first = int(cue.start // bin_seconds)
        last = min(bins - 1, int(max(cue.start, cue.end - 1e-6) // bin_seconds))
        for index in range(max(0, first), last + 1):
            share = _overlap(cue.start, cue.end, index * bin_seconds, (index + 1) * bin_seconds)
            if role == "teacher":
                teacher_seconds[index] += share
                teacher_chars[index] += len(cue.text) * (share / length if length else 1.0)
            elif role == "student":
                student_seconds[index] += share

    turns = build_turns(cues, roles, gap=1.5)
    for turn in turns:
        if turn.role == "student" and 0 <= int(turn.start // bin_seconds) < bins:
            student_turns[int(turn.start // bin_seconds)] += 1

    teacher_speakers = {speaker for speaker, role in roles.items() if role == "teacher"}
    teacher_keys = {normalize_name(speaker) for speaker in teacher_speakers}
    chat_total = 0
    for message in chat or []:
        if normalize_name(message.sender) in teacher_keys:
            continue
        index = int(message.time // bin_seconds)
        if 0 <= index < bins:
            chats[index] += 1
            chat_total += 1

    # 問いかけと待ち時間（次にだれかが話し始めるまで）
    patterns = [re.compile(pattern) for pattern in rules["question_patterns"]]
    questions: list[dict[str, Any]] = []
    for index, cue in enumerate(cues):
        if roles.get(cue.speaker) != "teacher" or not any(pattern.search(cue.text) for pattern in patterns):
            continue
        following = next((other for other in cues[index + 1:] if other.start >= cue.end - 0.2), None)
        wait = max(0.0, following.start - cue.end) if following else None
        answered = bool(
            following and roles.get(following.speaker) == "student"
            and following.start - cue.end <= float(rules["answer_window_seconds"])
        )
        questions.append({"time": cue.start, "end": cue.end, "quote": cue.text[:120], "wait_seconds": None if wait is None else round(wait, 1), "student_answered": answered})

    # 先生が続けて話した区間（生徒の発言をはさまず、間が monologue_gap 秒未満）
    spans: list[list[float]] = []
    for cue in cues:
        role = roles.get(cue.speaker, "unknown") if cue.speaker else "unknown"
        if role != "teacher":
            if role == "student":
                spans.append([])  # 生徒が話したら区切る
            continue
        if spans and spans[-1] and cue.start - spans[-1][1] < float(rules["monologue_gap_seconds"]):
            spans[-1][1] = max(spans[-1][1], cue.end)
        else:
            spans.append([cue.start, cue.end])
    spans = [span for span in spans if span]
    longest = max(spans, key=lambda span: span[1] - span[0], default=None)

    # 沈黙（だれも話していない区間）
    silences: list[dict[str, float]] = []
    cursor = 0.0
    for cue in cues:
        if cue.start - cursor >= float(rules["silence_seconds"]):
            silences.append({"start": round(cursor, 1), "end": round(cue.start, 1), "seconds": round(cue.start - cursor, 1)})
        cursor = max(cursor, cue.end)

    teacher_total = sum(teacher_seconds)
    student_turn_list = [turn for turn in turns if turn.role == "student"]
    series = []
    for index in range(bins):
        series.append({
            "t_sec": int(index * bin_seconds),
            "teacher_talk_ratio": round(min(1.0, teacher_seconds[index] / bin_seconds), 3),
            "student_talk_ratio": round(min(1.0, student_seconds[index] / bin_seconds), 3),
            # 話す速さは、その10秒に2秒以上話したときだけ（短いと値がぶれる）
            "wpm": round(teacher_chars[index] / teacher_seconds[index] * 60) if teacher_seconds[index] >= 2 else None,
            "student_turns": student_turns[index],
            "chat_messages": chats[index],
        })

    teacher_cues = [
        {"time": cue.start, "end": cue.end, "text": cue.text}
        for cue in cues if roles.get(cue.speaker) == "teacher"
    ]
    return {
        "duration_sec": round(total, 1),
        "teacher_detection": method,
        "teacher_speaker_count": len(teacher_speakers),
        "student_aliases": sorted(aliases.values(), key=lambda alias: (len(alias), alias)),
        "summary": {
            "teacher_talk_ratio": round(teacher_total / total, 3) if total else None,
            "wpm": round(sum(teacher_chars) / teacher_total * 60) if teacher_total >= 10 else None,
            "questions": len(questions),
            "questions_answered": sum(1 for question in questions if question["student_answered"]),
            "median_wait_seconds": _median([question["wait_seconds"] for question in questions if question["wait_seconds"] is not None]),
            "student_turns": len(student_turn_list),
            "student_speakers": len(aliases),
            "chat_messages": chat_total,
            "longest_monologue": {"start": round(longest[0], 1), "end": round(longest[1], 1), "seconds": round(longest[1] - longest[0], 1)} if longest else None,
            "silence_count": len(silences),
        },
        "series": series,
        "questions": questions,
        "monologues": [
            {"start": round(span[0], 1), "end": round(span[1], 1), "seconds": round(span[1] - span[0], 1)}
            for span in spans if span[1] - span[0] >= float(rules["long_monologue_seconds"])
        ],
        "silences": silences,
        # 根拠の引用に使うのは先生の発言だけ（生徒の発言の本文は外に出さない）
        "teacher_cues": teacher_cues,
    }


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    return round(ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2, 1)
