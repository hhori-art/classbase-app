"""文字起こしの分析と振り返りのテスト（MediaPipe は使わない）。

    .venv/bin/python -m unittest discover -s tests
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analyze import main  # noqa: E402
from lesson_analysis.evaluate import clock, evaluate, merge_series  # noqa: E402
from lesson_analysis.rules import DEFAULT_RULES, merge_rules  # noqa: E402
from lesson_analysis.transcript import analyze_transcript  # noqa: E402
from lesson_analysis.video import head_angles  # noqa: E402
from lesson_analysis.vtt import parse_chat, parse_vtt  # noqa: E402

SAMPLE = (ROOT / "tests" / "sample.vtt").read_text(encoding="utf-8")
STUDENT_NAMES = ["テスト生徒一郎", "テスト生徒二子"]


class TranscriptTest(unittest.TestCase):
    def setUp(self):
        self.cues = parse_vtt(SAMPLE)
        self.result = analyze_transcript(self.cues, DEFAULT_RULES, teacher_names=["山田先生"], duration=150)

    def test_parse(self):
        self.assertEqual(len(self.cues), 10)
        self.assertEqual(self.cues[0].speaker, "山田 先生")
        self.assertEqual(self.cues[2].start, 24.0)

    def test_teacher_and_students(self):
        self.assertEqual(self.result["teacher_detection"], "registered_name")
        summary = self.result["summary"]
        self.assertEqual(summary["student_turns"], 2)
        self.assertEqual(summary["student_speakers"], 2)
        self.assertEqual(self.result["student_aliases"], ["生徒A", "生徒B"])

    def test_questions_and_wait(self):
        questions = self.result["questions"]
        self.assertEqual(len(questions), 2)
        self.assertEqual(questions[0]["wait_seconds"], 4.0)
        self.assertTrue(questions[0]["student_answered"])
        self.assertEqual(questions[1]["wait_seconds"], 0.5)

    def test_monologue_and_silence(self):
        longest = self.result["summary"]["longest_monologue"]
        self.assertEqual((longest["start"], longest["end"]), (70.0, 140.0))
        self.assertEqual(self.result["silences"][0]["start"], 48.0)

    def test_series(self):
        series = self.result["series"]
        self.assertEqual(len(series), 15)
        self.assertEqual(series[2]["student_turns"], 1)  # 24秒の発言は20〜30秒の行
        self.assertGreater(series[0]["teacher_talk_ratio"], 0)

    def test_teacher_falls_back_to_most_talk(self):
        result = analyze_transcript(self.cues, DEFAULT_RULES, teacher_names=None)
        self.assertEqual(result["teacher_detection"], "most_talk")
        self.assertEqual(result["summary"]["student_speakers"], 2)


class EvaluationTest(unittest.TestCase):
    def test_shape_and_evidence(self):
        cues = parse_vtt(SAMPLE)
        transcript = analyze_transcript(cues, DEFAULT_RULES, teacher_names=["山田先生"], duration=150)
        evaluation = evaluate(transcript, merge_series(transcript, None), DEFAULT_RULES)
        self.assertEqual(set(evaluation), {"summary", "scores", "strengths", "improvements", "notable_moments"})
        self.assertEqual([score["criterion"] for score in evaluation["scores"]], ["導入", "発問", "生徒の参加", "説明の分かりやすさ", "時間配分"])
        for score in evaluation["scores"]:
            self.assertIn(score["level"], [1, 2, 3, 4])
        intro = evaluation["scores"][0]
        self.assertEqual(intro["level"], 4)
        self.assertEqual(intro["evidence"][0]["time"], "00:00:05")
        self.assertEqual(evaluation["scores"][4]["level"], 3)  # 終わり2分以内のまとめ
        question_times = [item["time"] for item in evaluation["scores"][1]["evidence"]]
        self.assertEqual(question_times, sorted(set(question_times)))
        self.assertEqual(evaluation["scores"][2]["evidence"][0]["quote"], "前回やったオームの法則、覚えている人はいますか？")

    def test_merge_masks_video_when_student_speaks(self):
        transcript = {"series": [{"t_sec": 0, "teacher_talk_ratio": 0.1, "student_talk_ratio": 0.6}, {"t_sec": 10, "teacher_talk_ratio": 0.9, "student_talk_ratio": 0}]}
        video = {"series": [{"t_sec": t, "presence": 1, "gaze_camera": 0.5, "movement": 0.1, "gesture": 0.2, "screen_share": 0} for t in (0, 10)]}
        rows = merge_series(transcript, video)
        self.assertIsNone(rows[0]["presence"])
        self.assertEqual(rows[1]["presence"], 1)


class MiscTest(unittest.TestCase):
    def test_clock(self):
        self.assertEqual(clock(3725), "01:02:05")

    def test_head_angles(self):
        identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
        yaw, pitch = head_angles(identity)
        self.assertAlmostEqual(yaw, 0)
        self.assertAlmostEqual(pitch, 0)

    def test_chat(self):
        messages = parse_chat("00:01:02 From テスト生徒一郎 to Everyone:\n\tこたえ\n00:02:00\t山田 先生:\tはい")
        self.assertEqual([round(message.time) for message in messages], [62, 120])

    def test_rules_override(self):
        self.assertEqual(merge_rules({"wait_ok_seconds": 5, "unknown": 1})["wait_ok_seconds"], 5)


class CliTest(unittest.TestCase):
    def test_outputs_without_student_names(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(main(["--vtt", str(ROOT / "tests" / "sample.vtt"), "--teacher-name", "山田先生", "--duration", "150", "--out", folder]), 0)
            for name in ("timeseries.csv", "events.json", "evaluation.json", "summary.json"):
                text = (Path(folder) / name).read_text(encoding="utf-8")
                for student in STUDENT_NAMES:
                    self.assertNotIn(student, text, f"{name} に生徒の名前が入っている")
                if name.endswith(".json"):
                    json.loads(text)


if __name__ == "__main__":
    unittest.main()
