"""先生の映像から、動きを数値にする（MediaPipe Tasks API）。

- フレームは fps（既定3）に間引く。映像の1コマも顔の画像も保存せず、10秒ごとの集計の数値だけを返す。
- 録画は「画面共有＋話している人」（shared_screen_with_speaker_view）を使う。画面共有中は先生が隅に小さく映るので、
  顔が小さいときは、その周りを切り出して拡大してから姿勢を見る。
- モデルは、日本語を含むパスでも読めるように、bytes にしてメモリから渡す（Windows の制限への対策）。
"""

from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision

# 姿勢の目印の番号（MediaPipe Pose）
L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST = 11, 12, 15, 16
# 顔の幅が画面のこの割合より小さければ、画面共有中の小さな映像とみなす
SMALL_FACE_RATIO = 0.12
ANALYSIS_WIDTH = 960


def _load(path: Path) -> bytes:
    return path.read_bytes()


def _face_landmarker(models: Path):
    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_buffer=_load(models / "face_landmarker.task")),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
        output_facial_transformation_matrixes=True,
        min_face_detection_confidence=0.4,
        min_face_presence_confidence=0.4,
    )
    return vision.FaceLandmarker.create_from_options(options)


def _pose_landmarker(models: Path):
    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_buffer=_load(models / "pose_landmarker_lite.task")),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.6,
        min_pose_presence_confidence=0.6,
    )
    return vision.PoseLandmarker.create_from_options(options)


def head_angles(matrix: np.ndarray) -> tuple[float, float]:
    """顔の変換行列から、左右（yaw）と上下（pitch）の向き（度）。正面を向いていれば 0, 0。"""
    forward = np.asarray(matrix, dtype=float)[:3, 2]
    norm = float(np.linalg.norm(forward)) or 1.0
    x, y, z = forward / norm
    yaw = math.degrees(math.atan2(x, z))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, y))))
    return yaw, pitch


def _image(frame_bgr: np.ndarray) -> mp.Image:
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))


def _pose_points(result, width: int, height: int, offset: tuple[int, int], scale: float):
    """肩と手首の位置（元の画面のピクセル）と見えているか。"""
    if not result.pose_landmarks:
        return None
    marks = result.pose_landmarks[0]
    points = {}
    for index in (L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST):
        mark = marks[index]
        points[index] = (
            offset[0] + mark.x * width / scale,
            offset[1] + mark.y * height / scale,
            float(getattr(mark, "visibility", 1.0) or 0.0),
        )
    # スライドの図や文字を人と取り違えないよう、鼻と両肩がはっきり見えるときだけ使う
    if points[L_SHOULDER][2] < 0.7 or points[R_SHOULDER][2] < 0.7 or float(getattr(marks[0], "visibility", 1.0) or 0.0) < 0.7:
        return None
    return points


