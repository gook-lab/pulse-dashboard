import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { useModalOpenSignal } from '@/store/useModalStore';
import { EmptyState } from '@/components/common';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import type { AppNotification } from '@/data/types';
import s from './NotificationCenter.module.css';

interface NotificationCenterProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function Signal() {
  useModalOpenSignal();
  return null;
}

function getIconAndLabel(kind: AppNotification['kind']): { icon: string; label: string } {
  switch (kind) {
    case 'price':
      return { icon: '📈', label: '가격 알림' };
    case 'apt':
      return { icon: '🏢', label: '부동산 알림' };
    case 'sys':
      return { icon: '🔔', label: '시스템 알림' };
    default:
      return { icon: '📬', label: '알림' };
  }
}

function NotificationItem({
  notification,
  onClose,
}: {
  notification: AppNotification;
  onClose: () => void;
}) {
  const selectStock = useStore((st) => st.selectStock);
  const setTab = useStore((st) => st.setTab);
  const markNotificationRead = useStore((st) => st.markNotificationRead);

  const { icon } = getIconAndLabel(notification.kind);

  const handleClick = () => {
    markNotificationRead(notification.id);

    // 딥링크: kind별로 탭 이동 + 데이터 선택
    if (notification.kind === 'price' && notification.code) {
      selectStock(notification.code);
    } else if (notification.kind === 'apt') {
      setTab('realestate');
    }
    // sys: 이동 없음

    onClose();
  };

  return (
    <motion.button
      className={`${s.item} ${!notification.read ? s.itemUnread : ''}`}
      onClick={handleClick}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
    >
      <div className={s.icon}>{icon}</div>
      <div className={s.textBox}>
        <div className={s.title}>
          {notification.title}
          {!notification.read && <span className={s.newDot} />}
        </div>
        <div className={s.desc}>{notification.desc}</div>
        <div className={s.time}>{formatRelativeTime(notification.at)}</div>
      </div>
    </motion.button>
  );
}

export default function NotificationCenter({
  open,
  onOpenChange,
}: NotificationCenterProps) {
  const notifications = useStore((st) => st.notifications);
  const markAllNotificationsRead = useStore((st) => st.markAllNotificationsRead);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // ESC 키로 닫기
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  const handleMarkAllRead = useCallback(() => {
    markAllNotificationsRead();
  }, [markAllNotificationsRead]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onOpenChange(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <Signal />
          <motion.div
            className={s.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleBackdropClick}
          />
          <motion.div
            className={s.drawer}
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div className={s.header}>
              <div className={s.headerTitle}>
                알림
                {unreadCount > 0 && (
                  <span className={s.unreadCount}>({unreadCount})</span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  className={s.markAllReadBtn}
                  onClick={handleMarkAllRead}
                  title="모든 알림을 읽음으로 표시"
                >
                  모두 읽음
                </button>
              )}
            </div>

            <div className={s.content}>
              {notifications.length === 0 ? (
                <EmptyState title="알림이 없습니다" />
              ) : (
                <AnimatePresence>
                  {notifications.map((n) => (
                    <NotificationItem
                      key={n.id}
                      notification={n}
                      onClose={() => onOpenChange(false)}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
