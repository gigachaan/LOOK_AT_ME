'use client';

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

function getWargameModelScale(zoom: number): number {
  if (zoom <= 10) return 0.28;
  if (zoom === 11) return 0.35;
  if (zoom === 12) return 0.45;
  if (zoom === 13) return 0.58;
  if (zoom === 14) return 0.72;
  if (zoom === 15) return 0.90;
  if (zoom === 16) return 1.10;
  return Math.min(1.30, 1.10 + (zoom - 16) * 0.12);
}

function createWargameModelHtml(type: string, unitIndex: number, scale: number = 1.0, detectedClass?: string): string {
  const isTank = type === 'tank' || type.includes('전차') || type.includes('기갑');
  const isApc = type === 'apc' || type.includes('장갑차') || type.includes('보병');
  const isRadar = type === 'radar' || type.includes('레이더') || type.includes('방공');
  const isTel = type === 'tel' || type.includes('방사포') || type.includes('다연장');

  const exactModel = detectedClass && detectedClass !== 'TARGET' && detectedClass !== 'UNKNOWN' ? detectedClass.toUpperCase() : '';
  const labelText = exactModel
    ? `${exactModel} #${unitIndex}`
    : isTank
    ? `MBT #${unitIndex}`
    : isApc
    ? `AFV #${unitIndex}`
    : isTel
    ? `MLRS #${unitIndex}`
    : isRadar
    ? `RADAR #${unitIndex}`
    : `TGT #${unitIndex}`;

  let figureContent = '';
  if (isTank || isApc || isTel) {
    // 실사 기반 3D 전차 모델 (사용자 제공 정밀 애셋 + 얇은 적군 붉은색 외곽선 윤곽)
    figureContent = `
      <div style="position:relative; display:flex; align-items:center; justify-content:center;">
        <img 
          src="/tank_model.png" 
          alt="${labelText}" 
          style="width:52px; height:24px; object-fit:contain; filter:drop-shadow(1px 0 0 #ef4444) drop-shadow(-1px 0 0 #ef4444) drop-shadow(0 1px 0 #ef4444) drop-shadow(0 -1px 0 #ef4444) drop-shadow(0 0 1px #ef4444) drop-shadow(0 3px 5px rgba(0,0,0,0.9)); pointer-events:none;" 
        />
      </div>
    `;
  } else {
    figureContent = `
      <div style="position:relative; display:flex; align-items:center; justify-content:center;">
        <svg viewBox="0 0 44 44" width="38" height="38" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 4px 6px rgba(0,0,0,0.9));">
          <rect x="13" y="12" width="18" height="24" rx="3" fill="#334155" stroke="#0f172a" stroke-width="1.2"/>
          <circle cx="22" cy="21" r="8" fill="#475569" stroke="#ef4444" stroke-width="1.2" stroke-dasharray="3 2"/>
          <line x1="22" y1="21" x2="28" y2="15" stroke="#ef4444" stroke-width="2"/>
          <circle cx="22" cy="21" r="2.5" fill="#ef4444"/>
        </svg>
      </div>
    `;
  }

  return `
    <div class="figure-deploy" style="position:relative; width:56px; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; pointer-events:auto; transform: scale(${scale}); transform-origin: center center;">
      ${figureContent}
      <div style="font-size:8px; font-weight:800; font-family:'JetBrains Mono', Pretendard, monospace; color:#fca5a5; background:#450a0aee; border:1px solid #ef4444; border-radius:2.5px; padding:0px 3px; white-space:nowrap; margin-top:2px; box-shadow:0 2px 4px rgba(0,0,0,0.85);">${labelText}</div>
    </div>
  `;
}

interface TacticalMapProps {
  drones: Drone[];
  targets: TacticalTarget[];
  flightPlans?: { [droneId: string]: { route_rois: string[]; waypoints: [number, number][] } };
  selectedDroneId?: string | null;
  onSelectDrone?: (id: string) => void;
  onOpenDroneModal?: (drone: Drone) => void;
  onOpenTargetModal?: (target: TacticalTarget) => void;
}

