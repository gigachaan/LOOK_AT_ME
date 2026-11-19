# -*- coding: utf-8 -*-
"""
LOOK-AT-ME C4I 전술 데이터 파이프라인 (Tactical Data Pipeline)
- 10개 위성 SAR-광학 융합 ROI 데이터 로드
- MVRSD 기반 미시 표적 위협도 및 거시 변화도 우선순위 산정 (ROIPriorityCalculator)
- 중고도 무인기(KUS-FS) 3기 최적 비행 경로 할당 (APSO-LS)
"""

import os
import sys
import csv
import math
from typing import Dict, List, Any

# APSO-LS & Rolling Horizon 모듈 경로 추가
LOCAL_PLANNER_DIR = os.path.join(os.path.dirname(__file__), "planner")
if os.path.exists(LOCAL_PLANNER_DIR) and LOCAL_PLANNER_DIR not in sys.path:
    sys.path.insert(0, LOCAL_PLANNER_DIR)

try:
    from models import ROI, UAV
    from optimizer import APSOLSConfig
    from rolling_horizon import RollingHorizonSimulator
except ImportError:
    pass

# [APSO-LS v4 핵심] ROI별 실제 정찰시간 (Actual Service Time [min])
# - roi.service_time: 예정 정찰시간으로 APSO-LS 최적화 계획 계산에 사용
# - actual_service_time: 실제 정찰시간으로 UAV 잔여 운용시간 갱신에 사용
ACTUAL_SERVICE_TIMES = {
    'ROI_01': 5.8,  # 적 기갑전투 대열 (현장 실시간 추적 및 화력 연계)
    'ROI_02': 4.5,  # 적 군수 보급 대열 (이동로 추적)
    'ROI_03': 6.2,  # 적 전차 엄체호 진지 (피아식별 및 정밀 좌표 산출)
    'ROI_04': 4.0,  # 적 수색 정찰 기동 (기동 방향 감시)
    'ROI_05': 3.5,  # 적 공병 도하 진지 (진지 규모 정찰)
    'ROI_06': 6.8,  # 적 기갑 기동 집결지 (최우선 밀집 표적 정밀 추적)
    'ROI_07': 4.8,  # 적 후방 보급 집결지 (보급 규모 확인)
    'ROI_08': 5.2,  # 적 레이더/통신 수색 차량 (전자전/신호 식별)
    'ROI_09': 2.8,  # 민간 의심 차량 이동 (오인 방지 신속 확인)
    'ROI_10': 6.5,  # 적 전방 기갑 지휘소 (지휘통제 시설 식별)
}


CSV_PATH = os.path.join(os.path.dirname(__file__), "data", "roi_change_results.csv")

