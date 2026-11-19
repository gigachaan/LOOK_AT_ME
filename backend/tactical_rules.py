# -*- coding: utf-8 -*-
"""
전술 대응 룰 엔진 (Tactical Doctrine Rules Engine)
- 1차 ROI 위협도 공식과 100% 동일한 수식 체계 적용:
  1) 개별 표적 위협도 단위: s_ij = w_c * q_ij * (100 / (100 + d_ij))
  2) 시그마(∑) 객체 수량 합산: sum_s = ∑ s_ij = count * s_ij
  3) 전술 위협도 로그 집계: O_Tactical = ln(1 + ∑ s_ij)
- [단조 증가 보장] 객체 탐지 수가 일시적으로 줄어도 위협도와 식별 수량은 낮추지 않고 피크값(High-Water Mark) 유지
"""

import math

# 기준점 A: 서부전선 문산 방어 원점 (거리 환산 기준)
REF_LAT, REF_LNG = 37.8300, 126.7300

# 2차 현장 정밀 식별 기종별 전술 가중치 (w_c) 및 작전 교리 매핑
# ※ O = ln(1 + ∑ s_ij) 적용 시 대응 추천 구간(긴급 >= 0.85, 우선 >= 0.70, 지속관찰 >= 0.40, 일반 < 0.40)에 맞게 정밀 보정
TACTICAL_DOCTRINE = {
    "radar": {
        "name": "적 저고도 대공 탐색 레이더 기지 [방공망]",
        "type": "방공 자산 (최우선)",
        "w_c": 1.90,
        "recommendation": "🎯 정밀 유도탄 및 방공망 제압 사격 (SEAD)"
    },
    "tel": {
        "name": "적 이동식 미사일 발사대 (TEL) / 방사포 대열",
        "type": "화력 자산 (최우선)",
        "w_c": 0.95,
        "recommendation": "💥 K-9 자주포 / 대화력전 즉각 집중 타격"
    },
    "tank": {
        "name": "적 전차 대열 [T-72/T-90 계열]",
        "type": "기갑 전력 (중위협)",
        "w_c": 0.88,
        "recommendation": "💥 K-9 자주포 즉각 타격 연계"
    },
    "apc": {
        "name": "적 기동 보병 전투장갑차 대열 [BMP/BTR 계열]",
        "type": "기동 병력 (고위협)",
        "w_c": 0.70,
        "recommendation": "🚁 공격헬기 대전차 유도탄 출격"
    },
    "truck": {
        "name": "적 군수 보급 수송 트럭 대열 [Ural 계열]",
        "type": "군수 보급 (통상)",
        "w_c": 0.32,
        "recommendation": "👀 선회 비행 및 보급로 추가 정밀 식별"
    },
    "civilian": {
        "name": "민간 의심 차량 이동체",
        "type": "비전투 이동체",
        "w_c": 0.25,
        "recommendation": "🔍 광학 줌 센서로 민간 오인 방지 추가 정밀 식별"
    }
}

def calc_distance_km(lat: float, lng: float) -> float:
    """기준점 A(문산 방어 원점) 대비 평면 유클리드 실측 거리 계산 (km)"""
    x = (lng - REF_LNG) * 111.0 * math.cos(math.radians(REF_LAT))
    y = (lat - REF_LAT) * 111.0
    return math.hypot(x, y)

