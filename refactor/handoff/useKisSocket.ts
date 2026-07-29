/**
 * 한국투자증권(KIS) 실시간 WebSocket 훅 뼈대
 * - 국내/해외 주식 체결(trade) · 호가(orderbook) 구독
 * - 자동 재접속(지수 백오프) · PINGPONG 하트비트 · 재접속 시 자동 재구독
 *
 * ⚠️ 보안: appkey/appsecret은 절대 프런트엔드에 두지 말 것.
 *   approval_key 발급(POST /oauth2/Approval)은 반드시 백엔드에서 하고,
 *   짧게 만료되는 approval_key만 브라우저로 내려주세요.
 *
 * TR_ID
 *   국내 체결 H0STCNT0 / 국내 호가 H0STASP0
 *   해외 체결 HDFSCNT0 / 해외 호가 HDFSASP0  (tr_key 예: "DNASAAPL")
 */

const KIS_WS_REAL = 'ws://ops.koreainvestment.com:21000';   // 실전
const KIS_WS_MOCK = 'ws://ops.koreainvestment.com:31000';   // 모의

export type Market = 'KR' | 'US';
export interface Trade {
  code: string; time: string; price: number;
  changePct: number; volume: number; side: '매수' | '매도';
}
export interface Level { price: number; qty: number; }
export interface Orderbook { code: string; asks: Level[]; bids: Level[]; }

type Kind = 'trade' | 'orderbook';
const TR: Record<Market, Record<Kind, string>> = {
  KR: { trade: 'H0STCNT0', orderbook: 'H0STASP0' },
  US: { trade: 'HDFSCNT0', orderbook: 'HDFSASP0' },
};

type Handler = (data: Trade | Orderbook) => void;
interface Sub { trId: string; trKey: string; kind: Kind; handlers: Set<Handler>; }

export interface KisOptions {
  approvalKey: string;              // 백엔드에서 발급받아 전달
  mode?: 'real' | 'mock';
  custType?: 'P' | 'B';             // 개인 P / 법인 B
}

/** 소켓 1개를 공유하는 매니저 (여러 컴포넌트가 같은 종목 구독 시 중복 연결 방지) */
export class KisSocket {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Sub>();          // key = `${trId}|${trKey}`
  private queue: string[] = [];                    // 연결 전 보낼 등록 메시지
  private backoff = 1000;
  private alive = true;
  constructor(private opt: KisOptions) { this.connect(); }

  private url() { return this.opt.mode === 'mock' ? KIS_WS_MOCK : KIS_WS_REAL; }

  private connect() {
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      // 재접속 시 기존 구독 전부 재등록
      for (const s of this.subs.values()) this.send(this.regMsg(s.trId, s.trKey, '1'));
      this.queue.forEach((m) => ws.send(m));
      this.queue = [];
    };
    ws.onmessage = (e) => this.onMessage(e.data);
    ws.onclose = () => { if (this.alive) this.reconnect(); };
    ws.onerror = () => ws.close();
  }
  private reconnect() {
    setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);   // 최대 30s
  }
  private send(msg: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(msg);
    else this.queue.push(msg);
  }
  private regMsg(trId: string, trKey: string, trType: '1' | '2') {
    return JSON.stringify({
      header: { approval_key: this.opt.approvalKey, custtype: this.opt.custType ?? 'P', tr_type: trType, 'content-type': 'utf-8' },
      body: { input: { tr_id: trId, tr_key: trKey } },
    });
  }

  private onMessage(raw: string) {
    // 제어 프레임(JSON): 구독 응답 / PINGPONG
    if (raw[0] === '{') {
      const msg = JSON.parse(raw);
      if (msg.header?.tr_id === 'PINGPONG') { this.ws?.send(raw); return; } // 그대로 반사
      return; // SUBSCRIBE SUCCESS 등
    }
    // 실시간 데이터: `암호화여부|TR_ID|건수|필드^필드^...`
    const [, trId, , body] = raw.split('|');
    if (!body) return;
    const f = body.split('^');
    const key = `${trId}|${f[0]}`;
    const sub = this.subs.get(key);
    if (!sub) return;
    const parsed = sub.kind === 'trade' ? parseTrade(trId, f) : parseOrderbook(trId, f);
    if (parsed) sub.handlers.forEach((h) => h(parsed));
  }

  subscribe(code: string, market: Market, kind: Kind, handler: Handler): () => void {
    const trId = TR[market][kind];
    const trKey = market === 'US' ? toUsKey(code) : code;   // 해외는 거래소 프리픽스 필요
    const key = `${trId}|${trKey}`;
    let sub = this.subs.get(key);
    if (!sub) {
      sub = { trId, trKey, kind, handlers: new Set() };
      this.subs.set(key, sub);
      this.send(this.regMsg(trId, trKey, '1'));            // 신규 등록
    }
    sub.handlers.add(handler);
    return () => {
      sub!.handlers.delete(handler);
      if (sub!.handlers.size === 0) {
        this.subs.delete(key);
        this.send(this.regMsg(trId, trKey, '2'));          // 마지막 구독자면 해제
      }
    };
  }
  close() { this.alive = false; this.ws?.close(); }
}

