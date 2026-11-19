'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Shield, ShieldAlert, Lock, UserCheck, Terminal, KeyRound, ArrowRight, Satellite } from 'lucide-react';

interface LoginGateProps {
  onLogin: (userInfo: { name: string; militaryId: string; rank: string; role: string }) => void;
}

export default function LoginGate({ onLogin }: LoginGateProps) {
  const [militaryId, setMilitaryId] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'COMMANDER' | 'CONTROLLER'>('COMMANDER');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('보안 인증 대기 중');

  // 레이더 스위프 및 표적 블립 정밀 물리 동기화용 Ref
  const sweepRef = useRef<HTMLDivElement>(null);
  const blipRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 전술 표적 레이더 블립 데이터 (서부전선 축선 표적, SSR/클라이언트 부동소수점 오차 방지 정밀 좌표 사전계산)
  const TARGET_BLIPS = [
    { id: 'AFV-01', angle: 38, dist: 280, color: 'text-red-400', ping: 'bg-red-500' },
    { id: 'LMV-02', angle: 84, dist: 390, color: 'text-amber-400', ping: 'bg-amber-500' },
    { id: 'SMV-03', angle: 142, dist: 320, color: 'text-red-400', ping: 'bg-red-500' },
    { id: 'CV-04', angle: 215, dist: 450, color: 'text-orange-400', ping: 'bg-orange-500' },
    { id: 'AFV-05', angle: 288, dist: 340, color: 'text-red-400', ping: 'bg-red-500' },
    { id: 'PAT-06', angle: 335, dist: 230, color: 'text-orange-300', ping: 'bg-orange-400' },
  ].map((tgt) => {
    const rad = (tgt.angle - 90) * (Math.PI / 180);
    return {
      ...tgt,
      x: Number((Math.cos(rad) * (tgt.dist * 0.78)).toFixed(2)),
      y: Number((Math.sin(rad) * (tgt.dist * 0.78)).toFixed(2)),
    };
  });

  // 60KM 링 둘레 72개 각도 눈금선(DIAL_TICKS) 정밀 사전계산 (하이드레이션 불일치 100% 방지)
  const DIAL_TICKS = Array.from({ length: 72 }, (_, i) => {
    const deg = i * 5;
    const isMajor = deg % 30 === 0;
    const isMedium = deg % 10 === 0;
    const rad = (deg - 90) * (Math.PI / 180);
    const rOuter = 430;
    const rInner = isMajor ? 414 : isMedium ? 420 : 424;
    return {
      id: `dial-tick-${i}`,
      x1: Number((430 + Math.cos(rad) * rOuter).toFixed(2)),
      y1: Number((430 + Math.sin(rad) * rOuter).toFixed(2)),
      x2: Number((430 + Math.cos(rad) * rInner).toFixed(2)),
      y2: Number((430 + Math.sin(rad) * rInner).toFixed(2)),
      stroke: isMajor ? 'rgba(249,115,22,0.85)' : isMedium ? 'rgba(249,115,22,0.5)' : 'rgba(249,115,22,0.25)',
      strokeWidth: isMajor ? 1.5 : 1,
    };
  });

  // 단일 타임스탬프(rAF) 기반 레이더 스위프 & 표적 인광 감쇠 완전 물리 동기화
  useEffect(() => {
    let animId: number;
    const PERIOD = 8000; // 8초 주기
    const FADE_ARC = 36; // 스캔선 통과 후 잔상 유지 각도 (36도 = 약 0.8초)
    const startTime = performance.now();

    const renderRadar = (now: number) => {
      const totalElapsed = now - startTime;
      const currentAngle = ((totalElapsed % PERIOD) / PERIOD) * 360; // 0 ~ 360도

      // 1. 레이더 스위프 빔 회전 (수학적 일치)
      if (sweepRef.current) {
        sweepRef.current.style.transform = `rotate(${currentAngle}deg)`;
      }

      // 2. 표적 블립 상태 동기화: 스캔선이 닿기 전에는 절대 뜨지 않음
      TARGET_BLIPS.forEach((tgt, idx) => {
        const el = blipRefs.current[idx];
        if (!el) return;

        // 첫 바퀴 방어: 스캔선이 최초로 표적 각도에 도달하기 전까지는 100% 완전 암전 유지
        const firstHitTime = (tgt.angle / 360) * PERIOD;
        if (totalElapsed < firstHitTime) {
          el.style.opacity = '0';
          el.style.visibility = 'hidden';
          return;
        }

        // 스캔선 각도와 표적 각도의 상대 위상차 (0 ~ 360)
        const diff = (currentAngle - tgt.angle + 360) % 360;

        // 스캔선 선단 라인이 표적에 닿기 직전 2도(-2도)부터 통과 후 36도(약 0.8초)까지만 발광 후 소멸
        const isHit = (diff >= 358 && diff <= 360) || (diff >= 0 && diff <= FADE_ARC);

        if (isHit) {
          let progress = 0;
          if (diff >= 358) {
            // 닿기 직전 2도: 선단 발광부 진입
            progress = 0;
          } else {
            // 통과 후: 점진적 인광 감쇠 (0 -> 1)
            progress = diff / FADE_ARC;
          }

          const opacity = Math.max(0, 1 - progress);
          const scale = 1.25 - 0.35 * progress;

          el.style.opacity = opacity.toFixed(3);
          el.style.transform = `scale(${scale.toFixed(3)})`;
          el.style.visibility = 'visible';
        } else {
          // 스캔선이 닿지 않은 나머지 각도: 완전 소멸 암전
          el.style.opacity = '0';
          el.style.visibility = 'hidden';
        }
      });

      animId = requestAnimationFrame(renderRadar);
    };

    animId = requestAnimationFrame(renderRadar);
    return () => cancelAnimationFrame(animId);
  }, []);

  const handleSubmit = (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e && 'preventDefault' in e) e.preventDefault();
    const cleanId = militaryId.trim();
    const cleanPw = password.trim();
    let isValid = false;
    if (role === 'COMMANDER' && cleanId === '19-71502805' && cleanPw === '1q2w3e4r') {
      isValid = true;
    } else if (role === 'CONTROLLER' && ['08-20260428', '01-20230330', '72-09180922'].includes(cleanId) && cleanPw === '1q2w3e4r') {
      isValid = true;
    }

    if (!isValid) {
      setStatusMsg('보안 인증 실패: 선택한 권한에 인가되지 않은 계정입니다.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setStatusMsg('C2MS 암호화 세션 키 교환 중...');

    setTimeout(() => {
      setStatusMsg('지휘통제 권한 승인 완료 ➔ 작전 대시보드 진입');
      setTimeout(() => {
        onLogin({
          name: role === 'COMMANDER' ? '김필재 소령' : '이승우 대위',
          militaryId: cleanId,
          rank: role === 'COMMANDER' ? '작전지휘관' : '전술통제관',
          role: role === 'COMMANDER' ? 'AUTH-LV3 (타격결심 전결권)' : 'AUTH-LV2 (감시관제권)',
        });
      }, 300);
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#03060f] text-slate-100 overflow-hidden font-sans select-none">
      {/* ======================================================== */}
      {/* [시안 A 1:1] 1. 외곽 전술 모니터 베젤 프레임 (Outer Monitor Bezel) */}
      {/* ======================================================== */}
      <div className="absolute inset-3 rounded-2xl border border-orange-500/35 pointer-events-none shadow-[inset_0_0_40px_rgba(249,115,22,0.06)] z-30">
        {/* 4개 코너 정밀 조준 틱 */}
        <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-orange-400"></div>
        <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-orange-400"></div>
        <div className="absolute bottom-2 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-orange-400"></div>
        <div className="absolute bottom-2 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-orange-400"></div>
      </div>

      {/* ======================================================== */}
      {/* [시안 A 1:1] 2. 선명한 십자 조준선 (+) 전술 그리드 패턴 (Wide Tactical Crosshair Grid) */}
      {/* ======================================================== */}
      <div className="absolute inset-0 pointer-events-none opacity-80 z-0">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            {/* 120px x 120px 광역 전술 그리드 및 선명한 십자 조준선(+) */}
            <pattern id="tactical-cross-grid" width="120" height="120" patternUnits="userSpaceOnUse">
              {/* 은은한 차콜-앰버 격자 라인 */}
              <path d="M 120 0 L 0 0 0 120" fill="none" stroke="rgba(249, 115, 22, 0.12)" strokeWidth="0.8" />
              {/* 선명하게 빛나는 교차점 십자 조준선 (+) 마크 (시안 A 1:1 일치) */}
              <path d="M 0 -8 L 0 8 M -8 0 L 8 0" fill="none" stroke="rgba(249, 115, 22, 0.75)" strokeWidth="1.5" />
              {/* 보조 중앙 센터 십자 조준선 (+) */}
              <path d="M 60 55 L 60 65 M 55 60 L 65 60" fill="none" stroke="rgba(249, 115, 22, 0.4)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#tactical-cross-grid)" />
        </svg>
      </div>

      {/* ======================================================== */}
      {/* [시안 A 1:1] 3. 상단 및 하단 촘촘한 정밀 눈금자 (Horizontal Ruler Ticks) */}
      {/* ======================================================== */}
      <div className="absolute top-5 inset-x-14 h-5 flex justify-between items-end pointer-events-none hidden md:flex border-b border-orange-500/30 px-6 pb-1 z-20">
        {[...Array(65)].map((_, i) => (
          <span
            key={`top-tick-${i}`}
            className={`w-[1px] ${
              i % 10 === 0
                ? 'h-3.5 bg-orange-400'
                : i % 5 === 0
                ? 'h-2 bg-orange-400/80'
                : 'h-1 bg-orange-500/40'
            }`}
          />
        ))}
      </div>
      <div className="absolute bottom-5 inset-x-14 h-5 flex justify-between items-start pointer-events-none hidden md:flex border-t border-orange-500/30 px-6 pt-1 z-20">
        {[...Array(65)].map((_, i) => (
          <span
            key={`bot-tick-${i}`}
            className={`w-[1px] ${
              i % 10 === 0
                ? 'h-3.5 bg-orange-400'
                : i % 5 === 0
                ? 'h-2 bg-orange-400/80'
                : 'h-1 bg-orange-500/40'
            }`}
          />
        ))}
      </div>

      {/* ======================================================== */}
      {/* [시안 A 1:1] 4. 좌우 세로 정밀 거리 룰러 바 (Vertical Range Scale Rulers) */}
      {/* ======================================================== */}
      {/* 좌측 세로 룰러 바 (시안 A 위치: 레이더 링 바로 바깥) */}
      <div className="absolute left-[calc(50%-440px)] top-1/2 -translate-y-1/2 flex items-center space-x-2 pointer-events-none hidden xl:flex z-20">
        <div className="flex flex-col justify-between h-[500px] text-[10px] font-mono text-orange-400/70 text-right pr-1">
          <span>60KM</span>
          <span>45KM</span>
          <span>30KM</span>
          <span>20KM</span>
          <span className="text-orange-400 font-bold">270° W</span>
          <span>20KM</span>
          <span>30KM</span>
          <span>45KM</span>
          <span>60KM</span>
        </div>
        <div className="flex flex-col justify-between h-[500px] w-2 border-r border-orange-500/40">
          {[...Array(41)].map((_, i) => (
            <span
              key={`left-tick-${i}`}
              className={`h-[1px] self-end ${
                i % 10 === 0 ? 'w-3 bg-orange-400' : i % 5 === 0 ? 'w-2 bg-orange-400/80' : 'w-1 bg-orange-400/40'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 우측 세로 룰러 바 (시안 A 위치: 레이더 링 바로 바깥) */}
      <div className="absolute right-[calc(50%-440px)] top-1/2 -translate-y-1/2 flex items-center space-x-2 pointer-events-none hidden xl:flex z-20">
        <div className="flex flex-col justify-between h-[500px] w-2 border-l border-orange-500/40">
          {[...Array(41)].map((_, i) => (
            <span
              key={`right-tick-${i}`}
              className={`h-[1px] self-start ${
                i % 10 === 0 ? 'w-3 bg-orange-400' : i % 5 === 0 ? 'w-2 bg-orange-400/80' : 'w-1 bg-orange-400/40'
              }`}
            />
          ))}
        </div>
        <div className="flex flex-col justify-between h-[500px] text-[10px] font-mono text-orange-400/70 text-left pl-1">
          <span>60KM</span>
          <span>45KM</span>
          <span>30KM</span>
          <span>20KM</span>
          <span className="text-orange-400 font-bold">090° E</span>
          <span>20KM</span>
          <span>30KM</span>
          <span>45KM</span>
          <span>60KM</span>
        </div>
      </div>



      {/* 앰비언트 글로우 */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-orange-600/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* 배경 실루엣: 인공위성 (우측 상단) - 시네마틱 홀로그램 블렌딩 적용 */}
      <div className="absolute -top-10 -right-20 w-[600px] h-[600px] opacity-[0.06] pointer-events-none transform rotate-12 mix-blend-screen grayscale contrast-150">
        <img src="/satellite.png" alt="Satellite" className="w-full h-full object-contain" />
      </div>

      {/* 배경 실루엣: 무인기 UAV (좌측 하단) - 시네마틱 홀로그램 블렌딩 적용 */}
      <div className="absolute -bottom-20 -left-20 w-[700px] h-[700px] opacity-[0.05] pointer-events-none transform -rotate-12 mix-blend-screen grayscale contrast-150">
        <img src="/uav.png" alt="UAV" className="w-full h-full object-contain" />
      </div>

      {/* ======================================================== */}
      {/* [시안 A 1:1] 6. 전술 앰버 360° 레이더 스코프 및 360도 각도 틱 눈금 */}
      {/* ======================================================== */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden z-10">
        <div className="relative w-[860px] h-[860px] rounded-full flex items-center justify-center">
          {/* 60KM 링 (최외곽) 둘레 360도 각도 눈금선 (Dial Degree Ticks, 시안 A 1:1 일치, SSR 하이드레이션 완전 일치) */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 860 860" suppressHydrationWarning>
            {DIAL_TICKS.map((tick) => (
              <line
                key={tick.id}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                stroke={tick.stroke}
                strokeWidth={tick.strokeWidth}
              />
            ))}
          </svg>

          {/* 60KM 링 */}
          <div className="absolute inset-0 rounded-full border border-orange-500/30 shadow-[0_0_40px_rgba(249,115,22,0.08)]">
            <span className="absolute top-3 left-1/2 -translate-x-1/2 text-[9px] font-mono text-orange-400/60 tracking-wider">60KM</span>
          </div>

          {/* 45KM 링 */}
          <div className="absolute w-[670px] h-[670px] rounded-full border border-dashed border-orange-500/30">
            <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[9px] font-mono text-orange-400/50 tracking-wider">45KM</span>
          </div>

          {/* 30KM 링 */}
          <div className="absolute w-[480px] h-[480px] rounded-full border border-orange-500/30">
            <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[9px] font-mono text-orange-400/50 tracking-wider">30KM</span>
          </div>

          {/* 전술 십자선 (수직/수평 방위각선) */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-gradient-to-r from-transparent via-orange-500/25 to-transparent"></div>
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-gradient-to-b from-transparent via-orange-500/25 to-transparent"></div>

          {/* 45도 대각선 보조 조준선 */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-gradient-to-r from-transparent via-orange-500/15 to-transparent rotate-45"></div>
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-gradient-to-r from-transparent via-orange-500/15 to-transparent -rotate-45"></div>

          {/* 방위각 나침반 표기 (000 N, 090 E, 180 S, 270 W, 시안 A와 1:1 일치) */}
          <span className="absolute top-8 left-1/2 -translate-x-1/2 text-[12px] font-mono font-bold text-orange-400 tracking-wider">000 N</span>
          <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[12px] font-mono font-bold text-orange-400 tracking-wider">090 E</span>
          <span className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[12px] font-mono font-bold text-orange-400 tracking-wider">180 S</span>
          <span className="absolute left-8 top-1/2 -translate-y-1/2 text-[12px] font-mono font-bold text-orange-400 tracking-wider">270 W</span>

          {/* 360도 연속 회전 레이더 빔 (rAF 실시간 수학적 각도 동기화) */}
          <div
            ref={sweepRef}
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{ transformOrigin: '50% 50%' }}
          >
            <div
              className="w-full h-full rounded-full"
              style={{
                background: 'conic-gradient(from 270deg at 50% 50%, transparent 0deg, rgba(249,115,22,0.02) 20deg, rgba(249,115,22,0.1) 50deg, rgba(249,115,22,0.3) 80deg, rgba(249,115,22,0.55) 90deg, transparent 90.1deg, transparent 360deg)',
              }}
            />
            {/* 레이더 선단(Leading Edge) 선명한 전술 발광 라인 */}
            <div className="absolute top-0 left-1/2 w-[2px] h-[430px] -translate-x-1/2 origin-bottom bg-gradient-to-t from-orange-500/20 via-orange-400 to-white shadow-[0_0_12px_#f97316]"></div>
          </div>

          {/* 전술 표적 레이더 블립 (rAF 물리 엔진: 스캔선 겹칠 때만 점등) */}
          {TARGET_BLIPS.map((tgt, idx) => (
            <div
              key={tgt.id}
              className="absolute pointer-events-none"
              style={{
                left: '50%',
                top: '50%',
                transform: `translate(calc(-50% + ${tgt.x}px), calc(-50% + ${tgt.y}px))`,
              }}
            >
              <div
                ref={(el) => { blipRefs.current[idx] = el; }}
                className="flex flex-col items-center justify-center pointer-events-none"
                style={{
                  opacity: 0,
                  visibility: 'hidden',
                  willChange: 'opacity, transform',
                }}
              >
                <div className="mb-1 pointer-events-none select-none">
                  <span className={`text-[10px] font-mono font-black tracking-widest leading-none ${tgt.color} drop-shadow-[0_0_8px_rgba(249,115,22,1)]`}>
                    {tgt.id}
                  </span>
                </div>
                <div className="relative flex items-center justify-center w-2.5 h-2.5">
                  <span className={`w-2 h-2 rounded-full ${tgt.ping} shadow-[0_0_10px_#f97316]`}></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ======================================================== */}
      {/* [시안 A 1:1] 중앙 전술 로그인 콘솔 카드 (웜 티타늄 스모크 그레이 Frosted Glass) */}
      {/* ======================================================== */}
      <div
        className="relative z-30 pointer-events-auto w-full max-w-[390px] p-7 mx-4 rounded-2xl backdrop-blur-md"
        style={{
          background: 'linear-gradient(165deg, rgba(86, 82, 74, 0.76) 0%, rgba(72, 68, 60, 0.72) 100%)',
          border: '1px solid rgba(165, 155, 140, 0.35)',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* 상단 Hanwha 공식 로고(오렌지 심볼 + 흰색 텍스트) & LOOK-AT-ME 타이틀 (시안 A 1:1 완벽 일치) */}
        <div className="text-left mb-5">
          <div className="mb-1.5">
            <img src="/hanwha_logo_white.png" alt="Hanwha" className="h-6 sm:h-7 object-contain" />
          </div>
          <h1 className="text-2xl font-black tracking-wide text-white font-mono">
            LOOK-AT-ME
          </h1>
        </div>

        {/* 폼 영역 */}
        <div className="space-y-3.5">
          {/* 권한 등급 세그먼트 스위치 */}
          <div
            className="flex p-1 rounded-lg text-[11px] font-mono"
            style={{
              background: 'rgba(38, 35, 31, 0.85)',
              border: '1px solid rgba(135, 125, 110, 0.35)',
            }}
          >
            <button
              type="button"
              onClick={() => setRole('COMMANDER')}
              className={`flex-1 py-1.5 rounded-md font-bold transition cursor-pointer flex items-center justify-center space-x-1 ${
                role === 'COMMANDER'
                  ? 'bg-orange-500/30 text-orange-400 border border-orange-500/60 shadow-sm'
                  : 'text-[#a8a095] hover:text-white'
              }`}
            >
              <Shield className="w-3 h-3" />
              <span>작전지휘관 (LV3)</span>
            </button>
            <button
              type="button"
              onClick={() => setRole('CONTROLLER')}
              className={`flex-1 py-1.5 rounded-md font-bold transition cursor-pointer flex items-center justify-center space-x-1 ${
                role === 'CONTROLLER'
                  ? 'bg-orange-500/30 text-orange-400 border border-orange-500/60 shadow-sm'
                  : 'text-[#a8a095] hover:text-white'
              }`}
            >
              <UserCheck className="w-3 h-3" />
              <span>전술통제관 (LV2)</span>
            </button>
          </div>

          {/* MILITARY ID 입력 필드 (시안 A 1:1 일치) */}
          <div className="relative">
            <input
              type="text"
              value={militaryId}
              onChange={(e) => setMilitaryId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(e); }}
              placeholder="MILITARY ID"
              style={{
                background: 'rgba(32, 30, 26, 0.85)',
                borderColor: 'rgba(140, 130, 115, 0.45)',
                fontFamily: "'JetBrains Mono', 'Pretendard', 'Noto Sans KR', sans-serif",
              }}
              className="w-full px-4 py-3 border rounded-lg text-sm text-white font-semibold placeholder:text-[#8e877c] placeholder:font-mono placeholder:font-normal placeholder:tracking-wider focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition shadow-inner"
            />
          </div>

          {/* SECURITY PASSCODE 입력 필드 (시안 A 1:1 일치) */}
          <div className="relative">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(e); }}
              placeholder="SECURITY PASSCODE"
              style={{
                background: 'rgba(32, 30, 26, 0.85)',
                borderColor: 'rgba(140, 130, 115, 0.45)',
                fontFamily: "'JetBrains Mono', 'Pretendard', 'Noto Sans KR', sans-serif",
              }}
              className="w-full px-4 py-3 border rounded-lg text-sm text-white font-semibold placeholder:text-[#8e877c] placeholder:font-mono placeholder:font-normal placeholder:tracking-wider focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition shadow-inner"
            />
          </div>

          {/* 전술 오렌지 AUTHORIZE 버튼 (시안 A 1:1 우하단 챔퍼 컷 디자인) */}
          <button
            type="button"
            onClick={(e) => handleSubmit(e)}
            disabled={isLoading}
            style={{
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
            }}
            className="w-full py-3.5 px-4 bg-[#e86620] hover:bg-[#ff7525] active:scale-[0.99] text-[#0a0f18] font-black text-sm font-mono tracking-widest transition shadow-[0_0_20px_rgba(232,102,32,0.4)] hover:shadow-[0_0_30px_rgba(232,102,32,0.65)] flex items-center justify-center space-x-2 cursor-pointer focus:outline-none"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-[#0a0f18] border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <span>AUTHORIZE</span>
            )}
          </button>

          {/* 하단 미니 상태 표시줄 (AES-256 제거) */}
          <div className="pt-1 flex items-center space-x-1.5 text-[10px] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></span>
            <span className="truncate text-orange-300/90">{statusMsg}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