# 1차 위성 SAR-광학 융합 탐지 ROI 카탈로그 (문산/파주/연천 접경 축선 정보)
# ※ 거리(dist)는 기준점 A(문산 방어 원점)와 각 표적 좌표 간의 실제 유클리드 거리로 동적 계산됩니다.
SATELLITE_ROI_CATALOG = {
    'ROI_01': {
        'name': '문산 동북부 1호 표적 [적 기갑전투 대열]',
        'class': 'AFV',
        'type': '기갑 전력 (기동 대열)',
        'conf': 0.94,
        'response_level': '⚔️ 기동 차단',
        'level_color': 'bg-orange-950 text-orange-300 border border-orange-600',
        'recommendation': '🚀 다연장로켓(MLRS) 종심 차단사격',
    },
    'ROI_02': {
        'name': '파주 북부 2호 표적 [적 군수 보급 대열]',
        'class': 'LMV',
        'type': '군수 보급 (고위협)',
        'conf': 0.88,
        'response_level': '● 전술 감시',
        'level_color': 'bg-cyan-950 text-cyan-300 border border-cyan-700',
        'recommendation': '👀 선회 비행 및 보급로 동향 추적',
    },
    'ROI_03': {
        'name': '문산 서북부 3호 표적 [적 전차 엄체호 진지]',
        'class': 'AFV',
        'type': '기갑 진지 (고위협)',
        'conf': 0.91,
        'response_level': '▲ 우선 타격',
        'level_color': 'bg-amber-950 text-amber-300 border border-amber-600',
        'recommendation': '🚁 공격헬기 대전차 유도탄 출격',
    },
    'ROI_04': {
        'name': '임진강 서안 4호 표적 [적 수색 정찰 기동]',
        'class': 'SMV',
        'type': '경장갑 정찰 (통상)',
        'conf': 0.85,
        'response_level': '● 경계 감시',
        'level_color': 'bg-blue-950 text-blue-300 border border-blue-700',
        'recommendation': '🔍 기동축선 선회 및 지속 감시 유지',
    },
    'ROI_05': {
        'name': '연천 서부 5호 표적 [적 공병 도하 진지]',
        'class': 'MCV',
        'type': '전술 공병 (통상)',
        'conf': 0.78,
        'response_level': '● 경계 감시',
        'level_color': 'bg-blue-950 text-blue-300 border border-blue-700',
        'recommendation': '🔍 기동축선 선회 및 지속 감시 유지',
    },
    'ROI_06': {
        'name': '문산 중부 6호 표적 [적 기갑 기동 집결지]',
        'class': 'AFV',
        'type': '기갑 주력 (최우선)',
        'conf': 0.95,
        'response_level': '🚨 긴급 타격',
        'level_color': 'bg-red-950 text-red-400 border border-red-700 animate-pulse',
        'recommendation': '💥 K-9 자주포 TOT 집중사격 연계',
    },
    'ROI_07': {
        'name': '파주 남부 7호 표적 [적 후방 보급 집결지]',
        'class': 'LMV',
        'type': '군수 보급 (고위협)',
        'conf': 0.82,
        'response_level': '● 전술 감시',
        'level_color': 'bg-cyan-950 text-cyan-300 border border-cyan-700',
        'recommendation': '👀 선회 비행 및 편대 동향 정밀 추적',
    },
    'ROI_08': {
        'name': '연천 남부 8호 표적 [적 레이더·통신 수색 차량]',
        'class': 'SMV',
        'type': '방공/통신 (고위협)',
        'conf': 0.79,
        'response_level': '📡 방공 제압',
        'level_color': 'bg-purple-950 text-purple-300 border border-purple-600',
        'recommendation': '🎯 대레이더 유도탄 방공망 제압(SEAD)',
    },
    'ROI_09': {
        'name': '임진강 동안 9호 표적 [민간 의심 차량 이동]',
        'class': 'CV',
        'type': '비전투 이동체',
        'conf': 0.90,
        'response_level': '● 일반 확인',
        'level_color': 'bg-slate-800 text-slate-400 border border-slate-700',
        'recommendation': '🔍 광학 줌 센서 민간 오인방지 식별',
    },
    'ROI_10': {
        'name': '문산 동부 10호 표적 [적 전방 기갑 지휘소]',
        'class': 'AFV',
        'type': '지휘소/기갑 (최우선)',
        'conf': 0.93,
        'response_level': '🎯 지휘 타격',
        'level_color': 'bg-rose-950 text-rose-300 border border-rose-600',
        'recommendation': '🚀 KTSSM/정밀유도탄 지휘부 타격',
    },
}

