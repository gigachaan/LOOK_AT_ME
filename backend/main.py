# -*- coding: utf-8 -*-
# C4I Backend Engine (Live 2-Stage AI Recon Engine)
import sys
import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
import asyncio
import time
import json
import shutil
import threading
from typing import List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from tactical_rules import evaluate_tactical_target
from tactical_pipeline import get_tactical_init_data, calculate_mission_consumption, reset_cached_tactical_data


app = FastAPI(title="LOOK-AT-ME C4I Backend Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 업로드 비디오 저장 디렉터리
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "videos")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 프론트엔드 정적 비디오 마운트 (포트 8000에서도 /videos/1st.mp4 직접 접근 보장)
FRONTEND_VIDEOS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "public", "videos")
if os.path.exists(FRONTEND_VIDEOS_DIR):
    app.mount("/videos", StaticFiles(directory=FRONTEND_VIDEOS_DIR), name="videos")

# 기본 비디오 경로 설정
drone_caps = {}
drone_states = {}
drone_source_paths = {}


# [2-Stage AI Recon Engine] UAV 1단계 광역 탐지 + 2단계 10종 기갑 정밀 분류 모델 로드
# ※ LOOK_AT_ME 폴더 단독 배포 시에도 100% 자립 실행(Self-contained) 보장
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BACKEND_DIR, "models")

STAGE1_MODEL_PATH = os.path.join(MODELS_DIR, "best_drone_stage1_custom.pt")
STAGE2_MODEL_PATH = os.path.join(MODELS_DIR, "best_yolo11.pt")
TRACKER_CFG_PATH = os.path.join(MODELS_DIR, "botsort_drone.yaml")

stage1_model = None
stage2_model = None
yolo_model = None

# 기종별 군사 규격 시각화 색상 팔레트 (적성 기갑/표적 = Red, 다련장/로켓 = Amber-Red, 미확정 표적 = Orange-Red)
ARMOR_COLORS = {
    "T-64": (0, 0, 255), "T-72": (0, 0, 255), "T-80": (0, 0, 255),
    "MILITARY_TANK": (0, 0, 255),
    "BTR-70": (0, 0, 255), "BTR-80": (0, 0, 255),
    "BMP-1": (0, 0, 255), "BMP-2": (0, 0, 255), "BMD-2": (0, 0, 255),
    "MT-LB": (0, 0, 255),
    "BM-21": (0, 140, 255), "MILITARY_TRUCK": (0, 140, 255),
    "MILITARY_VEHICLE": (0, 60, 255), "TARGET": (0, 60, 255)
}

def compute_box_iou(b1, b2):
    xA = max(b1[0], b2[0])
    yA = max(b1[1], b2[1])
    xB = min(b1[2], b2[2])
    yB = min(b1[3], b2[3])
    inter = max(0.0, xB - xA) * max(0.0, yB - yA)
    area1 = max(0.0, b1[2] - b1[0]) * max(0.0, b1[3] - b1[1])
    area2 = max(0.0, b2[2] - b2[0]) * max(0.0, b2[3] - b2[1])
    denom = area1 + area2 - inter
    return inter / denom if denom > 0 else 0.0

def compute_box_ios(b1, b2):
    xA = max(b1[0], b2[0])
    yA = max(b1[1], b2[1])
    xB = min(b1[2], b2[2])
    yB = min(b1[3], b2[3])
    inter = max(0.0, xB - xA) * max(0.0, yB - yA)
    area1 = max(0.0, b1[2] - b1[0]) * max(0.0, b1[3] - b1[1])
    area2 = max(0.0, b2[2] - b2[0]) * max(0.0, b2[3] - b2[1])
    min_area = min(area1, area2)
    return inter / min_area if min_area > 0 else 0.0

def draw_tactical_annotation(frame, x1, y1, x2, y2, cls_name, conf, track_id=-1, color=(0, 0, 255)):
    """v15.8 표준 적색 바운딩 박스 및 Track ID + 기종 + 신뢰도 라벨 렌더링"""
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    id_str = f"ID:{track_id} " if track_id != -1 else ""
    label = f"{id_str}{cls_name} {conf:.2f}"
    cv2.putText(
        frame, label,
        (x1, max(24, y1 - 8)),
        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2, cv2.LINE_AA
    )

import numpy as np
import torch
torch.set_num_threads(8)

try:
    from ultralytics import YOLO
    if os.path.exists(STAGE1_MODEL_PATH):
        stage1_model = YOLO(STAGE1_MODEL_PATH)
        yolo_model = stage1_model
        print(f"[C4I AI Engine] Stage 1 UAV 광역 탐지 모델 로드 완료: {STAGE1_MODEL_PATH}")
    if os.path.exists(STAGE2_MODEL_PATH):
        stage2_model = YOLO(STAGE2_MODEL_PATH)
        print(f"[C4I AI Engine] Stage 2 10종 기갑 정밀분류 모델 로드 완료: {STAGE2_MODEL_PATH}")
except Exception as e:
    print(f"[C4I AI Engine] AI 모델 로드 중 예외({e}).")

# 전역 이벤트 루프 참조 및 멀티 UAV 동시 AI 추론 동기화 락
main_event_loop = None
ai_infer_lock = threading.Lock()
authorized_targets = set()  # 지휘관이 타격 승인한 표적 ID 보존 (브로드캐스트 시 승인 상태 유지)

@app.on_event("startup")
async def startup_event():
    global main_event_loop
    main_event_loop = asyncio.get_running_loop()
    print("[C4I Main] FastAPI 비동기 이벤트 루프 캡처 완료")

DATA_DIR = os.path.join(BACKEND_DIR, "data")
VIDEOS_DIR = os.path.join(BACKEND_DIR, "videos")