export default function TacticalMap({ drones, targets, flightPlans, selectedDroneId, onSelectDrone, onOpenDroneModal, onOpenTargetModal }: TacticalMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const droneLayersRef = useRef<{
    [id: string]: {
      marker: L.Marker;
      circle: L.Circle;
      polyline: L.Polyline;
      sectorMarker?: L.Marker;
    };
  }>({});
  const lastMGRSRef = useRef<{ [id: string]: { time: number, text: string } }>({});

  const emergencyGroupRef = useRef<L.LayerGroup | null>(null);
  const [currentTile, setCurrentTile] = useState<'dark' | 'satellite' | 'street'>('satellite');

  // 4. 긴급 표적 및 진입 유도선 레이어 동기화 (재생성 깜빡임 원천 차단 및 안정적 렌더링)
  const targetLayersRef = useRef<{
    [id: string]: {
      marker: L.Marker;
      circle: L.Circle;
      polyline?: L.Polyline;
      status?: string;
      authorized?: boolean;
      score?: number;
      entityMarkers?: L.Marker[];
      lastRenderedAuthorized?: boolean;
      lastRenderedClass?: string;
    };
  }>({});

  const targetsRef = useRef<TacticalTarget[]>(targets);
  targetsRef.current = targets;

  // 1. 지도 초기화
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [37.8724, 126.7873],
      zoom: 12,
      minZoom: 10,
      maxBounds: [
        [37.0, 125.0],
        [39.0, 129.0]
      ],
      maxBoundsViscosity: 0.8,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    tileLayerRef.current = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=y&hl=ko&x={x}&y={y}&z={z}&apistyle=s.e:l.i|p.v:off',
      { maxZoom: 19, maxNativeZoom: 18, updateWhenZooming: false, keepBuffer: 4, attribution: '&copy; Google Maps' }
    ).addTo(map);

    emergencyGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // 지도 줌 인/줌 아웃 시 워게임 전차/장갑차 모형 크기를 줌 레벨에 비례하여 동적 스케일링
    const handleZoomChange = () => {
      if (!mapRef.current) return;
      const zoom = mapRef.current.getZoom();
      const scale = getWargameModelScale(zoom);
      const w = Math.max(16, Math.round(56 * scale));
      const h = Math.max(14, Math.round(38 * scale));

      Object.entries(targetLayersRef.current).forEach(([targetId, item]) => {
        if (item.entityMarkers && item.entityMarkers.length > 0) {
          const targetObj = targetsRef.current.find((t) => t.id === targetId);
          const enemyType = targetObj?.enemyType || (targetObj?.name.includes('장갑차') ? 'apc' : targetObj?.name.includes('레이더') ? 'radar' : 'tank');
          item.entityMarkers.forEach((m, idx) => {
            const html = createWargameModelHtml(enemyType, idx + 1, scale, targetObj?.detectedClass);
            const modelIcon = L.divIcon({
              html,
              className: 'wargame-entity-model',
              iconSize: [w, h],
              iconAnchor: [Math.round(w / 2), Math.round(h / 2)],
            });
            m.setIcon(modelIcon);
            m.setZIndexOffset(200);
          });
        }
      });
    };

    map.on('zoomend', handleZoomChange);

    // 컨테이너 크기 변경(전체보기 모달, 레이아웃 변경) 시 즉각 Leaflet 지도 타일 재계산
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      map.off('zoomend', handleZoomChange);
      resizeObserver.disconnect();
      Object.values(droneLayersRef.current).forEach((item) => {
        item.marker.remove();
        item.circle.remove();
        item.polyline.remove();
        if (item.sectorMarker) item.sectorMarker.remove();
      });
      droneLayersRef.current = {};
      Object.values(targetLayersRef.current).forEach((item) => {
        if (item.entityMarkers) item.entityMarkers.forEach(m => m.remove());
      });
      targetLayersRef.current = {};
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 3. UAV 3기 고정익(KUS-FS) 마커 및 독립 감시 반경 레이어 동기화
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    drones.forEach((d) => {
      const isSelected = selectedDroneId === d.id;
      const isEnRoute = d.status === '급파 요격';
      const isTracking = d.status === '현장 정밀 정찰';
      const headingDeg = Math.round(d.heading ?? 0);

      if (!droneLayersRef.current[d.id]) {
        // KUS-FS 중고도 고정익 무인기 전술 심볼 SVG
        const iconHtml = `
          <div style="position:relative; width:44px; height:44px; display:flex; align-items:center; justify-content:center; cursor:pointer;">
            <div class="uav-selection-ring" style="position:absolute; width:48px; height:48px; border-radius:50%; background:${d.color}20; border:2px solid ${d.color}; display:${isSelected ? 'block' : 'none'}; pointer-events:none; opacity:0.7; box-shadow:0 0 10px ${d.color}; animation:pulse-emergency 2s infinite;"></div>
            <div class="uav-plane-icon" style="width:36px; height:36px; display:flex; align-items:center; justify-content:center; transform:rotate(${headingDeg}deg); filter:drop-shadow(0 0 6px ${d.color}); color:${d.color}; pointer-events:none;">
              <svg viewBox="0 0 48 48" width="36" height="36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M24 5 C23 5, 22 7, 22 12 L22 17 L4 21.5 C2.5 22, 2.5 23.5, 4 23.8 L21.5 24.5 L22 36 L15 41.5 C14 42.2, 14.5 43, 15.5 43 L22 41 L22 43 C22 43.8, 26 43.8, 26 43 L26 41 L32.5 43 C33.5 43, 34 42.2, 33 41.5 L26 36 L26.5 24.5 L44 23.8 C45.5 23.5, 45.5 22, 44 21.5 L26 17 L26 12 C26 7, 25 5, 24 5 Z" 
                      fill="currentColor" fill-opacity="0.95" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>
                <circle cx="24" cy="11" r="2.2" fill="#ffffff" fill-opacity="0.95"/>
              </svg>
            </div>
            <span style="position:absolute; bottom:-12px; font-size:10px; font-weight:800; font-family:monospace; color:${d.color}; background:#050812ee; padding:0.5px 5px; border-radius:3px; border:1px solid ${d.color}; white-space:nowrap; box-shadow:0 2px 4px rgba(0,0,0,0.8);">${d.id}</span>
            <span class="uav-mgrs-label" style="position:absolute; left:48px; top:14px; font-size:10px; font-weight:bold; font-family:monospace; color:#38bdf8; background:#050812aa; padding:1px 4px; border-radius:2px; white-space:nowrap; pointer-events:none;">${toMGRS8(d.currentLat, d.currentLng)}</span>
          </div>
        `;
        const customIcon = L.divIcon({
          html: iconHtml,
          className: 'custom-uav-icon',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        });

        const marker = L.marker([d.currentLat, d.currentLng], { 
          icon: customIcon,
          zIndexOffset: 10000,
        }).addTo(map);
        marker.on('click', () => {
          if (onOpenDroneModal) {
            onOpenDroneModal(d);
          } else {
            onSelectDrone?.(d.id);
          }
        });

        // 독립 감시 반경 원 (겹치지 않는 분할 구역 - 돌발상황 발생 시에도 상시 100% 존치)
        const circle = L.circle(d.center, {
          radius: d.radius * 1000,
          color: d.color,
          weight: 1.5,
          fillColor: d.color,
          fillOpacity: 0.08,
          dashArray: '5, 5',
        }).addTo(map);

        // 비행 궤적선: 급파 요격 중일 때만 해당 기체의 목표 지점으로의 비행선 표시
        const waypoints = d.status === '급파 요격' ? (flightPlans?.[d.id]?.waypoints || []) : [];
        const polyline = L.polyline(waypoints, {
          color: d.color,
          weight: 2.5,
          opacity: 0.85,
          dashArray: '8, 6',
        }).addTo(map);

        droneLayersRef.current[d.id] = { marker, circle, polyline };
      } else {
        const { marker, circle, polyline } = droneLayersRef.current[d.id];
        marker.setLatLng([d.currentLat, d.currentLng]);
        marker.setZIndexOffset(10000);


        // 급파 요격(이동 중) 시에만 [현재 UAV 위치 -> 목표 ROI 위치] 1:1 비행선 표시, 도착 후에는 완전 제거
        if (d.status === '급파 요격' && d.targetLat && d.targetLng) {
          polyline.setLatLngs([
            [d.currentLat, d.currentLng],
            [d.targetLat, d.targetLng],
          ]);
          polyline.setStyle({
            color: d.color,
            weight: 2.5,
            opacity: 0.85,
            dashArray: '8, 6',
          });
        } else {
          // 도착했거나 평시 상태면 비행선 빈 배열로 완전히 지움
          polyline.setLatLngs([]);
        }

          const markerEl = marker.getElement();
          if (markerEl) {
            const planeIcon = markerEl.querySelector('.uav-plane-icon') as HTMLElement;
            if (planeIcon) {
              planeIcon.style.transform = `rotate(${headingDeg}deg)`;
            }
            const ring = markerEl.querySelector('.uav-selection-ring') as HTMLElement;
            if (ring) {
              ring.style.display = isSelected ? 'block' : 'none';
            }
            const mgrsLabel = markerEl.querySelector('.uav-mgrs-label') as HTMLElement;
            if (mgrsLabel) {
              const now = Date.now();
              const last = lastMGRSRef.current[d.id] || { time: 0, text: '' };
              if (now - last.time >= 1000) {
                last.time = now;
                last.text = toMGRS8(d.currentLat, d.currentLng);
                lastMGRSRef.current[d.id] = last;
                mgrsLabel.innerText = last.text;
              }
            }
          }

        // UAV가 긴급 ROI로 출격하더라도 원래의 정찰 비행 구역 원은 지도상에 명확히 상시 유지
        const targetRadius = d.radius * 1000;
        if (circle.getRadius() !== targetRadius) circle.setRadius(targetRadius);
        
        const currentCenter = circle.getLatLng();
        if (currentCenter.lat !== d.center[0] || currentCenter.lng !== d.center[1]) {
          circle.setLatLng(d.center);
        }
        circle.setStyle({
          color: d.color,
          weight: 1.5,
          opacity: 0.85,
          fillColor: d.color,
          fillOpacity: 0.08,
          dashArray: '5, 5',
        });
      }
    });

  }, [drones, selectedDroneId, onSelectDrone, flightPlans]);

  // 4. 긴급 표적 및 진입 유도선 레이어 동기화 (재생성 깜빡임 원천 차단 및 안정적 렌더링)

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const currentTargetIds = new Set(targets.map((t) => t.id));

    // 미존재 표적 레이어 정리
    Object.keys(targetLayersRef.current).forEach((id) => {
      if (!currentTargetIds.has(id)) {
        const item = targetLayersRef.current[id];
        item.marker.remove();
        item.circle.remove();
        if (item.polyline) item.polyline.remove();
        if (item.entityMarkers) item.entityMarkers.forEach((m: any) => m.remove());
        delete targetLayersRef.current[id];
      }
    });

    targets.forEach((target) => {
      // 평시 광역 감시 섹터는 건너뛰고 10대 실제 ROI 및 전술 표적 렌더링
      if (target.id.startsWith('SEC-')) return;

      const assignedDrone = drones.find((d) => d.id === target.assignedDrone);
      const isTracking = target.status === '승인 대기' || target.status === '타격 승인 완료';
      const isEnRoute = assignedDrone && assignedDrone.status === '급파 요격';
      const circleColor = target.authorized
        ? '#10b981'
        : isTracking
        ? '#ef4444'
        : target.score >= 0.6
        ? '#ef4444'
        : target.score >= 0.4
        ? '#f59e0b'
        : '#38bdf8';

      const iconEmoji = target.name.includes('전차') || target.type.includes('기갑')
        ? '🛡️'
        : target.name.includes('장갑차') || target.type.includes('정찰')
        ? '🛞'
        : target.name.includes('레이더') || target.type.includes('방공')
        ? '📡'
        : target.name.includes('공병')
        ? '🚜'
        : target.name.includes('보급')
        ? '🚛'
        : '🎯';

      if (!targetLayersRef.current[target.id]) {
        const emHtml = `
          <div style="position:relative; width:44px; height:44px; display:flex; align-items:center; justify-content:center; cursor:pointer;">
            <div class="em-pulse" style="position:absolute; inset:0; border-radius:50%; background:${circleColor}30; border:2px solid ${circleColor}; ${isTracking ? 'animation: pulse-emergency 1.8s ease-out infinite;' : ''}"></div>
            <span style="font-size:18px;">${iconEmoji}</span>
            <span class="em-tag" style="position:absolute; top:-16px; font-size:11px; font-weight:bold; color:${circleColor}; background:#000000bb; padding:1px 5px; border-radius:4px; border:1px solid ${circleColor}; white-space:nowrap;">${target.id} (${(target.score * 100).toFixed(0)}%)</span>
          </div>
        `;

        const emIcon = L.divIcon({
          html: emHtml,
          className: 'custom-emergency-icon',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        });

        const marker = L.marker([target.lat, target.lng], { 
          icon: emIcon,
          zIndexOffset: 500,
        }).addTo(map);
        marker.on('click', () => {
          onOpenTargetModal?.(target);
        });

        const circle = L.circle([target.lat, target.lng], {
          radius: 650,
          color: circleColor,
          weight: 1.5,
          fillColor: circleColor,
          fillOpacity: 0.15,
          dashArray: isTracking ? '4, 4' : undefined,
        }).addTo(map);

        targetLayersRef.current[target.id] = {
          marker,
          circle,
          status: target.status,
          authorized: target.authorized,
          score: target.score,
        };
      } else {
        const layerItem = targetLayersRef.current[target.id];
        // 상태, 승인 여부, 또는 실시간 위협도(score) 변경 시 즉각 스타일 및 배지 텍스트 갱신!
        if (
          layerItem.status !== target.status || 
          layerItem.authorized !== target.authorized ||
          layerItem.score !== target.score
        ) {
          layerItem.status = target.status;
          layerItem.authorized = target.authorized;
          layerItem.score = target.score;

          layerItem.circle.setStyle({
            color: circleColor,
            fillColor: circleColor,
            dashArray: isTracking ? '4, 4' : undefined,
          });

          const el = layerItem.marker.getElement();
          if (el) {
            const pulseEl = el.querySelector('.em-pulse') as HTMLElement;
            if (pulseEl) {
              pulseEl.style.borderColor = circleColor;
              pulseEl.style.background = `${circleColor}30`;
              pulseEl.style.animation = isTracking ? 'pulse-emergency 1.8s ease-out infinite' : 'none';
            }
            const tagEl = el.querySelector('.em-tag') as HTMLElement;
            if (tagEl) {
              tagEl.style.borderColor = circleColor;
              tagEl.style.color = circleColor;
              // [실시간 갱신] ROI 현장 식별에 따라 변화하는 위협도 점수(77% -> 100%) 즉시 반영!
              tagEl.textContent = `${target.id} (${(target.score * 100).toFixed(0)}%)`;
            }
          }
        }
      }

      // 5. 워게임 스타일 적군 개체 모형 마커 동적 렌더링 (ROI 영역 내 식별된 전차/기갑 모형 배치)
      // [사용자 요구사항] UAV가 실제로 현장에 도착하여 정찰 영상이 송출되고 표적이 식별된 상태에서만 전차 말(모형) 배치
      const currentItem = targetLayersRef.current[target.id];
      if (currentItem) {
        const isUavOnSite = assignedDrone && assignedDrone.status === '현장 정밀 정찰';
        const hasDetectedEntities = typeof target.detectedCount === 'number' && target.detectedCount > 0;
        const shouldRenderEntityModels = Boolean(isUavOnSite && hasDetectedEntities);

        if (shouldRenderEntityModels) {
          // 식별된 전차/기갑 기물 개수는 실제 AI 탐지 피크값을 반영 (강제 4기 제한 해제)
          const targetCount = target.detectedCount || 0;
          const entityCount = Math.max(currentItem.entityMarkers?.length || 0, targetCount);
          const currentCount = currentItem.entityMarkers?.length || 0;

          // 개체수가 늘어났을 때만 마커 생성
          if (currentCount !== entityCount && entityCount > 0) {
            if (currentItem.entityMarkers) {
              currentItem.entityMarkers.forEach((m) => m.remove());
            }
            currentItem.entityMarkers = [];

            // 650m ROI 영역 내 전투 대형(Echelon) 동적 분산 배치 좌표 생성 (대수 무제한 대응)
            const getEntityOffsets = (n: number): [number, number][] => {
              if (n === 1) return [[-0.0022, 0.0000]];
              if (n === 2) return [[-0.0022, -0.0030], [-0.0022, 0.0030]];
              if (n === 3) return [[-0.0018, 0.0000], [-0.0036, -0.0028], [-0.0036, 0.0028]];
              if (n === 4) return [[-0.0018, -0.0032], [-0.0018, 0.0032], [-0.0036, -0.0016], [-0.0036, 0.0016]];
              const res: [number, number][] = [];
              const cols = Math.ceil(Math.sqrt(n * 1.5));
              for (let i = 0; i < n; i++) {
                const row = Math.floor(i / cols);
                const col = i % cols;
                const dLat = -0.0018 - row * 0.0016;
                const dLng = (col - (cols - 1) / 2) * 0.0024;
                res.push([dLat, dLng]);
              }
              return res;
            };
            const offsets = getEntityOffsets(entityCount);

            const enemyType = target.enemyType || (target.name.includes('장갑차') ? 'apc' : target.name.includes('레이더') ? 'radar' : 'tank');
            const currentZoom = map.getZoom();
            const scale = getWargameModelScale(currentZoom);
            const w = Math.max(16, Math.round(56 * scale));
            const h = Math.max(14, Math.round(38 * scale));

            offsets.slice(0, entityCount).forEach(([dLat, dLng], idx) => {
              const pos: [number, number] = [target.lat + dLat, target.lng + dLng];
              const html = createWargameModelHtml(enemyType, idx + 1, scale, target.detectedClass);
              const modelIcon = L.divIcon({
                html,
                className: 'wargame-entity-model',
                iconSize: [w, h],
                iconAnchor: [Math.round(w / 2), Math.round(h / 2)],
              });
              const entityMarker = L.marker(pos, { 
                icon: modelIcon,
                zIndexOffset: 200,
              }).addTo(map);
              entityMarker.on('click', () => {
                onOpenTargetModal?.(target);
              });
              currentItem.entityMarkers!.push(entityMarker);
            });
            currentItem.lastRenderedAuthorized = target.authorized;
            currentItem.lastRenderedClass = target.detectedClass;
          } else if (
            currentItem.lastRenderedAuthorized !== target.authorized ||
            currentItem.lastRenderedClass !== target.detectedClass
          ) {
            currentItem.lastRenderedAuthorized = target.authorized;
            currentItem.lastRenderedClass = target.detectedClass;
            const enemyType = target.enemyType || (target.name.includes('장갑차') ? 'apc' : target.name.includes('레이더') ? 'radar' : 'tank');
            const currentZoom = map.getZoom();
            const scale = getWargameModelScale(currentZoom);
            const w = Math.max(16, Math.round(56 * scale));
            const h = Math.max(14, Math.round(38 * scale));
            currentItem.entityMarkers?.forEach((m: any, idx: number) => {
              const html = createWargameModelHtml(enemyType, idx + 1, scale, target.detectedClass);
              const modelIcon = L.divIcon({
                html,
                className: 'wargame-entity-model',
                iconSize: [w, h],
                iconAnchor: [Math.round(w / 2), Math.round(h / 2)],
              });
              m.setIcon(modelIcon);
              m.setZIndexOffset(200);
            });
          }
        } else {
          // 정밀 정찰 도착 전이거나 식별 개체 0이면 모형 마커를 완전히 제거하여 화면을 깨끗하게 유지
          if (currentItem.entityMarkers && currentItem.entityMarkers.length > 0) {
            currentItem.entityMarkers.forEach((m) => m.remove());
            currentItem.entityMarkers = [];
          }
        }
      }

      // 표적 레이어의 중복 비행선은 제거하고 정리
      if (currentItem && currentItem.polyline) {
        currentItem.polyline.remove();
        currentItem.polyline = undefined;
      }
    });
  }, [targets, drones, onOpenTargetModal]);

  return (
    <div className="flex-1 w-full h-full relative flex flex-col border-r border-[#1b263b] bg-[#060911] font-sans">


      <div ref={mapContainerRef} className="flex-1 w-full h-full z-0" />
    </div>
  );
}
