from __future__ import annotations
from dataclasses import replace
from typing import List, Dict, Iterable

from models import ROI, UAV
from optimizer import APSOLSPlanner, APSOLSConfig, euclidean


class RollingHorizonSimulator:
    """
    Event/stage-based Rolling Horizon simulator.

    각 Stage에서:
    1) 신규 ROI를 기존 미수행 ROI에 추가
    2) 현재 UAV 위치와 남은 운용시간을 기준으로 APSO-LS 재계획
    3) 각 UAV에 할당된 경로 중 첫 번째 ROI 임무 수행
    4) 수행 후 UAV 위치와 남은 운용시간 갱신
    5) 완료한 ROI 제거
    6) 다음 신규 ROI 발생 시 미수행 ROI와 함께 다시 재계획
    """

    # 시뮬레이터 초기화
    def __init__(self, uavs: List[UAV], config: APSOLSConfig):
        self.uavs = [replace(u) for u in uavs]
        self.config = config # APSO-LS 설정값 저장
        self.outstanding: Dict[str, ROI] = {} # 아직 수행하지 않은 ROI를 저장할 딕셔너리
        self.completed: List[str] = [] # 이미 수행 완료한 ROI ID 저장
        self.stage_logs = [] # 각 Stage 결과를 기록해두는 리스트

    # 신규 ROI 추가
    def add_rois(self, rois: Iterable[ROI]):
        # 새롭게 발생한 ROI를 outstanding 추가
        for r in rois:
            if r.roi_id not in self.completed:
                self.outstanding[r.roi_id] = r

    # 실제 임무 수행 반영
    def _consume_leg_and_service(self, uav: UAV, roi: ROI, actual_service_time: float = None):

        # 현재 UAV 위치에서 ROI까지 거리
        d = euclidean((uav.x, uav.y), (roi.x, roi.y))

        # 이동시간 계산 (거리=km, 속도=km/h, 시간=min 기준)
        travel_time = (d / max(uav.speed, 1e-9)) * 60.0

        # 실제 임무에 소요된 시간 = 이동시간 + (실제 정찰시간 또는 예정 정찰시간)
        srv_time = actual_service_time if actual_service_time is not None else roi.service_time
        consumed_time = travel_time + srv_time
        
        # 남은 운용시간 감소
        uav.remaining_time = max(0.0, uav.remaining_time - consumed_time)
        
        # 임무 수행 후 현재 위치를 ROI 위치로 갱신
        uav.x, uav.y = roi.x, roi.y

    # Rolling Horizon 핵심 (새로운 ROI가 발생할 때마다 호출)
    def run_stage(self, new_rois: List[ROI], actual_service_times: Dict[str, float] = None, verbose: bool = False):
        self.add_rois(new_rois) # 신규 ROI를 기존 미수행 ROI에 합침

        # 수행할 ROI가 하나도 없으면 아무것도 안 하고 종료
        if not self.outstanding:
            return None

        # APSO-LS 호출
        planner = APSOLSPlanner(
            rois=list(self.outstanding.values()),
            uavs=self.uavs,
            config=self.config,
        ) # 현재 미수행 ROI + 현재 UAV 상태를 optimizer에 넣음
        plan, history = planner.optimize(verbose=verbose) # 실제로 APSO-LS를 돌려서 최적 계획을 받음

        executed = [] # 이번 Stage에서 실제 수행한 임무 기록용
        # Execute only the first task per UAV before replanning. (UAV한대당 하나의 ROI만 수행)
        for u in self.uavs:
            route = plan.routes.get(u.uav_id, [])
            if not route:
                continue

            rid = route[0] # 첫번째 ROI만 가져옴
            if rid not in self.outstanding:
                continue

            roi = self.outstanding[rid] # 현재 수행하려는 ROI 객체 꺼냄 
            actual_srv = (actual_service_times.get(rid, roi.service_time) if actual_service_times else roi.service_time)
            self._consume_leg_and_service(u, roi, actual_service_time=actual_srv) # 위치 갱신, remaining_time 감소
            executed.append((u.uav_id, rid)) # 이번 Stage에서 실제 수행한 UAV-ROI 임무 기록
            self.completed.append(rid) # 해당 ROI를 완료 목록에 추가
            del self.outstanding[rid] # 미수행 목록에서는 제거

        # 로그 저장
        log = {
            "plan": plan, # APSO-LS가 만든 전체 계획
            "history": history, # 반복하면서 Cost가 어떻게 줄었는지
            "executed": executed, # 이번에 실제 수행한 ROI
            "uav_states": [
                (u.uav_id, round(u.x, 2), round(u.y, 2), round(u.remaining_time, 2))
                for u in self.uavs
            ], # 현재 UAV 상태
            "remaining": list(self.outstanding.keys()), # 아직 미수행 ROI 목록
        }
        self.stage_logs.append(log)
        return log
