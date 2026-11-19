'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, ShieldAlert, CheckCircle2, Crosshair, AlertTriangle, Flame, Shield, Eye, Send } from 'lucide-react';
import { TacticalTarget } from '@/types/c4i';

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

interface TargetModalProps {
  target: TacticalTarget | null;
  onClose: () => void;
  onAuthorize: (targetId: string, selectedOption: string, planTitle?: string) => void;
  onDefer: (targetId: string) => void;
  isShiftedToRight?: boolean;
}

interface TacticalOption {
  id: string;
  badge: string;
  badgeColor: string;
  title: string;
  weaponSystem: string;
  allocation: string;
  effect: string;
  scoreMatch: string;
  icon: React.ReactNode;
}

function getTacticalOptions(target: TacticalTarget): TacticalOption[] {
  const rec = target.recommendation || '';
  const score = target.score || 0;
  const isCommand = rec.includes('KTSSM') || rec.includes('지휘부') || rec.includes('지휘 타격') || (target.name || '').includes('지휘소');
  const isMRLS = rec.includes('다연장') || rec.includes('MLRS') || rec.includes('기동 차단') || (target.name || '').includes('기갑전투 대열');
  const isSead = rec.includes('방공망') || rec.includes('SEAD') || rec.includes('레이더') || rec.includes('대공/대화력 유도탄') || (target.name || '').includes('레이더');
  const isHelicopter = rec.includes('공격헬기') || rec.includes('헬기') || rec.includes('아파치') || (target.name || '').includes('엄체호');
  const isArtillery = rec.includes('K-9') || rec.includes('자주포') || rec.includes('TOT') || rec.includes('대화력전') || (score >= 0.85);

  if (isCommand) {
    return [
      {
        id: 'PLAN-PRIMARY',
        badge: 'AI 최우선 권장 (PRIMARY)',
        badgeColor: 'bg-rose-950 text-rose-300 border-rose-500',
        title: '전술지대지(KTSSM) 지휘부 핀포인트 정밀 타격',
        weaponSystem: 'KTSSM-I 단거리 전술지대지 유도탄 (군단 핵심 화력)',
        allocation: 'KTSSM 1기 표적 지휘소 핀포인트 관통 타격 (오차 2m 이내)',
        effect: '적 전방 지휘소 및 지휘통신망 완벽 궤멸 (C2 마비)',
        scoreMatch: '작전 적합도 99%',
        icon: <Crosshair className="w-5 h-5 text-rose-400" />,
      },
      {
        id: 'PLAN-CONTINGENCY',
        badge: '항공 지원 대체안 (CONTINGENCY)',
        badgeColor: 'bg-red-950 text-red-300 border-red-500',
        title: '공군 전술기 공대지 정밀유도폭탄(JDAM) 타격',
        weaponSystem: 'KF-16 / FA-50 GBU-31 JDAM 정밀 타격',
        allocation: '전술기 1개 편대 긴급 CAS 임무 전환 출격',
        effect: '지하시설 및 견고 진지 완파',
        scoreMatch: '작전 적합도 91%',
        icon: <Flame className="w-5 h-5 text-red-400" />,
      },
      {
        id: 'PLAN-SURVEILLANCE',
        badge: '상황 주시 (PERSISTENT ISR)',
        badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-500',
        title: '정찰 UAV 락온 및 실시간 BDA(전투피해평가)',
        weaponSystem: 'EO/IR 센서 줌인 선회 및 실시간 텔레메트리 전파',
        allocation: '담당 무인기 표적 상공 저속 선회 식별 유지',
        effect: '지휘부 생존 인원 및 후속 대피 동향 실시간 감시',
        scoreMatch: '안전성 우선',
        icon: <Eye className="w-5 h-5 text-cyan-400" />,
      },
    ];
  } else if (isMRLS) {
    return [
      {
        id: 'PLAN-PRIMARY',
        badge: 'AI 최우선 권장 (PRIMARY)',
        badgeColor: 'bg-orange-950 text-orange-300 border-orange-500',
        title: 'K239 다연장로켓(MLRS) 종심 차단사격',
        weaponSystem: 'K239 천무 130mm/239mm 유도로켓 군단 화력',
        allocation: '천무 1개 포대 기동축선 분산 탄착 차단사격',
        effect: '남하 기동로 도로 파쇄 및 전차 대열 기동 차단/지연',
        scoreMatch: '작전 적합도 98%',
        icon: <Flame className="w-5 h-5 text-orange-400" />,
      },
      {
        id: 'PLAN-CONTINGENCY',
        badge: '포병 화력 대체안 (CONTINGENCY)',
        badgeColor: 'bg-amber-950 text-amber-300 border-amber-500',
        title: 'K-9 자주포 155mm 원거리 저지 차단 사격',
        weaponSystem: 'K-9A1 자주포 155mm 항력감소탄 연계',
        allocation: 'K-9 자주포 2문 저지사격 준비',
        effect: '기갑 종대 전두부 타격으로 진격 속도 마비',
        scoreMatch: '작전 적합도 89%',
        icon: <Crosshair className="w-5 h-5 text-amber-400" />,
      },
      {
        id: 'PLAN-SURVEILLANCE',
        badge: '상황 주시 (PERSISTENT ISR)',
        badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-500',
        title: '정찰 UAV 락온 및 지속 감시 유지',
        weaponSystem: 'EO/IR 센서 줌인 선회 및 실시간 텔레메트리 전파',
        allocation: '담당 무인기 표적 상공 저속 선회 식별 유지',
        effect: '우회 기동로 개척 여부 감시 및 아군 방어선 경보 전파',
        scoreMatch: '안전성 우선',
        icon: <Eye className="w-5 h-5 text-cyan-400" />,
      },
    ];
  } else if (isSead) {
    return [
      {
        id: 'PLAN-PRIMARY',
        badge: 'AI 최우선 권장 (PRIMARY)',
        badgeColor: 'bg-purple-950 text-purple-300 border-purple-500',
        title: '대레이더 유도탄 및 방공망 제압 사격 (SEAD)',
        weaponSystem: '전술 지대지 정밀 유도탄 / 대레이더 미사일',
        allocation: '원거리 대레이더 정밀 타격 미사일 유도 발사 (군단 전술 자산)',
        effect: '적 레이더 및 방공망 조기 파괴로 아군 항공 및 무인기 작전로 확보',
        scoreMatch: '작전 적합도 97%',
        icon: <Crosshair className="w-5 h-5 text-purple-400" />,
      },
      {
        id: 'PLAN-CONTINGENCY',
        badge: '항공 지원 대체안 (CONTINGENCY)',
        badgeColor: 'bg-red-950 text-red-300 border-red-500',
        title: '육군항공 공격헬기 초저공 정밀 타격',
        weaponSystem: 'AH-64E 레이더 사각 초저공 침투 유도탄 타격',
        allocation: '공격헬기 2기 저고도 침투',
        effect: '레이더 음영 구역 활용 핀포인트 기습 제압',
        scoreMatch: '작전 적합도 86%',
        icon: <Flame className="w-5 h-5 text-red-400" />,
      },
      {
        id: 'PLAN-SURVEILLANCE',
        badge: '상황 주시 (PERSISTENT ISR)',
        badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-500',
        title: '정찰 UAV 락온 및 지속 감시 유지',
        weaponSystem: 'EO/IR 센서 줌인 선회 및 실시간 텔레메트리 전파',
        allocation: '담당 무인기 표적 상공 저속 선회 식별 유지',
        effect: '적 방공 레이더 전파 송출 여부 및 재배치 동향 감시',
        scoreMatch: '안전성 우선',
        icon: <Eye className="w-5 h-5 text-cyan-400" />,
      },
    ];
  } else if (isHelicopter) {
    return [
      {
        id: 'PLAN-PRIMARY',
        badge: 'AI 최우선 권장 (PRIMARY)',
        badgeColor: 'bg-amber-950 text-amber-300 border-amber-500',
        title: '육군항공 공격헬기 정밀 항공타격',
        weaponSystem: 'AH-64E 아파치 / LAH 대전차 유도탄(Hellfire) 편대 출격',
        allocation: '공격헬기 편대 2기 긴급 출격 (대전차 미사일 유도)',
        effect: '엄체호 및 기갑 표적 원거리 핀포인트 제압',
        scoreMatch: '작전 적합도 96%',
        icon: <Crosshair className="w-5 h-5 text-amber-400" />,
      },
      {
        id: 'PLAN-CONTINGENCY',
        badge: '화력 지원 대체안 (CONTINGENCY)',
        badgeColor: 'bg-red-950 text-red-300 border-red-500',
        title: '군단 대화력전 포병 화력 연계',
        weaponSystem: 'K-9 자주포 155mm 곡사 화력 연계',
        allocation: 'K-9 자주포 2문 진지 파괴 사격 준비',
        effect: '표적 밀집 지역 조기 무력화 및 후속 기동로 차단',
        scoreMatch: '작전 적합도 88%',
        icon: <Flame className="w-5 h-5 text-red-400" />,
      },
      {
        id: 'PLAN-SURVEILLANCE',
        badge: '상황 주시 (PERSISTENT ISR)',
        badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-500',
        title: '정찰 UAV 락온 및 지속 감시 유지',
        weaponSystem: 'EO/IR 센서 줌인 선회 및 실시간 텔레메트리 전파',
        allocation: '담당 무인기 표적 상공 저속 선회 식별 유지',
        effect: '엄체호 주변 추가 증원 전력 확인 및 실시간 정보 제공',
        scoreMatch: '안전성 우선',
        icon: <Eye className="w-5 h-5 text-cyan-400" />,
      },
    ];
  } else if (isArtillery) {
    return [
      {
        id: 'PLAN-PRIMARY',
        badge: 'AI 최우선 권장 (PRIMARY)',
        badgeColor: 'bg-red-950 text-red-300 border-red-500',
        title: '군단 대화력전 포병 즉각 타격',
        weaponSystem: 'K-9 자주포 155mm 곡사 화력 연계',
        allocation: 'K-9 4문 즉각 집중 사격 (군단 화력 자산)',
        effect: '표적 밀집 지역 조기 궤멸 및 적 기동선 즉각 차단',
        scoreMatch: '작전 적합도 98%',
        icon: <Flame className="w-5 h-5 text-red-400" />,
      },
      {
        id: 'PLAN-CONTINGENCY',
        badge: '항공 지원 대체안 (CONTINGENCY)',
        badgeColor: 'bg-amber-950 text-amber-300 border-amber-500',
        title: '육군항공 공격헬기 정밀 항공타격',
        weaponSystem: 'AH-64E / LAH 공대지 유도탄 타격',
        allocation: '공격헬기 편대 2기 긴급 출격 (대전차 미사일 유도)',
        effect: '산악 은폐 표적 및 기동 부대 정밀 핀포인트 제압',
        scoreMatch: '작전 적합도 88%',
        icon: <Crosshair className="w-5 h-5 text-amber-400" />,
      },
      {
        id: 'PLAN-SURVEILLANCE',
        badge: '상황 주시 (PERSISTENT ISR)',
        badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-500',
        title: '정찰 UAV 락온 및 지속 감시 유지',
        weaponSystem: 'EO/IR 센서 줌인 선회 및 실시간 텔레메트리 전파',
        allocation: '담당 무인기 표적 상공 저속 선회 식별 유지',
        effect: '추가 증원 전력 확인 및 아군 방어 진지 정보 실시간 제공',
        scoreMatch: '안전성 우선',
        icon: <Eye className="w-5 h-5 text-cyan-400" />,
      },
    ];
  } else {
    return [
      {
        id: 'PLAN-PRIMARY',
        badge: 'AI 최우선 권장 (PRIMARY)',
        badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-500',
        title: '정찰 UAV 락온 및 지속 감시 유지',
        weaponSystem: 'EO/IR 센서 줌인 선회 및 실시간 텔레메트리 전파',
        allocation: '담당 무인기 표적 상공 저속 선회 식별 유지',
        effect: '추가 증원 전력 확인 및 아군 방어 진지 정보 실시간 제공',
        scoreMatch: '작전 적합도 95%',
        icon: <Eye className="w-5 h-5 text-cyan-400" />,
      },
      {
        id: 'PLAN-CONTINGENCY',
        badge: '작전 대기안 (CONTINGENCY)',
        badgeColor: 'bg-amber-950 text-amber-300 border-amber-500',
        title: '타격 자산 출격 준비 태세 유지',
        weaponSystem: '공격헬기 / K-9 자주포 5분 대기 태세',
        allocation: '대응 전력 유도탄 장착 완료 대기',
        effect: '적 도발 징후 식별 시 즉각 타격 전환 준비',
        scoreMatch: '작전 적합도 82%',
        icon: <Crosshair className="w-5 h-5 text-amber-400" />,
      },
      {
        id: 'PLAN-SURVEILLANCE',
        badge: '광역 정찰 (AREA ISR)',
        badgeColor: 'bg-slate-800 text-slate-300 border-slate-700',
        title: '주변 의심 구역 광역 탐색 확장',
        weaponSystem: '광학 줌 센서 광역 스캔',
        allocation: '인근 감시 경로 확장',
        effect: '배후 지원 세력 및 추가 위협 조기 탐지',
        scoreMatch: '안전성 우선',
        icon: <Eye className="w-5 h-5 text-slate-400" />,
      },
    ];
  }
}

