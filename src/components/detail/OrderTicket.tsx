import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { signColor, fmt } from '../../lib/colors';
import { snapToTick, tickSize } from '../../lib/krxTick';
import { validateBuy, validateSell, fee, marketOrderPrice, effectiveBalance, chipQty, type Orderbook } from '../../lib/paperOrders';
import { Button, Segmented, Badge, Modal, EmptyState, ErrorState } from '@/components/common';
import toast from '@/lib/toast';
import type { Market, PaperOrder, Portfolio } from '@/data/types';

interface OrderTicketProps {
  code: string;
  name: string;
  market: Market;
  price: number;
  orderbook?: Orderbook;
  lastTradePrice: number;
  portfolio: Portfolio | null;
}

export default function OrderTicket({
  code, name, market, price, orderbook, lastTradePrice, portfolio,
}: OrderTicketProps) {
  const mode = useStore((st) => st.colorMode);
  const paperOrders = useStore((st) => st.paperOrders);
  const placePaperOrder = useStore((st) => st.placePaperOrder);

  // UI state
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [qty, setQty] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<number>(price);
  const [showModal, setShowModal] = useState(false);

  // US 종목 처리
  if (market === 'US') {
    return <EmptyState title="모의 주문은 KR 종목만 지원" />;
  }

  // 포트폴리오 검증
  if (!portfolio) {
    return <ErrorState title="잔고 데이터를 불러올 수 없습니다" desc="포트폴리오 정보를 확인한 뒤 다시 시도하세요." />;
  }

  if (portfolio.unavailable) {
    return <ErrorState title="주문 불가 상태입니다" desc="포트폴리오 데이터에 연결되어 있지 않습니다." />;
  }

  // 유효 잔고 계산
  const { cash, holdings } = effectiveBalance(portfolio, paperOrders);
  const effectiveQty = holdings.get(code) ?? 0;

  // 주문 가격 결정
  const orderPrice = type === 'market'
    ? marketOrderPrice(side, orderbook || { asks: [], bids: [] }, lastTradePrice, price)
    : snapToTick(limitPrice);

  // 비용/수익 계산
  const totalAmount = orderPrice * qty;
  const totalFee = fee(totalAmount);
  const totalCost = side === 'buy' ? totalAmount + totalFee : totalAmount - totalFee;

  // 주문 후 예수금
  const afterCash = side === 'buy' ? cash - totalCost : cash + totalCost;

  // 유효성 검증
  const validation = side === 'buy'
    ? validateBuy(qty, orderPrice, portfolio, paperOrders)
    : validateSell(code, qty, portfolio, paperOrders);

  const isValid = validation.ok;
  const errorMsg = !validation.ok ? validation.error : '';

  // 칩 수량 계산 (도메인 로직 재사용)
  const chip = (pct: number) => chipQty(pct, side, orderPrice, code, portfolio, paperOrders);

  // 한계가 스냅
  useEffect(() => {
    setLimitPrice(snapToTick(price));
  }, [price]);

  const handleSetQty = (newQty: number) => {
    setQty(Math.max(1, newQty));
  };

  const handleLimitPriceBlur = () => {
    setLimitPrice(snapToTick(limitPrice));
  };

  const handleLimitPriceStepChange = (delta: number) => {
    const tick = tickSize(limitPrice);
    setLimitPrice(snapToTick(limitPrice + delta * tick));
  };

  const handlePlaceOrder = () => {
    if (!isValid) {
      toast.error({ message: errorMsg });
      return;
    }
    setShowModal(true);
  };

  const handleConfirmOrder = () => {
    const order: PaperOrder = {
      id: `${Date.now()}`,
      code,
      name,
      market,
      side,
      type,
      price: orderPrice,
      qty,
      fee: totalFee,
      at: Date.now(),
    };

    placePaperOrder(order);
    toast.success({ message: '모의 주문 접수' });
    setShowModal(false);
    // UI 리셋
    setQty(1);
    setLimitPrice(snapToTick(price));
  };

  const sideColor = signColor(side === 'buy' ? 1 : -1, mode);

  return (
    <div className="card" style={{ padding: '16px' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>모의 주문</h3>

      {/* 매수/매도 토글 */}
      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={[
            { value: 'buy' as const, label: '매수' },
            { value: 'sell' as const, label: '매도' },
          ]}
          value={side}
          onChange={(v) => setSide(v as 'buy' | 'sell')}
          className="w-full"
        />
      </div>

      {/* 지정가/시장가 토글 */}
      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={[
            { value: 'limit' as const, label: '지정가' },
            { value: 'market' as const, label: '시장가' },
          ]}
          value={type}
          onChange={(v) => setType(v as 'limit' | 'market')}
          className="w-full"
        />
      </div>

      {/* 지정가 입력 */}
      {type === 'limit' && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--text-sub)', display: 'block', marginBottom: 6 }}>지정가</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <input
                type="number"
                value={limitPrice}
                onChange={(e) => setLimitPrice(Number(e.target.value))}
                onBlur={handleLimitPriceBlur}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'var(--mono)',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => handleLimitPriceStepChange(-1)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text-sub)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                −
              </button>
              <button
                onClick={() => handleLimitPriceStepChange(1)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text-sub)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* 호가 클릭 옵션 */}
          {orderbook && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-sub)' }}>
              <div style={{ marginBottom: 4 }}>
                {orderbook.asks.length > 0 && (
                  <button
                    onClick={() => setLimitPrice(orderbook.asks[0].price)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: signColor(-1, mode),
                      cursor: 'pointer',
                      fontSize: 11,
                      textDecoration: 'underline',
                      marginRight: 8,
                    }}
                  >
                    최우선매도 {fmt(orderbook.asks[0].price, 0)}
                  </button>
                )}
              </div>
              <div>
                {orderbook.bids.length > 0 && (
                  <button
                    onClick={() => setLimitPrice(orderbook.bids[0].price)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: signColor(1, mode),
                      cursor: 'pointer',
                      fontSize: 11,
                      textDecoration: 'underline',
                    }}
                  >
                    최우선매수 {fmt(orderbook.bids[0].price, 0)}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 수량 입력 */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: 'var(--text-sub)', display: 'block', marginBottom: 6 }}>수량</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => handleSetQty(qty - 1)}
                style={{
                  flex: '0 0 28px',
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text-sub)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                −
              </button>
              <input
                type="number"
                value={qty}
                onChange={(e) => handleSetQty(Number(e.target.value))}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'var(--mono)',
                  textAlign: 'center',
                }}
              />
              <button
                onClick={() => handleSetQty(qty + 1)}
                style={{
                  flex: '0 0 28px',
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text-sub)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* 칩 버튼 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
          {side === 'buy' && (
            <>
              {[10, 25, 50, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => handleSetQty(chip(pct))}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: '1px solid var(--border)',
                    background: 'var(--panel-2)',
                    color: 'var(--text-sub)',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 500,
                  }}
                >
                  {pct}%
                </button>
              ))}
            </>
          )}
          {side === 'sell' && (
            <>
              {[10, 25, 50, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => handleSetQty(chip(pct))}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: '1px solid var(--border)',
                    background: 'var(--panel-2)',
                    color: 'var(--text-sub)',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 500,
                  }}
                  title={`${effectiveQty}주 중 ${pct}%`}
                >
                  {pct}%
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* 요약 영역 */}
      <div
        style={{
          padding: '12px',
          borderRadius: 8,
          background: 'var(--panel-2)',
          marginBottom: 12,
          fontSize: 11,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--text-sub)' }}>체결금액</span>
          <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
            ₩{fmt(totalAmount, 0)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--text-sub)' }}>수수료</span>
          <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
            ₩{fmt(totalFee, 0)}
          </span>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>
              {side === 'buy' ? '주문 후 예수금' : '주문 후 보유'}
            </span>
            <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
              ₩{fmt(side === 'buy' ? afterCash : effectiveQty - qty, 0)}
            </span>
          </div>
        </div>
      </div>

      {/* 오류 표시 */}
      {errorMsg && (
        <div
          style={{
            padding: '8px',
            borderRadius: 6,
            background: 'rgba(234,57,67,0.1)',
            marginBottom: 12,
            fontSize: 11,
            color: '#ea3943',
            lineHeight: 1.4,
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* 주문 버튼 */}
      <Button
        onClick={handlePlaceOrder}
        disabled={!isValid}
        block
        variant="primary"
        style={{ background: sideColor }}
      >
        {side === 'buy' ? '매수' : '매도'} {qty}주 주문
      </Button>

      {/* 확인 모달 */}
      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title="주문 확인"
        width={380}
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={() => setShowModal(false)} variant="subtle" block>취소</Button>
            <Button onClick={handleConfirmOrder} block style={{ background: sideColor }}>
              확정
            </Button>
          </div>
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px',
            borderRadius: 8,
            background: 'var(--panel-2)',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>종목</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>구분</span>
            <Badge color={sideColor}>{side === 'buy' ? '매수' : '매도'}</Badge>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>수량</span>
            <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
              {qty}주
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>가격</span>
            <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
              ₩{fmt(orderPrice, 0)} ({type === 'market' ? '시장가' : '지정가'})
            </span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--text-sub)' }}>체결금액</span>
              <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                ₩{fmt(totalAmount, 0)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-sub)' }}>수수료</span>
              <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                ₩{fmt(totalFee, 0)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              <span style={{ color: 'var(--text-sub)', fontWeight: 600 }}>합계</span>
              <span style={{ color: sideColor, fontFamily: 'var(--mono)', fontWeight: 700 }}>
                ₩{fmt(totalCost, 0)}
              </span>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
