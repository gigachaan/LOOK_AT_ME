'use client';

import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, 
  Play, 
  Pause, 
  RotateCcw, 
  Flame, 
  Gauge, 
  User, 
  LogOut 
} from 'lucide-react';
import { SimSpeed } from '@/types/c4i';

const SPEED_OPTIONS: { speed: SimSpeed; label: string; desc: string }[] = [
  { speed: 1, label: '기본 (1x)', desc: '실시간 기본 속도 재생' },
  { speed: 2, label: '2배 (2x)', desc: '2배속 빠른 시뮬레이션 진행' },
  { speed: 5, label: '5배 (5x)', desc: '5배속 고속 시뮬레이션 진행' },
  { speed: 10, label: '10배 (10x)', desc: '10배속 초고속 시뮬레이션 진행' },
];

interface CommandHeaderProps {
  user?: { name: string; militaryId: string; rank: string; role: string } | null;
  onLogout?: () => void;
  simRunning: boolean;
  simSpeed: SimSpeed;
  simTimeSec: number;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onTriggerEmergency: () => void;
  onChangeSpeed: (speed: SimSpeed) => void;
  threatCount?: number;
  pendingCount?: number;
  isFullView?: boolean;
  onToggleFullView?: () => void;
}

export default function CommandHeader({
  user,
  onLogout,
  simRunning,
  simSpeed,
  simTimeSec,
  onStart,
  onPause,
  onReset,
  onTriggerEmergency,
  onChangeSpeed,
  threatCount = 0,
  pendingCount = 0,
  isFullView = false,
  onToggleFullView,
}: CommandHeaderProps) {
  const [kstTime, setKstTime] = useState<string>('--:--:--');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setKstTime(now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }));
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatElapsedTime = (sec: number) => {
    const totalTenths = Math.max(0, Math.floor(sec * 10));
    const hrs = String(Math.floor(totalTenths / 36000)).padStart(2, '0');
    const mins = String(Math.floor((totalTenths % 36000) / 600)).padStart(2, '0');
    const secs = String(Math.floor((totalTenths % 600) / 10)).padStart(2, '0');
    const tenths = totalTenths % 10;
    return `${hrs}:${mins}:${secs}.${tenths}`;
  };

  return (
    <header className="min-h-[58px] h-auto border-b border-[#1b263b] bg-[#070b16] px-4 py-2 flex flex-wrap items-center justify-between gap-3 z-20 shrink-0">
      {/* 좌측: 타이틀 및 편대 제원 요약 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-xl bg-cyan-950/90 border border-cyan-400/80 flex items-center justify-center shadow-[0_0_15px_rgba(0,240,255,0.3)] shrink-0">
            <ShieldAlert className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-extrabold tracking-wider font-mono text-white flex items-center mr-2">
                LOOK-AT-ME
              </h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-700">
                ● KUS-FS 3기 가동 중
              </span>
              {threatCount > 0 && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                  pendingCount > 0 
                    ? 'bg-red-950 text-red-300 border border-red-600 animate-pulse' 
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                }`}>
                  {pendingCount > 0 ? `🚨 긴급 결심대기 ${pendingCount}건` : `● 조치완료 ${threatCount}건`}
                </span>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* 중앙: 직관적 시뮬레이션 제어 및 재생 속도 */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* 돌발상황 버튼 */}
        <button
          onClick={onTriggerEmergency}
          aria-label="돌발상황 발생"
          title="외곽 구역에 고위협 긴급 표적을 발생시켜 최적 UAV 급파 재계획을 유도합니다"
          className="px-3.5 py-1.5 text-xs rounded-xl bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/80 flex items-center space-x-1.5 font-bold shadow-[0_0_15px_rgba(239,68,68,0.3)] transition active:scale-95 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-red-400"
        >
          <Flame className="w-4 h-4 text-red-400 animate-pulse" />
          <span>돌발상황 발생 (외곽 긴급 표적)</span>
        </button>

        {onToggleFullView && (
          <button
            onClick={onToggleFullView}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold border transition active:scale-95 flex items-center space-x-1 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
              isFullView
                ? 'bg-cyan-900/80 text-cyan-200 border-cyan-500 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                : 'bg-slate-800 hover:bg-slate-700 text-white border-slate-600'
            }`}
          >
            <span>{isFullView ? '기본 화면 복귀' : '전체보기 (지도/영상 확장)'}</span>
          </button>
        )}
      </div>

      {/* 우측: 시간 및 로그인된 지휘관 정보 */}
      <div className="flex items-center space-x-4 text-right ml-auto">


        <div className="text-xs font-mono">
          <div className="text-slate-400 text-xs font-medium">KST 기준시</div>
          <div className="text-white font-semibold text-sm md:text-base tracking-wider">{kstTime}</div>
        </div>

        {user && (
          <>
            <div className="h-7 w-px bg-slate-800"></div>
            <div className="flex items-center space-x-2 pl-1">
              <div className="text-left text-xs font-sans">
                <div className="text-white font-bold flex items-center space-x-1">
                  <User className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{user.name}</span>
                </div>
                <div className="text-slate-400 text-[11px] font-mono">{user.rank}</div>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  aria-label="보안 로그아웃"
                  title="작전 통제 세션을 종료하고 로그인 게이트로 돌아갑니다"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-950/40 border border-slate-800 hover:border-red-800 transition active:scale-95"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
