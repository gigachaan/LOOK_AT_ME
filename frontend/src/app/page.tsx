'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import CommandHeader from '@/components/CommandHeader';
import DroneFleetStatus from '@/components/DroneFleetStatus';
import ReconCameraFeed from '@/components/ReconCameraFeed';
import DecisionTable from '@/components/DecisionTable';
import LoginGate from '@/components/LoginGate';
import DroneModal from '@/components/DroneModal';
import TargetModal from '@/components/TargetModal';
import { Drone, TacticalTarget, VideoFeedState, SimSpeed } from '@/types/c4i';

const TacticalMap = dynamic(() => import('@/components/TacticalMap'), { ssr: false });

// 위협도 점수 및 실시간 AI 식별 표적 특성 기준 전술 대응 교리 등급 산출 함수
function getDoctrineTier(
  score: number,
  enemyType: string = 'tank',
  targetName: string = '',
  targetType: string = '',
  detectedCount: number = 1
) {
  const eLower = (enemyType || '').toLowerCase();
  const nLower = (targetName || '').toLowerCase();
  const tLower = (targetType || '').toLowerCase();

  const isArmor = eLower.includes('tank') || eLower.includes('apc') || eLower.includes('btr') || eLower.includes('bmp') || eLower.includes('bmd') || eLower.includes('mt-lb') || eLower.includes('기갑') || eLower.includes('전차') || eLower.includes('장갑') || nLower.includes('기갑') || nLower.includes('전차') || nLower.includes('장갑');
  const isRadar = eLower.includes('radar') || eLower.includes('레이더') || eLower.includes('방공') || nLower.includes('레이더') || nLower.includes('방공') || tLower.includes('방공');
  const isCommand = nLower.includes('지휘소') || tLower.includes('지휘소') || nLower.includes('지휘') || tLower.includes('지휘') || eLower.includes('지휘') || eLower.includes('tel') || eLower.includes('bm-21') || nLower.includes('방사포') || nLower.includes('다연장');
  const isBunker = nLower.includes('엄체호') || nLower.includes('진지') || tLower.includes('진지');
  const isColumn = detectedCount >= 2 || nLower.includes('전투 대열') || nLower.includes('대열') || tLower.includes('대열');
  const isSupply = nLower.includes('보급') || tLower.includes('보급') || eLower.includes('truck');
  const isCivilian = nLower.includes('민간') || tLower.includes('비전투') || eLower.includes('civilian');

  // Tier 1: 최우선 긴급 타격 (score >= 0.85 또는 1.00 - 적 기갑 기동 집결지 등)
  if (score >= 0.85) {
    return {
      responseLevel: '🚨 긴급 타격',
      levelColor: 'bg-red-950 text-red-400 border border-red-700 animate-pulse',
      recommendation: isArmor
        ? '💥 K-9 자주포 TOT 집중사격 연계'
        : isRadar
        ? '🎯 정밀 유도탄 및 방공망 제압 사격 (SEAD)'
        : isCommand
        ? '🚀 KTSSM 전술지대지 지휘부 정밀 타격'
        : '💥 지상 화력 즉각 집중 타격'
    };
  }

  // Tier 2: 고가치 지휘통제 타격 (score >= 0.745 & 지휘소)
  if (isCommand || (score >= 0.745 && !isRadar)) {
    return {
      responseLevel: '🎯 지휘 타격',
      levelColor: 'bg-rose-950 text-rose-300 border border-rose-600',
      recommendation: '🚀 KTSSM/정밀유도탄 지휘부 타격'
    };
  }

  // Tier 3: 방공망/레이더 제압 (score >= 0.73 & 방공/레이더)
  if (isRadar || (score >= 0.73 && score < 0.745)) {
    return {
      responseLevel: '📡 방공 제압',
      levelColor: 'bg-purple-950 text-purple-300 border border-purple-600',
      recommendation: '🎯 대레이더 유도탄 방공망 제압(SEAD)'
    };
  }

  // Tier 4: 엄체호/진지 정밀 타격 (score >= 0.715 & 엄체호/진지)
  if (isBunker || (score >= 0.715 && score < 0.73)) {
    return {
      responseLevel: '▲ 우선 타격',
      levelColor: 'bg-amber-950 text-amber-300 border border-amber-600',
      recommendation: '🚁 공격헬기 대전차 유도탄 출격'
    };
  }

  // Tier 5: 기갑 대열 기동 차단 (score >= 0.70 & 기동대열)
  if (isColumn || score >= 0.70) {
    return {
      responseLevel: '⚔️ 기동 차단',
      levelColor: 'bg-orange-950 text-orange-300 border border-orange-600',
      recommendation: '🚀 다연장로켓(MLRS) 종심 차단사격'
    };
  }

  // Tier 6: 후방 보급 및 전술 감시 (score >= 0.60)
  if (score >= 0.60) {
    return {
      responseLevel: '● 전술 감시',
      levelColor: 'bg-cyan-950 text-cyan-300 border border-cyan-700',
      recommendation: isSupply
        ? '👀 선회 비행 및 보급로 동향 추적'
        : '👀 선회 비행 및 편대 동향 정밀 추적'
    };
  }

  // Tier 7: 지속 경계 감시 (score >= 0.40)
  if (score >= 0.40) {
    return {
      responseLevel: '● 경계 감시',
      levelColor: 'bg-blue-950 text-blue-300 border border-blue-700',
      recommendation: '🔍 기동축선 선회 및 지속 감시 유지'
    };
  }

  // Tier 8: 일반 확인 (< 0.40)
  return {
    responseLevel: '● 일반 확인',
    levelColor: 'bg-slate-800 text-slate-400 border border-slate-700',
    recommendation: isCivilian
      ? '🔍 광학 줌 센서 민간 오인방지 식별'
      : '🔍 광학 줌 센서로 추가 정밀 식별'
  };
}

