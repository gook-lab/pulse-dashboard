import { useEffect, useRef, useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import { scaleColor, legendStops, SIGNAL_DOMAIN, MUTED } from '@/lib/colors';
import type { AptComplex, ScreenRank } from '@/data/types';
import { formatSignalValue } from './ComplexList';
import s from './ComplexMap.module.css';

// ───────────────────────────────────────────────────────────────────
// 카카오맵 SDK 싱글턴 로드
// ───────────────────────────────────────────────────────────────────

interface KakaoMaps {
  Map: new (container: HTMLElement, options: unknown) => KakaoMap;
  LatLng: new (lat: number, lng: number) => LatLng;
  LatLngBounds: new () => KakaoBounds;
  CustomOverlay: new (options: unknown) => CustomOverlay;
  Marker: new (options: unknown) => Marker;
  InfoWindow: new (options: unknown) => InfoWindow;
  event: {
    addListener(target: unknown, type: string, callback: () => void): void;
    removeListener(target: unknown, type: string, callback: () => void): void;
  };
}

interface KakaoBounds {
  extend(latlng: LatLng): void;
  isEmpty(): boolean;
}

interface KakaoMap {
  setCenter(latlng: LatLng): void;
  getCenter(): LatLng;
  panTo(latlng: LatLng): void;
  setBounds(bounds: KakaoBounds): void;
  relayout(): void;
  setLevel(level: number): void;
  getLevel(): number;
  setMap(map: KakaoMap | null): void;
  getProjection(): { fromCoordToOffset: (latlng: LatLng) => { x: number; y: number } };
  getBounds(): { getSouthWest(): LatLng; getNorthEast(): LatLng };
  addListener(type: string, callback: () => void): void;
  removeListener(type: string, callback: () => void): void;
}

interface LatLng {
  getLat(): number;
  getLng(): number;
}

interface CustomOverlay {
  setMap(map: KakaoMap | null): void;
  setPosition(latlng: LatLng): void;
}

interface Marker {
  setMap(map: KakaoMap | null): void;
  setPosition(latlng: LatLng): void;
  setZIndex(zIndex: number): void;
}

interface InfoWindow {
  open(map: KakaoMap, marker: Marker): void;
  close(): void;
}

let kakaoPromise: Promise<KakaoMaps> | null = null;

function loadKakaoSdk(apiKey: string): Promise<KakaoMaps> {
  if (kakaoPromise) return kakaoPromise;

  kakaoPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&autoload=false`;

    const timeout = setTimeout(() => {
      cleanup();
      kakaoPromise = null; // 다음 마운트에서 재시도 가능하게
      reject(new Error('Kakao Maps SDK 로드 타임아웃(5초)'));
    }, 5000);

    const cleanup = () => clearTimeout(timeout);

    script.onload = () => {
      cleanup();
      const win = window as unknown as { kakao?: { maps?: { load: (cb: () => void) => void } } };
      if (win.kakao?.maps?.load) {
        win.kakao.maps.load(() => {
          resolve(win.kakao!.maps as unknown as KakaoMaps);
        });
      } else {
        reject(new Error('Kakao Maps SDK이 로드되지 않음'));
      }
    };

    script.onerror = () => {
      cleanup();
      kakaoPromise = null;
      reject(new Error('Kakao Maps SDK 로드 실패'));
    };

    document.head.appendChild(script);
  });

  return kakaoPromise;
}

// ───────────────────────────────────────────────────────────────────
// 동 단위 집계 박스
// ───────────────────────────────────────────────────────────────────

interface AggregatedDistrict {
  gu: string | null;
  umdNm: string;
  lat: number;
  lng: number;
  value: number;
  count: number;
  ids: string[];
}

function createDistrictAggregates(
  ranks: ScreenRank[],
  byId: Map<string, AptComplex>,
): AggregatedDistrict[] {
  const byDistrict = new Map<string, { items: AptComplex[]; values: number[] }>();

  for (const rank of ranks) {
    const apt = byId.get(rank.id);
    if (!apt || apt.lat == null || apt.lng == null) continue;

    const key = `${apt.gu}|${apt.umdNm}`;
    if (!byDistrict.has(key)) {
      byDistrict.set(key, { items: [], values: [] });
    }
    const dist = byDistrict.get(key)!;
    dist.items.push(apt);
    dist.values.push(rank.value);
  }

  const aggregates: AggregatedDistrict[] = [];
  for (const [key, { items, values }] of byDistrict) {
    const [gu, umdNm] = key.split('|');
    const lats = items.map((a) => a.lat!);
    const lngs = items.map((a) => a.lng!);
    const avgLat = lats.reduce((s, x) => s + x, 0) / lats.length;
    const avgLng = lngs.reduce((s, x) => s + x, 0) / lngs.length;

    // 중앙값
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    aggregates.push({
      gu: gu === 'null' ? null : gu,
      umdNm,
      lat: avgLat,
      lng: avgLng,
      value: median,
      count: items.length,
      ids: items.map((a) => a.aptSeq),
    });
  }

  // 멤버 수 상위 30개 — 값 기준으로 자르면 하락 동네가 지도에서 사라진다
  return aggregates.sort((a, b) => b.count - a.count).slice(0, 30);
}

// ───────────────────────────────────────────────────────────────────
// 컴포넌트
// ───────────────────────────────────────────────────────────────────

export default function ComplexMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const overlaysRef = useRef<CustomOverlay[]>([]);

  const aptScreen = useStore((st) => st.aptScreen);
  const aptComplexes = useStore((st) => st.aptComplexes);
  const hoveredComplexId = useStore((st) => st.hoveredComplexId);
  const selectedComplexId = useStore((st) => st.selectedComplexId);
  const selectionSource = useStore((st) => st.selectionSource);
  const areaFilter = useStore((st) => st.areaFilter);
  const colorMode = useStore((st) => st.colorMode);
  const setHoveredComplex = useStore((st) => st.setHoveredComplex);
  const selectComplex = useStore((st) => st.selectComplex);
  const setAreaFilter = useStore((st) => st.setAreaFilter);
  const setAptMapFailed = useStore((st) => st.setAptMapFailed);

  const [kakao, setKakao] = useState<KakaoMaps | null>(null);
  const [level, setLevel] = useState(8);
  // 팬만 해도 뷰포트가 바뀐다 — level 이 같아도 idle 마다 오버레이를 다시 걸러야 한다
  const [viewportTick, setViewportTick] = useState(0);
  // hover 하이라이트는 재구성 없이 이 맵으로 스타일만 바꾼다 (재구성하면 마우스 아래 DOM 이 교체되어 플리커)
  const markerElsRef = useRef(new Map<string, HTMLDivElement>());
  // 우리가 움직인 idle 인지 사용자가 움직인 idle 인지 구분한다.
  // 사용자가 직접 팬·줌한 뒤에는 필터 변경 자동 맞춤이 지도를 빼앗지 않는다.
  // 불리언 소비 방식은 idle 이 0회(같은 좌표 setCenter)거나 2회(setBounds) 오면 어긋난다 —
  // 시간 창으로 분류해 미발화 시 자연 만료되게 한다.
  const programmaticUntilRef = useRef(0);
  const userMovedRef = useRef(false);

  /** 우리 쪽에서 지도를 움직일 때는 반드시 이걸 통해서 — idle 핸들러가 사용자 이동으로 오인하지 않게. */
  const moveMap = (fn: (map: KakaoMap) => void) => {
    if (!mapRef.current) return;
    programmaticUntilRef.current = Date.now() + 800;
    fn(mapRef.current);
  };

  // ─────────────────── SDK 초기화 ─────────────────────
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        // config에서 카카오 키 조회
        const configRes = await fetch('/api/realestate/config');
        if (!configRes.ok) {
          if (isMounted) {
            setAptMapFailed(true);
          }
          return;
        }

        const config = (await configRes.json()) as { kakaoJsKey?: string | null };
        if (!config.kakaoJsKey) {
          if (isMounted) {
            setAptMapFailed(true, 'KAKAO_JS_KEY 미설정 (server/.env)');
          }
          return;
        }

        // 사전 점검 — 미등록 도메인이면 카카오가 Referer 를 보고 401 을 준다.
        // 브라우저 직접 fetch 는 CORS 로 원인이 안 보이므로 서버 프록시로 물어본다.
        try {
          const probe = await fetch(`/api/realestate/kakao-probe?origin=${encodeURIComponent(location.origin)}`)
            .then((r) => r.json());
          if (!probe.ok) {
            const reason = probe.domainMismatch
              ? `카카오 콘솔에 Web 도메인(${location.origin}) 등록 필요 — 등록 후 새로고침`
              : `카카오 SDK 점검 실패(${probe.status ?? '?'}) — 키·카카오맵 사용 설정 확인`;
            if (isMounted) setAptMapFailed(true, reason);
            return;
          }
        } catch { /* 프록시 실패 시 본 로드로 진행 — 실패해도 아래 catch 가 잡는다 */ }

        // SDK 로드
        const sdk = await loadKakaoSdk(config.kakaoJsKey);
        if (isMounted) {
          setKakao(sdk);
        }
      } catch (err) {
        // 타임아웃 또는 로드 실패
        if (isMounted) {
          setAptMapFailed(true);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [setAptMapFailed]);

  // ─────────────────── 지도 초기화 ─────────────────────
  useEffect(() => {
    if (!kakao || !containerRef.current) return;

    if (mapRef.current) {
      // 이미 생성됨
      return;
    }

    // 서울시청 좌표
    const center = new kakao.LatLng(37.5665, 126.978);
    const mapInstance = new kakao.Map(containerRef.current, {
      center,
      level: 8,
      draggable: true,
      scrollwheel: true,
    });

    mapRef.current = mapInstance;

    // 줌·팬 종료마다 오버레이 재구성 트리거. level 이 그대로여도 뷰포트는 바뀐다.
    // 프로그램적 이동 시간 창 밖의 idle 만 사용자 이동으로 기록 → 자동 맞춤 중단.
    const onIdle = () => {
      if (Date.now() > programmaticUntilRef.current) userMovedRef.current = true;
      setLevel(mapInstance.getLevel());
      setViewportTick((t) => t + 1);
    };

    kakao.event.addListener(mapInstance, 'idle', onIdle);

    // "지도 보기" 토글·반응형 전환으로 컨테이너가 0 → 양수 크기가 되는 순간
    // 카카오 지도는 스스로 모른다 — relayout 없이는 타일이 깨진 채 남는다.
    let hadSize = containerRef.current.clientWidth > 0;
    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el) return;
      const hasSize = el.clientWidth > 0 && el.clientHeight > 0;
      if (hasSize && !hadSize) {
        const center = mapInstance.getCenter();
        programmaticUntilRef.current = Date.now() + 800; // 같은 좌표 setCenter 는 idle 을 안 낼 수 있다 — 시간 창이라 안전
        mapInstance.relayout();
        mapInstance.setCenter(center);
      }
      hadSize = hasSize;
    });
    ro.observe(containerRef.current);

    return () => {
      kakao.event.removeListener(mapInstance, 'idle', onIdle);
      ro.disconnect();
    };
  }, [kakao]);

  // ─────────────────── 오버레이 재구성 ─────────────────────
  // hoveredComplexId 는 의도적으로 deps 에서 뺐다 — hover 마다 재구성하면
  // 마우스 아래 DOM 이 교체되어 mouseout → 재구성 → mouseover 플리커 루프가 된다.
  // 하이라이트는 아래 별도 이펙트가 스타일만 바꾼다.
  useEffect(() => {
    if (!mapRef.current || !kakao || !aptScreen || !aptComplexes) return;

    const clear = () => {
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
      markerElsRef.current.clear();
    };
    clear();

    const currentLevel = mapRef.current.getLevel();
    const bounds = mapRef.current.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const swLat = sw.getLat(), swLng = sw.getLng(), neLat = ne.getLat(), neLng = ne.getLng();
    const inView = (lat: number, lng: number) => lat >= swLat && lat <= neLat && lng >= swLng && lng <= neLng;

    const byId = new Map(aptComplexes.items.map((c) => [c.aptSeq, c]));
    const signal = aptScreen.signal;
    const domain = SIGNAL_DOMAIN[signal];

    if (currentLevel >= 7) {
      // ─── 동 단위 집계 박스 ───
      const aggs = createDistrictAggregates(aptScreen.ranked, byId);

      for (const agg of aggs) {
        if (!inView(agg.lat, agg.lng)) continue;

        // 계산 표본이 너무 적은 동은 색으로 말하면 안 된다 — 회색 '거래부족'
        const thin = agg.count < 3;
        const bg = thin ? MUTED : `${scaleColor(agg.value, domain, colorMode)}E6`;

        const el = document.createElement('div');
        el.className = s.districtBox;
        el.style.backgroundColor = bg;
        el.innerHTML = `
          <div class="${s.districtName}">${agg.umdNm}</div>
          <div class="mono" style="font-size: 13px; font-weight: 700;">${thin ? '거래부족' : formatSignalValue(agg.value, signal)}</div>
          <div style="font-size: 11.5px; opacity: .8;">단지 ${agg.count}</div>
        `;
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          // 줌만 하지 않는다 — 리스트도 이 동으로 좁혀 지도→리스트 방향을 잇는다 (전역 순위는 유지)
          if (agg.gu) setAreaFilter({ gu: agg.gu, umdNm: agg.umdNm });
          moveMap((m) => {
            m.setCenter(new kakao.LatLng(agg.lat, agg.lng));
            m.setLevel(5);
          });
        });

        const overlay = new kakao.CustomOverlay({
          position: new kakao.LatLng(agg.lat, agg.lng),
          content: el,
          zIndex: 10,
        });
        overlay.setMap(mapRef.current);
        overlaysRef.current.push(overlay);
      }
    } else {
      // ─── 단지 마커 — 뷰포트 안 + 순위 상위 400개 캡 (8,095 전체 렌더 금지) ───
      const selectedId = useStore.getState().selectedComplexId;
      interface MarkerOpts {
        isGray?: boolean;
        zIndex?: number;
      }
      const addMarker = (apt: AptComplex, value: number | null, opts?: MarkerOpts) => {
        if (apt.lat == null || apt.lng == null) return; // 호출부가 이미 거르지만 타입 내로잉용
        const isGray = opts?.isGray ?? false;
        const zIndex = opts?.zIndex ?? 100;

        const color = isGray ? MUTED : scaleColor(value, domain, colorMode);
        const el = document.createElement('div');
        el.className = isGray ? `${s.markerDot} ${s.markerDim}` : s.markerDot;
        el.style.backgroundColor = color;

        const tip = document.createElement('span');
        tip.className = s.markerTip;
        if (isGray) {
          tip.textContent = `${apt.aptNm} · 조건 미충족(거래부족·데이터부족)`;
        } else {
          tip.textContent = `${apt.aptNm} ${value != null ? formatSignalValue(value, signal) : '조건 미충족'}`;
        }
        el.appendChild(tip);

        el.addEventListener('mouseover', () => setHoveredComplex(apt.aptSeq, 'map'));
        el.addEventListener('mouseout', () => setHoveredComplex(null, 'map'));
        el.addEventListener('click', () => selectComplex(apt.aptSeq, 'map'));

        const overlay = new kakao.CustomOverlay({
          position: new kakao.LatLng(apt.lat, apt.lng),
          content: el,
          zIndex,
        });
        overlay.setMap(mapRef.current);
        overlaysRef.current.push(overlay);
        markerElsRef.current.set(apt.aptSeq, el);
      };

      // ─── 컬러 마커 (조건 통과 단지) — 캡 400 ───
      let shown = 0;
      for (const rank of aptScreen.ranked) {
        if (shown >= 400) break;
        const apt = byId.get(rank.id);
        if (!apt || apt.lat == null || apt.lng == null) continue;
        if (!inView(apt.lat, apt.lng)) continue;
        shown++;
        addMarker(apt, rank.value);
      }

      // 선택 단지는 캡·뷰포트와 무관하게 반드시 마커가 있어야 링 강조가 성립한다.
      if (selectedId && !markerElsRef.current.has(selectedId)) {
        const apt = byId.get(selectedId);
        if (apt && apt.lat != null && apt.lng != null) {
          addMarker(apt, aptScreen.ranked.find((r) => r.id === selectedId)?.value ?? null);
        }
      }

      // ─── 회색 마커 (저거래·데이터부족 단지) — 캡 200 ───
      const rankedSet = new Set(aptScreen.ranked.map((r) => r.id));
      let shownGray = 0;
      for (const apt of aptComplexes.items) {
        if (shownGray >= 200) break;
        if (rankedSet.has(apt.aptSeq)) continue; // 이미 컬러 마커로 표시됨
        if (apt.lat == null || apt.lng == null) continue;
        if (!inView(apt.lat, apt.lng)) continue;
        shownGray++;
        addMarker(apt, null, { isGray: true, zIndex: 50 });
      }
    }

    return clear;
  }, [
    kakao,
    aptScreen,
    aptComplexes,
    // level state 는 표시용(칩)일 뿐 — 재구성은 idle 이 올리는 viewportTick 하나로 트리거한다.
    // 둘 다 걸면 한 프레임 어긋난 이중 재구성이 생긴다.
    viewportTick,
    colorMode,
    setHoveredComplex,
    selectComplex,
    setAreaFilter,
  ]);

  // ─────────────────── hover·선택 하이라이트 (리스트 ↔ 마커 양방향) ─────────────────────
  useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      el.classList.toggle(s.markerOn, id === hoveredComplexId);
      el.classList.toggle(s.markerSel, id === selectedComplexId);
    }
  }, [hoveredComplexId, selectedComplexId, viewportTick, aptScreen]);

  // ─────────────────── 리스트발 선택 → 지도가 따라간다 ─────────────────────
  // 지도발 선택(selectionSource==='map')은 무시 — 사용자가 방금 클릭한 자리에서 지도를 빼앗지 않는다.
  useEffect(() => {
    if (!kakao || !mapRef.current || !selectedComplexId || selectionSource !== 'list') return;
    const apt = aptComplexes?.items.find((c) => c.aptSeq === selectedComplexId);
    if (!apt || apt.lat == null || apt.lng == null) return;
    moveMap((m) => {
      if (m.getLevel() >= 7) m.setLevel(5);
      m.panTo(new kakao.LatLng(apt.lat!, apt.lng!));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kakao, selectedComplexId, selectionSource, aptComplexes]);

  // ─────────────────── 뷰포트 자동 맞춤 — 단일 조정자 ─────────────────────
  // 규칙을 한 곳에 모은다. 두 effect 로 나누면 지역 필터 중 시그널 변경 시
  // 전역 top-50 맞춤이 지역 선택을 빼앗는 경합이 생긴다(리뷰에서 확인된 critical).
  //   · areaFilter 변경        → 항상 그 지역으로 (명시적 사용자 의도)
  //   · 시그널·거래유형 변경    → areaFilter 있으면 그 지역으로(최신 데이터),
  //                              없으면 사용자가 손대지 않았을 때만 top-50 으로
  //   · 첫 로드                → 서울 전역 기본 뷰 유지
  const prevFitKeyRef = useRef<{ query: string; area: string } | null>(null);
  useEffect(() => {
    if (!kakao || !mapRef.current || !aptScreen || !aptComplexes) return;
    const queryKey = `${aptScreen.signal}|${aptScreen.dealType}`;
    const areaKey = areaFilter ? `${areaFilter.gu}|${areaFilter.umdNm ?? ''}` : '';
    const prev = prevFitKeyRef.current;
    prevFitKeyRef.current = { query: queryKey, area: areaKey };
    if (!prev) return;
    const queryChanged = prev.query !== queryKey;
    const areaChanged = prev.area !== areaKey;
    if (!queryChanged && !areaChanged) return;

    const byId = new Map(aptComplexes.items.map((c) => [c.aptSeq, c]));
    const bounds = new kakao.LatLngBounds();
    let n = 0;
    const extend = (apt: AptComplex) => {
      if (apt.lat != null && apt.lng != null) { bounds.extend(new kakao.LatLng(apt.lat, apt.lng)); n++; }
    };

    if (areaFilter) {
      for (const r of aptScreen.ranked) {
        const apt = byId.get(r.id);
        if (!apt || apt.gu !== areaFilter.gu) continue;
        if (areaFilter.umdNm && apt.umdNm !== areaFilter.umdNm) continue;
        extend(apt);
      }
    } else if (areaChanged) {
      return; // 필터 해제 — 현재 뷰를 유지한다(사용자가 보던 자리를 빼앗지 않음)
    } else if (userMovedRef.current) {
      return; // 사용자가 직접 움직인 뒤에는 전역 자동 맞춤을 하지 않는다
    } else {
      for (const r of aptScreen.ranked.slice(0, 50)) {
        const apt = byId.get(r.id);
        if (apt) extend(apt);
      }
    }
    if (n >= 2) moveMap((m) => m.setBounds(bounds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kakao, aptScreen, aptComplexes, areaFilter]);

  // ─────────────────── 줌 버튼 ─────────────────────
  const handleZoomIn = () => {
    if (mapRef.current) {
      const newLevel = Math.max(1, mapRef.current.getLevel() - 1);
      mapRef.current.setLevel(newLevel);
      setLevel(newLevel);
    }
  };

  const handleZoomOut = () => {
    if (mapRef.current) {
      const newLevel = Math.min(14, mapRef.current.getLevel() + 1);
      mapRef.current.setLevel(newLevel);
      setLevel(newLevel);
    }
  };

  // ─────────────────── 범례 — 화면에 실제로 그려진 데이터(aptScreen) 기준 ─────────────────────
  const legendData = useMemo(() => {
    if (!aptScreen) return null;
    return legendStops(SIGNAL_DOMAIN[aptScreen.signal], colorMode);
  }, [aptScreen, colorMode]);

  // 좌표가 없어 지도에서 조용히 빠진 단지 수 — 숨기지 않고 칩으로 알린다.
  const noCoordCount = useMemo(() => {
    if (!aptScreen || !aptComplexes) return 0;
    const byId = new Map(aptComplexes.items.map((c) => [c.aptSeq, c]));
    return aptScreen.ranked.reduce((sum, r) => {
      const apt = byId.get(r.id);
      return sum + (!apt || apt.lat == null ? 1 : 0);
    }, 0);
  }, [aptScreen, aptComplexes]);

  if (!kakao) {
    return null;
  }

  // 지도는 보조 뷰(디자인 D9)지만 통째로 aria-hidden 을 걸면 안 된다 —
  // 하위의 줌 버튼이 "포커스는 가는데 읽히지 않는" 상태가 된다.
  // 접근성 트리에서 빼는 건 마커 캔버스뿐. 마커·동 박스에는 tabIndex 를 주지 않는다(리스트가 정규 조작면).
  return (
    <div className={s.container} role="region" aria-label="단지 지도 (보조 뷰)">
      <div ref={containerRef} className={s.mapContainer} aria-hidden="true" />

      {/* 좌상단 칩 */}
      <div className={s.chipTop}>
        {level >= 7
          ? '줌아웃 · 동 단위 집계 — 확대하면 단지 마커'
          : '단지 마커 — 축소하면 동 단위 집계'}
      </div>

      {/* 우상단 줌 버튼 */}
      <div className={s.zoomControls}>
        <button
          className={s.zoomBtn}
          onClick={handleZoomIn}
          aria-label="줌 인"
          title="확대"
        >
          +
        </button>
        <button
          className={s.zoomBtn}
          onClick={handleZoomOut}
          aria-label="줌 아웃"
          title="축소"
        >
          −
        </button>
      </div>

      {/* 좌표 없는 단지 안내 — 지도에서 빠진 만큼을 숨기지 않는다 */}
      {noCoordCount > 0 && (
        <div className={s.noCoordChip}>좌표 없음 {noCoordCount.toLocaleString()}단지 제외</div>
      )}

      {/* 하단 범례 — 산식 설명은 ⓘ 툴팁으로 (한 줄 4개 정보는 과밀) */}
      {legendData && aptScreen && (
        <div className={s.legendStrip}>
          <div className={s.legendContent}>
            <span className={s.legendLabel}>
              {formatSignalValue(legendData[0].value, aptScreen.signal)}
            </span>
            {legendData.map((stop) => (
              <div
                key={stop.value}
                className={s.legendBox}
                style={{ backgroundColor: stop.color }}
              />
            ))}
            <span className={s.legendLabel}>
              {formatSignalValue(legendData[legendData.length - 1].value, aptScreen.signal)}
            </span>
            <span className={s.legendNote}>회색 = 거래 {aptScreen.minDeals}건 미만·데이터 부족</span>
            <span
              className={s.legendInfo}
              title={`${aptScreen.dealType === 'rent' ? '전세' : '매매'} 평당가 중앙값 · 기준월 = 3개월 전 (신고지연 30일 보정)`}
            >ⓘ</span>
          </div>
        </div>
      )}
    </div>
  );
}