def analyze_video(
    video_path: str,
    models_dir: str,
    rules: dict[str, Any],
    fps: float = 3.0,
    offset_seconds: float = 0.0,
    max_seconds: float | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    models = Path(models_dir)
    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise RuntimeError("video-open-failed")
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    bin_seconds = float(rules["bin_seconds"])
    gaze_limit = float(rules["gaze_degrees"])
    face_marker = _face_landmarker(models)
    pose_marker = _pose_landmarker(models)

    bins: dict[int, dict[str, float]] = {}
    previous: dict[str, Any] | None = None
    samples = 0
    next_time = 0.0
    frame_index = -1
    try:
        while True:
            if not capture.grab():
                break
            frame_index += 1
            at = frame_index / source_fps
            if max_seconds is not None and at > max_seconds:
                break
            if at + 1e-6 < next_time:
                continue
            next_time += 1.0 / fps
            ok, frame = capture.retrieve()
            if not ok:
                continue
            samples += 1
            height, width = frame.shape[:2]
            if width > ANALYSIS_WIDTH:
                ratio = ANALYSIS_WIDTH / width
                frame = cv2.resize(frame, (ANALYSIS_WIDTH, int(height * ratio)), interpolation=cv2.INTER_AREA)
                height, width = frame.shape[:2]

            face = face_marker.detect_for_video(_image(frame), int(at * 1000))
            face_box = None
            gaze = None
            if face.face_landmarks:
                xs = [mark.x for mark in face.face_landmarks[0]]
                ys = [mark.y for mark in face.face_landmarks[0]]
                face_box = (min(xs) * width, min(ys) * height, max(xs) * width, max(ys) * height)
                if face.facial_transformation_matrixes:
                    yaw, pitch = head_angles(face.facial_transformation_matrixes[0])
                    gaze = abs(yaw) <= gaze_limit and abs(pitch) <= gaze_limit

            # 顔が小さい（画面共有中の隅の映像）ときは、顔の周りを切り出して拡大してから姿勢を見る
            small = bool(face_box and (face_box[2] - face_box[0]) / width < SMALL_FACE_RATIO)
            region = frame
            offset = (0, 0)
            scale = 1.0
            if small and face_box:
                face_w = face_box[2] - face_box[0]
                face_h = face_box[3] - face_box[1]
                cx = (face_box[0] + face_box[2]) / 2
                x0 = int(max(0, cx - face_w * 3))
                x1 = int(min(width, cx + face_w * 3))
                y0 = int(max(0, face_box[1] - face_h * 1.0))
                y1 = int(min(height, face_box[3] + face_h * 4))
                region = frame[y0:y1, x0:x1]
                offset = (x0, y0)
                if region.size and region.shape[1] < 480:
                    scale = 480 / region.shape[1]
                    region = cv2.resize(region, None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
            pose = pose_marker.detect(_image(region)) if region.size else None
            points = _pose_points(pose, region.shape[1], region.shape[0], offset, scale) if pose else None

            movement = None
            gesture = False
            if points:
                shoulder_width = math.dist(points[L_SHOULDER][:2], points[R_SHOULDER][:2]) or 1.0
                chest_y = (points[L_SHOULDER][1] + points[R_SHOULDER][1]) / 2 + shoulder_width * 0.5
                if previous and previous["points"] and at - previous["at"] <= 2.5 / fps:
                    moves = []
                    for index in (L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST):
                        if points[index][2] >= 0.5 and previous["points"][index][2] >= 0.5:
                            moves.append(math.dist(points[index][:2], previous["points"][index][:2]) / shoulder_width)
                    if moves:
                        movement = sum(moves) / len(moves) / (at - previous["at"])
                    for index in (L_WRIST, R_WRIST):
                        wrist = points[index]
                        before = previous["points"][index]
                        if wrist[2] >= 0.5 and before[2] >= 0.5 and wrist[1] < chest_y and math.dist(wrist[:2], before[:2]) / shoulder_width > 0.05:
                            gesture = True
            previous = {"at": at, "points": points}

            key = int((at + offset_seconds) // bin_seconds)
            if key < 0:
                continue
            item = bins.setdefault(key, {"samples": 0, "present": 0, "gaze_n": 0, "gaze": 0, "pose": 0, "gesture": 0, "move_n": 0, "move": 0.0, "share_n": 0, "share": 0})
            item["samples"] += 1
            if face_box or points:
                item["present"] += 1
            if gaze is not None:
                item["gaze_n"] += 1
                item["gaze"] += int(gaze)
            if points:
                item["pose"] += 1
                item["gesture"] += int(gesture)
            if movement is not None:
                item["move_n"] += 1
                item["move"] += movement
            if face_box:
                item["share_n"] += 1
                item["share"] += int(small)
    finally:
        capture.release()
        face_marker.close()
        pose_marker.close()

    series = []
    for key in sorted(bins):
        item = bins[key]
        series.append({
            "t_sec": int(key * bin_seconds),
            "presence": round(item["present"] / item["samples"], 3) if item["samples"] else None,
            "gaze_camera": round(item["gaze"] / item["gaze_n"], 3) if item["gaze_n"] else None,
            "movement": round(item["move"] / item["move_n"], 3) if item["move_n"] else None,
            "gesture": round(item["gesture"] / item["pose"], 3) if item["pose"] else None,
            # 顔が小さく映っている割合が半分以上なら、画面共有中とみなす
            "screen_share": (1 if item["share"] / item["share_n"] >= 0.5 else 0) if item["share_n"] else None,
        })
    return {
        "source_fps": round(source_fps, 2),
        "frames": frame_count,
        "samples": samples,
        "elapsed_sec": round(time.monotonic() - started, 1),
        "series": series,
    }