/** 해외 종목키: 예) AAPL → "DNASAAPL"(나스닥), TSLA → "DNAS..." / NYSE는 "DNYS" (실전 명세 참고) */
function toUsKey(code: string) { return code.includes('.') ? code : `DNAS${code}`; }

/** H0STCNT0 / HDFSCNT0 체결 파싱 (필드 인덱스는 KIS 실시간 명세 기준) */
function parseTrade(trId: string, f: string[]): Trade {
  const num = (s: string) => Number(s || 0);
  return {
    code: f[0],
    time: fmtTime(f[1]),
    price: num(f[2]),
    changePct: num(f[5]),          // 전일대비율
    volume: num(f[12]),            // 체결 거래량
    side: f[21] === '5' ? '매도' : '매수', // CCLD_DVSN: 1 매수 / 5 매도
  };
}

/** H0STASP0 / HDFSASP0 호가 파싱 — 상위 5호가 */
function parseOrderbook(trId: string, f: string[]): Orderbook {
  const num = (s: string) => Number(s || 0);
  // 국내 H0STASP0: [3..12] 매도호가1~10, [13..22] 매수호가1~10,
  //               [23..32] 매도잔량1~10, [33..42] 매수잔량1~10
  const asks: Level[] = [], bids: Level[] = [];
  for (let i = 0; i < 5; i++) {
    asks.push({ price: num(f[3 + i]), qty: num(f[23 + i]) });
    bids.push({ price: num(f[13 + i]), qty: num(f[33 + i]) });
  }
  return { code: f[0], asks, bids };
}

function fmtTime(hms: string) {
  // "HHMMSS" → "HH:MM:SS"
  if (!hms || hms.length < 6) return hms || '';
  return `${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
}

/* ------------------------------------------------------------------ */
/* React 훅                                                            */
/* ------------------------------------------------------------------ */
import { useEffect, useRef, useState } from 'react';

let shared: KisSocket | null = null;
export function getKisSocket(opt: KisOptions) {
  if (!shared) shared = new KisSocket(opt);
  return shared;
}

/** 실시간 체결가 훅 */
export function useKisTrade(code: string, market: Market, opt: KisOptions) {
  const [trade, setTrade] = useState<Trade | null>(null);
  useEffect(() => {
    const s = getKisSocket(opt);
    return s.subscribe(code, market, 'trade', (d) => setTrade(d as Trade));
  }, [code, market]);
  return trade;
}

/** 최근 체결 리스트 훅 (최대 maxLen개 유지) */
export function useKisTrades(code: string, market: Market, opt: KisOptions, maxLen = 30) {
  const [list, setList] = useState<Trade[]>([]);
  useEffect(() => {
    setList([]);
    const s = getKisSocket(opt);
    return s.subscribe(code, market, 'trade', (d) =>
      setList((prev) => [d as Trade, ...prev].slice(0, maxLen)));
  }, [code, market]);
  return list;
}

/** 실시간 호가 훅 */
export function useKisOrderbook(code: string, market: Market, opt: KisOptions) {
  const [ob, setOb] = useState<Orderbook | null>(null);
  useEffect(() => {
    const s = getKisSocket(opt);
    return s.subscribe(code, market, 'orderbook', (d) => setOb(d as Orderbook));
  }, [code, market]);
  return ob;
}
