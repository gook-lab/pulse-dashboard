import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useStore, type Tab } from '../store/useStore';
import { Segmented } from '@/components/common';
import { useKisState } from '../lib/kisSocket';
import type { ColorMode } from '../lib/colors';
import s from './AppBar.module.css';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: '대시보드' },
  { id: 'detail', label: '종목 상세' },
  { id: 'news', label: '뉴스' },
  { id: 'portfolio', label: '포트폴리오' },
  { id: 'research', label: '리서치' },
  { id: 'realestate', label: '부동산' },
];

const WS_META: Record<string, { cls: string; label: string }> = {
  connected: { cls: s.dotConnected, label: '실시간 연결' },
  connecting: { cls: s.dotConnecting, label: '연결 중' },
  disconnected: { cls: s.dotDisconnected, label: '연결 끊김' },
};

const COLOR_OPTS: { value: ColorMode; label: string }[] = [
  { value: 'global', label: '국제식 ↑초록' },
  { value: 'korea', label: '한국식 ↑빨강' },
];

function useClock(timeZone: string) {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () =>
      setT(new Intl.DateTimeFormat('en-GB', {
        timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeZone]);
  return t;
}

export default function AppBar() {
  const tab = useStore((st) => st.tab);
  const setTab = useStore((st) => st.setTab);
  const colorMode = useStore((st) => st.colorMode);
  const setColorMode = useStore((st) => st.setColorMode);
  const watchlist = useStore((st) => st.watchlist);
  const selectStock = useStore((st) => st.selectStock);
  const wsState = useKisState();

  const ny = useClock('America/New_York');
  const seoul = useClock('Asia/Seoul');

  // ⌘K 종목 검색
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return watchlist.filter((w) => w.name.toLowerCase().includes(t) || w.code.toLowerCase().includes(t)).slice(0, 8);
  }, [q, watchlist]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (code: string) => {
    selectStock(code);
    setQ(''); setOpen(false);
    inputRef.current?.blur();
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (!matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[Math.min(hi, matches.length - 1)].code); }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  const ws = WS_META[wsState] ?? WS_META.disconnected;

  return (
    <header className={s.bar}>
      <div className={s.left}>
        <div className={s.logo}>P</div>
        <span className={s.brand}>PULSE</span>
        <nav className={s.nav}>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? `${s.tab} ${s.active}` : s.tab} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className={s.right}>
        <div className={s.search}>
          <span className={s.searchIcon}><Search size={14} /></span>
          <input
            ref={inputRef}
            className={s.searchInput}
            placeholder="종목 검색"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onInputKey}
            aria-label="종목 검색"
          />
          <span className={s.kbd}>⌘K</span>
          {open && matches.length > 0 && (
            <div className={s.searchPop} role="listbox">
              {matches.map((w, i) => (
                <button
                  key={w.code}
                  role="option"
                  aria-selected={i === hi}
                  className={i === hi ? `${s.searchOpt} ${s.searchOptOn}` : s.searchOpt}
                  onMouseEnter={() => setHi(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(w.code); }}
                >
                  <span>{w.name}</span>
                  <span className={`${s.searchOptPx} mono`}>{w.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={s.clock}><span className={s.city}>뉴욕</span><span className="mono">{ny}</span></div>
        <div className={s.clock}><span className={s.city}>서울</span><span className="mono">{seoul}</span></div>
        <div className={s.ws} title="KIS 실시간 WebSocket 연결 상태">
          <span className={`${s.dot} ${ws.cls}`} /> {ws.label}
        </div>
        <Segmented options={COLOR_OPTS} value={colorMode} onChange={setColorMode} />
      </div>
    </header>
  );
}
