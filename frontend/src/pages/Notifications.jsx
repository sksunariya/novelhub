import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, CheckCheck, ChevronRight } from 'lucide-react';
import client from '../api/client';
import PageTransition from '../components/PageTransition';
import { formatRelativeTime } from '../utils/dateUtils';

const Notifications = () => {
  const [notifications, setNotifications] = useState(null);

  useEffect(() => {
    client
      .get('/library/notifications/list')
      .then(({ data }) => setNotifications(data.notifications))
      .catch(() => setNotifications([]));
  }, []);

  const markAllRead = async () => {
    await client.put('/library/notifications/read', {});
    setNotifications((items) => items.map((n) => ({ ...n, read: true })));
  };

  const markSingleRead = async (id) => {
    setNotifications((items) => items.map((n) => (n._id === id ? { ...n, read: true } : n)));
    try {
      await client.put('/library/notifications/read', { id });
    } catch (err) {
      // Ignore background read error
    }
  };

  const unread = notifications?.filter((n) => !n.read).length || 0;

  return (
    <PageTransition>
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow"><Bell className="h-3.5 w-3.5" aria-hidden="true" /> Inbox</p>
            <h1 className="mt-3 font-display text-3xl font-extrabold text-silver sm:text-4xl">Notifications</h1>
            <p className="mt-2 text-sm text-silver-muted">
              {notifications === null ? 'Loading…' : unread ? `${unread} unread` : 'You are all caught up.'}
            </p>
          </div>
          {unread > 0 && (
            <button type="button" onClick={markAllRead} className="btn btn-secondary btn-sm">
              <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all as read
            </button>
          )}
        </header>

        {notifications === null ? (
          <div className="space-y-2.5" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-[4.5rem] rounded-2xl" />)}
          </div>
        ) : notifications.length === 0 ? (
          <div className="panel flex flex-col items-center px-6 py-16 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-crimson/15 text-crimson-soft">
              <BellOff className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="mt-4 font-display text-lg font-bold text-silver">No notifications</p>
            <p className="mt-1 text-sm text-silver-muted">New chapters, replies and announcements will show up here.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {notifications.map((notification) => {
              const inner = (
                <div
                  className={`group flex items-start gap-3.5 rounded-2xl border p-4 transition-colors ${
                    notification.read
                      ? 'border-line bg-night-surface/60 hover:bg-night-surface'
                      : 'border-crimson-soft/30 bg-crimson/10 hover:bg-crimson/15'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                      notification.read ? 'bg-night-raised text-silver-muted' : 'bg-gradient-to-br from-crimson to-crimson-alt text-white'
                    }`}
                    aria-hidden="true"
                  >
                    <Bell className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-relaxed ${notification.read ? 'text-silver/80' : 'font-medium text-silver'}`}>
                      {notification.message}
                    </p>
                    <p className="mt-1 text-xs text-silver-muted" title={new Date(notification.createdAt).toLocaleString()}>
                      {formatRelativeTime(notification.createdAt)}
                    </p>
                  </div>
                  {!notification.read && (
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-crimson-soft" aria-label="Unread" />
                  )}
                  {notification.link && (
                    <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-silver-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  )}
                </div>
              );
              return (
                <li key={notification._id}>
                  {notification.link ? (
                    <Link
                      to={notification.link}
                      onClick={() => {
                        if (!notification.read) markSingleRead(notification._id);
                      }}
                      className="block rounded-2xl"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div
                      onClick={() => {
                        if (!notification.read) markSingleRead(notification._id);
                      }}
                      className="cursor-pointer"
                    >
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageTransition>
  );
};

export default Notifications;