export default function TargetModal({ target, onClose, onAuthorize, onDefer, isShiftedToRight }: TargetModalProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<string>('PLAN-PRIMARY');
  const isRight = Boolean(isShiftedToRight);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setPosition({ x: 0, y: 0 });
  }, [target?.id]);

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

  if (!target) return null;

  const isSector = target.type === '정상 감시';
  const tacticalOptions = getTacticalOptions(target);

  return (
    <div 
      className={`fixed inset-0 z-[2100] flex pointer-events-none select-none animate-in fade-in duration-200 ${
        isRight 
          ? 'items-start justify-start pl-[52vw] pt-[76px]' 
          : 'items-center justify-center p-4'
      }`}
    >
      <div 
        className={`relative ${
          isRight 
            ? 'w-[45vw] max-w-[620px] min-w-[390px] max-h-[82vh]' 
            : 'w-full max-w-3xl max-h-[86vh]'
        } bg-[#070b16] border border-cyan-500/70 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden pointer-events-auto transition-transform`}
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          transitionDuration: isDragging ? '0ms' : '100ms'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상단 모달 헤더 바 (드래그 핸들) */}
        <div 
          className="px-6 py-4 bg-[#0a1020] border-b border-slate-800 flex items-center justify-between cursor-move select-none"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-red-950/80 border border-red-500/80 flex items-center justify-center shadow-lg">
              <ShieldAlert className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-mono font-black text-red-400">[{target.id}]</span>
                <h3 className="text-base font-bold text-white tracking-wide">
                  {target.name}
                </h3>
                <span className={`text-xs px-2 py-0.5 rounded font-semibold ${target.levelColor}`}>
                  {target.responseLevel}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                담당 탐지 자산: <strong className="text-cyan-400">{target.assignedDrone}</strong> // 위협도 지수: <strong className="text-amber-300">{target.score.toFixed(2)}</strong>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="창 닫기"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition active:scale-95 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 바디 영역 */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* 표적 탐지 위치 및 센서 식별 정보 카드 */}
          <div className="p-4 rounded-xl bg-[#0b1222] border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block mb-1">군사격자좌표 (MGRS 10m 정밀도)</span>
              <strong className="text-cyan-300 font-mono text-sm tracking-wider">
                {toMGRS8(target.lat, target.lng)}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 block mb-1">위경도 좌표 (WGS84)</span>
              <strong className="text-white font-mono text-xs">
                {target.lat.toFixed(4)}°N, {target.lng.toFixed(4)}°E
              </strong>
            </div>
            <div>
              <span className="text-slate-400 block mb-1">작전 승인 상태</span>
              <strong className={target.authorized ? 'text-emerald-400' : 'text-red-400'}>
                {target.authorized ? '● 타격 승인 완료 (명령 하달됨)' : '● 지휘관 결심 대기 중'}
              </strong>
            </div>
          </div>

          {/* AI 전술 작전 선택 매트릭스 (모듈형 카드) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 tracking-wide uppercase flex items-center space-x-1.5">
                <Crosshair className="w-4 h-4 text-cyan-400" />
                <span>지휘관 결심 옵션 선택 (전술 무기체계 최적 연계)</span>
              </span>
              <span className="text-[11px] text-slate-400">원하는 작전 카드를 클릭하여 선택하십시오</span>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {tacticalOptions.map((opt) => {
                const isSelected = selectedPlanId === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => setSelectedPlanId(opt.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.2)] ring-1 ring-cyan-400'
                        : 'bg-[#0a0f1d] border-slate-800 hover:bg-[#0e162a]'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3">
                        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 shrink-0 mt-0.5">
                          {opt.icon}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${opt.badgeColor}`}>
                              {opt.badge}
                            </span>
                            <h4 className="text-sm font-bold text-white">{opt.title}</h4>
                          </div>
                          <p className="text-xs text-cyan-300 font-semibold mt-1">
                            {opt.weaponSystem}
                          </p>
                          <div className="mt-1.5 text-xs text-slate-300 space-y-0.5">
                            <div>• 투입 부대/자산: <span className="text-white">{opt.allocation}</span></div>
                            <div>• 작전 기대 효과: <span className="text-slate-300">{opt.effect}</span></div>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0 ml-3">
                        <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/80 px-2 py-1 rounded border border-emerald-800 block">
                          {opt.scoreMatch}
                        </span>
                        {isSelected && (
                          <div className="mt-2 inline-flex items-center space-x-1 text-xs text-cyan-400 font-bold">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>선택됨</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 하단 명령 하달 버튼 바 */}
        <div className="px-6 py-4 bg-[#080d1a] border-t border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {target.authorized ? (
              <span className="text-emerald-400 font-semibold flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>이미 타격 승인이 완료된 작전입니다.</span>
              </span>
            ) : (
              <span>선택된 전술 방안으로 연계 부대에 즉시 작전 명령을 전송합니다.</span>
            )}
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={() => {
                onDefer(target.id);
                onClose();
              }}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition active:scale-95"
            >
              타격 보류
            </button>

            <button
              onClick={() => {
                const selectedOpt = tacticalOptions.find(o => o.id === selectedPlanId);
                onAuthorize(target.id, selectedPlanId, selectedOpt?.title);
                onClose();
              }}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs shadow-[0_0_15px_rgba(239,68,68,0.4)] transition active:scale-95 flex items-center space-x-1.5"
            >
              <Send className="w-4 h-4" />
              <span>선택 작전 결심 승인 및 명령 하달</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
