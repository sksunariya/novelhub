import { useState, useEffect, useCallback } from 'react';
import { Ban, ShieldCheck, Shield, Trash2 } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const UsersAdmin = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    client.get(`/admin/users${query}`).then(({ data }) => setUsers(data.users)).catch(() => setUsers([]));
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (user, payload) => {
    await client.put(`/admin/users/${user._id}`, payload);
    load();
  };

  const remove = async (user) => {
    if (!window.confirm(`Delete user "${user.username}" and all their activity?`)) return;
    await client.delete(`/admin/users/${user._id}`);
    load();
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Users</h1>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          aria-label="Search users"
          className="w-full rounded-full border border-line bg-night-surface px-4 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none sm:w-64"
        />
      </div>

      {users === null ? (
        <Spinner full />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-night-surface text-xs uppercase text-silver-muted">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((user) => {
                const isSelf = user._id === currentUser.id;
                return (
                  <tr key={user._id} className="bg-night transition-colors hover:bg-night-surface">
                    <td className="px-4 py-3">
                      <p className="font-medium text-silver">
                        {user.fullName || user.username}
                        {isSelf && <span className="ml-2 text-xs text-crimson-soft">(you)</span>}
                      </p>
                      <p className="text-xs text-silver-muted">
                        {user.fullName ? `@${user.username} • ${user.email}` : user.email}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.role === 'admin' ? 'bg-crimson/20 text-crimson-soft' : 'bg-night-raised text-silver-muted'}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.banned ? 'bg-crimson/20 text-crimson-soft' : 'bg-green-500/15 text-green-400'}`}>
                        {user.banned ? 'Banned' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-silver-muted">{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {!isSelf && (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => update(user, { role: user.role === 'admin' ? 'user' : 'admin' })}
                            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-silver"
                            aria-label={user.role === 'admin' ? `Demote ${user.username}` : `Promote ${user.username} to admin`}
                            title={user.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                          >
                            {user.role === 'admin' ? <Shield className="h-4 w-4" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => update(user, { banned: !user.banned })}
                            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-crimson-soft"
                            aria-label={user.banned ? `Unban ${user.username}` : `Ban ${user.username}`}
                            title={user.banned ? 'Unban' : 'Ban'}
                          >
                            <Ban className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(user)}
                            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-crimson-soft"
                            aria-label={`Delete ${user.username}`}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UsersAdmin;
