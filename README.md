# LOOK-AT-ME C4I

다중 UAV 경로 최적화(APSO-LS + Rolling Horizon)와 2-Stage YOLO 객체 탐지·추적 기반의 실시간 관제 대시보드 프로젝트입니다.

세부 아키텍처, API 규격 및 수식은 [LOOK_AT_ME_SPECIFICATION.md](./LOOK_AT_ME_SPECIFICATION.md)에 정리되어 있습니다.

---

## 주요 기능

- **관심지역(ROI) 우선순위 산정 및 UAV 경로 할당**
  - `roi_change_results.csv`의 10개 ROI 데이터를 불러와 변화 강도·면적, 표적 가중치, 기준점 대비 거리를 조합해 우선순위를 계산합니다.
  - `APSO-LS`와 `RollingHorizonSimulator`로 UAV 3기의 비행 경로 및 잔여 운용시간(15% 예비시간 18분 고려)을 계산합니다.
- **2-Stage 객체 탐지 및 추적 (`DroneReconPlayer`)**
  - **Stage 1**: 공중 탐지 모델(`best_drone_stage1_custom.pt`)과 `BoT-SORT` 추적기로 객체를 검출하고 추적합니다. (HUD 영역 마스킹, 종대 박스 2등분 분할, 트랙릿 재연결, 단기 차폐 유지 로직 포함)
  - **Stage 2**: 분류 모델(`best_yolo11.pt`)로 크롭 영역의 기종을 분류하고 다수결 투표와 BBox EMA 평활화를 적용합니다.
  - 추론이 끝난 프레임에 바운딩 박스를 그려 MJPEG(`/api/video_feed/{drone_id}`)로 스트리밍합니다.
- **위협도 갱신 및 지휘 결심 연동**
  - 0.35초 주기로 탐지 수량·신뢰도·거리를 반영한 위협도($O = \ln(1 + \sum s_{ij})$)와 대응 등급을 계산해 WebSocket(`/ws/tactical`)으로 전달합니다.
  - 대시보드에서 표적 확인 및 승인 상태를 백엔드와 동기화합니다.
- **웹 대시보드 (Next.js 16 / React 19)**
  - 레이더 스캔 애니메이션 로그인 화면 (`LoginGate`)
  - Leaflet 지도 위 UAV 위치, 경로, 탐지 객체 마커 표시 (`TacticalMap`)
  - 초기 감시 영상 재생 및 현장 도착 시 실시간 추론 스트림 전환 (`ReconCameraFeed`)
  - 표적 상황판 및 상세 모달 (`DecisionTable`, `TargetModal`, `DroneModal`)

---

## 기술 스택

| 구분 | 기술 |
| :--- | :--- |
| **Backend** | Python, FastAPI, Uvicorn, WebSocket, OpenCV, PyTorch, Ultralytics YOLO, BoT-SORT, NumPy |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS, Leaflet, Lucide Icons |

---

## 프로젝트 구조

```text
LOOK_AT_ME/
├── install_dependencies.bat      # 의존성 일괄 설치 (Windows)
├── run_look_at_me.bat            # 백엔드(8000) & 프론트엔드(3000) 실행 (Windows)
├── README.md
├── LOOK_AT_ME_SPECIFICATION.md   # API 및 파이프라인 세부 명세
│
├── backend/
│   ├── main.py                   # FastAPI 서버, WebSocket, MJPEG 스트리밍 & DroneReconPlayer
│   ├── tactical_pipeline.py      # ROI 로드, 1차 우선순위 산정 & APSO-LS 할당
│   ├── tactical_rules.py         # 2차 위협도 계산 & 대응 등급 매핑
│   ├── requirements.txt
│   ├── data/
│   │   └── roi_change_results.csv
│   ├── models/
│   │   ├── best_drone_stage1_custom.pt
│   │   ├── best_yolo11.pt
│   │   └── botsort_drone.yaml
│   ├── planner/
│   │   ├── models.py             # ROI, UAV, RouteMetrics, Plan 모델
│   │   ├── optimizer.py          # APSO-LS 경로 최적화
│   │   └── rolling_horizon.py    # Rolling Horizon 시뮬레이터
│   └── videos/                   # (Git 제외, 로컬 배치용)
│       ├── raw_uav01_60s.mp4
│       ├── raw_uav02_50s.mp4
│       └── raw_uav03_37s.mp4
│
└── frontend/
    ├── package.json
    ├── public/
    │   └── videos/               # (Git 제외, 로컬 배치용: 1st.mp4, 2nd.mp4, 3rd.mp4)
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   └── page.tsx          # 메인 대시보드
        ├── types/
        │   └── c4i.ts
        └── components/
            ├── LoginGate.tsx
            ├── CommandHeader.tsx
            ├── DroneFleetStatus.tsx
            ├── TacticalMap.tsx
            ├── ReconCameraFeed.tsx
            ├── DecisionTable.tsx
            ├── TargetModal.tsx
            └── DroneModal.tsx
```

---

## 실행 방법

### 사전 요구사항
- Python 3.10+
- Node.js 18.17+
- 데모 영상(`.mp4`)은 용량 제한으로 Git 저장소에서 제외되어 있으며, 로컬 실행 시 아래 경로에 배치해야 영상 재생 및 AI 추론이 동작합니다.
  - 초기 감시 영상: `frontend/public/videos/` (`1st.mp4`, `2nd.mp4`, `3rd.mp4`)
  - AI 추론 원본 영상: `backend/videos/` (`raw_uav01_60s.mp4`, `raw_uav02_50s.mp4`, `raw_uav03_37s.mp4`)

### 1) 스크립트 실행 (Windows)
1. 최초 1회 `install_dependencies.bat` 실행
2. `run_look_at_me.bat` 실행
3. [http://localhost:3000](http://localhost:3000) 접속

### 2) 수동 실행 (CLI)

**Backend (Port 8000)**
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
- API 문서: `http://localhost:8000/docs`

**Frontend (Port 3000)**
```bash
cd frontend
npm install
npm run dev
```
- 프로덕션 빌드 실행: `npm run build && npm run start`

---

## 테스트 계정

로그인 화면에서 역할을 선택한 뒤 아래 계정으로 접속할 수 있습니다.

| 역할 | 권한 | ID | 비밀번호 |
| :--- | :--- | :--- | :--- |
| 지휘관 (`COMMANDER`) | AUTH-LV3 (타격결심 승인) | `19-71502805` | `1q2w3e4r` |
| 통제관 (`CONTROLLER`) | AUTH-LV2 (감시관제) | `08-20260428` / `01-20230330` / `72-09180922` | `1q2w3e4r` |
