import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, BookOpen, FileText, MessageSquare, Star, Eye } from 'lucide-react';
import client from '../api/client';
import Spinner from '../components/Spinner';

const STAT_CARDS = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'novels', label: 'Novels', icon: BookOpen },
  { key: 'chapters', label: 'Chapters', icon: FileText },
  { key: 'totalViews', label: 'Total Views', icon: Eye },
  { key: 'comments', label: 'Comments', icon: MessageSquare },
  { key: 'reviews', label: 'Reviews', icon: Star },
];

const Dashboard = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    client.get('/admin/stats').then(({ data: res }) => setData(res)).catch(() => setData({ stats: {}, recentUsers: [], topNovels: [] }));
  }, []);

  if (!data) return <Spinner full />;

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-silver">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {STAT_CARDS.map((card, index) => (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: index * 0.05 }}
            className="rounded-xl border border-line bg-night-surface p-4"
          >
            <card.icon className="h-5 w-5 text-crimson" aria-hidden="true" />
            <p className="mt-3 text-2xl font-bold text-silver">{(data.stats[card.key] || 0).toLocaleString()}</p>
            <p className="text-xs text-silver-muted">{card.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-night-surface p-5" aria-label="Top novels">
          <h2 className="mb-4 font-display text-lg font-bold text-silver">Top Novels</h2>
          {data.topNovels.length === 0 ? (
            <p className="text-sm text-silver-muted">No novels yet.</p>
          ) : (
            <div className="space-y-3">
              {data.topNovels.map((novel, index) => (
                <div key={novel._id} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-center font-display font-bold text-crimson">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-silver">{novel.title}</span>
                  <span className="shrink-0 text-silver-muted">{(novel.views || 0).toLocaleString()} views</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-night-surface p-5" aria-label="Recent signups">
          <h2 className="mb-4 font-display text-lg font-bold text-silver">Recent Signups</h2>
          {data.recentUsers.length === 0 ? (
            <p className="text-sm text-silver-muted">No users yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recentUsers.map((user) => (
                <div key={user._id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-silver">{user.username}</span>
                  <span className="shrink-0 text-xs text-silver-muted">{new Date(user.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/admin/novels" className="rounded-full bg-crimson px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft">
          Manage Novels
        </Link>
        <Link to="/admin/settings" className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-silver transition-colors hover:border-crimson/60">
          Site Settings
        </Link>
      </div>
    </div>
  );
};

export default Dashboard;
