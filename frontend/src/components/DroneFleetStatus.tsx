'use client';

import React, { useState } from 'react';
import {
  Activity,
  Battery,
  BatteryWarning,
  ShieldCheck,
  Flame,
  Camera,
  RotateCcw,
  SlidersHorizontal,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react';
import { Drone, TacticalTarget } from '@/types/c4i';

interface DroneFleetStatusProps {
  drones: Drone[];
  targets: TacticalTarget[];
  selectedDroneId?: string | null;
  onSelectDrone?: (id: string) => void;
  onOpenDroneModal?: (drone: Drone) => void;
}

export default function DroneFleetStatus({
  drones,
  targets,
  selectedDroneId,
  onSelectDrone,
  onOpenDroneModal
}: DroneFleetStatusProps) {
  const [showDetailedFormula, setShowDetailedFormula] = useState<boolean>(false);

  const getTargetDistance = (d: Drone): string => {
    const assignedTarget = targets.find((t) => t.id === d.assignedTargetId);
    if (!assignedTarget) return '--';
    const R = 6371;
    const dLat = ((assignedTarget.lat - d.currentLat) * Math.PI) / 180;
    const dLng = ((assignedTarget.lng - d.currentLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((d.currentLat * Math.PI) / 180) *
      Math.cos((assignedTarget.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return `${(R * c).toFixed(2)}`;
  };

  // 사용자 지정 제원: 운용시간 120분 기준 잔여 시간 포맷
  const formatRemainTime = (minutes: number): string => {
    const totalM = Math.max(0, Math.floor(minutes));
    const h = Math.floor(totalM / 60);
    const m = totalM % 60;
    return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case '급파 요격':
        return {
          label: '긴급 급파 중',
          icon: <Flame className="w-3.5 h-3.5 text-red-400" />,
          badgeClass: 'bg-red-950/90 text-red-200 border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)] animate-pulse',
        };
      case '현장 정밀 정찰':
        return {
          label: '정밀 정찰 중',
          icon: <Camera className="w-3.5 h-3.5 text-amber-400" />,
          badgeClass: 'bg-amber-950/90 text-amber-200 border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)] animate-pulse',
        };
      case '복귀 중':
        return {
          label: '기지 복귀 중',
          icon: <RotateCcw className="w-3.5 h-3.5 text-purple-400" />,
          badgeClass: 'bg-purple-950/90 text-purple-200 border-purple-500',
        };
      case '정상 감시':
      default:
        return {
          label: '정상 감시 중',
          icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />,
          badgeClass: 'bg-emerald-950/80 text-emerald-200 border-emerald-700',
        };
    }
  };

  return (
    <div className="shrink-0 max-h-[50%] p-3.5 border-b border-[#1b263b] flex flex-col bg-[#070b16] overflow-hidden font-sans select-none">
      {/* 상단 헤더 영역 */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center space-x-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-cyan-300 tracking-wide uppercase">
            UAV 편대 운용 현황
          </h2>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-700 font-mono font-medium">
            KUS-FS 고정익
          </span>
          <button
            onClick={() => setShowDetailedFormula(!showDetailedFormula)}
            aria-expanded={showDetailedFormula}
            className="flex items-center space-x-1 text-xs text-slate-400 hover:text-cyan-300 transition px-1.5 py-0.5 rounded hover:bg-slate-800"
            title="APSO 비용 계산식 및 세부 제약 수치 보기/접기"
          >
            <span>산출식</span>
            {showDetailedFormula ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 세부 산출 공식 (접기/펼치기) */}
      {showDetailedFormula && (
        <div className="bg-[#0b101c] px-3 py-1.5 rounded border border-slate-800 text-xs text-slate-300 mb-2 flex items-center justify-between shrink-0 transition-all font-mono">
          <div className="flex items-center space-x-1.5 truncate">
            <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">Cost J = 0.6*(거리/15km) + 0.4*(1-SoC) + 페널티</span>
          </div>
          <span className="text-red-400 font-bold ml-2 shrink-0">15% 안전선 미달 시 출동 제외</span>
        </div>
      )}

      {/* 3기 UAV 통합 모니터링 카드 리스트 */}
      <div className="space-y-2 flex-1 overflow-y-auto pr-1">
        {drones.map((d) => {
          const distStr = getTargetDistance(d);
          const isLowBattery = d.battery <= 15;
          const statusInfo = getStatusDisplay(d.status);
          const barColor = d.battery > 50 ? 'bg-emerald-400' : d.battery > 25 ? 'bg-amber-400' : 'bg-red-500';

          // 사용자 지정 제원: 운용시간 120분 기준 배터리(연료) 잔량 실시간 정확 연동
          const maxOperatingMinutes = d.maxMinutes || 120;
          const calculatedRemainMinutes = (d.battery / 100) * maxOperatingMinutes;

          return (
            <div
              key={d.id}
              role="button"
              tabIndex={0}
              aria-label={`${d.name} 선택 및 세부 제원 열람`}
              onClick={() => {
                onOpenDroneModal?.(d);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenDroneModal?.(d);
                }
              }}
              className={`p-2.5 rounded-xl border flex flex-col space-y-2 transition-all cursor-pointer active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-cyan-400 ${selectedDroneId === d.id
                  ? 'border-cyan-400 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.3)] ring-1 ring-cyan-400'
                  : d.status === '급파 요격' || d.status === '현장 정밀 정찰'
                    ? 'bg-red-950/20 border-red-500/70 hover:bg-red-950/30'
                    : 'bg-[#0c1222] border-slate-800 hover:bg-[#11192e] hover:border-slate-700'
                }`}
            >
              {/* 상단 라인: UAV 식별, 비행 속도 (최대 360km/h), 상태 뱃지 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: d.color }}></span>
                  <span className="font-bold text-white text-sm">{d.name}</span>
                  <span className="text-xs text-slate-300 bg-slate-800/80 px-2 py-0.5 rounded font-mono border border-slate-700" title="최대속도: 360 km/h (순항속도: 비공개)">
                    {d.speedKmh} km/h
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono bg-[#0b101c] px-2 py-0.5 rounded border border-slate-800/60">
                    APSO: <strong className="text-cyan-300">{d.apsoCost && d.apsoCost > 0 ? d.apsoCost.toFixed(3) : '대기'}</strong>
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  {distStr !== '--' && (
                    <span className="text-xs text-slate-300">
                      표적거리: <strong className="text-cyan-400 font-semibold">{distStr} km</strong>
                    </span>
                  )}
                  <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${statusInfo.badgeClass}`}>
                    {statusInfo.icon}
                    <span>{statusInfo.label}</span>
                  </span>
                </div>
              </div>

              {/* 연료/배터리 게이지 및 실시간 120분 기준 예상 운용 시간 (실시간 연동) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-1.5">
                    {isLowBattery ? (
                      <BatteryWarning className="w-4 h-4 text-red-400 animate-bounce" />
                    ) : (
                      <Battery className="w-4 h-4 text-emerald-400" />
                    )}
                    <span className="text-slate-300 font-medium">잔여 운용시간 비율:</span>
                    <strong className="text-white font-bold text-sm font-mono">{d.battery.toFixed(1)}%</strong>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <span className="text-slate-300">예상 운용:</span>
                    <span className="text-emerald-400 font-bold text-sm font-mono">
                      {formatRemainTime(calculatedRemainMinutes)}
                    </span>
                    <span className="text-slate-500 text-xs font-mono">/ 120분</span>
                  </div>
                </div>

                <div className="relative w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColor} transition-all duration-300`}
                    style={{ width: `${Math.min(100, Math.max(0, d.battery))}%` }}
                  ></div>
                  <div
                    className="absolute top-0 bottom-0 left-[15%] w-0.5 bg-yellow-400 z-10 opacity-90"
                    title="15% 안전선 마진"
                  ></div>
                </div>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
