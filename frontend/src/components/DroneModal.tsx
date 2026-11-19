'use client';

import React, { useEffect, useState, useRef } from 'react';
import { X, Battery, Activity, ShieldCheck, Compass, Radio, Gauge, Zap, Crosshair } from 'lucide-react';
import { Drone, TacticalTarget } from '@/types/c4i';

function toMGRS8(lat: number, lng: number): string {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const e_prime2 = (a * a - b * b) / (b * b);

  const zone = Math.floor((lng + 180) / 6) + 1;
  const lonOriginRad = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lng * Math.PI) / 180;

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = e_prime2 * Math.cos(latRad) * Math.cos(latRad);
  const A = Math.cos(latRad) * (lonRad - lonOriginRad);

  const M = a * (
    (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * latRad -
    ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * latRad) +
    ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * latRad) -
    ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * latRad)
  );

  const k0 = 0.9996;
  const easting = k0 * N * (
    A + ((1 - T + C) * Math.pow(A, 3)) / 6 +
    ((5 - 18 * T + T * T + 72 * C - 58 * e_prime2) * Math.pow(A, 5)) / 120
  ) + 500000.0;

  let northing = k0 * (
    M + N * Math.tan(latRad) * (
      (A * A) / 2 +
      ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
      ((61 - 58 * T + T * T + 600 * C - 330 * e_prime2) * Math.pow(A, 6)) / 720
    )
  );
  if (lat < 0) northing += 10000000.0;

  const colIdx = Math.floor(easting / 100000);
  const colLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const colSet = (zone - 1) % 3;
  const colChar = colLetters[(colSet * 8 + colIdx - 1) % colLetters.length];

  const rowLetters = 'ABCDEFGHJKLMNPQRSTUV';
  const rowIdx = Math.floor((northing % 2000000) / 100000);
  const rowOffset = zone % 2 === 1 ? 0 : 5;
  const rowChar = rowLetters[(rowIdx + rowOffset) % rowLetters.length];

  const eStr = String(Math.floor((easting % 100000) / 10)).padStart(4, '0');
  const nStr = String(Math.floor((northing % 100000) / 10)).padStart(4, '0');
  const gzd = lat >= 32 && lat < 40 ? `${zone}S` : `${zone}T`;

  return `${gzd} ${colChar}${rowChar} ${eStr} ${nStr}`;
}

interface DroneModalProps {
  drone: Drone | null;
  assignedTarget?: TacticalTarget | null;
  onClose: () => void;
  onSwitchCamera: (droneId: string) => void;
  isShiftedToRight?: boolean;
}