// 평시 기본 감시 표적 (3개 축선 정상 감시)
const INITIAL_TARGETS: TacticalTarget[] = [
  {
    id: 'SEC-01',
    name: '문산 서부 축선 광역 감시',
    type: '정상 감시',
    lat: 37.8420,
    lng: 126.7450,
    score: 0.08,
    responseLevel: '● 광역 감시',
    levelColor: 'bg-slate-800 text-slate-300 border border-slate-700',
    assignedDrone: 'UAV-01',
    recommendation: '사전 계획 비행선 유지 및 감시',
    status: '정상 감시',
    authorized: true,
  },
  {
    id: 'SEC-02',
    name: '파주 중부 축선 광역 감시',
    type: '정상 감시',
    lat: 37.8350,
    lng: 126.7950,
    score: 0.05,
    responseLevel: '● 광역 감시',
    levelColor: 'bg-slate-800 text-slate-300 border border-slate-700',
    assignedDrone: 'UAV-02',
    recommendation: '사전 계획 비행선 유지 및 감시',
    status: '정상 감시',
    authorized: true,
  },
  {
    id: 'SEC-03',
    name: '연천 동부 축선 광역 감시',
    type: '정상 감시',
    lat: 37.8710,
    lng: 126.8320,
    score: 0.09,
    responseLevel: '● 광역 감시',
    levelColor: 'bg-slate-800 text-slate-300 border border-slate-700',
    assignedDrone: 'UAV-03',
    recommendation: '사전 계획 비행선 유지 및 감시',
    status: '정상 감시',
    authorized: true,
  },
];

// [핵심] 3기 UAV의 비행 구역(원)이 서로 절대 겹치지 않도록 보장하는 분할 구역 생성 함수
function generateRandomDrones(): Drone[] {
  const droneConfigs = [
    { id: 'UAV-01', name: 'UAV-01 (KUS-FS 1호기)', color: '#00f0ff', baseSpeed: 300 },
    { id: 'UAV-02', name: 'UAV-02 (KUS-FS 2호기)', color: '#10b981', baseSpeed: 320 },
    { id: 'UAV-03', name: 'UAV-03 (KUS-FS 3호기)', color: '#c084fc', baseSpeed: 290 },
  ];

  // 3개 독립 작전 축선 정의 (경도 간격 약 4.4km 이상으로 원 직경 2.4km 기준 겹침 원천 차단)
  const sectorBases = [
    { baseLat: 37.850, baseLng: 126.745, latSpan: 0.012, lngSpan: 0.012 }, // 서부 문산 축선
    { baseLat: 37.835, baseLng: 126.795, latSpan: 0.012, lngSpan: 0.012 }, // 중부 파주 축선
    { baseLat: 37.865, baseLng: 126.845, latSpan: 0.012, lngSpan: 0.012 }, // 동부 연천 축선
  ];

  const newDrones: Drone[] = [];

  for (let i = 0; i < 3; i++) {
    const sector = sectorBases[i];
    let cLat = sector.baseLat;
    let cLng = sector.baseLng;
    let radius = 1.2;
    let valid = false;
    let attempts = 0;

    while (!valid && attempts < 100) {
      attempts++;
      cLat = sector.baseLat + (Math.random() - 0.5) * sector.latSpan;
      cLng = sector.baseLng + (Math.random() - 0.5) * sector.lngSpan;
      radius = 1.15 + Math.random() * 0.15; // 1.15 ~ 1.30 km

      valid = true;
      for (const od of newDrones) {
        const dLat = (cLat - od.center[0]) * 111;
        const dLng = (cLng - od.center[1]) * (111 * Math.cos((cLat * Math.PI) / 180));
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        // 기체 간 중심 거리 >= (반경1 + 반경2 + 1.2km 안전 분리 버퍼)
        if (dist < (radius + od.radius + 1.2)) {
          valid = false;
          break;
        }
      }
    }

    // 만약 시도 초과 시 사전에 검증된 안전 분리 기준 좌표 채택 (절대 겹침 불가)
    if (!valid) {
      cLat = sector.baseLat;
      cLng = sector.baseLng;
      radius = 1.2;
    }

    const angle = (i * 120 + Math.random() * 60) % 360;
    const rad = (angle * Math.PI) / 180;
    const curLat = cLat + (radius / 111) * Math.cos(rad);
    const curLng = cLng + (radius / (111 * Math.cos((cLat * Math.PI) / 180))) * Math.sin(rad);

    // [사용자 지정 제원] 운용시간 120분, 최대속도 360km/h (순항속도 미공개), 1,200HP 터보프롭, 최대 고도 45,000ft
    const battery = 88 + Math.floor(Math.random() * 11);
    const maxMinutes = 120; // 사용자 지정: 120분
    const remainMinutes = Math.round((battery / 100) * maxMinutes);

    newDrones.push({
      id: droneConfigs[i].id,
      name: droneConfigs[i].name,
      model: 'KUS-FS (고정익)',
      color: droneConfigs[i].color,
      battery: battery,
      speedKmh: droneConfigs[i].baseSpeed,
      maxMinutes: maxMinutes,
      remainMinutes: remainMinutes,
      status: '정상 감시',
      currentLat: curLat,
      currentLng: curLng,
      targetLat: null,
      targetLng: null,
      assignedTargetId: null,
      center: [cLat, cLng],
      radius: radius,
      patrolAngle: angle,
      patrolPoints: [],
      apsoCost: 0.0,
      altitudeFt: 45000,
      heading: (angle + 90) % 360,
    });
  }

  return newDrones;
}