def evaluate_tactical_target(
    detected_class: str,
    confidence: float,
    lat: float,
    lng: float,
    target_id: str = "ROI_06",
    count: int = 0,
    prev_score: float = 0.0,
    prev_count: int = 0,
    assigned_drone: str = ""
):
    """
    UAV 현장 도착 후 실시간 2-Stage AI 인식 기반 2차 전술 위협도 산정:
    1) s_ij = w_c * q_ij * (100 / (100 + d_ij))
    2) ∑ s_ij = effective_count * s_ij  (실제 탐지된 객체 수량만큼 시그마 합산)
    3) Threat = ln(1 + ∑ s_ij)
    4) [단조 증가] 탐지 개수가 일시적으로 줄어도 위협도와 기물 개수는 피크값(High-Water Mark) 유지
    """
    cls_key = (detected_class or "TARGET").lower().strip()
    effective_count = max(count, prev_count)
    suffix = "대열" if effective_count >= 2 else "표적"

    if any(k in cls_key for k in ["btr", "bmp", "bmd", "mt-lb", "apc"]):
        doctrine_key = "apc"
        default_name = f"적 기동 장갑차 {suffix} [{detected_class.upper()}]"
    elif any(k in cls_key for k in ["t-64", "t-72", "t-80", "t-90", "t-", "tank", "전차"]):
        doctrine_key = "tank"
        default_name = f"적 주력전차 {suffix} [{detected_class.upper()}]"
    elif any(k in cls_key for k in ["radar", "레이더"]):
        doctrine_key = "radar"
        default_name = f"적 대공 탐색 레이더 [{detected_class.upper()}]"
    elif any(k in cls_key for k in ["tel", "bm-21", "방사포"]):
        doctrine_key = "tel"
        default_name = f"적 다연장로켓/방사포 {suffix} [{detected_class.upper()}]"
    elif any(k in cls_key for k in ["truck", "트럭"]):
        doctrine_key = "truck"
        default_name = f"적 군수 보급 수송 차량 {suffix}"
    elif "civilian" in cls_key:
        doctrine_key = "civilian"
        default_name = "민간 의심 차량 이동체"
    elif cls_key in ["target", "military_vehicle", "unknown"]:
        doctrine_key = "apc"
        default_name = f"적 기동 기갑/차량 {suffix} [정밀 판독 중]"
    else:
        doctrine_key = "apc"
        default_name = f"적 지상 전투 장비 {suffix} [{detected_class.upper()}]"

    doctrine = TACTICAL_DOCTRINE.get(doctrine_key, {
        "name": default_name,
        "type": "기동 장갑 (고위협)",
        "w_c": 0.75,
        "recommendation": "🚁 공격헬기 대전차 유도탄 출격"
    })

    # 1. 기준점 A 원점 기준 실측 거리 d_ij (km)
    dist_km = calc_distance_km(lat, lng)

    # 2. 거리 보정 함수 f(d) = 100 / (100 + d)
    f_d = 100.0 / (100.0 + dist_km) if dist_km >= 0 else 1.0

    # 3. 단일 표적 위협도 단위: s_ij = w_c * q_ij * f(d)
    s_single = doctrine["w_c"] * confidence * f_d

    # 4. 실제 식별된 객체 수만큼 시그마(∑) 합산
    sum_s = effective_count * s_single

    # 5. 로그 집계 O = ln(1 + ∑ s_ij)
    if effective_count > 0:
        raw_threat = math.log(1.0 + sum_s)
        calc_score = min(1.0, max(0.05, round(raw_threat, 2)))
    else:
        calc_score = prev_score

    # 6. [위협도 단조 증가] 이전 위협도보다 낮아지지 않음
    final_score = max(prev_score, calc_score)

    # 7. 산출된 위협도 및 실제 인식된 기종(doctrine_key)에 따른 실시간 작전 대응 등급 매핑
    is_cmd = doctrine_key == "tel" or "지휘" in default_name
    is_radar = doctrine_key == "radar" or "방공" in default_name
    is_bunker = "진지" in default_name or "엄체호" in default_name
    is_column = effective_count >= 2 or "대열" in default_name

    if final_score >= 0.85:
        response_level = "🚨 긴급 타격"
        level_color = "bg-red-950 text-red-400 border border-red-700 animate-pulse"
        if doctrine_key in ["tank", "apc"]:
            recommendation = "💥 K-9 자주포 TOT 집중사격 연계"
        elif is_radar:
            recommendation = "🎯 정밀 유도탄 및 방공망 제압 사격 (SEAD)"
        elif is_cmd:
            recommendation = "🚀 KTSSM 전술지대지 유도탄 정밀 타격"
        else:
            recommendation = "💥 지상 화력 즉각 집중 타격"
    elif is_cmd or (final_score >= 0.745 and not is_radar):
        response_level = "🎯 화력 타격"
        level_color = "bg-rose-950 text-rose-300 border border-rose-600"
        recommendation = "🚀 KTSSM/대화력전 정밀유도탄 타격"
    elif is_radar or (final_score >= 0.73 and final_score < 0.745):
        response_level = "📡 방공 제압"
        level_color = "bg-purple-950 text-purple-300 border border-purple-600"
        recommendation = "🎯 대레이더 유도탄 방공망 제압(SEAD)"
    elif is_bunker or (final_score >= 0.715 and final_score < 0.73):
        response_level = "▲ 우선 타격"
        level_color = "bg-amber-950 text-amber-300 border border-amber-600"
        recommendation = "🚁 공격헬기 대전차 유도탄 출격"
    elif is_column or final_score >= 0.70:
        response_level = "⚔️ 기동 차단"
        level_color = "bg-orange-950 text-orange-300 border border-orange-600"
        recommendation = "🚀 다연장로켓(MLRS) 종심 차단사격"
    elif final_score >= 0.60:
        response_level = "● 전술 감시"
        level_color = "bg-cyan-950 text-cyan-300 border border-cyan-700"
        recommendation = "👀 선회 비행 및 보급로 동향 추적" if doctrine_key == "truck" else "👀 선회 비행 및 편대 동향 정밀 추적"
    elif final_score >= 0.40:
        response_level = "● 경계 감시"
        level_color = "bg-blue-950 text-blue-300 border border-blue-700"
        recommendation = "🔍 기동축선 선회 및 지속 감시 유지"
    else:
        response_level = "● 일반 확인"
        level_color = "bg-slate-800 text-slate-400 border border-slate-700"
        recommendation = "🔍 광학 줌 센서 민간 오인방지 식별" if doctrine_key == "civilian" else "🔍 광학 줌 센서로 추가 정밀 식별"

    return {
        "id": target_id,
        "name": default_name,
        "type": doctrine["type"],
        "lat": round(lat, 4),
        "lng": round(lng, 4),
        "distanceKm": round(dist_km, 2),
        "score": final_score,
        "responseLevel": response_level,
        "levelColor": level_color,
        "assignedDrone": assigned_drone,
        "recommendation": recommendation,
        "status": "승인 대기",
        "authorized": False,
        "detectedCount": effective_count,
        "detectedClass": detected_class.upper() if detected_class else "TARGET",
        "enemyType": doctrine_key
    }




