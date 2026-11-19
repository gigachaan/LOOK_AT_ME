'use client';

import React from 'react';
import {
  CheckCircle2,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  ChevronRight,
  Send
} from 'lucide-react';
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

interface DecisionTableProps {
  targets: TacticalTarget[];
  onOpenTargetModal: (target: TacticalTarget) => void;
  decisionLog: string;
  showAllTargets?: boolean;
  onToggleShowAll?: () => void;
  totalEmergencyCount?: number;
}

export default function DecisionTable({
  targets,
  onOpenTargetModal,
  decisionLog,
  showAllTargets = false,
  onToggleShowAll,
  totalEmergencyCount = 0,
}: DecisionTableProps) {
  const activeThreats = targets.filter((t) => t.type !== '정상 감시');
  const criticalWaiting = targets.filter((t) => t.type !== '정상 감시' && !t.authorized);

  return (
    <div className="bg-[#070b16] flex flex-col h-full min-h-0 overflow-hidden font-sans select-none">
      {/* 상단 상황판 헤더 바 */}
      <div className="px-4 py-2 bg-[#0a0f1d] border-b border-[#1b263b] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs md:text-sm font-bold text-white tracking-wide uppercase">
            전술 표적 상황판 // 지휘관 타격결심 지원체계
          </h3>
        </div>

        <div className="flex items-center space-x-3 text-xs text-slate-300">
          <span className="flex items-center gap-1.5">
            <span>식별된 위협:</span>
            <strong className="text-white font-semibold text-sm">{activeThreats.length}개소</strong>
          </span>
          <span>
            결심 대기: <strong className="text-red-400 font-bold text-sm">{criticalWaiting.length}건</strong>
          </span>

          {totalEmergencyCount > 5 && onToggleShowAll && (
            <button
              onClick={onToggleShowAll}
              className="px-2.5 py-0.5 rounded border border-cyan-800 bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 text-[11px] font-mono transition flex items-center gap-1.5 shadow-sm active:scale-95"
              title={showAllTargets ? '고위협 상위 5개소만 표출하여 화면을 간소화합니다' : '전체 전술 표적을 상황판과 지도에 표출합니다'}
            >
              <SlidersHorizontal className="w-3 h-3" />
              <span>{showAllTargets ? '상위 5개 집중 모드' : '전체 표적 열람'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 테이블 영역 (10개 ROI 전체를 스크롤해서 열람 가능) */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-[#0b1222] text-slate-300 sticky top-0 border-b border-slate-800 z-10 shadow-sm">
            <tr>
              <th className="py-2 px-2 text-center font-semibold whitespace-nowrap w-[70px]">담당 UAV</th>
              <th className="py-2 px-2.5 text-left font-semibold whitespace-nowrap min-w-[190px]">표적 ID / 구역 명칭</th>
              <th className="py-2 px-2 text-left font-semibold whitespace-nowrap w-[130px]">군사격자좌표</th>
              <th className="py-2 px-2.5 text-center font-semibold whitespace-nowrap w-[140px]">위협도 / 대응 수준</th>
              <th className="py-2 px-2.5 text-left font-semibold whitespace-nowrap">추천 대응</th>
              <th className="py-2 px-3 text-center font-semibold whitespace-nowrap w-[170px]">지휘 결심 및 조치</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-sans">
            {targets.map((t) => {
              const isSector = t.type === '정상 감시';
              const mgrsCoord = toMGRS8(t.lat, t.lng);

              return (
                <tr
                  key={t.id}
                  role={isSector ? undefined : "button"}
                  tabIndex={isSector ? undefined : 0}
                  aria-label={isSector ? undefined : `표적 ${t.name} 클릭하여 전술 결심 팝업 열기`}
                  onClick={() => {
                    if (!isSector) onOpenTargetModal(t);
                  }}
                  onKeyDown={(e) => {
                    if (!isSector && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onOpenTargetModal(t);
                    }
                  }}
                  className={`transition ${
                    isSector
                      ? ''
                      : 'hover:bg-[#11192e] cursor-pointer active:scale-[0.99] focus:outline-none focus:bg-[#11192e]'
                  } ${
                    isSector
                      ? ''
                      : t.authorized
                      ? 'bg-emerald-950/20'
                      : 'bg-red-950/20'
                  }`}
                >
                  {/* 담당 UAV */}
                  <td className="py-2 px-2 text-center text-cyan-300 font-mono font-bold whitespace-nowrap">
                    {t.assignedDrone}
                  </td>

                  {/* 표적 ID / 명칭 */}
                  <td className="py-2 px-3 font-semibold text-white whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {isSector ? (
                        <span className="text-cyan-400">◈</span>
                      ) : (
                        <span className="text-red-500 animate-pulse">●</span>
                      )}
                      <span className={isSector ? 'text-cyan-300 font-mono font-bold' : 'text-red-400 font-mono font-bold'}>
                        [{t.id}]
                      </span>
                      <span className="truncate max-w-[200px]">{t.name}</span>
                    </div>
                  </td>

                  {/* 군사격자좌표 */}
                  <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                    <span className="font-mono font-bold text-cyan-300 text-xs tracking-wider">
                      {mgrsCoord}
                    </span>
                  </td>

                  {/* 위협도 / 대응 수준 통합 */}
                  <td className="py-2 px-3 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center space-x-2">
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono font-bold text-xs ${
                          isSector ? 'bg-slate-800 text-slate-400' : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}
                      >
                        {t.score.toFixed(2)}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${t.levelColor}`}>
                        {t.responseLevel}
                      </span>
                    </div>
                  </td>


                  {/* 추천 대응 요약 */}
                  <td className="py-2 px-2.5 text-slate-300 whitespace-nowrap">
                    <span className="truncate block max-w-[230px]">
                      {t.recommendation}
                    </span>
                  </td>

                  {/* 결심 액션 버튼 */}
                  <td className="py-2 px-3 text-center whitespace-nowrap">
                    {isSector ? (
                      <div className="inline-flex items-center space-x-1 text-cyan-300 text-xs bg-cyan-950/40 border border-cyan-800/60 rounded px-2.5 py-1">
                        <Shield className="w-3.5 h-3.5 text-cyan-400" />
                        <span>정상 감시중</span>
                      </div>
                    ) : t.authorized ? (
                      <div className="inline-flex items-center space-x-1 text-emerald-400 font-bold text-xs">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>승인 완료 (명령 하달됨)</span>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenTargetModal(t);
                        }}
                        aria-label="전술 결심 인스펙터 팝업 열기"
                        className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow transition active:scale-95 flex items-center space-x-1 mx-auto whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>⚡ 전술 결심 및 하달</span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 하단 상태 표시 */}
      <div className="px-4 py-1.5 bg-[#060a14] border-t border-[#1b263b] flex items-center justify-between text-xs text-slate-300">
        <div className="text-cyan-400 font-semibold font-mono">
          C2MS C-band 통신 보안 링크 암호화 정상 활성
        </div>
        <div className="text-slate-400 font-mono text-[11px] shrink-0 ml-4 bg-slate-900/50 px-2 py-0.5 rounded border border-slate-800">
          <span className="text-cyan-500 font-bold">APSO 지수 :</span> 거리 비용(60%) 및 잔여 운용시간(40%)을 종합 평가하여 최적 기체를 선별하는 지수 (낮을수록 최적)
        </div>
      </div>
    </div>
  );
}
