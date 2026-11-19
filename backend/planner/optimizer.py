from __future__ import annotations
import math
import random
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional

import numpy as np

from models import ROI, UAV, Plan, RouteMetrics

"""
APSO-LS 알고리즘은 각 단계에서 임무의 makespan(전체 임무 완료시간)과 이동거리, ROI 우선순위을 고려하여 
임무 할당과 경로 계획을 효율적으로 최적화.
Rolling Horizon은 신규 ROI 발생 시 UAV의 현재 상태를 갱신하고,
갱신된 상태를 기준으로 최적화 문제를 다시 구성하여 재계획한다.

APSO가 전역적으로 좋은 영역을 찾고, _sa_local_search()가 그 주변을 세밀하게 추가 탐색해서 더 좋은 해를 찾는 구조
"""
EPS = 1e-12

# 거리 계산 (UAV 좌표와 ROI 좌표사이의 직선거리 계산)
def euclidean(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])

# APSO-LS에서 사용하는 모든 설정값을 모아놓은 클래스
@dataclass
class APSOLSConfig:
    n_particles: int = 50 # 동시에 탐색하는 임무계획 후보 수
    max_iter: int = 120 # 최대 120번 탐색
    c1: float = 1.8 # 자기 자신이 과거에 찾았던 좋은 해를 따라가는 정도
    c2: float = 1.8 # 전체 집단의 가장 좋은 해 따라가는 정도
    
    # 초기에는 넓게 탐색하고, 반복이 진행될수록 세밀하게 수렴시키기 위한 값
    inertia_max: float = 0.90
    inertia_min: float = 0.40

    # Adaptive Perturbation 파라미터 (최적값이 개선되지 않으면 rho는 Particle을 일부러 랜덤하게 흔드는 정도)
    rho_init: float = 0.08
    rho_min: float = 0.01
    rho_max: float = 0.35
    rho_increase: float = 1.35
    rho_decrease: float = 0.92
    stagnation_trigger: int = 5 # 5번 동안 gbest가 안 좋아지면 rho를 키움

    # SA Local Search 설정 (PSO가 찾은 좋은 결과 주변을 Simulated Annealing 방식으로 한 번 더 탐색)
    sa_temp_init: float = 1.0
    sa_alpha: float = 0.96
    local_search_steps: int = 10

    # Objective weights (목적함수 가중치)
    w_makespan: float = 1.0
    w_distance: float = 0.20
    w_priority_delay: float = 0.60
    unserved_penalty: float = 250.0

    seed: int = 42


