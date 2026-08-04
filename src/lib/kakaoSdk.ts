// 카카오맵 SDK 단일 로더 — 지도와 로드뷰가 같은 스크립트를 공유한다.
// 컴포넌트마다 주입하면 SDK 가 중복 로드되고 kakao.maps.load 콜백이 어긋난다.

export interface KakaoMaps {
  Roadview: new (container: HTMLElement, options?: unknown) => KakaoRoadview;
  RoadviewClient: new () => KakaoRoadviewClient;
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

export interface KakaoBounds {
  extend(latlng: LatLng): void;
  isEmpty(): boolean;
}

export interface KakaoMap {
  setCenter(latlng: LatLng): void;
  getCenter(): LatLng;
  panTo(latlng: LatLng): void;
  setBounds(bounds: KakaoBounds): void;
  relayout(): void;
  setLevel(level: number): void;
  getLevel(): number;
  setMap(map: KakaoMap | null): void;
  getProjection(): {
    fromCoordToOffset: (latlng: LatLng) => { x: number; y: number };
    containerPointFromCoords: (latlng: LatLng) => { x: number; y: number };
  };
  getBounds(): { getSouthWest(): LatLng; getNorthEast(): LatLng };
  addListener(type: string, callback: () => void): void;
  removeListener(type: string, callback: () => void): void;
}

export interface LatLng {
  getLat(): number;
  getLng(): number;
}

export interface CustomOverlay {
  setMap(map: KakaoMap | null): void;
  setPosition(latlng: LatLng): void;
  setYAnchor(y: number): void;
}

export interface Marker {
  setMap(map: KakaoMap | null): void;
  setPosition(latlng: LatLng): void;
  setZIndex(zIndex: number): void;
}

export interface InfoWindow {
  open(map: KakaoMap, marker: Marker): void;
  close(): void;
}

let kakaoPromise: Promise<KakaoMaps> | null = null;

export function loadKakaoSdk(apiKey: string): Promise<KakaoMaps> {
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


export interface KakaoRoadview {
  setPanoId(panoId: string, position: LatLng): void;
  setViewpoint(vp: { pan: number; tilt: number; zoom: number }): void;
  relayout(): void;
}

export interface KakaoRoadviewClient {
  getNearestPanoId(position: LatLng, radius: number, cb: (panoId: string | null) => void): void;
}

/** 카카오 JS 키 — server/.env 에서 내려온다(소스에 커밋하지 않는 원칙). */
export async function fetchKakaoJsKey(): Promise<string | null> {
  try {
    const r = await fetch('/api/realestate/config');
    if (!r.ok) return null;
    const j = (await r.json()) as { kakaoJsKey?: string | null };
    return j.kakaoJsKey ?? null;
  } catch { return null; }
}
