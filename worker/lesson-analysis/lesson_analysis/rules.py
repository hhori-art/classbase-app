"""判定の決まり（既定値）。管理画面の設定（JSON）で上書きできる。

AI は使わず、文字起こしの時刻・話者と、言葉の決まりだけで判定する。
"""

from __future__ import annotations

import copy
from typing import Any

DEFAULT_RULES: dict[str, Any] = {
    # 集計の幅（秒）
    "bin_seconds": 10,
    # 先生の問いかけとみなす言い方（正規表現。1つでも当てはまれば問いかけ）
    "question_patterns": [
        r"[？?]",
        r"(ですか|ますか|でしょうか|かな|のか)[。．]?\s*$",
        r"どう思う",
        r"(わか|分か)る人",
        r"(知って|しって)る人",
        r"どうして",
        r"なぜ",
        r"なんで",
        r"答えて",
        r"言ってみて",
        r"どうなる",
    ],
    # 待ち時間がこの秒数以上あれば「待てた」とみなす
    "wait_ok_seconds": 3,
    # 問いかけのあと、この秒数以内に生徒が話せば「生徒が答えた」とみなす
    "answer_window_seconds": 15,
    # 先生の発言どうしの間がこの秒数未満なら、続けて話しているとみなす
    "monologue_gap_seconds": 3,
    # この秒数以上、先生が続けて話したら「長い説明」として印を付ける
    "long_monologue_seconds": 180,
    # この秒数以上、だれも話していなければ「沈黙」として印を付ける
    "silence_seconds": 15,
    # 導入：授業のはじめに、ねらい・めあてを示す言い方
    "intro_patterns": [r"今日は", r"今日の", r"めあて", r"目標", r"ねらい", r"学習課題", r"やること", r"について(学|勉強|考え)"],
    "intro_good_seconds": 180,
    "intro_ok_seconds": 300,
    "intro_late_seconds": 600,
    # まとめ：授業の終わりに、まとめに入る言い方
    "summary_patterns": [r"まとめ", r"今日のポイント", r"振り返", r"ふりかえ", r"おさらい", r"今日やった", r"復習すると", r"大事なところ"],
    # 先生の話す速さ（1分あたりの文字数）のちょうどよい範囲
    "wpm_min": 220,
    "wpm_max": 380,
    # 先生の映像：カメラ目線とみなす顔の向き（度）
    "gaze_degrees": 20,
    # 発問：10分あたりの問いかけの回数の目安（レベル4・3・2）
    "questions_per_10min": [3, 2, 1],
    # 生徒の参加：10分あたりの生徒の発言＋チャットの目安（レベル4・3・2）
    "participation_per_10min": [5, 3, 1],
}

DEFAULT_RUBRIC: list[dict[str, str]] = [
    {"criterion": "導入", "description": "ねらいが明確に示されたか"},
    {"criterion": "発問", "description": "問いの頻度と待ち時間"},
    {"criterion": "生徒の参加", "description": "発言・チャットの量"},
    {"criterion": "説明の分かりやすさ", "description": "速さ、一方的な説明が長すぎないか"},
    {"criterion": "時間配分", "description": "まとめまで到達したか"},
]


def merge_rules(override: dict[str, Any] | None) -> dict[str, Any]:
    rules = copy.deepcopy(DEFAULT_RULES)
    for key, value in (override or {}).items():
        if key in rules and value is not None:
            rules[key] = value
    return rules
