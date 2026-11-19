export type DroneStatus = '정상 감시' | '급파 요격' | '현장 정밀 정찰' | '복귀 중';

export interface Drone {
  id: string;
  name: string;
  model?: string;
  color: string;
  battery: number;
  speedKmh: number;
  maxMinutes: number;
  remainMinutes: number;
  status: DroneStatus;
  currentLat: number;
  currentLng: number;
  targetLat: number | null;
  targetLng: number | null;
  assignedTargetId: string | null;
  center: [number, number];
  radius: number;
  patrolAngle: number;
  patrolPoints: [number, number][];
  apsoCost?: number;
  heading?: number;
  altitudeFt?: number;
  actualServiceTime?: number;    // [v4] 현장 실제 정찰시간 (분)
  plannedServiceTime?: number;   // [v4] APSO 계획 정찰시간 (분)
  consumedMinutes?: number;      // [v4] 해당 임무 총 소모시간 (이동 + 실제정찰)
  usableMinutes?: number;        // [v4] 15%(18분) 안전선 제외 가용 운용시간
}

export interface TacticalTarget {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  score: number;
  threatLevel?: number;
  responseLevel: string;
  levelColor: string;
  assignedDrone: string;
  recommendation: string;
  status: string;
  authorized: boolean;
  detectedCount?: number;
  detectedClass?: string;
  enemyType?: string;
  area_km2?: number;             // ROI 면적 (km²)
  changeScore?: number;          // 변화 탐지 강도
  serviceTime?: number;          // 예정 정찰시간 (T_service = 3.0 + 500*Area + 2.0*Prio)
  actualServiceTime?: number;    // [v4] 실제 정찰시간 (UAV 잔여 운용시간 갱신용)
}


export type VideoFeedState = 'PATROL' | 'EN_ROUTE' | 'DISCOVERING' | 'TURNING' | 'TRACKING';

export type SimSpeed = 1 | 2 | 5 | 10;