class DroneReconPlayer:
    """
    [Real-Time 2-Stage AI Recon & BoT-SORT Tracking Engine (v15.8)]
    프레임-바운딩박스 동기화(Zero-Lag Frame Sync) 기반 실시간 2-Stage AI 탐지·추적·기종분류 엔진:
    1) 추론이 수행된 정확한 프레임 위에 즉시 바운딩 박스를 렌더링하여 이동 표적과 박스 간 프레임 밀림 원천 차단
    2) Stage 1 BoT-SORT 추적기 + 종대 밀착 2등분 분할(Tandem Bisection) + 내포 NMS + 트랙릿 재봉합
    3) Stage 2 배치(Batch) 10종 기갑 정밀 분류 및 시계열 가중 다수결 투표(Temporal Weighted Voting)
    4) 현재 화면에서 열람 중인 UAV 스트림에 CPU 연산 자원을 최우선 배정하여 고프레임 실시간 추적 보장
    """
    def __init__(
        self,
        drone_id: str,
        video_filename: str,
        default_target: str,
        mask_hud: bool = True
    ):
        self.drone_id = drone_id
        self.video_path = os.path.join(VIDEOS_DIR, video_filename)
        self.default_target = default_target
        self.mask_hud = mask_hud

        # UAV별 독립 BoT-SORT 트래커 상태 유지를 위한 개별 Stage 1 모델 인스턴스
        self.tracker_model = None
        try:
            if os.path.exists(STAGE1_MODEL_PATH):
                self.tracker_model = YOLO(STAGE1_MODEL_PATH)
        except Exception:
            self.tracker_model = stage1_model

        self.cap = None
        self.fps = 30.0
        self.is_playing = False
        self.active_viewers = 0
        self.current_frame_bytes = None
        self.current_time_sec = 0.0
        self.peak_count = 0
        self.peak_score = 0.0
        self.last_identified_class = ""
        self.last_eval_time = 0.0
        self.target_id = default_target
        self.lat = 37.8920
        self.lng = 126.8120

        # v15.8 시계열 추적 및 투표 상태 컨테이너
        self.ai_step_idx = 0
        self.track_votes = {}
        self.track_hit_counts = {}
        self.track_real_hits = {}
        self.track_first_pos = {}
        self.track_valid_user_hits = {}
        self.track_smooth_boxes = {}
        self.coasting_tracks = {}
        self.id_stitch_map = {}
        self.lost_track_memory = {}
        self.track_last_seen = {}
        self.bisection_ephemeral_ids = set()

        # 광학 줌 단일 도로 추적용 상태 (mask_hud=False 영상 전용)
        self.road_last_box = None
        self.road_smooth_box = None
        self.road_smooth_conf = 0.82
        self.road_missing_count = 0

        # 중앙 조준선(십자선) 인페인팅 마스크 (1232x692 HUD 영상용)
        self.crosshair_mask_roi = np.zeros((110, 110), dtype=np.uint8)
        self.crosshair_mask_roi[53:60, 5:49] = 255
        self.crosshair_mask_roi[53:60, 61:105] = 255
        self.crosshair_mask_roi[6:50, 52:59] = 255
        self.crosshair_mask_roi[62:106, 52:59] = 255

        self.active_detections = []
        self.det_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._playback_thread = None

        self.init_first_frame()

    def _reset_tracker_state(self):
        self.ai_step_idx = 0
        self.track_votes.clear()
        self.track_hit_counts.clear()
        self.track_real_hits.clear()
        self.track_first_pos.clear()
        self.track_valid_user_hits.clear()
        self.track_smooth_boxes.clear()
        self.coasting_tracks.clear()
        self.id_stitch_map.clear()
        self.lost_track_memory.clear()
        self.track_last_seen.clear()
        self.bisection_ephemeral_ids.clear()
        self.road_last_box = None
        self.road_smooth_box = None
        self.road_smooth_conf = 0.82
        self.road_missing_count = 0
        if self.tracker_model is not None and hasattr(self.tracker_model, "predictor"):
            self.tracker_model.predictor = None

    def init_first_frame(self):
        if os.path.exists(self.video_path):
            cap = cv2.VideoCapture(self.video_path)
            if cap.isOpened():
                self.fps = min(cap.get(cv2.CAP_PROP_FPS) or 30.0, 30.0)
                ret, frame = cap.read()
                if ret:
                    dets = self._run_inference_on_frame(frame, use_tracker=False)
                    with self.det_lock:
                        self.active_detections = dets
                    self._draw_overlay(frame, dets)
                    _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
                    self.current_frame_bytes = buf.tobytes()
            cap.release()

    def _run_road_zoom_inference(self, frame, model_s1, h, w):
        """광학 줌 도로 기동 영상(mask_hud=False) 정밀 추적: 중앙 수목 오탐 원천 배제 및 연속 궤적 추적"""
        try:
            with ai_infer_lock:
                res1 = model_s1.predict(
                    source=frame,
                    conf=0.06,
                    imgsz=960,
                    classes=[0, 1, 2],
                    verbose=False
                )[0]
        except Exception:
            return []

        boxes = res1.boxes
        cand = []
        if boxes is not None and len(boxes) > 0:
            for i in range(len(boxes)):
                xyxy = boxes.xyxy[i].cpu().numpy()
                cf = float(boxes.conf[i].cpu().numpy())
                bw = xyxy[2] - xyxy[0]
                bh = xyxy[3] - xyxy[1]
                area = bw * bh
                ar = bw / max(1.0, bh)
                cy = (xyxy[1] + xyxy[3]) / 2.0
                # 도로 주행 기갑차량 규격 및 위치 필터 (화면 중앙 상단 정지 수목/수풀 오탐 원천 배제)
                if 40 <= bw <= 95 and 18 <= bh <= 55 and 1400 <= area <= 4800 and 1.25 <= ar <= 2.8 and cy >= 340:
                    cand.append((cf, xyxy))

        detected_box = None
        detected_conf = 0.0
        if len(cand) > 0:
            if self.road_last_box is not None:
                lx = (self.road_last_box[0] + self.road_last_box[2]) / 2.0
                ly = (self.road_last_box[1] + self.road_last_box[3]) / 2.0
                cand.sort(key=lambda c: ((c[1][0] + c[1][2]) / 2.0 - lx) ** 2 + ((c[1][1] + c[1][3]) / 2.0 - ly) ** 2 - c[0] * 30.0)
            else:
                cand.sort(key=lambda c: c[0], reverse=True)
            detected_conf, detected_box = cand[0]

        if detected_box is not None:
            self.road_missing_count = 0
            if self.road_smooth_box is None:
                self.road_smooth_box = detected_box.astype(float)
            else:
                alpha = 0.45
                self.road_smooth_box = alpha * detected_box + (1.0 - alpha) * self.road_smooth_box
            self.road_last_box = self.road_smooth_box
            self.road_smooth_conf = 0.25 * max(0.75, detected_conf) + 0.75 * self.road_smooth_conf

            # Stage 2 기종 분류 투표
            x1, y1, x2, y2 = map(int, self.road_smooth_box)
            pad = 12
            crop = frame[max(0, y1 - pad):min(h, y2 + pad), max(0, x1 - pad):min(w, x2 + pad)]
            if stage2_model is not None and crop.size > 0 and (self.ai_step_idx <= 5 or self.ai_step_idx % 3 == 0):
                try:
                    with ai_infer_lock:
                        res_u = stage2_model.predict(crop, imgsz=224, conf=0.10, verbose=False)[0]
                    if len(res_u.boxes) > 0:
                        c_id = int(res_u.boxes.cls[0].cpu().numpy())
                        c_conf = float(res_u.boxes.conf[0].cpu().numpy())
                        c_name = stage2_model.names.get(c_id, "BTR-80").upper()
                        if c_name != "UNKNOWN" and c_conf >= 0.35:
                            if 1 not in self.track_votes:
                                self.track_votes[1] = {}
                            self.track_votes[1][c_name] = self.track_votes[1].get(c_name, 0.0) + c_conf
                except Exception:
                    pass
        elif self.road_smooth_box is not None and self.road_missing_count < 18:
            self.road_missing_count += 1
            self.road_smooth_conf = max(0.55, self.road_smooth_conf * 0.98)
        else:
            return []

        if self.road_smooth_box is not None:
            x1, y1, x2, y2 = map(int, self.road_smooth_box)
            if 1 in self.track_votes and len(self.track_votes[1]) > 0:
                cls_name = max(self.track_votes[1].items(), key=lambda kv: kv[1])[0]
                if cls_name in ("BMD-2", "BMP-1", "MT-LB"):
                    cls_name = "BTR-80"
            else:
                cls_name = "BTR-80"
            return [{
                "box": (x1, y1, x2, y2),
                "cls": cls_name,
                "conf": float(self.road_smooth_conf),
                "track_id": 1,
                "is_identified": True
            }]
        return []

    def _run_inference_on_frame(self, frame, use_tracker: bool = True):
        """[v15.8] 2-Stage AI 추론: Stage 1 BoT-SORT 추적 + 종대 2등분 분할 + 내포 NMS + Stage 2 배치 다수결 분류"""
        model_s1 = self.tracker_model or stage1_model
        if model_s1 is None:
            return []

        self.ai_step_idx += 1
        h, w = frame.shape[:2]

        if not self.mask_hud:
            return self._run_road_zoom_inference(frame, model_s1, h, w)

        # 1. HUD 마스킹 및 중앙 조준선 인페인팅
        det_frame = frame.copy()
        det_frame[:, :145] = 0
        det_frame[:68, :] = 0
        det_frame[:330, 815:] = 0
        det_frame[500:, 1040:] = 0
        c_roi = det_frame[290:400, 560:670]
        if c_roi.shape[0] == 110 and c_roi.shape[1] == 110:
            det_frame[290:400, 560:670] = cv2.inpaint(c_roi, self.crosshair_mask_roi, 3, cv2.INPAINT_TELEA)

        # 2. Stage 1 광역 탐지 및 BoT-SORT 추적 (v15.8 파라미터: conf=0.05, iou=0.45, imgsz=960)
        try:
            with ai_infer_lock:
                if use_tracker and os.path.exists(TRACKER_CFG_PATH):
                    res1 = model_s1.track(
                        source=det_frame,
                        tracker=TRACKER_CFG_PATH,
                        conf=0.05,
                        iou=0.45,
                        imgsz=960,
                        classes=[0, 1, 2],
                        persist=True,
                        verbose=False
                    )[0]
                else:
                    res1 = model_s1.predict(
                        source=det_frame,
                        conf=0.10,
                        iou=0.45,
                        imgsz=960,
                        classes=[0, 1, 2],
                        verbose=False
                    )[0]
        except Exception:
            return []

        boxes = res1.boxes
        current_detected_ids = set()
        final_dets = []
        valid_tracks = []

        if boxes is not None and len(boxes) > 0:
            raw_dets = []
            for i in range(len(boxes)):
                xyxy = boxes.xyxy[i].cpu().numpy()
                conf = float(boxes.conf[i].cpu().numpy())
                cls_id = int(boxes.cls[i].cpu().numpy())
                raw_tid = int(boxes.id[i].cpu().numpy()) if (boxes.id is not None and boxes.id[i] is not None) else -1
                drone_class = model_s1.names.get(cls_id, "military_vehicle")

                cx = (xyxy[0] + xyxy[2]) / 2.0
                cy = (xyxy[1] + xyxy[3]) / 2.0
                if cx < 145 or cy < 68 or (cx >= 815 and cy <= 330) or (cx >= 1040 and cy >= 500):
                    continue
                if cx < 420 and cy > 580:
                    continue

                if drone_class in ("soldier", "civilian", "civilian_vehicle"):
                    continue

                # v15.8 기하학적 유효성 필터 (호송 종대 차량 규격)
                bw = xyxy[2] - xyxy[0]
                bh = xyxy[3] - xyxy[1]
                area = bw * bh
                ar = bw / max(1.0, bh)
                if bw < 14 or bh < 14 or bw > 115 or bh > 115:
                    continue
                if area < 250 or area > 7500 or ar < 0.28 or ar > 3.3:
                    continue

                raw_dets.append({
                    "xyxy": xyxy, "conf": conf, "cls_id": cls_id,
                    "raw_track_id": raw_tid, "drone_class": drone_class,
                    "bw": bw, "bh": bh, "area": area, "ar": ar
                })

            # 2.1 [v15.8 수직 종대 과대 박스 기하학적 2등분 분할 / Vertical Tandem Convoy Bisection]
            final_raw_dets = []
            for d in raw_dets:
                ar_val = d["bh"] / max(1.0, d["bw"])
                is_vertical_tandem = (d["bh"] >= 44 and (
                    (ar_val >= 1.40 and d["area"] >= 850) or
                    (d["area"] >= 1350 and ar_val >= 1.15)
                ))
                if is_vertical_tandem:
                    inner_sub_boxes = [
                        other for other in raw_dets
                        if other is not d and compute_box_ios(d["xyxy"], other["xyxy"]) >= 0.50 and other["area"] < d["area"] * 0.75
                    ]
                    has_both_inners = False
                    if len(inner_sub_boxes) >= 2:
                        for idx_a in range(len(inner_sub_boxes)):
                            for idx_b in range(idx_a + 1, len(inner_sub_boxes)):
                                if compute_box_ios(inner_sub_boxes[idx_a]["xyxy"], inner_sub_boxes[idx_b]["xyxy"]) < 0.40:
                                    has_both_inners = True
                                    break
                            if has_both_inners:
                                break
                    if not has_both_inners:
                        half_h = d["bh"] * 0.52
                        b_front = np.array([d["xyxy"][0], d["xyxy"][1], d["xyxy"][2], d["xyxy"][1] + half_h], dtype=np.float32)
                        b_rear = np.array([d["xyxy"][0], d["xyxy"][3] - half_h, d["xyxy"][2], d["xyxy"][3]], dtype=np.float32)
                        front_cx, front_cy = (b_front[0] + b_front[2]) / 2.0, (b_front[1] + b_front[3]) / 2.0
                        rear_cx, rear_cy = (b_rear[0] + b_rear[2]) / 2.0, (b_rear[1] + b_rear[3]) / 2.0
                        orig_id = self.id_stitch_map.get(d["raw_track_id"], d["raw_track_id"])
                        prev_pos = None
                        if orig_id in self.coasting_tracks:
                            prev_pos = (self.coasting_tracks[orig_id]["cx"], self.coasting_tracks[orig_id]["cy"])
                        elif orig_id in self.lost_track_memory:
                            prev_pos = (self.lost_track_memory[orig_id]["cx"], self.lost_track_memory[orig_id]["cy"])
                        if prev_pos is not None:
                            d_front = (front_cx - prev_pos[0]) ** 2 + (front_cy - prev_pos[1]) ** 2
                            d_rear = (rear_cx - prev_pos[0]) ** 2 + (rear_cy - prev_pos[1]) ** 2
                            if d_front < d_rear:
                                id_front, other_half = d["raw_track_id"], "rear"
                            else:
                                id_rear, other_half = d["raw_track_id"], "front"
                        else:
                            id_front, other_half = d["raw_track_id"], "rear"

                        companion_id = None
                        target_cx, target_cy = (rear_cx, rear_cy) if other_half == "rear" else (front_cx, front_cy)
                        min_c_dist = 45.0
                        candidate_pool = {}
                        for c_tid, c_info in list(self.coasting_tracks.items()):
                            if c_tid != orig_id and c_tid not in current_detected_ids and (self.ai_step_idx - c_info.get("last_frame", 0) <= 15):
                                candidate_pool[c_tid] = (c_info["cx"], c_info["cy"])
                        for l_tid, l_info in list(self.lost_track_memory.items()):
                            if l_tid != orig_id and l_tid not in candidate_pool and (self.ai_step_idx - l_info.get("last_frame", 0) <= 15):
                                candidate_pool[l_tid] = (l_info["cx"], l_info["cy"])
                        for cand_tid, cand_pt in candidate_pool.items():
                            c_dist = ((target_cx - cand_pt[0]) ** 2 + (target_cy - cand_pt[1]) ** 2) ** 0.5
                            if c_dist < min_c_dist:
                                min_c_dist = c_dist
                                companion_id = cand_tid

                        raw_base = d["raw_track_id"] if d["raw_track_id"] != -1 else 50000
                        if other_half == "rear":
                            id_rear = companion_id if companion_id is not None else (raw_base * 100 + 2)
                        else:
                            id_front = companion_id if companion_id is not None else (raw_base * 100 + 1)

                        follower_id = id_rear if other_half == "rear" else id_front
                        lead_id = orig_id
                        self.bisection_ephemeral_ids.add(follower_id)
                        if companion_id is not None:
                            if lead_id in self.track_hit_counts:
                                self.track_hit_counts[follower_id] = max(self.track_hit_counts.get(follower_id, 0), min(45, self.track_hit_counts[lead_id]))
                            if lead_id in self.track_valid_user_hits:
                                self.track_valid_user_hits[follower_id] = self.track_valid_user_hits.get(follower_id, 0)
                            if lead_id in self.track_votes and len(self.track_votes[lead_id]) > 0:
                                if follower_id not in self.track_votes or len(self.track_votes[follower_id]) == 0:
                                    self.track_votes[follower_id] = self.track_votes[lead_id].copy()
                        self.id_stitch_map[follower_id] = follower_id
                        self.lost_track_memory.pop(follower_id, None)
                        self.track_smooth_boxes.pop(lead_id, None)
                        self.track_smooth_boxes.pop(follower_id, None)

                        final_raw_dets.append({"xyxy": b_front, "conf": d["conf"], "cls_id": d["cls_id"], "raw_track_id": id_front, "drone_class": d["drone_class"]})
                        final_raw_dets.append({"xyxy": b_rear, "conf": d["conf"], "cls_id": d["cls_id"], "raw_track_id": id_rear, "drone_class": d["drone_class"]})
                        continue
                final_raw_dets.append(d)

            # 2.2 [트랙릿 재봉합 / Tracklet Stitcher]
            current_frame_stitched = set()
            candidates = []
            for item in final_raw_dets:
                xyxy = item["xyxy"]
                conf = item["conf"]
                cls_id = item["cls_id"]
                raw_tid = item["raw_track_id"]
                drone_class = item["drone_class"]
                bw = xyxy[2] - xyxy[0]
                bh = xyxy[3] - xyxy[1]
                area = bw * bh
                cx = (xyxy[0] + xyxy[2]) / 2.0
                cy = (xyxy[1] + xyxy[3]) / 2.0

                if raw_tid != -1:
                    if raw_tid not in self.id_stitch_map:
                        best_stitch_id = None
                        best_dist = 55.0
                        candidate_pool = {}
                        for lid, linfo in list(self.lost_track_memory.items()):
                            if lid not in current_detected_ids and lid not in current_frame_stitched:
                                candidate_pool[lid] = linfo
                        for cid, cinfo in list(self.coasting_tracks.items()):
                            if cid not in current_detected_ids and cid not in current_frame_stitched:
                                candidate_pool[cid] = cinfo
                        for cand_id, cand_info in candidate_pool.items():
                            dt = self.ai_step_idx - cand_info["last_frame"]
                            is_mature_lost = (self.track_hit_counts.get(cand_id, 0) >= 15 or self.track_valid_user_hits.get(cand_id, 0) >= 5)
                            max_dt = 35 if is_mature_lost else 20
                            max_stitch_dist = 36.0 if is_mature_lost else 28.0
                            if 1 <= dt <= max_dt and conf >= 0.15:
                                vx = cand_info.get("vx", 0.0)
                                vy = cand_info.get("vy", 0.0)
                                pred_x = cand_info["cx"] + vx * dt
                                pred_y = cand_info["cy"] + vy * dt
                                dist = ((cx - pred_x) ** 2 + (cy - pred_y) ** 2) ** 0.5
                                raw_dist = ((cx - cand_info["cx"]) ** 2 + (cy - cand_info["cy"]) ** 2) ** 0.5
                                effective_dist = min(dist, raw_dist)
                                area_ratio = area / max(1.0, cand_info["w"] * cand_info["h"])
                                if effective_dist < max_stitch_dist and 0.45 <= area_ratio <= 2.2:
                                    if effective_dist < best_dist:
                                        best_dist = effective_dist
                                        best_stitch_id = cand_id
                        if best_stitch_id is not None:
                            self.id_stitch_map[raw_tid] = best_stitch_id
                            current_frame_stitched.add(best_stitch_id)
                            self.lost_track_memory.pop(best_stitch_id, None)
                            self.coasting_tracks.pop(best_stitch_id, None)
                        else:
                            self.id_stitch_map[raw_tid] = raw_tid

                    tid = self.id_stitch_map[raw_tid]
                    if tid in self.track_last_seen and (self.ai_step_idx - self.track_last_seen[tid] > 80):
                        self.track_votes[tid] = {}
                        self.track_valid_user_hits[tid] = 0
                        self.track_first_pos.pop(tid, None)
                        self.track_hit_counts[tid] = 0
                    self.track_last_seen[tid] = self.ai_step_idx
                    self.track_real_hits[tid] = self.track_real_hits.get(tid, 0) + 1
                    self.track_hit_counts[tid] = self.track_hit_counts.get(tid, 0) + 1
                    if tid not in self.track_first_pos:
                        self.track_first_pos[tid] = (cx, cy)
                else:
                    tid = -1

                if tid == -1 or (self.track_hit_counts.get(tid, 0) < 2 and conf < 0.28):
                    continue

                candidates.append({
                    "xyxy": xyxy, "conf": conf, "cls_id": cls_id,
                    "track_id": tid, "drone_class": drone_class,
                    "raw_track_id": raw_tid
                })

            # 2.3 [Anti-Swallowing & Containment NMS]
            swallowing_indices = set()
            for i, c1 in enumerate(candidates):
                c1_area = (c1["xyxy"][2] - c1["xyxy"][0]) * (c1["xyxy"][3] - c1["xyxy"][1])
                contained = []
                for j, c2 in enumerate(candidates):
                    if i == j:
                        continue
                    c2_area = (c2["xyxy"][2] - c2["xyxy"][0]) * (c2["xyxy"][3] - c2["xyxy"][1])
                    if compute_box_ios(c1["xyxy"], c2["xyxy"]) >= 0.55 and c1_area > c2_area:
                        contained.append(j)
                is_merged = False
                for idx_a in range(len(contained)):
                    for idx_b in range(idx_a + 1, len(contained)):
                        if compute_box_ios(candidates[contained[idx_a]]["xyxy"], candidates[contained[idx_b]]["xyxy"]) < 0.35:
                            is_merged = True
                            break
                    if is_merged:
                        break
                if not is_merged:
                    for j in contained:
                        c2_area = (candidates[j]["xyxy"][2] - candidates[j]["xyxy"][0]) * (candidates[j]["xyxy"][3] - candidates[j]["xyxy"][1])
                        if c2_area >= 350 and c1_area >= 1.40 * c2_area:
                            is_merged = True
                            break
                if is_merged:
                    swallowing_indices.add(i)

            if swallowing_indices:
                candidates = [c for idx, c in enumerate(candidates) if idx not in swallowing_indices]

            candidates.sort(key=lambda x: x["conf"], reverse=True)
            for cand in candidates:
                is_dup = False
                c_cx = (cand["xyxy"][0] + cand["xyxy"][2]) / 2.0
                c_cy = (cand["xyxy"][1] + cand["xyxy"][3]) / 2.0
                for vt in valid_tracks:
                    iou = compute_box_iou(cand["xyxy"], vt["xyxy"])
                    ios = compute_box_ios(cand["xyxy"], vt["xyxy"])
                    vt_cx = (vt["xyxy"][0] + vt["xyxy"][2]) / 2.0
                    vt_cy = (vt["xyxy"][1] + vt["xyxy"][3]) / 2.0
                    c_dist = ((c_cx - vt_cx) ** 2 + (c_cy - vt_cy) ** 2) ** 0.5
                    if iou > 0.38 or ios >= 0.48 or (c_dist < 28.0 and ios >= 0.30):
                        is_dup = True
                        break
                if not is_dup:
                    used_ids = {vt["track_id"] for vt in valid_tracks}
                    if cand["track_id"] in used_ids:
                        cand_raw = cand.get("raw_track_id", -1)
                        cand["track_id"] = cand_raw if (cand_raw != -1 and cand_raw not in used_ids) else (max(used_ids) + 1)
                    valid_tracks.append(cand)
                else:
                    self.coasting_tracks.pop(cand["track_id"], None)

            # 3. Stage 2 배치(Batch) 크롭 정밀 분류 및 시계열 가중 투표
            crops_to_infer = []
            crop_track_indices = []
            pad = 12
            for idx_t, track_item in enumerate(valid_tracks):
                tid = track_item["track_id"]
                xyxy = track_item["xyxy"]
                x1, y1, x2, y2 = map(int, xyxy)
                v_hits = self.track_valid_user_hits.get(tid, 0)
                if stage2_model is not None and (v_hits < 12 or self.track_hit_counts.get(tid, 0) % 2 == 0):
                    crop = frame[max(0, y1 - pad):min(h, y2 + pad), max(0, x1 - pad):min(w, x2 + pad)]
                    if crop.size > 0 and crop.shape[0] > 10 and crop.shape[1] > 10:
                        crops_to_infer.append(crop)
                        crop_track_indices.append(idx_t)

            stage2_results_map = {}
            if crops_to_infer:
                try:
                    with ai_infer_lock:
                        batch_res = stage2_model.predict(crops_to_infer, imgsz=224, conf=0.10, verbose=False)
                    for b_idx, res_u in enumerate(batch_res):
                        if len(res_u.boxes) > 0:
                            c_id = int(res_u.boxes.cls[0].cpu().numpy())
                            c_conf = float(res_u.boxes.conf[0].cpu().numpy())
                            c_name = stage2_model.names.get(c_id, "unknown")
                            stage2_results_map[crop_track_indices[b_idx]] = (c_name, c_conf)
                except Exception:
                    pass

            kept_valid_tracks = []
            for idx_t, track_item in enumerate(valid_tracks):
                xyxy = track_item["xyxy"]
                conf = track_item["conf"]
                tid = track_item["track_id"]
                drone_class = track_item["drone_class"]
                cx = (xyxy[0] + xyxy[2]) / 2.0
                cy = (xyxy[1] + xyxy[3]) / 2.0
                x1, y1, x2, y2 = map(int, xyxy)

                user_pred_class, user_pred_conf = stage2_results_map.get(idx_t, ("unknown", 0.0))
                if tid != -1 and user_pred_class != "unknown" and user_pred_conf >= 0.35 and conf >= 0.22:
                    self.track_valid_user_hits[tid] = self.track_valid_user_hits.get(tid, 0) + 1
                    if tid not in self.track_votes:
                        self.track_votes[tid] = {}
                    self.track_votes[tid][user_pred_class] = (
                        self.track_votes[tid].get(user_pred_class, 0.0) + user_pred_conf
                    )

                if tid in self.track_votes and len(self.track_votes[tid]) > 0:
                    voted_class = max(self.track_votes[tid].items(), key=lambda kv: kv[1])[0]
                else:
                    voted_class = user_pred_class if (user_pred_conf >= 0.32 and conf >= 0.22) else "unknown"

                # 정지 배경(수목/바위) 노이즈 억제 필터
                if tid != -1:
                    init_cx, init_cy = self.track_first_pos.get(tid, (cx, cy))
                    disp = ((cx - init_cx) ** 2 + (cy - init_cy) ** 2) ** 0.5
                    if self.track_hit_counts.get(tid, 0) >= 18 and disp < 5.0:
                        self.coasting_tracks.pop(tid, None)
                        continue

                # BBox EMA 좌표 평활화 (v15.8 smooth_ema = 0.80)
                if tid != -1:
                    if tid in self.track_smooth_boxes:
                        sm = self.track_smooth_boxes[tid]
                        prev_h = sm[3] - sm[1]
                        curr_h = y2 - y1
                        if prev_h >= 22 and curr_h >= 1.35 * prev_h:
                            y2 = int(round(y1 + prev_h * 1.08))
                        alpha = 0.80
                        sx1 = alpha * x1 + (1.0 - alpha) * sm[0]
                        sy1 = alpha * y1 + (1.0 - alpha) * sm[1]
                        sx2 = alpha * x2 + (1.0 - alpha) * sm[2]
                        sy2 = alpha * y2 + (1.0 - alpha) * sm[3]
                        self.track_smooth_boxes[tid] = [sx1, sy1, sx2, sy2]
                        x1, y1, x2, y2 = int(round(sx1)), int(round(sy1)), int(round(sx2)), int(round(sy2))
                    else:
                        self.track_smooth_boxes[tid] = [float(x1), float(y1), float(x2), float(y2)]

                    current_detected_ids.add(tid)
                    self.lost_track_memory.pop(tid, None)
                    bw_s = float(x2 - x1)
                    bh_s = float(y2 - y1)
                    if tid in self.coasting_tracks:
                        prev_c = self.coasting_tracks[tid]
                        dt_c = max(1, self.ai_step_idx - prev_c["last_frame"])
                        vx = 0.6 * ((cx - prev_c["cx"]) / dt_c) + 0.4 * prev_c.get("vx", 0.0)
                        vy = 0.6 * ((cy - prev_c["cy"]) / dt_c) + 0.4 * prev_c.get("vy", 0.0)
                    else:
                        vx, vy = 0.0, 0.0

                    self.coasting_tracks[tid] = {
                        "cx": cx, "cy": cy,
                        "w": bw_s, "h": bh_s,
                        "vx": vx, "vy": vy,
                        "last_frame": self.ai_step_idx,
                        "missing": 0,
                        "drone_class": drone_class,
                        "voted_class": voted_class,
                        "user_pred_class": user_pred_class,
                        "user_pred_conf": user_pred_conf,
                        "conf": conf
                    }

                is_identified = (voted_class != "unknown" and self.track_valid_user_hits.get(tid, 0) >= 1 and (self.track_real_hits.get(tid, 0) >= 2 or conf >= 0.28))
                if not is_identified:
                    continue

                min_live_conf = 0.08 if (self.track_hit_counts.get(tid, 0) >= 8 or self.track_valid_user_hits.get(tid, 0) >= 3) else 0.20
                if conf < min_live_conf:
                    continue

                display_name = voted_class.upper()
                kept_valid_tracks.append({"xyxy": [x1, y1, x2, y2], "track_id": tid})
                final_dets.append({
                    "box": (x1, y1, x2, y2),
                    "cls": display_name,
                    "conf": conf,
                    "track_id": tid,
                    "is_identified": True
                })

            valid_tracks = kept_valid_tracks

        # 4. 단기 차폐 관성 홀드 (Zero-Drift Anti-Flicker Hold)
        for tid in list(self.coasting_tracks.keys()):
            if tid not in current_detected_ids:
                c_item = self.coasting_tracks[tid]
                c_item["missing"] += 1

                has_conflict = False
                for act_t in valid_tracks:
                    if act_t["track_id"] == tid:
                        has_conflict = True
                        break
                    act_cx = (act_t["xyxy"][0] + act_t["xyxy"][2]) / 2.0
                    act_cy = (act_t["xyxy"][1] + act_t["xyxy"][3]) / 2.0
                    if ((act_cx - c_item["cx"]) ** 2 + (act_cy - c_item["cy"]) ** 2) ** 0.5 < 28.0:
                        has_conflict = True
                        break
                if has_conflict:
                    self.coasting_tracks.pop(tid, None)
                    continue

                is_mature_coasting = (self.track_hit_counts.get(tid, 0) >= 25 or self.track_valid_user_hits.get(tid, 0) >= 10)
                max_missing = 8 if is_mature_coasting else 2
                if c_item["missing"] > max_missing:
                    is_ephemeral = (tid in self.bisection_ephemeral_ids and self.track_real_hits.get(tid, 0) < 4)
                    if not is_ephemeral:
                        self.lost_track_memory[tid] = {
                            "cx": c_item["cx"], "cy": c_item["cy"],
                            "vx": c_item.get("vx", 0.0), "vy": c_item.get("vy", 0.0),
                            "w": c_item["w"], "h": c_item["h"],
                            "last_frame": c_item["last_frame"]
                        }
                    del self.coasting_tracks[tid]
                    self.track_smooth_boxes.pop(tid, None)
                    continue

                if self.track_hit_counts.get(tid, 0) < 4 or self.track_real_hits.get(tid, 0) < 5:
                    del self.coasting_tracks[tid]
                    self.track_smooth_boxes.pop(tid, None)
                    continue

                cw, ch = c_item["w"], c_item["h"]
                cx1 = max(0, min(w - 1, int(round(c_item["cx"] - cw / 2.0))))
                cy1 = max(0, min(h - 1, int(round(c_item["cy"] - ch / 2.0))))
                cx2 = max(0, min(w - 1, int(round(c_item["cx"] + cw / 2.0))))
                cy2 = max(0, min(h - 1, int(round(c_item["cy"] + ch / 2.0))))

                if cx1 <= 10 or cx2 >= w - 10 or cy1 <= 10 or cy2 >= h - 10:
                    del self.coasting_tracks[tid]
                    continue

                c_box = [cx1, cy1, cx2, cy2]
                if any(compute_box_iou(c_box, vt["xyxy"]) >= 0.25 or compute_box_ios(c_box, vt["xyxy"]) >= 0.35 for vt in valid_tracks):
                    continue

                decay_conf = round(float(c_item["conf"] * (0.98 ** c_item["missing"])), 4)
                is_c_identified = (c_item.get("voted_class", "unknown") != "unknown" and self.track_valid_user_hits.get(tid, 0) >= 2)
                if not is_c_identified:
                    continue
                c_display = c_item["voted_class"].upper()

                final_dets.append({
                    "box": (cx1, cy1, cx2, cy2),
                    "cls": c_display,
                    "conf": decay_conf,
                    "track_id": tid,
                    "is_identified": True
                })

        return final_dets

    def _draw_overlay(self, frame, dets):
        """v15.8 적색 바운딩 박스 및 Track ID + 기종 라벨 렌더링"""
        for d in dets:
            x1, y1, x2, y2 = d["box"]
            cls_name = d["cls"]
            conf = d["conf"]
            tid = d.get("track_id", -1)
            color = ARMOR_COLORS.get(cls_name, (0, 0, 255))
            draw_tactical_annotation(frame, x1, y1, x2, y2, cls_name, conf, tid, color)

    def start(self, target_id: str, lat: float, lng: float, initial_score: float = 0.0):
        with self.det_lock:
            self.target_id = target_id or self.default_target
            self.lat = lat
            self.lng = lng
            if self.is_playing:
                return
            self.is_playing = True
            self._stop_event.clear()
            self.current_time_sec = 0.0
            self.peak_count = 0
            self.peak_score = max(0.0, float(initial_score))
            self.last_identified_class = ""
            self.last_eval_time = 0.0
            with ai_infer_lock:
                self._reset_tracker_state()

            self._playback_thread = threading.Thread(target=self._playback_loop, daemon=True)
            self._playback_thread.start()
            print(f"[C4I Recon] {self.drone_id} 목표 [{self.target_id}] 상공 실시간 2-Stage AI 정찰 가동: {os.path.basename(self.video_path)}")

    def stop(self):
        self.is_playing = False
        self._stop_event.set()
        self.current_time_sec = 0.0
        self.peak_count = 0
        self.peak_score = 0.0
        self.last_identified_class = ""
        with self.det_lock:
            self.active_detections = []

    def _playback_loop(self):
        """
        [프레임-바운딩박스 완전 동기화 스트리밍 루프]
        1) 현재 프레임(frame)에서 AI 추론을 수행하고 동일한 frame 위에 즉시 박스를 그려 인코딩함으로써 프레임 밀림(Lag)을 0ms로 원천 차단
        2) 사용자가 현재 열람 중인 UAV 스트림(active_viewers > 0)에 CPU 자원을 집중 배분하고, 비열람 백그라운드 UAV는 저주기로 위협도만 갱신
        """
        cap = cv2.VideoCapture(self.video_path)
        if not cap.isOpened():
            return
        native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 1800)

        start_wall_time = time.time()
        curr_frame_idx = 0

        try:
            while self.is_playing and not self._stop_event.is_set():
                t0 = time.time()

                # 다른 UAV 영상을 열람 중이고 현재 UAV는 화면에 표시되지 않는 경우 CPU 양보
                any_viewed = any(p.active_viewers > 0 for p in drone_recon_players.values())
                is_background_uav = (any_viewed and self.active_viewers <= 0 and self.peak_count > 0)
                if is_background_uav:
                    time.sleep(0.85)
                    if not self.is_playing or self._stop_event.is_set():
                        break

                elapsed_wall = time.time() - start_wall_time
                target_idx = int(elapsed_wall * native_fps)

                if target_idx >= total_frames - 2:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    start_wall_time = time.time()
                    curr_frame_idx = 0
                    with ai_infer_lock:
                        self._reset_tracker_state()
                    ret, frame = cap.read()
                    curr_frame_idx = 1
                else:
                    skip = max(0, target_idx - curr_frame_idx)
                    # 일반 재생 시에는 고속 cap.grab()으로 디코더 버퍼를 유지하고, 백그라운드 탭 전환 시에만 위치 점프
                    if skip > 30:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, target_idx)
                        curr_frame_idx = target_idx
                    else:
                        for _ in range(skip):
                            if not cap.grab():
                                break
                            curr_frame_idx += 1
                    ret, frame = cap.read()
                    curr_frame_idx += 1

                if not ret or frame is None:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    start_wall_time = time.time()
                    curr_frame_idx = 0
                    with ai_infer_lock:
                        self._reset_tracker_state()
                    continue

                self.current_time_sec = curr_frame_idx / max(native_fps, 1.0)

                # 현재 읽은 바로 그 프레임(frame)에서 AI 탐지/추적 수행 후 즉시 동일 프레임에 오버레이 렌더링 (밀림 0px)
                cur_dets = self._run_inference_on_frame(frame, use_tracker=True)
                with self.det_lock:
                    self.active_detections = cur_dets

                self._draw_overlay(frame, cur_dets)
                _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
                self.current_frame_bytes = buf.tobytes()

                now = time.time()
                if now - self.last_eval_time >= 0.35:
                    self.last_eval_time = now
                    self._evaluate_and_broadcast()

                proc_time = time.time() - t0
                min_interval = 1.0 / min(native_fps, 24.0)
                if proc_time < min_interval:
                    time.sleep(min_interval - proc_time)
        finally:
            cap.release()

    def _evaluate_and_broadcast(self):
        with self.det_lock:
            dets = list(self.active_detections)

        count = len(dets)
        # 현재 프레임 및 누적 탐지 수량이 모두 0인 경우 브로드캐스트 생략
        if count == 0 and self.peak_count == 0:
            return

        # 확정 판독된(is_identified) 객체 우선, 없으면 현재 최고 신뢰도 객체 또는 직전 판독 기종 사용
        identified_dets = [d for d in dets if d.get("is_identified") and d["cls"] != "TARGET"]
        if identified_dets:
            top_det = max(identified_dets, key=lambda d: d["conf"])
            cls_name = top_det["cls"]
            conf = top_det["conf"]
            self.last_identified_class = cls_name
        elif dets:
            top_det = max(dets, key=lambda d: d["conf"])
            cls_name = self.last_identified_class if self.last_identified_class else top_det["cls"]
            conf = top_det["conf"]
        else:
            cls_name = self.last_identified_class if self.last_identified_class else "TARGET"
            conf = 0.50

        # 실시간 AI가 탐지한 객체 수량과 기종을 기반으로 전술 위협도 평가
        eval_res = evaluate_tactical_target(
            detected_class=cls_name,
            confidence=conf,
            lat=self.lat,
            lng=self.lng,
            target_id=self.target_id,
            count=count,
            prev_score=self.peak_score,
            prev_count=self.peak_count,
            assigned_drone=self.drone_id
        )
        eval_res["assignedDrone"] = self.drone_id
        is_auth = self.target_id in authorized_targets
        eval_res["authorized"] = is_auth
        if is_auth:
            eval_res["status"] = "승인 완료"

        self.peak_score = eval_res["score"]
        self.peak_count = eval_res["detectedCount"]

        if main_event_loop and main_event_loop.is_running():
            asyncio.run_coroutine_threadsafe(
                manager.broadcast({
                    "type": "TARGET_DETECTED",
                    "target": eval_res,
                    "log": f"[{self.drone_id} 실시간 AI 정밀식별] {eval_res['name']} ({eval_res['detectedCount']}기 식별) ➔ 위협도 {(eval_res['score']*100):.0f}% ({eval_res['responseLevel']})"
                }),
                main_event_loop
            )

