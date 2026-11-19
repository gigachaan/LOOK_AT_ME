from dataclasses import dataclass, field
from typing import List, Dict, Tuple


# 관심지역(Region of Interest) 정보 저장
@dataclass
class ROI:
    roi_id: str
    x: float
    y: float
    priority: float          # 0~1
    service_time: float = 2.0

# UAV의 현재 상태 저장
@dataclass
class UAV:
    uav_id: str
    x: float
    y: float
    remaining_time: float = 90.0 # 현재 남은 운용 가능 시간
    # max_range: float = 100.0 # 최대 비행 거리
    speed: float = 80.0
    active: bool = True # 운용 가능 여부

# UAV 한 대의 경로를 평가한 결과
@dataclass
class RouteMetrics:
    distance: float = 0.0 # 총 이동거리
    mission_time: float = 0.0 # 총 임무시간 (이동 시간 + 각 ROI에서 정찰하는 시간)
    weighted_arrival_time: float = 0.0 # ROI 도착시간

# APSO-LS가 최종적으로 찾은 전체 UAV 임무계획 결과 저장
@dataclass
class Plan:
    routes: Dict[str, List[str]]
    unserved: List[str]
    cost: float
    makespan: float
    total_distance: float
    weighted_arrival_time: float
