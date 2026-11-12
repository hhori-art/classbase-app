"""授業録画の分析（手元で動かす CLI）。

    python analyze.py --video x.mp4 --vtt x.vtt [--chat chat.txt] [--teacher-name 名前] [--out out]

出力（--out のフォルダ）：
    timeseries.csv  10秒ごとの数値（映像と文字起こし）
    events.json     問いかけ・長い説明・沈黙
    evaluation.json 観点ごとの振り返り（AI は使わず、決まりで作る）
    summary.json    授業全体の数値と、処理にかかった時間
映像は読むだけで、1コマも保存しない。--video を省くと文字起こしだけで分析する。
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

from lesson_analysis.evaluate import evaluate, events_from, merge_series
from lesson_analysis.rules import merge_rules
from lesson_analysis.transcript import analyze_transcript
from lesson_analysis.vtt import parse_chat, parse_vtt

HERE = Path(__file__).resolve().parent


def run(args: argparse.Namespace) -> dict:
    started = time.monotonic()
    rules = merge_rules(json.loads(Path(args.rules).read_text(encoding="utf-8")) if args.rules else None)
    cues = parse_vtt(Path(args.vtt).read_text(encoding="utf-8-sig")) if args.vtt else []
    chat = parse_chat(Path(args.chat).read_text(encoding="utf-8-sig")) if args.chat else []
    # Zoom のチャットの時刻はミーティングの開始から数えるので、録画の開始に合わせる
    for message in chat:
        message.time -= args.chat_offset
    video = None
    if args.video:
        from lesson_analysis.video import analyze_video  # MediaPipe は映像があるときだけ読み込む
        video = analyze_video(args.video, args.models, rules, fps=args.fps, offset_seconds=args.video_offset, max_seconds=args.max_seconds)
    duration = args.duration or (max((row["t_sec"] for row in video["series"]), default=0) + rules["bin_seconds"] if video else None)
    transcript = analyze_transcript(cues, rules, teacher_names=args.teacher_name, duration=duration, chat=chat)
    series = merge_series(transcript, video)
    evaluation = evaluate(transcript, series, rules)
    events = events_from(transcript)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with (out / "timeseries.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(series[0].keys()) if series else ["t_sec"])
        writer.writeheader()
        writer.writerows(series)
    (out / "events.json").write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "evaluation.json").write_text(json.dumps(evaluation, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "duration_sec": transcript["duration_sec"],
        "teacher_detection": transcript["teacher_detection"],
        "students": transcript["student_aliases"],
        **transcript["summary"],
        "video": None if not video else {key: video[key] for key in ("source_fps", "frames", "samples", "elapsed_sec")},
        "elapsed_sec": round(time.monotonic() - started, 1),
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="授業録画の分析（AI を使わない）")
    parser.add_argument("--video", help="先生が映っている録画（mp4）。省くと文字起こしだけで分析")
    parser.add_argument("--vtt", help="Zoom の文字起こし（WebVTT）")
    parser.add_argument("--chat", help="Zoom のチャットのログ（txt）")
    parser.add_argument("--teacher-name", action="append", default=[], help="先生の名前（Zoom の表示名と照らし合わせる。何度でも指定可）")
    parser.add_argument("--rules", help="判定の決まりを上書きする JSON")
    parser.add_argument("--models", default=str(HERE / "models"), help="MediaPipe のモデルのフォルダ")
    parser.add_argument("--fps", type=float, default=3.0, help="映像を間引く間隔（1秒あたりのコマ数、2〜5）")
    parser.add_argument("--video-offset", type=float, default=0.0, help="文字起こしの時刻に合わせるため映像に足す秒数")
    parser.add_argument("--chat-offset", type=float, default=0.0, help="チャットの時刻から引く秒数（ミーティングの開始から録画の開始まで）")
    parser.add_argument("--max-seconds", type=float, help="映像を先頭からこの秒数だけ読む（試し用）")
    parser.add_argument("--duration", type=float, help="授業の長さ（秒）")
    parser.add_argument("--out", default="out", help="出力のフォルダ")
    args = parser.parse_args(argv)
    if not args.video and not args.vtt:
        parser.error("--video か --vtt のどちらかが要ります")
    summary = run(args)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