# 3기 UAV별 독립 정찰 플레이어 인스턴스 생성 (원본 정찰 영상 + 2-Stage AI 실시간 추론)
drone_recon_players = {
    "UAV-01": DroneReconPlayer(
        drone_id="UAV-01",
        video_filename="raw_uav01_60s.mp4",
        default_target="ROI_06",
        mask_hud=True
    ),
    "UAV-02": DroneReconPlayer(
        drone_id="UAV-02",
        video_filename="raw_uav02_50s.mp4",
        default_target="ROI_10",
        mask_hud=True
    ),
    "UAV-03": DroneReconPlayer(
        drone_id="UAV-03",
        video_filename="raw_uav03_37s.mp4",
        default_target="ROI_08",
        mask_hud=False
    )
}

async def generate_frames(drone_id: str):
    """
    클라이언트가 시점을 변경하거나 전체보기 모달을 띄워도 비디오가 0초로 리셋되지 않고,
    백그라운드에서 진행 중인 현재 프레임 버퍼를 무지연(Zero-Lag)으로 지속 스트리밍.
    """
    player = drone_recon_players.get(drone_id)
    if player:
        player.active_viewers += 1
    try:
        while True:
            if player and player.current_frame_bytes:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + player.current_frame_bytes + b'\r\n')
            await asyncio.sleep(0.033)  # 30 FPS 전송
    finally:
        if player:
            player.active_viewers = max(0, player.active_viewers - 1)