function DraggablePopup({ onClose, droneId, drones, targets }: { onClose: () => void, droneId: string, drones: Drone[], targets: TacticalTarget[] }) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    startPosRef.current = position;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPosition({ x: startPosRef.current.x + dx, y: startPosRef.current.y + dy });
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-start pl-4 sm:pl-6 pt-12 pb-6 pointer-events-none animate-in fade-in zoom-in duration-300">
       <div 
         className="relative w-[50vw] max-w-[51vw] min-w-[480px] h-[78vh] max-h-[820px] border border-red-500/50 bg-[#070b16] rounded-xl flex flex-col overflow-hidden shadow-[0_0_50px_rgba(239,68,68,0.3)] pointer-events-auto transition-transform"
         style={{ transform: `translate(${position.x}px, ${position.y}px)`, transitionDuration: isDragging ? '0ms' : '150ms' }}
       >
         <div 
           className="p-4 bg-red-950/40 border-b border-red-900/50 flex justify-between items-center shrink-0 cursor-move"
           onMouseDown={handleMouseDown}
         >
           <h2 className="text-lg font-bold text-red-400 flex items-center gap-2 tracking-wide select-none">
             <AlertTriangle className="animate-pulse" />
             [긴급] 최고 위험도 표적 정찰 영상
           </h2>
           <button 
             onClick={onClose} 
             className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-red-900/50 transition cursor-default"
             aria-label="닫기"
             onMouseDown={e => e.stopPropagation()}
           >
             <X className="w-5 h-5" />
           </button>
         </div>
         <div className="flex-1 overflow-hidden relative">
           <ReconCameraFeed selectedDrone={drones.find((d:any) => d.id === droneId) || null} targets={targets} className="h-full w-full" />
         </div>
       </div>
    </div>
  );
}

