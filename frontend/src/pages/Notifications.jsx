import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import client from '../api/client';
import PageTransition from '../components/PageTransition';
import Spinner from '../components/Spinner';

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

  return (
    <PageTransition>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-silver">Notifications</h1>
        {notifications?.some((n) => !n.read) && (
          <button
            type="button"
            onClick={markAllRead}
            className="flex cursor-pointer items-center gap-1.5 text-sm text-crimson-soft hover:underline"
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all as read
          </button>
        )}
      </div>

      {notifications === null ? (
        <Spinner full />
      ) : notifications.length === 0 ? (
        <p className="rounded-xl border border-line bg-night-surface py-16 text-center text-silver-muted">No notifications.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => {
            const inner = (
              <div className={`rounded-xl border px-4 py-3 transition-colors ${notification.read ? 'border-line bg-night-surface' : 'border-crimson/40 bg-crimson/10'}`}>
                <p className="text-sm text-silver">{notification.message}</p>
                <p className="mt-1 text-xs text-silver-muted">{new Date(notification.createdAt).toLocaleString()}</p>
              </div>
            );
            return notification.link ? (
              <Link
                key={notification._id}
                to={notification.link}
                onClick={() => {
                  if (!notification.read) markSingleRead(notification._id);
                }}
                className="block"
              >
                {inner}
              </Link>
            ) : (
              <div
                key={notification._id}
                onClick={() => {
                  if (!notification.read) markSingleRead(notification._id);
                }}
                className="cursor-pointer"
              >
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </PageTransition>
  );
};

export default Notifications;