export default function DroneModal({ drone, assignedTarget, onClose, onSwitchCamera, isShiftedToRight }: DroneModalProps) {
  const isRight = Boolean(isShiftedToRight);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setPosition({ x: 0, y: 0 });
  }, [drone?.id]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!drone) return null;

  const isLowBattery = drone.battery <= 15;
  const barColor = drone.battery > 50 ? 'bg-emerald-400' : drone.battery > 25 ? 'bg-amber-400' : 'bg-red-500';

  const formatTime = (mins: number) => {
    const total = Math.max(0, Math.floor(mins));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  };

  return (
    <div 
      className={`fixed inset-0 z-[2100] flex pointer-events-none select-none animate-in fade-in duration-200 ${
        isRight 
          ? 'items-start justify-start pl-[52.5vw] pt-[76px]' 
          : 'items-center justify-center p-4'
      }`}
    >
      <div 
        className={`relative ${
          isRight 
            ? 'w-[45vw] max-w-[540px] min-w-[380px] max-h-[82vh]' 
            : 'w-full max-w-2xl max-h-[85vh]'
        } bg-[#080d1a] border border-cyan-500/70 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden pointer-events-auto transition-transform`}
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          transitionDuration: isDragging ? '0ms' : '100ms'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상단 모달 헤더 바 (드래그 핸들) */}
        <div 
          className="px-6 py-3.5 bg-[#0c1427] border-b border-slate-800 flex items-center justify-between cursor-move select-none"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center space-x-3 pointer-events-none">
            <span className="w-3.5 h-3.5 rounded-full shadow-md" style={{ backgroundColor: drone.color }}></span>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white font-mono tracking-wide">
                  {drone.name}
                </h3>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                기체 식별 부호: {drone.id} // 서부전선 정상 감시 제1편대
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="팝업 닫기"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition active:scale-95 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 바디 콘텐츠 (3개 주요 영역) */}
        <div className="p-6 space-y-5 flex-1 min-h-0 overflow-y-auto">
          {/* 현재 임무 상태 요약 카드 */}
          <div className="p-4 rounded-xl bg-[#0e172e] border border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400">현재 비행 임무</span>
                <div className="text-sm font-bold text-white flex items-center space-x-2 mt-0.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    drone.status === '급파 요격' ? 'bg-red-400 animate-ping' : 'bg-emerald-400'
                  }`}></span>
                  <span>{drone.status === '급파 요격' ? '긴급 돌발 표적 급파 요격' : drone.status === '현장 정밀 정찰' ? '표적 상공 현장 정밀 정찰' : '지정 구역 정상 감시'}</span>
                </div>
              </div>
            </div>

            {assignedTarget ? (
              <div className="text-right">
                <span className="text-xs text-slate-400">할당된 표적</span>
                <div className="text-xs font-bold text-red-400 mt-0.5">
                  [{assignedTarget.id}] {assignedTarget.name}
                </div>
              </div>
            ) : (
              <div className="text-right">
                <span className="text-xs text-slate-400">책임 감시 구역</span>
                <div className="text-xs font-mono font-bold text-cyan-300 mt-0.5">
                  반경 {drone.radius.toFixed(1)} km 선회 비행
                </div>
              </div>
            )}
          </div>

          {/* 2열 그리드: 비행 제원 vs 배터리·동력 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. 비행 제원 & 항법 상태 */}
            <div className="p-4 rounded-xl bg-[#0b1224] border border-slate-800/90 space-y-3">
              <div className="flex items-center space-x-2 text-xs font-bold text-cyan-300 uppercase tracking-wider">
                <Compass className="w-4 h-4" />
                <span>기체 상태</span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">비행 속도</span>
                  <strong className="text-white font-mono">{drone.speedKmh === 360 ? '최대 전속 360 km/h (급파)' : `${drone.speedKmh} km/h`}</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">현재 고도</span>
                  <strong className="text-white font-mono">15,400 ft</strong>
                </div>
                <div className="flex flex-col py-1 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">현재 좌표 (MGRS)</span>
                    <strong className="text-cyan-300 font-mono tracking-wider">{toMGRS8(drone.currentLat, drone.currentLng)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 text-[10px]">WGS84 위경도</span>
                    <strong className="text-slate-300 font-mono text-[10px]">{drone.currentLat.toFixed(4)}°N, {drone.currentLng.toFixed(4)}°E</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. 하이브리드 배터리 및 안전선 */}
            <div className="p-4 rounded-xl bg-[#0b1224] border border-slate-800/90 space-y-3">
              <div className="flex items-center space-x-2 text-xs font-bold text-cyan-300 uppercase tracking-wider">
                <Zap className="w-4 h-4" />
                <span>운용시간 잔여 현황</span>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">가용 운용시간 비율:</span>
                  <strong className="text-white text-sm font-mono">{drone.battery.toFixed(1)}%</strong>
                </div>

                <div className="relative w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${drone.battery}%` }}></div>
                  <div className="absolute top-0 bottom-0 left-[15%] w-0.5 bg-yellow-400 z-10" title="15% 안전선"></div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-400">예상 사용 가능 시간:</span>
                  <span className="text-emerald-400 font-bold font-mono">{formatTime(drone.remainMinutes)} / 120분</span>
                </div>

                <div className="p-2 rounded bg-[#070b16] border border-slate-800 text-[11px] flex items-center justify-between">
                  <span className="text-slate-400">15% 비행 안전선 여유:</span>
                  <span className={drone.battery > 15 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {drone.battery > 15 ? `안전선 확보 정상 (+${(drone.battery - 15).toFixed(1)}%)` : '경고: 안전선 미달 (복귀 요망)'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>


        {/* 하단 액션 버튼 바 */}
        <div className="px-6 py-3.5 bg-[#0a1020] border-t border-slate-800 flex items-center justify-end space-x-3 shrink-0">
          <button
            onClick={() => {
              onSwitchCamera(drone.id);
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg transition active:scale-95 flex items-center space-x-1.5 cursor-pointer"
          >
            <Crosshair className="w-4 h-4" />
            <span>이 기체 정찰 카메라 보기</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition active:scale-95 cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