export default function C4IPage() {
  // 1. 보안 로그인 사용자 상태
  const [user, setUser] = useState<{
    name: string;
    militaryId: string;
    rank: string;
    role: string;
  } | null>(null);

  // 2. 핵심 시뮬레이션 상태
  const [drones, setDrones] = useState<Drone[]>([]);
  const [targets, setTargets] = useState<TacticalTarget[]>(INITIAL_TARGETS);
  const [flightPlans, setFlightPlans] = useState<any>({});
  const [selectedDroneId, setSelectedDroneId] = useState<string>('UAV-01');
  const [simRunning, setSimRunning] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<SimSpeed>(1);
  const [simTimeSec, setSimTimeSec] = useState<number>(0);
  const [isFullView, setIsFullView] = useState<boolean>(false);
  const [decisionLog, setDecisionLog] = useState<string>(
    '[평시 감시 비행] KUS-FS 3기 편대 정상 구역 분할 감시 중'
  );

  // 3. 팝업(모달) 상태 관리
  const [inspectingDroneId, setInspectingDroneId] = useState<string | null>(null);
  const inspectingDrone = inspectingDroneId ? drones.find(d => d.id === inspectingDroneId) : null;
  const [inspectingTarget, setInspectingTarget] = useState<TacticalTarget | null>(null);

  // 4. 긴급 표적 영상 팝업 상태
  const [highestRiskPopupDroneId, setHighestRiskPopupDroneId] = useState<string | null>(null);
  const hasPoppedUpRef = useRef<boolean>(false);

  // 5. ROI 표적 시각적 집중 모드 (상위 5개 우선 선별 vs 전체 10개)
  const [allEmergencyTargets, setAllEmergencyTargets] = useState<TacticalTarget[]>([]);
  const [showAllTargets, setShowAllTargets] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const authorizedTargetIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setDrones(generateRandomDrones());
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : '127.0.0.1';
    const connectWS = () => {
      ws = new WebSocket(`ws://${host}:8000/ws/tactical`);
      wsRef.current = ws;

      ws.onopen = () => {
        // 새 연결 시 백엔드 잔류 상태 초기화
        authorizedTargetIdsRef.current.clear();
        ws.send(JSON.stringify({ action: 'RESET' }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TARGET_DETECTED') {
            const incoming = msg.target;
            const updateTargetObj = (t: TacticalTarget) => {
              if (t.id === incoming.id) {
                const nextScore = Math.max(t.score || 0, incoming.score || 0);
                const nextCount = Math.max(t.detectedCount || 0, incoming.detectedCount || 0);
                const nextEnemyType = incoming.enemyType || t.enemyType || 'apc';
                const nextDetectedClass = (incoming.detectedClass && incoming.detectedClass !== 'TARGET')
                  ? incoming.detectedClass
                  : (t.detectedClass || incoming.detectedClass || 'TARGET');

                // 지역 명칭 접두어(예: "문산 중부 6호 표적")는 보존하면서 AI가 실시간 판독한 기종/명칭으로 동적 갱신
                const basePrefix = (t.name || '').split('[')[0].trim();
                const dynamicName = incoming.name
                  ? (basePrefix ? `${basePrefix} [${incoming.name.replace(/\[.*?\]/g, '').trim()} - ${nextDetectedClass}]` : incoming.name)
                  : t.name;
                const dynamicType = incoming.type || t.type;

                const isAlreadyAuthorized = authorizedTargetIdsRef.current.has(t.id);
                const tier = getDoctrineTier(nextScore, nextEnemyType, dynamicName, dynamicType, nextCount);

                return {
                  ...t,
                  name: dynamicName,
                  type: dynamicType,
                  score: nextScore,
                  status: isAlreadyAuthorized
                    ? (t.status === '타격 승인 완료' ? '타격 승인 완료' : '승인 완료')
                    : (t.status === '정찰 대기' ? '승인 대기' : (t.status || '승인 대기')),
                  authorized: isAlreadyAuthorized,
                  responseLevel: incoming.responseLevel || tier.responseLevel,
                  levelColor: incoming.levelColor || tier.levelColor,
                  recommendation: incoming.recommendation || tier.recommendation,
                  detectedCount: nextCount,
                  detectedClass: nextDetectedClass,
                  enemyType: nextEnemyType,
                };
              }
              return t;
            };

            setTargets((prev) => prev.map(updateTargetObj));
            setAllEmergencyTargets((prev) => prev.map(updateTargetObj));
            if (msg.log) {
              setDecisionLog(msg.log);
            }
          } else if (msg.type === 'DECISION_UPDATED') {
            if (msg.status === '승인 완료' && msg.target_id) {
              authorizedTargetIdsRef.current.add(msg.target_id);
            }
            const updateDecision = (t: TacticalTarget) =>
              t.id === msg.target_id ? { ...t, status: msg.status, authorized: msg.status === '승인 완료' } : t;

            setTargets((prev) => prev.map(updateDecision));
            setAllEmergencyTargets((prev) => prev.map(updateDecision));
            setDecisionLog(msg.log);
          } else if (msg.type === 'UAV_MISSION_CONSUMED') {
            const cons = msg.consumption;
            setDrones((prev) =>
              prev.map((d) => {
                if (d.id === msg.drone_id) {
                  return {
                    ...d,
                    remainMinutes: cons.updated_remaining_min,
                    battery: cons.battery_pct,
                    actualServiceTime: cons.actual_service_time_min,
                    consumedMinutes: cons.total_consumed_min,
                    usableMinutes: cons.usable_time_min,
                  };
                }
                return d;
              })
            );
          } else if (msg.type === 'RESET_DONE') {
            setDecisionLog('[전술 리셋 완료] 관제 서버 비디오 및 비행 데이터가 초기화되었습니다.');
          }

        } catch (e) {
          console.error(e);
        }
      };

      ws.onopen = () => {
        setDecisionLog('[전술 링크 수립] 중앙 관제 서버 C2MS 통신 활성화 완료');
      };

      ws.onclose = () => {
        setTimeout(connectWS, 3000);
      };
    };

    connectWS();

    return () => {
      if (ws) ws.close();
    };
  }, []);

  // 120분 운용 기준 실시간 배터리 및 비행 시뮬레이션
  useEffect(() => {
    if (!simRunning) return;

    const interval = setInterval(() => {
      setSimTimeSec((prev) => prev + (0.05 * simSpeed));

      setDrones((prevDrones) =>
        prevDrones.map((d) => {
          let updated = { ...d };

          // 120분 기준 배터리/연료 소모율
          const discharge = d.status === '급파 요격' ? 0.03 : 0.012;
          updated.battery = Math.max(0, d.battery - discharge * simSpeed);
          updated.remainMinutes = (updated.battery / 100) * d.maxMinutes;

          if (d.status === '급파 요격' && d.targetLat && d.targetLng) {
            const dLat = d.targetLat - d.currentLat;
            const dLng = d.targetLng - d.currentLng;
            const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111;

            // 기수 비행 방향각 계산 (헤딩 회전)
            const radAngle = Math.atan2(dLng, dLat);
            updated.heading = (radAngle * (180 / Math.PI) + 360) % 360;

            if (dist < 0.70) {
              updated.status = '현장 정밀 정찰';
              updated.speedKmh = 160; // 현실적인 군용 중고도 무인기 체공/선회 정찰 속도 (160km/h)
              updated.patrolAngle = (radAngle * (180 / Math.PI) + 180) % 360;

              // [APSO-LS v4 핵심 연동] 실제 정찰시간(actual_service_time)으로 UAV 잔여 운용시간 갱신!
              const targetObj = targets.find((t) => t.id === d.assignedTargetId) || allEmergencyTargets.find((t) => t.id === d.assignedTargetId);
              const actualSrv = targetObj?.actualServiceTime || 5.0;
              const plannedSrv = targetObj?.serviceTime || 5.0;
              const travelTime = (dist / (d.speedKmh || 300)) * 60;
              const totalConsumed = travelTime + actualSrv;
              const updatedRemain = Math.max(0, d.remainMinutes - totalConsumed);
              const updatedBattery = Math.round((updatedRemain / d.maxMinutes) * 100 * 10) / 10;
              const usableMin = Math.max(0, updatedRemain - 18.0);

              updated.remainMinutes = parseFloat(updatedRemain.toFixed(1));
              updated.battery = updatedBattery;
              updated.actualServiceTime = actualSrv;
              updated.plannedServiceTime = plannedSrv;
              updated.consumedMinutes = parseFloat(totalConsumed.toFixed(1));
              updated.usableMinutes = parseFloat(usableMin.toFixed(1));

              // 현장 도착 시: 상태를 '현장 정밀 정찰'로 전환하고 해당 표적을 '승인 대기' 상태로 전환
              const markArrivedTarget = (t: TacticalTarget) => {
                if (t.id === d.assignedTargetId) {
                  return {
                    ...t,
                    status: t.status === '타격 승인 완료' ? t.status : '승인 대기',
                  };
                }
                return t;
              };
              setTargets((prev) => prev.map(markArrivedTarget));
              setAllEmergencyTargets((prev) => prev.map(markArrivedTarget));

              // 도착 완료 즉시 날아온 비행 경로선을 완전히 제거
              setFlightPlans((prevPlans: Record<string, any>) => {
                const nextPlans = { ...prevPlans };
                delete nextPlans[d.id];
                return nextPlans;
              });

              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ 
                  action: 'ARRIVED_AT_TARGET', 
                  drone_id: d.id, 
                  lat: d.targetLat, 
                  lng: d.targetLng, 
                  target_id: d.assignedTargetId,
                  uav_lat: d.currentLat,
                  uav_lng: d.currentLng,
                  speed_kmh: d.speedKmh,
                  remain_minutes: d.remainMinutes,
                  initial_score: targetObj?.score || 0.0
                }));
              }

              setDecisionLog(`[AI 광학 포착] [${d.id}] 표적 [${d.assignedTargetId}] 상공 진입 완료 ➔ EO/IR 주간/열상 센서 정밀 추적 중`);
            } else {

              // 급파 요격 시 최대 360km/h 전속력 스프린트
              updated.speedKmh = 360;
              const VISUAL_ACCEL = 16;
              const step = (updated.speedKmh / 3600) * 0.05 * simSpeed * VISUAL_ACCEL;
              const ratio = Math.min(1.0, step / dist);
              updated.currentLat += dLat * ratio;
              updated.currentLng += dLng * ratio;
            }
          } else if (d.status === '정상 감시' || d.status === '현장 정밀 정찰') {
            const isTracking = d.status === '현장 정밀 정찰';
            // 정밀 정찰 시 650m ROI 표적 구역 외곽(0.70km)을 차분하고 우아하게 선회 (정신사나운 고속 회전 원천 제거)
            const circleRadius = isTracking ? 0.70 : d.radius;
            const circleCenter = isTracking && d.targetLat && d.targetLng ? [d.targetLat, d.targetLng] : d.center;
            // 초기 평시 감시는 정찰 영상과 템포가 일치하도록 2.0배율 적용(기존 16배속에서 감속), 현장 정밀 정찰은 1.0 배율 적용
            const visualAccel = isTracking ? 1.0 : 2.0;
            
            const step = (d.speedKmh / 3600) * 0.05 * simSpeed * visualAccel;
            const deltaRad = step / circleRadius;
            const deltaDeg = deltaRad * (180 / Math.PI);

            updated.patrolAngle = ((updated.patrolAngle !== undefined ? updated.patrolAngle : d.patrolAngle) + deltaDeg) % 360;
            const rad = (updated.patrolAngle * Math.PI) / 180;
            updated.currentLat = circleCenter[0] + (circleRadius / 111) * Math.cos(rad);
            updated.currentLng = circleCenter[1] + (circleRadius / (111 * Math.cos((circleCenter[0] * Math.PI) / 180))) * Math.sin(rad);
            updated.heading = (updated.patrolAngle + 90) % 360;
          }

          return updated;
        })
      );
    }, 50);

    return () => clearInterval(interval);
  }, [simRunning, simSpeed]);

  // 가장 위험도가 높은 정찰영상 팝업 로직
  useEffect(() => {
    // 1. 긴급 표적들 (평시 '정상 감시'가 아닌 표적들) 찾기
    const emergencyTargets = targets.filter(t => t.type !== '정상 감시');
    if (emergencyTargets.length === 0) {
      hasPoppedUpRef.current = false;
      return;
    }

    // 2. 긴급 표적들에 할당된 UAV들 찾기
    const dispatchedDrones = drones.filter(d => 
      d.assignedTargetId && emergencyTargets.some(t => t.id === d.assignedTargetId)
    );

    if (dispatchedDrones.length === 0) return;

    // 3. 파견된 모든 UAV가 현장에 도착했는지 확인 (급파 요격 상태가 아니고 현장 정밀 정찰 진입)
    const allArrived = dispatchedDrones.every(d => d.status === '현장 정밀 정찰');

    // 4. 파견된 표적 중 위험도(score)가 가장 높은 표적 및 담당 UAV 선별
    const assignedEmergencyTargets = emergencyTargets.filter(t => 
      dispatchedDrones.some(d => d.assignedTargetId === t.id)
    );

    if (allArrived && !hasPoppedUpRef.current && assignedEmergencyTargets.length > 0) {
      hasPoppedUpRef.current = true;
      const sortedTargets = [...assignedEmergencyTargets].sort((a, b) => b.score - a.score);
      const highestTarget = sortedTargets[0];
      const highestDrone = dispatchedDrones.find(d => d.assignedTargetId === highestTarget.id) || dispatchedDrones[0];
      if (highestDrone) {
        setHighestRiskPopupDroneId(highestDrone.id);
        setDecisionLog(`[최고 위험도 표적 식별] [${highestDrone.name}] ${highestTarget.name} 정찰 영상 팝업 전개 (위협도: ${(highestTarget.score * 100).toFixed(0)}%)`);
      }
    }
  }, [drones, targets]);
  const handleStart = () => {
    setSimRunning(true);
    setDecisionLog('[명령 하달] 시뮬레이션 및 편대 비행 가동');
  };

  const handlePause = () => {
    setSimRunning(false);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'PAUSE' }));
    }
    setDecisionLog('[명령 하달] 상황 작전 정지');
  };

  const handleReset = () => {
    authorizedTargetIdsRef.current.clear();
    setSimRunning(false);
    setSimTimeSec(0);
    setDrones(generateRandomDrones());
    setTargets(INITIAL_TARGETS);
    setAllEmergencyTargets([]);
    setShowAllTargets(false);
    setFlightPlans({});
    setSelectedDroneId('UAV-01');
    setInspectingDroneId(null);
    setInspectingTarget(null);
    setHighestRiskPopupDroneId(null);
    hasPoppedUpRef.current = false;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'RESET' }));
    }
    setDecisionLog('[체계 리셋] 감시 대기 모드로 초기화 (3기 KUS-FS 독립 구역 정상 감시 복귀)');
  };

  // [핵심] 돌발상황 발생 버튼 클릭 시: 위성 SAR-광학 융합 10개 접경 ROI 중 고위협 상위 5개소 우선 표출 및 최상위 3개 핵심 ROI에 각 UAV 1:1 급파!
  const handleTriggerEmergency = async () => {
    try {
      // 돌발 상황 발생 시 결심 내역 초기화 및 백엔드 리셋
      authorizedTargetIdsRef.current.clear();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'RESET' }));
      }
      const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : '127.0.0.1';
      const res = await fetch(`http://${host}:8000/api/tactical/init`);
      if (!res.ok) {
        throw new Error(`Tactical init failed: ${res.status}`);
      }
      const data = await res.json();

      // 1. 위성 SAR-광학 융합 10개 실제 접경지역 ROI 표적 로드 (상황판 및 지도에 표출)
      const allTargets = (data.targets as TacticalTarget[]) || [];

      // 2. 백엔드 APSO-LS 최적화 알고리즘 결과(data.uav_plans[uavId].route_rois) 기반 동적 기체 할당
      const sortedByRisk = [...allTargets].sort((a, b) => (b.score || 0) - (a.score || 0));
      const droneAssignments: Record<string, string> = {};
      const uavPlans = (data as any)?.uav_plans || {};
      const uavIds = ['UAV-01', 'UAV-02', 'UAV-03'];

      uavIds.forEach((uid) => {
        const route = uavPlans[uid]?.route_rois;
        if (route && route.length > 0) {
          // APSO-LS 최적화 계획에서 해당 UAV의 1순위 최적 목표 ROI 할당
          droneAssignments[uid] = route[0];
        }
      });

      // uav_plans 보조 매핑: 표적의 assignedDrone 속성 참조
      if (Object.keys(droneAssignments).length === 0) {
        allTargets.forEach((tgt) => {
          if (tgt.assignedDrone && !droneAssignments[tgt.assignedDrone]) {
            droneAssignments[tgt.assignedDrone] = tgt.id;
          }
        });
      }

      // 표적 데이터에 담당 UAV 및 이동 상태 업데이트 (위험도 내림차순 정렬 상태 유지)
      const updatedTargets = sortedByRisk.map((t) => {
        const assignedDroneId = Object.keys(droneAssignments).find(
          (dId) => droneAssignments[dId] === t.id
        );
        const inferredType = t.enemyType || (
          (t.name?.includes('레이더') || t.type?.includes('방공') || t.type?.includes('통신')) ? 'radar' :
          (t.name?.includes('장갑차') || t.type?.includes('보병') || t.type?.includes('정찰')) ? 'apc' :
          (t.name?.includes('TEL') || t.type?.includes('화력')) ? 'tel' :
          'tank'
        );
        const tier = getDoctrineTier(t.score, inferredType, t.name, t.type, 1);
        if (assignedDroneId) {
          return {
            ...t,
            ...tier,
            enemyType: inferredType,
            assignedDrone: assignedDroneId,
            status: '급파 이동 중',
            detectedCount: 0,
            authorized: false,
          };
        }
        return {
          ...t,
          ...tier,
          enemyType: inferredType,
          status: '정찰 대기',
          detectedCount: 0,
          authorized: false,
        };
      });

      // 전체 10개 보관 및 [사용자 요청] 시각 피로 방지를 위해 고위협 상위 5개소만 우선 표출
      setAllEmergencyTargets(updatedTargets);
      setShowAllTargets(false);
      setTargets(updatedTargets.slice(0, 5));

      // 3. 비행 경로선: 각 UAV가 현재 위치에서 목표 ROI로 향하고 선회 감시하는 전술 경로선 전개
      const activeFlightPlans: Record<string, any> = {};

      setDrones((prevDrones) =>
        prevDrones.map((d) => {
          const targetId = droneAssignments[d.id];
          const tgt = allTargets.find((t) => t.id === targetId);

          if (tgt) {
            // 해당 기체의 APSO-LS 최적 유도선: [현재 UAV 좌표 -> 목표 ROI 좌표]
            activeFlightPlans[d.id] = {
              route_rois: [tgt.id],
              waypoints: [
                [d.currentLat, d.currentLng],
                [tgt.lat, tgt.lng],
              ],
            };

            // 기수(heading)를 목표 지점을 향해 즉각 선회
            const dLat = tgt.lat - d.currentLat;
            const dLng = tgt.lng - d.currentLng;
            const radAngle = Math.atan2(dLng, dLat);
            const headingDeg = (radAngle * (180 / Math.PI) + 360) % 360;

            // APSO 비용 산출: 거리 비용(60%) + 연료 잔량(40%)
            const distKm = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
            const cost = 0.6 * (distKm / 15.0) + 0.4 * (1.0 - d.battery / 100.0);

            return {
              ...d,
              status: '급파 요격' as const,
              speedKmh: 360, // 360km/h 전속력 급파
              targetLat: tgt.lat,
              targetLng: tgt.lng,
              assignedTargetId: tgt.id,
              heading: headingDeg,
              apsoCost: parseFloat(cost.toFixed(3)),
              actualServiceTime: tgt.actualServiceTime || 5.0,
              plannedServiceTime: tgt.serviceTime || 5.0,
              usableMinutes: Math.max(0, d.remainMinutes - 18.0),
            };

          }
          return d;
        })
      );

      setFlightPlans(activeFlightPlans);

      setDecisionLog(
        `[돌발상황 긴급 발령] 위성 접경지역 10개 ROI 중 고위협 상위 5개소 우선 표출! 최상위 3개소로 UAV 3기 1:1 전속력(360km/h) 급파 요격 개시!`
      );
    } catch (err) {
      console.error('Error triggering emergency:', err);
    }
  };

  const handleToggleShowAllTargets = () => {
    if (allEmergencyTargets.length === 0) return;
    const nextVal = !showAllTargets;
    setShowAllTargets(nextVal);
    if (nextVal) {
      setTargets(allEmergencyTargets);
      setDecisionLog('[표적 상황판 모드 전환] 전체 표적 열람 모드 활성화');
    } else {
      setTargets(allEmergencyTargets.slice(0, 5));
      setDecisionLog('[표적 상황판 모드 전환] 고위협 상위 5개소 집중 감시 모드 활성화');
    }
  };

  const handleAuthorizePlan = (targetId: string, selectedOption: string, planTitle?: string) => {
    const planName = planTitle || (
      selectedOption === 'PLAN-PRIMARY' 
        ? 'AI 최우선 권장 작전' 
        : selectedOption === 'PLAN-CONTINGENCY' 
        ? '대체 전술 타격' 
        : '지속 감시 유지'
    );

    authorizedTargetIdsRef.current.add(targetId);

    const updateAuth = (t: TacticalTarget) =>
      t.id === targetId ? { ...t, authorized: true, status: '타격 승인 완료' } : t;

    setTargets((prev) => prev.map(updateAuth));
    setAllEmergencyTargets((prev) => prev.map(updateAuth));

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'DECISION_APPROVE',
        target_id: targetId,
        plan: selectedOption
      }));
    }

    setDecisionLog(`[지휘관 결심 하달] 표적 [${targetId}] ${planName} 승인 완료 ➔ 작전 명령 즉각 하달`);
  };

  const handleDefer = (targetId: string) => {
    setDecisionLog(`[지휘관 결심 보류] 표적 [${targetId}] 타격 보류 ➔ 지속 감시 유지`);
  };

  // 로그인되지 않은 경우 보안 로그인 게이트 화면 노출
  if (!user) {
    return <LoginGate onLogin={setUser} />;
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-[#050811] text-slate-100 overflow-hidden font-sans select-none">
      {/* 1. 최상단 지휘통제 헤더 바 */}
      <CommandHeader
        user={user}
        onLogout={() => setUser(null)}
        simRunning={simRunning}
        simSpeed={simSpeed}
        simTimeSec={simTimeSec}
        onStart={handleStart}
        onPause={handlePause}
        onReset={handleReset}
        onTriggerEmergency={handleTriggerEmergency}
        onChangeSpeed={setSimSpeed}
        threatCount={targets.filter((t) => t.type !== '정상 감시').length}
        pendingCount={targets.filter((t) => t.type !== '정상 감시' && !t.authorized).length}
        isFullView={isFullView}
        onToggleFullView={() => {
          setInspectingDroneId(null);
          setInspectingTarget(null);
          setIsFullView(!isFullView);
        }}
      />

      {/* 2. 메인 바디 영역: 좌/우 2분할 */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        
        {/* 좌측 패널 (58%): 상단 전술 작전 지도 + 하단 표적 전술 상황판 */}
        <div className="w-[58%] flex flex-col border-r border-[#1b263b] bg-[#050811] overflow-hidden">
          <div className="flex-1 min-h-0 relative">
            {!isFullView && (
              <TacticalMap
                drones={drones}
                targets={targets}
                flightPlans={flightPlans}
                selectedDroneId={selectedDroneId}
                onSelectDrone={(id) => setSelectedDroneId(id)}
                onOpenDroneModal={(drone) => setInspectingDroneId(drone.id)}
                onOpenTargetModal={setInspectingTarget}
              />
            )}
          </div>
          <div className="h-[42%] min-h-[240px] flex flex-col overflow-hidden border-t border-[#1b263b]">
            <DecisionTable
              targets={targets}
              onOpenTargetModal={setInspectingTarget}
              decisionLog={decisionLog}
              showAllTargets={showAllTargets}
              onToggleShowAll={handleToggleShowAllTargets}
              totalEmergencyCount={allEmergencyTargets.length}
            />
          </div>
        </div>

        {/* 우측 패널 (42%): 상단 UAV 상태 모니터링 + 하단 센서 피드 */}
        <div className="w-[42%] flex flex-col bg-[#070b16] overflow-hidden">
          <DroneFleetStatus
            drones={drones}
            targets={targets}
            selectedDroneId={selectedDroneId}
            onSelectDrone={(id) => setSelectedDroneId(id)}
            onOpenDroneModal={(drone) => setInspectingDroneId(drone.id)}
          />

          <div className={`flex-1 min-h-0 flex flex-col ${isFullView ? 'hidden' : ''}`}>
            <ReconCameraFeed
              selectedDrone={drones.find((d) => d.id === selectedDroneId) || drones[0] || null}
              targets={targets}
              className="flex-1 min-h-0"
            />
          </div>
        </div>
      </div>


      {/* 전체보기 모달 (팝업) */}
      {isFullView && (
        <div className="fixed inset-0 z-[1000] p-4 bg-black/40 flex items-center justify-center animate-in fade-in duration-200">
          <div className="w-full h-full bg-[#050811] border border-cyan-800 rounded-xl flex flex-col shadow-[0_0_30px_rgba(0,240,255,0.15)] overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-[#1b263b] bg-[#070b16]">
              <div className="flex items-center space-x-3">
                <h2 className="text-cyan-300 font-bold text-sm tracking-wide">전술 지도 및 영상 정밀 통합 뷰</h2>
                {/* 전체보기 상태에서도 UAV 영상 시점을 빠르게 전환할 수 있는 선택 탭 */}
                <div className="flex items-center space-x-1 pl-3 border-l border-[#1b263b]">
                  {drones.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDroneId(d.id)}
                      className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold transition flex items-center space-x-1.5 ${
                        selectedDroneId === d.id
                          ? 'bg-cyan-950 text-cyan-300 border border-cyan-500 shadow-[0_0_8px_rgba(0,240,255,0.3)]'
                          : 'bg-[#0f172a] text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }}></span>
                      <span>{d.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsFullView(false);
                  setInspectingDroneId(null);
                  setInspectingTarget(null);
                }}
                className="text-slate-400 hover:text-white px-2.5 py-1 rounded hover:bg-slate-800 text-sm transition font-mono border border-slate-700/60"
              >
                닫기 ✕
              </button>
            </div>
            <div className="flex-1 flex min-h-0">
              {/* 좌측 전술 지도 (35%): 축선 및 ROI/UAV 현황 표출 */}
              <div className="w-[35%] border-r border-[#1b263b] relative">
                <TacticalMap
                  drones={drones}
                  targets={targets}
                  flightPlans={flightPlans}
                  selectedDroneId={selectedDroneId}
                  onSelectDrone={(id) => setSelectedDroneId(id)}
                />
              </div>
              {/* 우측 정찰 영상 (65%): 대형 고해상도 EO/IR 피드 및 AI 객체 인식 스트림 */}
              <div className="w-[65%] relative flex flex-col bg-[#070b16]">
                <ReconCameraFeed
                  selectedDrone={drones.find((d) => d.id === selectedDroneId) || drones[0] || null}
                  targets={targets}
                  className="flex-1 min-h-0"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 팝업 모달 1: UAV 정밀 제원 & 텔레메트리 인스펙터 (전체보기 닫힘 상태에서만 표출) */}
      {!isFullView && inspectingDrone && (
        <DroneModal
          drone={inspectingDrone}
          assignedTarget={targets.find(t => t.id === inspectingDrone.assignedTargetId)}
          onClose={() => setInspectingDroneId(null)}
          onSwitchCamera={(droneId) => {
            setSelectedDroneId(droneId);
          }}
          isShiftedToRight={Boolean(highestRiskPopupDroneId)}
        />
      )}

      {/* 팝업 모달 2: 지휘관 타격결심 지원 인스펙터 (전체보기 닫힘 상태에서만 표출) */}
      {!isFullView && inspectingTarget && (
        <TargetModal
          target={inspectingTarget}
          onClose={() => setInspectingTarget(null)}
          onAuthorize={handleAuthorizePlan}
          onDefer={handleDefer}
          isShiftedToRight={Boolean(highestRiskPopupDroneId)}
        />
      )}


      {/* 팝업 모달 3: 최고 위험도 정찰영상 자동 팝업 (드래그 가능) */}
      {highestRiskPopupDroneId && (
        <DraggablePopup
          droneId={highestRiskPopupDroneId}
          drones={drones}
          targets={targets}
          onClose={() => setHighestRiskPopupDroneId(null)}
        />
      )}
    </div>
  );
}
