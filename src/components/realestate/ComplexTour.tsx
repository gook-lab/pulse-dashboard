import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { Badge, Bar, Button, EmptyState, Loading, Modal, Segmented } from '@/components/common';
import { Maximize2 } from 'lucide-react';
import { fmt, scaleColor, SIGNAL_DOMAIN } from '@/lib/colors';
import { loadKakaoSdk, fetchKakaoJsKey, type KakaoMaps, type KakaoRoadview } from '@/lib/kakaoSdk';
import type { AptComplexDetail, FloorProfile } from '@/data/types';
import ComplexSiteMap from './ComplexSiteMap';
import s from './ComplexTour.module.css';

/**
 * 단지투어 — 실사 뷰(카카오 로드뷰) + 층별 가격.
 *
 * 호갱노노의 VR 실내투어는 자체 촬영 자산이라 재현 대상이 아니다(공공 데이터에 없음).
 * 대신 두 축을 실데이터로 만든다:
 *   ① 로드뷰 — 단지 앞 실제 거리. 좌표만 있으면 되고 우리는 8,745개를 갖고 있다.
 *   ② 층     — 실거래의 floor 는 100% 채워져 있다(aptDong 은 거의 비어 있어 동 단위는 불가).
 */

type Tab = 'sitemap' | 'roadview' | 'floors';

const BAND_LABEL = { low: '저층', mid: '중층', high: '고층' } as const;
type BandKey = keyof typeof BAND_LABEL;

/** 저·중·고 평당가 비교. 같은 단지 안에서도 층에 따라 값이 갈린다 — 시그널 왜곡의 주요 원인. */
function FloorBands({ profile }: { profile: FloorProfile }) {
  const bands = (Object.keys(BAND_LABEL) as BandKey[])
    .map((k) => ({ key: k, band: profile[k] }))
    .filter((b): b is { key: BandKey; band: NonNullable<FloorProfile['low']> } => b.band != null);

  if (!bands.length) return <EmptyState title="층별 거래가 없습니다" desc="확정 구간에 거래가 잡히지 않았습니다." />;

  const max = Math.max(...bands.map((b) => b.band.ppy));
  const lo = bands.find((b) => b.key === 'low')?.band;
  const hi = bands.find((b) => b.key === 'high')?.band;
  // 고층 프리미엄 — 서울 중앙값이 약 4%다. 크게 벌어지면 층이 가격을 지배하는 단지다.
  const premium = lo && hi ? (hi.ppy / lo.ppy - 1) * 100 : null;

  return (
    <div className={s.bands}>
      {bands.map(({ key, band }) => (
        <div key={key} className={s.bandRow}>
          <span className={s.bandLabel}>{BAND_LABEL[key]}</span>
          <Bar fraction={band.ppy / max} />
          <span className={`${s.bandPpy} mono`}>{fmt(band.ppy, 0)}만/평</span>
          <span className={`${s.bandCount} mono`}>{band.count}건</span>
        </div>
      ))}
      {premium != null && (
        <div className={s.premium}>
          고층 프리미엄{' '}
          <span className="mono" style={{ color: scaleColor(premium, SIGNAL_DOMAIN.momentum3, useStore.getState().colorMode) }}>
            {premium >= 0 ? '+' : ''}{premium.toFixed(1)}%
          </span>
          <span className={s.premiumNote}>서울 중앙값 +4.1% · 평당가 중앙값 기준</span>
        </div>
      )}
    </div>
  );
}