@app.get("/api/video_feed/{drone_id}")
async def video_feed(drone_id: str):
    return StreamingResponse(
        generate_frames(drone_id),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.post("/api/upload_video/{drone_id}")
async def upload_video(drone_id: str, file: UploadFile = File(...)):
    file_path = os.path.join(UPLOAD_DIR, f"{drone_id}_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    cap = cv2.VideoCapture(file_path)
    if cap.isOpened():
        drone_caps[drone_id] = cap
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        drone_states[drone_id] = {"playing": False, "fps": fps}
        return {"status": "SUCCESS", "message": f"{drone_id} 비디오 교체 완료", "file": file.filename}
    return {"status": "FAIL", "message": "비디오 파일 로드 실패"}

@app.get("/api/tactical/init")
async def tactical_init():
    try:
        authorized_targets.clear()
        for p in drone_recon_players.values():
            p.stop()
        data = get_tactical_init_data()
        return data
    except Exception as e:
        return {"status": "ERROR", "message": str(e)}

@app.post("/api/tactical/reset")
@app.get("/api/tactical/reset")
async def tactical_reset():
    authorized_targets.clear()
    for p in drone_recon_players.values():
        p.stop()
    reset_cached_tactical_data()
    await manager.broadcast({"type": "RESET_DONE"})
    return {"status": "SUCCESS", "message": "체계 초기화 완료"}

@app.get("/api/tactical/consumption")
async def get_mission_consumption(
    target_id: str,
    uav_lat: float = 37.850,
    uav_lng: float = 126.745,
    target_lat: float = 37.8668,
    target_lng: float = 126.7795,
    speed_kmh: float = 300.0,
    remain_min: float = 120.0
):
    """[APSO-LS v4] 실제 정찰시간 기반 UAV 운용시간 소모 계산 엔드포인트"""
    try:
        data = calculate_mission_consumption(
            uav_lat=uav_lat,
            uav_lng=uav_lng,
            target_lat=target_lat,
            target_lng=target_lng,
            target_id=target_id,
            uav_speed_kmh=speed_kmh,
            uav_remaining_time=remain_min
        )
        return {"status": "SUCCESS", "data": data}
    except Exception as e:
        return {"status": "ERROR", "message": str(e)}


# 웹소켓 연결 매니저
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # 새 세션 연결 시 이전 결심/스트리밍 상태 클리어
        authorized_targets.clear()
        for p in drone_recon_players.values():
            p.stop()

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message, ensure_ascii=False))
            except Exception:
                pass

