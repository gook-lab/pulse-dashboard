import { useEffect, useRef } from 'react';
import { Toaster } from 'react-hot-toast';
import { useStore } from './store/useStore';
import { useKisState } from './lib/kisSocket';
import { useAlertEngine } from './lib/useAlertEngine';
import toast from './lib/toast';
import AppBar from './components/AppBar';
import TickerTape from './components/TickerTape';
import Home from './components/home/Home';
import Dashboard from './components/dashboard/Dashboard';
import StockDetail from './components/detail/StockDetail';
import News from './components/news/News';
import Portfolio from './components/portfolio/Portfolio';
import Research from './components/research/Research';
import RealEstate from './components/realestate/RealEstate';

// 실시간 소켓 연결 상태 토스트: 연결 중 → 연결됨, 응답 지연 시 새로고침 유도.
function useConnectionToast() {
  const state = useKisState();
  const prev = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (state === prev.current) return;
    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    if (state === 'connecting') {
      toast.info({ message: '실시간 시세에 연결 중입니다…', id: 'kis-conn', duration: 10000 });
      clear();
      timer.current = setTimeout(() => {
        toast.warning({ title: '실시간 연결이 지연됩니다', message: '시세 응답이 없어요. 새로고침 해보세요.', id: 'kis-conn', duration: 30000, action: { label: '새로고침', onClick: () => window.location.reload() } });
      }, 12000);
    } else if (state === 'connected') {
      clear();
      toast.success({ message: '실시간 시세 연결됨', id: 'kis-conn', duration: 1800 });
    } else {
      clear();
    }
    prev.current = state;
    // 언마운트 시 대기 중인 타이머를 끊는다 — 없으면 12초 뒤 사라진 화면을
    // 향해 "새로고침" 토스트가 뜬다.
    return clear;
  }, [state]);
}

export default function App() {
  const tab = useStore((s) => s.tab);
  const load = useStore((s) => s.load);
  const refreshIndices = useStore((s) => s.refreshIndices);
  useConnectionToast();
  useAlertEngine();

  useEffect(() => { load(); }, [load]);
  // 티커·주요지수 30초 폴링(백그라운드 탭은 스킵)
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) refreshIndices(); }, 30_000);
    return () => clearInterval(id);
  }, [refreshIndices]);

  return (
    <div className="app">
      <AppBar />
      <TickerTape />
      <div className="main">
        <div className="wrap">
          {tab === 'home' && <Home />}
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'detail' && <StockDetail />}
          {tab === 'news' && <News />}
          {tab === 'portfolio' && <Portfolio />}
          {tab === 'research' && <Research />}
          {tab === 'realestate' && <RealEstate />}
        </div>
      </div>
      <Toaster position="bottom-right" gutter={10} />
    </div>
  );
}