/** 로드뷰 — SDK 는 지도와 공유한다. 파노라마가 없는 좌표도 있으므로 폴백이 필수다. */
function Roadview({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const rvRef = useRef<KakaoRoadview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'failed'>('loading');
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const key = await fetchKakaoJsKey();
      if (!alive) return;
      if (!key) { setState('failed'); setReason('KAKAO_JS_KEY 미설정 (server/.env)'); return; }

      let sdk: KakaoMaps;
      try {
        sdk = await loadKakaoSdk(key);
      } catch (e) {
        if (alive) { setState('failed'); setReason(String((e as Error)?.message || e)); }
        return;
      }
      if (!alive || !boxRef.current) return;

      const pos = new sdk.LatLng(lat, lng);
      // 반경을 넓혀가며 찾는다 — 단지 안쪽 좌표는 도로에서 멀어 35m 로는 못 잡는 경우가 많다.
      const radii = [50, 120, 300];
      const tryFind = (i: number) => {
        if (!alive) return;
        if (i >= radii.length) { setState('none'); return; }
        new sdk.RoadviewClient().getNearestPanoId(pos, radii[i], (panoId) => {
          if (!alive) return;
          if (!panoId) { tryFind(i + 1); return; }
          if (!rvRef.current && boxRef.current) rvRef.current = new sdk.Roadview(boxRef.current);
          rvRef.current?.setPanoId(panoId, pos);
          setState('ready');
        });
      };
      tryFind(0);
    })();
    return () => { alive = false; };
  }, [lat, lng]);

  return (
    <div className={s.rvWrap}>
      <div ref={boxRef} className={s.rvBox} aria-hidden="true" />
      {state === 'loading' && <div className={s.rvOverlay}><Loading label="로드뷰 불러오는 중…" /></div>}
      {state === 'none' && (
        <div className={s.rvOverlay}>
          <EmptyState
            title="이 위치에는 로드뷰가 없습니다"
            desc={`${name} 주변 300m 안에서 파노라마를 찾지 못했습니다. 단지 내부 좌표이거나 촬영되지 않은 구역입니다.`}
          />
        </div>
      )}
      {state === 'failed' && (
        <div className={s.rvOverlay}>
          <EmptyState title="로드뷰를 불러오지 못했습니다" desc={reason ?? undefined} />
        </div>
      )}
    </div>
  );
}

export default function ComplexTour({ detail }: { detail: AptComplexDetail }) {
  const dealType = useStore((st) => st.screenerQuery.dealType);
  const [tab, setTab] = useState<Tab>('sitemap');

  const profile = detail.floors?.[dealType === 'trade' ? 't' : 'r'] ?? null;
  const hasCoord = detail.lat != null && detail.lng != null;
  const [big, setBig] = useState(false);

  return (
    <section className={s.wrap} aria-label="단지투어">
      <div className={s.head}>
        <span className={s.title}>단지투어</span>
        <Segmented
          options={[
            { value: 'sitemap', label: '배치도' },
            { value: 'roadview', label: '실사 뷰' },
            { value: 'floors', label: '층별 가격' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
        {profile && <Badge>최고 {profile.max}층</Badge>}

        {/* 크게보기 — 배치도는 360px 안에서 보기엔 정보가 많다(주변 수백 동 + 인프라 라벨). */}
        {tab === 'sitemap' && (
          <Button variant="subtle" size="sm" icon={<Maximize2 size={13} />} onClick={() => setBig(true)}>
            크게보기
          </Button>
        )}
      </div>

      {tab === 'sitemap' ? (
        <ComplexSiteMap aptSeq={detail.aptSeq} fallbackFloors={profile?.max ?? null} />
      ) : tab === 'roadview' ? (
        hasCoord ? (
          <Roadview lat={detail.lat as number} lng={detail.lng as number} name={detail.aptNm} />
        ) : (
          <EmptyState title="좌표가 없어 실사 뷰를 열 수 없습니다" desc="지오코딩에서 좌표를 찾지 못한 단지입니다." />
        )
      ) : profile ? (
        profile.banded ? (
          <FloorBands profile={profile} />
        ) : (
          <EmptyState
            title={`최고 ${profile.max}층 — 층별 구분이 무의미합니다`}
            desc="저층 단지는 층에 따른 가격차가 거의 없어 구간을 나누지 않습니다."
          />
        )
      ) : (
        <EmptyState
          title="층별 데이터가 없습니다"
          desc={dealType === 'trade' ? '이 단지의 매매 거래가 없습니다.' : '이 단지의 전세 거래가 없습니다.'}
        />
      )}
      {/* 모달에는 같은 컴포넌트를 크게 띄운다 — 시점·구역은 각자 관리한다(서버 캐시라 다시 받아도 빠르다). */}
      <Modal open={big} onOpenChange={setBig} title={`${detail.aptNm} 배치도`}
        desc="드래그로 회전, Shift+드래그로 이동, 우클릭 드래그·휠로 확대" width={1180}>
        {big && <ComplexSiteMap aptSeq={detail.aptSeq} fallbackFloors={profile?.max ?? null} large />}
      </Modal>
    </section>
  );
}
