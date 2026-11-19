'use client';

import React, { useState } from 'react';
import { Eye, Radio } from 'lucide-react';
import { Drone, TacticalTarget, VideoFeedState } from '@/types/c4i';

interface ReconCameraFeedProps {
  selectedDrone: Drone | null;
  targets: TacticalTarget[];
  className?: string;
}

const DRONE_INITIAL_VIDEOS: Record<string, string> = {
  'UAV-01': '/videos/1st.mp4',
  'UAV-02': '/videos/2nd.mp4',
  'UAV-03': '/videos/3rd.mp4',
};

// 전역 비디오 재생 시간 추적기 (전체보기 모달 전환 또는 재마운트 시에도 영상이 0초로 리셋되지 않고 100% 연속 동기화)
const globalVideoTimes: Record<string, number> = {
  'UAV-01': 0,
  'UAV-02': 0,
  'UAV-03': 0,
};

export default function ReconCameraFeed({ selectedDrone, targets, className = 'h-full' }: ReconCameraFeedProps) {
  const [streamActive, setStreamActive] = useState<boolean>(false);
  const videoRefs = React.useRef<Record<string, HTMLVideoElement | null>>({});

  const videoFeedState = (selectedDrone
    ? selectedDrone.status === '현장 정밀 정찰'
      ? 'TRACKING'
      : selectedDrone.status === '급파 요격'
        ? 'EN_ROUTE'
        : 'PATROL'
    : 'PATROL') as VideoFeedState;

  const assignedTarget = targets.find((t) => t.id === selectedDrone?.assignedTargetId);

  // 컴포넌트 마운트 시 또는 기체 전환 시 전역 재생 시간으로 즉각 동기화 (전체보기 진입 시 0초 리셋 원천 방지)
  React.useEffect(() => {
    Object.entries(videoRefs.current).forEach(([droneId, video]) => {
      if (video) {
        const savedTime = globalVideoTimes[droneId];
        if (savedTime && savedTime > 0 && Math.abs(video.currentTime - savedTime) > 0.5) {
          try {
            video.currentTime = savedTime;
          } catch {
            // ignore
          }
        }
        if (video.paused) {
          video.play().catch(() => {});
        }
      }
    });
  }, [selectedDrone?.id]);

  const handleLoadedMetadata = (droneId: string, e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const savedTime = globalVideoTimes[droneId];
    if (savedTime && savedTime > 0 && Math.abs(video.currentTime - savedTime) > 0.5) {
      try {
        video.currentTime = savedTime;
      } catch {
        // ignore
      }
    }
  };

  const handleTimeUpdate = (droneId: string, e: React.SyntheticEvent<HTMLVideoElement>) => {
    const cur = e.currentTarget.currentTime;
    if (cur > 0) {
      globalVideoTimes[droneId] = cur;
    }
  };

  return (
    <div className={`p-3.5 flex flex-col bg-[#070b16] font-sans ${className}`}>
      {/* 헤더: UAV 명칭 및 상태만 심플하게 표시 (불필요한 버튼/효과 배제) */}
      <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
        <div className="flex items-center space-x-2">
          <Eye className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-cyan-300 tracking-wide uppercase">
            {selectedDrone ? `${selectedDrone.name} 정찰 영상` : 'UAV 정찰 영상'}
          </h2>
          <span className="text-xs px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-700 font-mono">
            {videoFeedState === 'TRACKING'
              ? '● 실시간 정밀 정찰'
              : videoFeedState === 'EN_ROUTE'
                ? '▶ 현장 급파 이동 중'
                : '● 정상 감시 중'}
          </span>
        </div>
      </div>

      {/* 비디오 뷰포트 영역: 3기 UAV 관측 영상 상시 무중단 백그라운드 재생 & 기체 전환 시 끊김 없는 즉각 표출 */}
      <div className="flex-1 w-full relative rounded-lg border border-slate-800 bg-[#02050c] overflow-hidden flex items-center justify-center">
        {/* 3개 기체 초기 감시정찰 비디오: 3개 모두 DOM에 상시 마운트되어 백그라운드에서 연속 재생 유지 (기체 변경 시 새로고침/재시작 없이 진행 시간 유지) */}
        {Object.entries(DRONE_INITIAL_VIDEOS).map(([droneId, src]) => {
          const isSelected = selectedDrone?.id === droneId;
          const isTracking = isSelected && videoFeedState === 'TRACKING';
          return (
            <video
              key={droneId}
              ref={(el) => {
                videoRefs.current[droneId] = el;
              }}
              src={src}
              autoPlay
              loop
              muted
              playsInline
              onLoadedMetadata={(e) => handleLoadedMetadata(droneId, e)}
              onTimeUpdate={(e) => handleTimeUpdate(droneId, e)}
              className={`absolute inset-0 w-full h-full object-cover ${
                isSelected && !isTracking ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'
              }`}
            />
          );
        })}


        {/* 현장 도달 시 실시간 전술 정찰 영상 스트림 표출: 3개 기체 피드를 상시 마운트하여 시점 전환 및 모달 진입 시에도 리셋 없이 100% 매끄럽게 연속 표출 */}
        {['UAV-01', 'UAV-02', 'UAV-03'].map((droneId) => {
          const isSelected = selectedDrone?.id === droneId;
          const isTracking = isSelected && videoFeedState === 'TRACKING';
          const backendHost = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : '127.0.0.1';
          return (
            <div
              key={`stream-${droneId}`}
              className={`absolute inset-0 w-full h-full z-20 transition-opacity duration-150 ${
                isTracking ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`}
            >
              <img
                src={`http://${backendHost}:8000/api/video_feed/${droneId}`}
                alt={`${droneId} 실시간 정찰 영상`}
                className="w-full h-full object-cover"
                onLoad={() => setStreamActive(true)}
                onError={() => setStreamActive(false)}
              />
              {/* 정찰 도달 시 실시간 AI로 식별된 표적 태그 */}
              {isTracking && assignedTarget && (
                <div className="absolute bottom-2 left-3 z-30 px-2.5 py-1 rounded bg-red-950/90 border border-red-500 text-red-200 font-bold text-xs shadow-md">
                  <span>[AI 실시간 식별] {assignedTarget.name}</span>
                  <span className="ml-2 text-cyan-300 font-mono">위협도 {(assignedTarget.score * 100).toFixed(0)}%</span>
                  {(assignedTarget.detectedCount ?? 0) > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-red-800 text-white font-mono text-[10px]">
                      {assignedTarget.detectedClass && assignedTarget.detectedClass !== 'TARGET'
                        ? `${assignedTarget.detectedClass} · ${assignedTarget.detectedCount}기`
                        : `${assignedTarget.detectedCount}기 식별`}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!selectedDrone && (
          <div className="flex flex-col items-center justify-center text-slate-500 space-y-2 z-10">
            <Radio className="w-8 h-8 text-slate-600 animate-pulse" />
            <span className="text-xs font-mono">UAV를 선택하면 영상이 표출됩니다</span>
          </div>
        )}
      </div>

    </div>
  );
}