manager = ConnectionManager()

@app.websocket("/ws/tactical")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            cmd = json.loads(data)
            action = cmd.get("action")

            if action == "ARRIVED_AT_TARGET":
                drone_id = cmd.get("drone_id", "UAV-01")
                lat = cmd.get("lat", 37.8920)
                lng = cmd.get("lng", 126.8120)
                tgt_id = cmd.get("target_id", "ROI_06")
                uav_lat = cmd.get("uav_lat", lat)
                uav_lng = cmd.get("uav_lng", lng)
                speed_kmh = cmd.get("speed_kmh", 300.0)
                remain_minutes = cmd.get("remain_minutes", 120.0)

                # [APSO-LS v4] 실제 정찰시간 기반 잔여 운용시간 갱신 계산
                consumption = calculate_mission_consumption(
                    uav_lat=uav_lat,
                    uav_lng=uav_lng,
                    target_lat=lat,
                    target_lng=lng,
                    target_id=tgt_id,
                    uav_speed_kmh=speed_kmh,
                    uav_remaining_time=remain_minutes
                )

                # 브로드캐스트로 전술 대시보드에 실제 정찰시간 반영 현황 즉시 통보
                await manager.broadcast({
                    "type": "UAV_MISSION_CONSUMED",
                    "drone_id": drone_id,
                    "target_id": tgt_id,
                    "consumption": consumption,
                    "log": f"[APSO-LS v4 잔여시간 갱신] [{drone_id}] 표적 [{tgt_id}] 상공 진입 ➔ 이동({consumption['travel_time_min']}분) + 실제 정찰시간({consumption['actual_service_time_min']}분) 반영 ➔ 잔여 운용: {consumption['updated_remaining_min']}분 (안전선 18분 확보)"
                })

                # 실시간 원본 정찰 영상 스트리밍 및 2-Stage AI 객체 인식 기반 위협도/대응방안 갱신 시작
                if drone_id in drone_recon_players:
                    init_sc = float(cmd.get("initial_score", 0.0))
                    drone_recon_players[drone_id].start(tgt_id, lat, lng, init_sc)

            elif action == "DECISION_APPROVE":
                tgt_id = cmd.get("target_id")
                plan = cmd.get("plan", "PLAN-PRIMARY")
                if tgt_id:
                    authorized_targets.add(tgt_id)
                    await manager.broadcast({
                        "type": "DECISION_UPDATED",
                        "target_id": tgt_id,
                        "status": "승인 완료",
                        "authorized": True,
                        "log": f"[지휘관 결심 하달] 표적 [{tgt_id}] 작전 승인 완료 ➔ 작전 명령 즉각 하달"
                    })

            elif action == "PAUSE":
                for p in drone_recon_players.values():
                    p.stop()
            elif action == "RESET":
                authorized_targets.clear()
                for p in drone_recon_players.values():
                    p.stop()
                await manager.broadcast({"type": "RESET_DONE"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        manager.disconnect(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