class PipelinePriorityCalculator:
    """1차 ROI 우선순위 산정기 (실시간 위성 탐지 가정: 시간 감쇄 배제, 기준점 A 대비 실측 거리 반영)"""
    def __init__(self, alpha=0.4, beta=0.6, dist_base=100.0, norm_mode='max'):
        self.alpha = alpha
        self.beta = beta
        self.dist_base = dist_base
        self.norm_mode = norm_mode
        self.class_weights = {
            'afv': 1.0, 'lmv': 0.8, 'smv': 0.6, 'mcv': 0.5, 'cv': 0.1
        }

    def _normalize(self, raw_list):
        arr = [float(x) for x in raw_list]
        if not arr:
            return arr
        max_v = max(arr)
        min_v = min(arr)

        if self.norm_mode == 'max':
            if max_v <= 0.0:
                return [0.0 for _ in arr]
            return [x / max_v for x in arr]
        else:
            if max_v == min_v:
                return [0.0 if max_v == 0.0 else 1.0 for _ in arr]
            return [(x - min_v) / (max_v - min_v) for x in arr]

    def evaluate(self, roi_inputs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        raw_changes = []
        raw_objects = []

        for roi in roi_inputs:
            raw_change = roi['change_intensity'] * roi['change_area']
            raw_changes.append(raw_change)

            sum_s = 0.0
            for t in roi.get('detected_targets', []):
                cls = t['class_name'].lower()
                conf = t['confidence']
                dist = t['distance']
                w_c = self.class_weights.get(cls, 0.2)
                f_d = self.dist_base / (self.dist_base + dist) if dist > 0 else 1.0
                sum_s += w_c * conf * f_d

            raw_objects.append(math.log(1.0 + sum_s))

        C_vec = self._normalize(raw_changes)
        O_vec = self._normalize(raw_objects)

        results = []
        for i, roi in enumerate(roi_inputs):
            prio = self.alpha * C_vec[i] + self.beta * O_vec[i]
            results.append({
                'roi_id': roi['roi_id'],
                'C_score': round(C_vec[i], 4),
                'O_score': round(O_vec[i], 4),
                'priority': round(prio, 4)
            })

        results.sort(key=lambda x: x['priority'], reverse=True)
        return results

def load_rois_from_csv():
    rois = []
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(f"CSV not found: {CSV_PATH}")

    with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rois.append({
                'roi_id': row['ROI_ID'],
                'lat': float(row['Latitude']),
                'lng': float(row['Longitude']),
                'area_px': float(row['Area_px']),
                'area_km2': float(row['Area_km2']),
                'mean_change': float(row['Mean_Change_Score']),
                'max_change': float(row['Max_Change_Score']),
                'mgrs': row['MGRS_8digit'],
            })
    return rois

# 전역 방어 원점 (기준점 A: 서부전선 문산 남서부 거리 환산 기준 원점)
REF_LAT, REF_LNG = 37.8300, 126.7300

def to_km(lat, lng):
    x = (lng - REF_LNG) * 111.0 * math.cos(math.radians(REF_LAT))
    y = (lat - REF_LAT) * 111.0
    return x, y

def get_doctrine_level(score: float, target_type: str = "기갑", target_name: str = "", target_id: str = ""):
    """위협도 점수 및 표적 유형 기준 전술 대응 교리 등급 매핑"""
    t_lower = target_type.lower()
    n_lower = target_name.lower()
    is_armor = any(k in t_lower for k in ["기갑", "전차", "장갑", "afv", "apc", "tank"]) or any(k in n_lower for k in ["기갑", "전차", "장갑"])
    is_air_def = any(k in t_lower for k in ["방공", "레이더", "radar", "smv"]) or any(k in n_lower for k in ["방공", "레이더"])
    is_cmd = any(k in t_lower for k in ["화력", "지휘", "tel"]) or any(k in n_lower for k in ["지휘", "지휘소"])
    is_bunker = "진지" in n_lower or "엄체호" in n_lower
    is_column = "대열" in n_lower

    if score >= 0.85:
        level = "🚨 긴급 타격"
        color = "bg-red-950 text-red-400 border border-red-700 animate-pulse"
        if is_armor:
            rec = "💥 K-9 자주포 TOT 집중사격 연계"
        elif is_air_def:
            rec = "🎯 정밀 유도탄 및 방공망 제압 사격 (SEAD)"
        elif is_cmd:
            rec = "🚀 KTSSM 전술지대지 지휘부 정밀 타격"
        else:
            rec = "💥 지상 화력 즉각 집중 타격"
    elif is_cmd or (score >= 0.745 and not is_air_def):
        level = "🎯 지휘 타격"
        color = "bg-rose-950 text-rose-300 border border-rose-600"
        rec = "🚀 KTSSM/정밀유도탄 지휘부 타격"
    elif is_air_def or (score >= 0.73 and score < 0.745):
        level = "📡 방공 제압"
        color = "bg-purple-950 text-purple-300 border border-purple-600"
        rec = "🎯 대레이더 유도탄 방공망 제압(SEAD)"
    elif is_bunker or (score >= 0.715 and score < 0.73):
        level = "▲ 우선 타격"
        color = "bg-amber-950 text-amber-300 border border-amber-600"
        rec = "🚁 공격헬기 대전차 유도탄 출격"
    elif is_column or score >= 0.70:
        level = "⚔️ 기동 차단"
        color = "bg-orange-950 text-orange-300 border border-orange-600"
        rec = "🚀 다연장로켓(MLRS) 종심 차단사격"
    elif score >= 0.60:
        level = "● 전술 감시"
        color = "bg-cyan-950 text-cyan-300 border border-cyan-700"
        rec = "👀 선회 비행 및 보급로 동향 추적" if "보급" in n_lower else "👀 선회 비행 및 편대 동향 정밀 추적"
    elif score >= 0.40:
        level = "● 경계 감시"
        color = "bg-blue-950 text-blue-300 border border-blue-700"
        rec = "🔍 기동축선 선회 및 지속 감시 유지"
    else:
        level = "● 일반 확인"
        color = "bg-slate-800 text-slate-400 border border-slate-700"
        rec = "🔍 광학 줌 센서 민간 오인방지 식별" if "민간" in n_lower else "🔍 광학 줌 센서로 추가 정밀 식별"

    return level, color, rec

_cached_init_data = None

def get_tactical_init_data():
    """10개 ROI 우선순위 산정 및 APSO-LS 초기 비행 경로 생성"""
    global _cached_init_data
    if _cached_init_data is not None:
        return _cached_init_data

    raw_rois = load_rois_from_csv()

    # 1. 우선순위 평가 입력 구성 (기준점 A 원점 ↔ 표적 B 중심 간 실제 이격거리 d_ij 계산)
    p_inputs = []
    for r in raw_rois:
        rid = r['roi_id']
        catalog_item = SATELLITE_ROI_CATALOG.get(rid, {'class': 'SMV', 'conf': 0.8})
        
        # 기준점 A (전역 방어 원점) ↔ 기준점 B (ROI 중심) 간의 실제 평면 유클리드 거리 (km)
        x, y = to_km(r['lat'], r['lng'])
        real_dist = round(math.hypot(x, y), 2)
        
        p_inputs.append({
            'roi_id': rid,
            'change_intensity': r['mean_change'],
            'change_area': r['area_px'],
            'detected_targets': [{
                'class_name': catalog_item['class'],
                'confidence': catalog_item['conf'],
                'distance': real_dist  # 실제 거리 d_ij 대입
            }]
        })

    calculator = PipelinePriorityCalculator(alpha=0.4, beta=0.6)
    evaluated = calculator.evaluate(p_inputs)
    prio_map = {item['roi_id']: item for item in evaluated}

    def calc_service_time(area_km2, prio):
        return 3.0 + 500.0 * area_km2 + 2.0 * prio

    roi_models = []
    for r in raw_rois:
        rid = r['roi_id']
        p_info = prio_map[rid]
        x, y = to_km(r['lat'], r['lng'])
        srv = calc_service_time(r['area_km2'], p_info['priority'])
        roi_models.append(ROI(roi_id=rid, x=x, y=y, priority=p_info['priority'], service_time=srv))

    # UAV 3기 기지 위치 (문산 서부, 파주 중부, 연천 동부)
    uav_bases = {
        'UAV-01': (37.850, 126.745),
        'UAV-02': (37.835, 126.795),
        'UAV-03': (37.865, 126.845)
    }

    uav_models = [
        UAV(uav_id='UAV-01', x=to_km(uav_bases['UAV-01'][0], uav_bases['UAV-01'][1])[0],
            y=to_km(uav_bases['UAV-01'][0], uav_bases['UAV-01'][1])[1], remaining_time=120.0, speed=300.0),
        UAV(uav_id='UAV-02', x=to_km(uav_bases['UAV-02'][0], uav_bases['UAV-02'][1])[0],
            y=to_km(uav_bases['UAV-02'][0], uav_bases['UAV-02'][1])[1], remaining_time=120.0, speed=320.0),
        UAV(uav_id='UAV-03', x=to_km(uav_bases['UAV-03'][0], uav_bases['UAV-03'][1])[0],
            y=to_km(uav_bases['UAV-03'][0], uav_bases['UAV-03'][1])[1], remaining_time=120.0, speed=290.0)
    ]

    # 3. Rolling Horizon 시뮬레이터 구동 (내부에서 APSO-LS 최적화 및 1단계 임무 배분 동시 실행)
    cfg = APSOLSConfig(n_particles=40, max_iter=80, seed=42)
    sim = RollingHorizonSimulator(uavs=uav_models, config=cfg)
    try:
        stage_log = sim.run_stage(new_rois=roi_models, actual_service_times=ACTUAL_SERVICE_TIMES, verbose=False)
    except TypeError:
        stage_log = sim.run_stage(new_rois=roi_models, verbose=False)

    plan = stage_log['plan']

    # 4. 역매핑 (어떤 UAV가 어떤 ROI를 맡는지)
    assigned_drone_map = {}
    for uid, route in plan.routes.items():
        for rid in route:
            assigned_drone_map[rid] = uid

    # 5. 최종 대시보드 표출용 ROI 목록
    roi_lookup = {r['roi_id']: r for r in raw_rois}
    tactical_targets = []
    for r in evaluated:
        rid = r['roi_id']
        raw_r = roi_lookup[rid]
        catalog_item = SATELLITE_ROI_CATALOG[rid]
        assigned_uav = assigned_drone_map.get(rid, 'UAV-01')

        # 기준점 A 원점 기준 실측 유클리드 거리 계산
        tx, ty = to_km(raw_r['lat'], raw_r['lng'])
        target_dist_km = round(math.hypot(tx, ty), 2)

        # [APSO-LS v4] 예정 정찰시간(계획용) 및 실제 정찰시간(잔여시간 갱신용)
        planned_srv = round(calc_service_time(raw_r['area_km2'], r['priority']), 2)
        actual_srv = round(ACTUAL_SERVICE_TIMES.get(rid, planned_srv), 2)
        score_val = round(r['priority'], 2)
        resp_level, lvl_color, rec_text = get_doctrine_level(score_val, catalog_item['type'], catalog_item['name'], rid)

        tactical_targets.append({
            'id': rid,
            'name': catalog_item['name'],
            'type': catalog_item['type'],
            'lat': round(raw_r['lat'], 4),
            'lng': round(raw_r['lng'], 4),
            'distanceKm': target_dist_km,           # 기준점 A(문산 방어 원점) 대비 실측 거리 d_ij (km)
            'area_km2': round(raw_r['area_km2'], 4),
            'changeScore': round(raw_r['mean_change'], 4),
            'score': score_val,
            'serviceTime': planned_srv,             # 기존 예정 정찰시간 (최적화 계산용)
            'actualServiceTime': actual_srv,        # [v4] 실제 정찰시간 (UAV 잔여 운용시간 갱신용)
            'mgrs': raw_r['mgrs'],
            'responseLevel': resp_level,
            'levelColor': lvl_color,
            'assignedDrone': assigned_uav,
            'recommendation': rec_text,
            'status': '정찰 대기',
            'authorized': False
        })

    # 6. UAV별 비행 경로선 (위도/경도 좌표열)
    uav_flight_plans = {}
    for uid, route in plan.routes.items():
        base_lat, base_lng = uav_bases[uid]
        coords = [[base_lat, base_lng]]
        for rid in route:
            r_info = roi_lookup[rid]
            coords.append([r_info['lat'], r_info['lng']])
        # 귀환 경로 포함 (폐곡선 순찰)
        coords.append([base_lat, base_lng])

        uav_flight_plans[uid] = {
            'route_rois': route,
            'waypoints': coords,
        }

    res = {
        'status': 'SUCCESS',
        'algorithm_version': 'APSO-LS v4 (Adaptive Perturbation + SA Local Search + Rolling Horizon)',
        'metrics': {
            'total_rois': len(raw_rois),
            'makespan_min': round(plan.makespan, 2),
            'total_distance_km': round(plan.total_distance, 2),
            'unserved': plan.unserved,
            'max_flight_time_min': 120.0,
            'reserve_time_min': 18.0,      # 최대 120분의 15% 안전 예비시간
            'service_time_formula': "T_service = 3.0 + 500*Area + 2.0*Prio (예정 정찰시간)",
            'actual_service_role': "actual_service_time (실제 정찰시간으로 UAV 잔여 운용시간 갱신)"
        },
        'rolling_horizon': {
            'framework': 'RollingHorizonSimulator',
            'stage': 1,
            'executed': stage_log.get('executed', []),
            'uav_states': stage_log.get('uav_states', []),
            'remaining_rois': stage_log.get('remaining', [])
        },
        'targets': tactical_targets,
        'uav_plans': uav_flight_plans
    }
    _cached_init_data = res
    return res


def reset_cached_tactical_data():
    """전술 캐시 초기화 (필요 시 재계산 지원)"""
    global _cached_init_data
    _cached_init_data = None


def calculate_mission_consumption(
    uav_lat: float,
    uav_lng: float,
    target_lat: float,
    target_lng: float,
    target_id: str,
    uav_speed_kmh: float = 300.0,
    uav_remaining_time: float = 120.0
) -> Dict[str, Any]:
    """
    [APSO-LS v4 핵심 연동]
    UAV가 특정 ROI에 도착하여 정찰을 완료했을 때 소모되는 시간 산출:
    1) 이동시간 = (거리 / 속도) * 60 [min]
    2) 실제 정찰시간 = actual_service_times[target_id] [min]
    3) 총 소모시간 = 이동시간 + 실제 정찰시간
    4) 잔여 운용시간 = max(0, remaining_time - 총 소모시간)
    5) 15% 안전 예비시간(18분) 초과 여부 검증
    """
    # 하버사인 거리 계산 (km)
    ref_lat_rad = math.radians(uav_lat)
    dx = (target_lng - uav_lng) * 111.0 * math.cos(ref_lat_rad)
    dy = (target_lat - uav_lat) * 111.0
    distance_km = math.sqrt(dx * dx + dy * dy)

    # 1. 이동 소요시간
    travel_time_min = (distance_km / max(uav_speed_kmh, 1e-9)) * 60.0

    # 2. 실제 정찰시간 (예정시간 대신 실제 정찰시간으로 잔여 운용시간 갱신)
    actual_srv = ACTUAL_SERVICE_TIMES.get(target_id, 5.0)

    # 3. 총 소모시간
    consumed_min = travel_time_min + actual_srv

    # 4. 갱신된 잔여 운용시간
    new_remaining = max(0.0, uav_remaining_time - consumed_min)

    # 5. 안전 예비시간 (18분) 및 실제 가용시간
    reserve_min = 18.0
    usable_min = max(0.0, new_remaining - reserve_min)

    return {
        'target_id': target_id,
        'distance_km': round(distance_km, 2),
        'travel_time_min': round(travel_time_min, 2),
        'actual_service_time_min': round(actual_srv, 2),
        'total_consumed_min': round(consumed_min, 2),
        'previous_remaining_min': round(uav_remaining_time, 2),
        'updated_remaining_min': round(new_remaining, 2),
        'reserve_time_min': reserve_min,
        'usable_time_min': round(usable_min, 2),
        'battery_pct': round((new_remaining / 120.0) * 100.0, 1),
        'feasible': new_remaining >= reserve_min
    }


if __name__ == '__main__':
    data = get_tactical_init_data()
    print("Metrics:", data['metrics'])
    print("Generated Targets Count:", len(data['targets']))
    for t in data['targets'][:3]:
        print(" ", t['id'], t['name'], "Prio:", t['score'], "Assigned:", t['assignedDrone'])
    print("UAV Plans:")
    for uid, p in data['uav_plans'].items():
        print(f"  {uid}: {p['route_rois']}")
