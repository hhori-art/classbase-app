"""Zoom の文字起こし（WebVTT）とチャットのログを読む。発言は「話者名: 発言」の形。"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class Cue:
    start: float
    end: float
    speaker: str
    text: str


def _seconds(value: str) -> float:
    parts = value.strip().replace(",", ".").split(":")
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        return float("nan")
    seconds = 0.0
    for number in numbers:
        seconds = seconds * 60 + number
    return seconds


def parse_vtt(text: str) -> list[Cue]:
    cues: list[Cue] = []
    for block in re.split(r"\n\s*\n", text.replace("\r", "")):
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        timing = next((index for index, line in enumerate(lines) if "-->" in line), -1)
        if timing < 0:
            continue
        start_text, _, end_text = lines[timing].partition("-->")
        start = _seconds(start_text)
        end = _seconds(end_text.strip().split(" ")[0])
        body = " ".join(lines[timing + 1:])
        if not body or start != start:  # NaN
            continue
        match = re.match(r"^([^:：]{1,60})[:：]\s*(.*)$", body)
        cues.append(Cue(
            start=start,
            end=end if end == end and end >= start else start,
            speaker=match.group(1).strip() if match else "",
            text=(match.group(2) if match else body).strip(),
        ))
    cues.sort(key=lambda cue: cue.start)
    return cues


@dataclass
class ChatMessage:
    time: float
    sender: str


def parse_chat(text: str) -> list[ChatMessage]:
    """Zoom のチャットのログ（「00:12:34 From 名前 to Everyone:」や「00:12:34\t名前:\t本文」の形）。本文は読まない。"""
    messages: list[ChatMessage] = []
    for line in text.replace("\r", "").split("\n"):
        match = re.match(r"^(\d{1,2}:\d{2}:\d{2})\s+(?:From\s+)?(.+?)(?:\s+to\s+.+?)?\s*[:：]", line)
        if match:
            messages.append(ChatMessage(time=_seconds(match.group(1)), sender=match.group(2).strip()))
    return messages