class APSOLSPlanner:
    """
    Project-tailored APSO-LS for multi-UAV surveillance mission planning.

    Continuous particle encoding:
      - first N values: UAV assignment keys for each ROI
      - next N values : visit-order keys for each ROI

    The continuous PSO position is decoded into discrete UAV routes.
    Infeasible routes are repaired using remaining-time/range feasibility checks.
    Particle은 PSO에서 말하는 해답 후보 하나
    ROI들을 어떤 UAV에 배정하고, 어떤 순서로 방문할지를 숫자로 표현한 후보 임무계획 하나
    """

    # 현재 Stage에서 임무계획에 사용할 데이터를 받는 부분
    def __init__(self, rois: List[ROI], uavs: List[UAV], config: Optional[APSOLSConfig] = None):
        self.rois = list(rois) # 현재 Stage에서 정찰해야 하는 ROI 목록
        self.uavs = [u for u in uavs if u.active] # 사용 가능한 UAV만 선택 (active=True만)
        self.cfg = config or APSOLSConfig()

        if not self.uavs: # 활성 UAV 없으면 에러
            raise ValueError("No active UAVs available.")
        if not self.rois: # ROI가 없으면 에러
            raise ValueError("No ROIs to plan.")

        self.rng = np.random.default_rng(self.cfg.seed)
        random.seed(self.cfg.seed)

        self.n_r = len(self.rois) # ROI 개수
        self.n_u = len(self.uavs) # 사용 가능한 UAV 개수
        self.dim = 2 * self.n_r # Particle 차원 = UAV 할당 N개 + 방문순서 N개

        self.roi_by_id = {r.roi_id: r for r in self.rois} # ROI를 ID로 바로 찾기 위한 딕셔너리
        self.uav_by_id = {u.uav_id: u for u in self.uavs} # UAV도 ID로 바로 찾게 저장

    # ------------------------------------------------------------------
    # Encoding / decoding (이산형 임무할당 문제를 PSO에 넣기 때문)
    # ------------------------------------------------------------------
    
    # 초기 Particle에서 ROI별 UAV 할당값과 방문 순서값 생성 (Particle 생성 부분: [UAV 할당값 | 방문 순서값])
    def _heuristic_position(self) -> np.ndarray:
        """
        Initialize near a proximity + priority heuristic, with noise.
        ROI를 무작정 랜덤하게 UAV에 배정하지 않고, 가까운 UAV 쪽으로 배정하고 + 우선순위 높은 ROI를 앞쪽에 두는 형태로 초기값 생성.
        """

        assign = np.zeros(self.n_r, dtype=float) 
        order = np.zeros(self.n_r, dtype=float) 
        for j, roi in enumerate(self.rois):

            # UAV 할당값 생성
            distances = [euclidean((u.x, u.y), (roi.x, roi.y)) for u in self.uavs] # 현재 ROI와 각 UAV 사이 거리 계산
            nearest = int(np.argmin(distances)) # 가장 가까운 UAV index 선택
            assign[j] = nearest + self.rng.normal(0, 0.22) # 가장 가까운 UAV 근처로 초기화하되, 다양성을 위해 작은 노이즈 추가
            
            # 방문순서값 생성 (lower order key => visited earlier)
            order[j] = max(0.0, min(1.0, 1.0 - roi.priority + self.rng.normal(0, 0.12))) # priority가 높을수록 작은 order 값

        return self._clip_position(np.concatenate([assign, order]))

    # 완전 랜덤 방식으로 초기 Particle 생성 (Particle 생성 부분)
    def _random_position(self) -> np.ndarray:
        assign = self.rng.uniform(0, self.n_u, size=self.n_r) 
        order = self.rng.uniform(0, 1, size=self.n_r)
        return self._clip_position(np.concatenate([assign, order]))

    # Particle 값이 허용 범위를 벗어나지 않도록 제한
    def _clip_position(self, x: np.ndarray) -> np.ndarray:
        x = x.copy()
        x[:self.n_r] = np.clip(x[:self.n_r], 0.0, max(0.0, self.n_u - 1e-6)) # assignment key in [0, n_u)
        x[self.n_r:] = np.clip(x[self.n_r:], 0.0, 1.0) # order key in [0,1]
        return x

    # Particle의 할당값과 순서값을 실제 UAV별 ROI 경로로 변환
    def decode(self, position: np.ndarray) -> Dict[str, List[str]]:
        assign_keys = position[:self.n_r] # Particle의 앞부분은 UAV 할당
        order_keys = position[self.n_r:] # 뒷부분은 방문순서로 분리

        routes: Dict[str, List[Tuple[float, str]]] = {u.uav_id: [] for u in self.uavs} # 각 UAV별 빈 경로 생성
        
        # 할당 key의 정수 부분으로 담당 UAV 결정
        for j, roi in enumerate(self.rois):
            u_idx = min(self.n_u - 1, int(math.floor(assign_keys[j]))) # UAV 인덱스 결정
            routes[self.uavs[u_idx].uav_id].append((float(order_keys[j]), roi.roi_id)) # UAV: (방문순서값, ROI 이름)

        # 같은 UAV에 배정된 ROI들을 order key가 작은 순서대로 정렬
        decoded = {
            uav_id: [rid for _, rid in sorted(items, key=lambda z: z[0])]
            for uav_id, items in routes.items()
        }
        return decoded

    # ------------------------------------------------------------------
    # Feasibility / objective
    # ------------------------------------------------------------------
    # UAV 한 대의 경로에 대한 거리/시간을 계산
    def _route_metrics(self, uav: UAV, route: List[str]) -> RouteMetrics:

        # 시작위치 설정 
        current = (uav.x, uav.y)

        # 누적값 초기화
        distance = 0.0
        mission_time = 0.0
        weighted_arrival = 0.0

        # UAV에게 할당된 ROI를 순서대로 방문
        for rid in route:
            roi = self.roi_by_id[rid]
            leg = euclidean(current, (roi.x, roi.y)) # 현재 위치에서 다음 ROI까지 거리 계산
            distance += leg # 이동거리 누적
            mission_time += leg / max(uav.speed, EPS) * 60.0 # 이동시간 누적(현재 위치에서 ROI까지 가는 데 걸린 시간 추가)

            # 우선순위를 반영한 도착시간 (고우선순위 ROI를 늦게 방문할수록 비용 증가) 
            weighted_arrival += roi.priority * mission_time 

            mission_time += roi.service_time # ROI 정찰시간 추가

            # 현재 위치를 ROI 위치로 갱신
            current = (roi.x, roi.y)

        return RouteMetrics(
            distance=distance,
            mission_time=mission_time,
            weighted_arrival_time=weighted_arrival,
        )

    # 해당 UAV가 이 경로를 실제로 수행 가능한지 확인
    def _is_route_feasible(self, uav: UAV, route: List[str]) -> bool:

        # 해당 경로의 총 이동거리와 총 임무시간 계산
        m = self._route_metrics(uav, route)

        # 최대 운용시간 120분의 15%를 복귀/안전 예비시간으로 확보
        reserve_time = 120.0 * 0.15   # 18분
        usable_time = max(0.0, uav.remaining_time - reserve_time)
        
        # 남은 운용시간 제약 위반
        if m.mission_time > usable_time + 1e-9:
            return False
        
        # 최대 작전거리 제약 위반
        # if m.distance > uav.max_range + 1e-9:
        #     return False
        return True

    def _repair(self, raw_routes: Dict[str, List[str]]) -> Tuple[Dict[str, List[str]], List[str]]:
        """
        1) 각 UAV의 할당 경로를 순서대로 확인하여, 운용시간과 최대 작전거리 제약을 만족하는 ROI만 유지한다.
        2) 제외된 ROI는 우선순위가 높은 순서대로 다른 UAV의 수행 가능한 위치에 재배정한다.
        """
        routes = {u.uav_id: [] for u in self.uavs} # repair 후 사용할 UAV별 경로(비어있는 새 경로)
        removed: List[str] = [] # 수행 불가능한 ROI 저장

        # 각 UAV 경로를 앞에서부터 하나씩 검사
        for u in self.uavs:
            for rid in raw_routes.get(u.uav_id, []):
                trial = routes[u.uav_id] + [rid]

                # 실제 수행 가능한지 확인
                if self._is_route_feasible(u, trial):
                    routes[u.uav_id].append(rid)
                else:
                    removed.append(rid)

        # 제거된 ROI를 priority 순으로 정렬
        removed.sort(key=lambda rid: self.roi_by_id[rid].priority, reverse=True)

        # 어느 UAV에도 재할당하지 못한 ROI (미정찰 ROI)
        unserved = []

        # 제거된 ROI 하나씩 재삽입 시도
        for rid in removed:
            best = None  # 가장 좋은 재삽입 위치 찾기(incremental_cost, uav_id, insert_idx)

            # 모든 UAV에 넣어보기
            for u in self.uavs:

                # 현재 UAV 경로 계산
                base_route = routes[u.uav_id] 
                base_m = self._route_metrics(u, base_route)
                
                for idx in range(len(base_route) + 1):
                    trial = base_route[:idx] + [rid] + base_route[idx:]
                    if not self._is_route_feasible(u, trial):
                        continue

                    # 가능한 경로면 새 거리/시간 계산
                    m = self._route_metrics(u, trial)

                    # 추가 비용 계산(작을수록 좋음)
                    inc = (m.distance - base_m.distance) + 0.2 * (m.mission_time - base_m.mission_time)

                    # 가장 좋은 후보 저장
                    if best is None or inc < best[0]:
                        best = (inc, u.uav_id, idx)

            if best is None: # ROI는 현재 UAV 상태로는 아무도 수행할 수 없음
                unserved.append(rid)
            else: # 넣을 곳이 있으면 실제 삽입
                _, uid, idx = best
                routes[uid].insert(idx, rid)

        return routes, unserved

    # Particle이 얼마나 좋은 임무계획인지 점수(Cost)를 매기는 함수
    def evaluate(self, position: np.ndarray) -> Tuple[float, Plan]:
        raw = self.decode(position) # Particle을 실제 경로로 변환
        routes, unserved = self._repair(raw)

        # metrics = {} # 각 UAV별 계산 결과 저장
        total_distance = 0.0
        weighted_arrival = 0.0
        makespan = 0.0

        # 각 UAV의 경로 평가
        for u in self.uavs:
            m = self._route_metrics(u, routes[u.uav_id])
            # metrics[u.uav_id] = m 

            # 전체 UAV 결과 합산
            total_distance += m.distance # 모든 UAV의 총 이동거리
            weighted_arrival += m.weighted_arrival_time # 우선순위 기반 도착시간 누적
            makespan = max(makespan, m.mission_time) # 가장 오래 걸리는 UAV의 임무시간

        # 미정찰 ROI들의 Priority 합 
        missed = sum(self.roi_by_id[rid].priority for rid in unserved)

        # 목적함수: makespan + distance + priority delay + 미정찰 penalty
        # Codt가 작을수록 더 좋은 Particle
        cost = (
            self.cfg.w_makespan * makespan # 전체 임무 완료 시간
            + self.cfg.w_distance * total_distance # 전체 이동 거리
            + self.cfg.w_priority_delay * weighted_arrival # 고우선순위 ROI 도착지연 
            + self.cfg.unserved_penalty * missed # 미정찰 ROI 페널티 
        )

        # 결과를 Plan으로 묶기
        plan = Plan(
            routes=routes,
            unserved=list(unserved),
            cost=float(cost),
            makespan=float(makespan),
            total_distance=float(total_distance),
            weighted_arrival_time=float(weighted_arrival),
        )
        return float(cost), plan

    # ------------------------------------------------------------------
    # Local search 
    # _neighbor()가 현재 좋은 해 주변에서 이웃 해를 생성하고, 
    # _sa_local_search()가 Simulated Annealing 방식으로 이웃 해를 탐색하여 더 좋은 해를 찾음
    # ------------------------------------------------------------------
    # Local Search에서 현재 해 주변의 이웃 해 생성
    def _neighbor(self, x: np.ndarray) -> np.ndarray:
        y = x.copy()

        # 방문순서 교환 / UAV 재할당 / 작은 값 흔들기 중 하나 선택
        move_type = random.choice(["swap_order", "reassign", "jitter"])

        # 방문순서 교환 (ROI 두 개의 방문 순서를 바꾸는 것)
        if move_type == "swap_order" and self.n_r >= 2:
            i, j = random.sample(range(self.n_r), 2)
            y[self.n_r + i], y[self.n_r + j] = y[self.n_r + j], y[self.n_r + i]

        # UAV 재할당 (담당 UAV를 바꿔보는 탐색)
        elif move_type == "reassign" and self.n_u > 1:
            i = random.randrange(self.n_r)
            current = int(math.floor(y[i]))
            choices = [k for k in range(self.n_u) if k != current]
            new_u = random.choice(choices)
            y[i] = new_u + random.random() * 0.95

        # 작은 값 흔들기 (현재 해 근처에서 살짝 바꿔보기)
        else:
            # local continuous perturbation
            idx = random.randrange(self.dim)
            scale = 0.20 if idx < self.n_r else 0.10
            y[idx] += random.gauss(0.0, scale)

        return self._clip_position(y) # 다시 정상 범위 안에 넣어서 반환

    # Simulated Annealing 기반 Local Search
    def _sa_local_search(self, x: np.ndarray, temp: float) -> Tuple[np.ndarray, float]:
        current = x.copy() # 현재 particle을 복사해서 local search 시작점으로 잡음 
        current_cost, _ = self.evaluate(current) # 현재 Particle의 Cost를 계산
        best = current.copy()
        best_cost = current_cost

        # SA에서 사용온하는 온도(Temperature)값
        T = max(temp, 1e-6) # 온도가 높을수록 나쁜 해도 어느 정도 받아들여서 넓게 탐색, 온도가 낮아질수록 좋은 해 위주로만 움직임

        # 설정된 횟수만큼 Local Search를 반복
        for _ in range(self.cfg.local_search_steps):
            neighbor = self._neighbor(current) # 현재 Particle을 조금 바꾼 새로운 후보 생성
            n_cost, _ = self.evaluate(neighbor) # 새 이웃의 Particle의 cost 계산
            delta = n_cost - current_cost # delta가 음수이면 더 좋은 해

            # 더 좋은 해는 수용, 더 나쁜 해도 SA 확률에 따라 가끔 수용
            if delta < 0 or random.random() < math.exp(-delta / max(T, 1e-9)):
                current = neighbor
                current_cost = n_cost

            # 현재 해가 지금까지 찾은 최고 해보다 좋다면
            if current_cost < best_cost:
                best = current.copy()
                best_cost = current_cost

            # 온도를 조금씩 낮춤
            T *= self.cfg.sa_alpha

        return best, best_cost # Local Search 과정에서 찾은 가장 좋은 Particle과 Cost를 반환

    # ------------------------------------------------------------------
    # APSO-LS main loop
    # ------------------------------------------------------------------
    def optimize(self, verbose: bool = False) -> Tuple[Plan, List[float]]:
        n = self.cfg.n_particles # Particle 개수 

        # 초기 Particle 생성: 약 1/3은 heuristic, 나머지는 random
        positions = np.vstack([
            self._heuristic_position() if i < max(2, n // 3) else self._random_position()
            for i in range(n)
        ]) # np.vstack()는 이렇게 생성된 Particle들을 세로로 쌓음

        # 각 Particle의 초기 velocity 생성
        velocities = self.rng.normal(0.0, 0.05, size=(n, self.dim))

        # 초기 위치를 각 Particle의 personal best로 설정
        pbest = positions.copy()

        # 각 Particle의 Cost 계산
        pbest_cost = np.array([self.evaluate(x)[0] for x in pbest])

        # 초기 global best 선택
        g_idx = int(np.argmin(pbest_cost))
        gbest = pbest[g_idx].copy() 
        gbest_cost = float(pbest_cost[g_idx]) # 

        # APSO용 변수 초기화
        rho = self.cfg.rho_init # Adaptive Perturbation 크기 (Particle을 일부러 흔들어 탐색 영역을 넓히는 정도)
        temp = self.cfg.sa_temp_init # SA Local Search에 사용할 초기 온도
        stagnation = 0 # gbest가 몇 번 연속 개선되지 않았는지 세는 값
        history = [gbest_cost] # 반복하면서 최고 Cost가 어떻게 변했는지 저장하는 리스트

        # APSO 반복시작
        for it in range(self.cfg.max_iter):
            frac = it / max(self.cfg.max_iter - 1, 1) # 현재 반복 진행 정도

            # 반복이 진행될수록 관성가중치를 감소시켜 탐색 -> 수렴으로 전환
            inertia = self.cfg.inertia_max + frac * (self.cfg.inertia_min - self.cfg.inertia_max)
            improved_global = False # 이번 반복에서 gbest가 개선됐는지 체크하기 위한 변수

            # 모든 Particle 하나씩 업데이트
            for p in range(n):

                # Particle 이동에 필요한 랜덤값 생성
                r1 = self.rng.random(self.dim) # pbest 쪽으로 움직이는 정도에 랜덤성 부여
                r2 = self.rng.random(self.dim) # gbest 쪽으로 움직이는 정도에 랜덤성 부여
                xi = self.rng.normal(0.0, 1.0, size=self.dim) # adaptive perturbation에 사용하는 노이즈

                # APSO 속도 업데이트: inertia + pbest + gbest + adaptive perturbation (APSO의 핵심 수식)
                velocities[p] = (
                    inertia * velocities[p] # 기존 움직임 유지
                    + self.cfg.c1 * r1 * (pbest[p] - positions[p]) # 자기 최고해 따라가기
                    + self.cfg.c2 * r2 * (gbest - positions[p]) # 전체 최고해 따라가기
                    + rho * xi # Adaptive perturbation 
                )

                # Particle 위치 업데이트 후 허용 범위로 제한
                positions[p] = self._clip_position(positions[p] + velocities[p])
                cost, _ = self.evaluate(positions[p])

                # 개인 최고 pbest 갱신 (기존 personal best보다 좋아졌으면 갱신)
                if cost < pbest_cost[p]:
                    pbest[p] = positions[p].copy()
                    pbest_cost[p] = cost
                    rho = max(self.cfg.rho_min, rho * self.cfg.rho_decrease) # 개선됐으면 perturbation 감소

                    # 전체 최고 gbest 갱신
                    if cost < gbest_cost:
                        gbest = positions[p].copy()
                        gbest_cost = float(cost)
                        improved_global = True

            # 현재 global best 주변을 SA Local Search로 추가 탐색 (APSO가 현재까지 찾은 gbest 주변을 조금 더 세밀하게 뒤져봄)
            ls_x, ls_cost = self._sa_local_search(gbest, temp)

            # Local Search가 더 좋은 해를 찾았다면
            if ls_cost < gbest_cost:
                gbest = ls_x # gbest 다시 갱신
                gbest_cost = float(ls_cost)
                improved_global = True

            temp *= self.cfg.sa_alpha # SA 온도 감소

            if improved_global:
                stagnation = 0
            else:
                stagnation += 1

            # 일정 횟수 동안 gbest 개선이 없으면 perturbation을 키워 탐색 확대
            if stagnation >= self.cfg.stagnation_trigger:
                rho = min(self.cfg.rho_max, rho * self.cfg.rho_increase)
                stagnation = 0

            history.append(gbest_cost) # 최고 Cost 기록

            if verbose and (it % 10 == 0 or it == self.cfg.max_iter - 1):
                print(f"[iter {it:03d}] best={gbest_cost:.3f}, rho={rho:.4f}, T={temp:.4f}")

        # 최종 global best를 실제 Plan 형태로 변환
        _, best_plan = self.evaluate(gbest)
        return best_plan, history
