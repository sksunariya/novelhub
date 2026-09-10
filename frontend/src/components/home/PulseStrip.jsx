import { Link } from 'react-router-dom';
import { BookOpen, MessagesSquare, Sparkles } from 'lucide-react';
import { compact } from './railStyle';

// The live activity strip.
//
// Social proof, and the fastest way to tell a first-time visitor that this is a
// place with people in it rather than a catalogue. Every number is real and
// comes from the same events the analytics read — there is no "247 readers
// online" here, because a returning visitor eventually notices that it is
// always 247, and a site that lies about something that small is not believed
// about anything else.
//
// The server withholds the payload entirely when activity is below the
// configured floor, so this renders nothing on a quiet site. "1 person is
// reading" is anti-proof.

const Item = ({ icon: Icon, children }) => (
  <span className="flex shrink-0 items-center gap-1.5">
    <Icon className="h-3.5 w-3.5 text-crimson" aria-hidden="true" />
    {children}
  </span>
);

const PulseStrip = ({ pulse }) => {
  if (!pulse) return null;
  const { chaptersOpen, postsToday, novelsUpdated, latestPost } = pulse;

  return (
    <div
      className="flex items-center gap-3 overflow-x-auto rounded-xl border border-line bg-night-surface/70 px-4 py-2.5 text-xs text-silver-muted [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      // A live region would re-announce the whole strip on every refresh, which
      // is noise, not information. It is labelled as a summary instead and read
      // on demand.
      role="status"
      aria-label="Recent activity on the site"
    >
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-silver">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          {/* motion-safe: a permanently pulsing dot is a problem for people who
              set a reduced-motion preference, and this one never stops. */}
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        Right now
      </span>

      {chaptersOpen > 0 && (
        <Item icon={BookOpen}>
          <strong className="font-semibold text-silver">{compact(chaptersOpen)}</strong>
          &nbsp;{chaptersOpen === 1 ? 'chapter' : 'chapters'} being read
        </Item>
      )}

      {postsToday > 0 && (
        <Item icon={MessagesSquare}>
          <strong className="font-semibold text-silver">{compact(postsToday)}</strong>
          &nbsp;{postsToday === 1 ? 'post' : 'posts'} today
        </Item>
      )}

      {novelsUpdated > 0 && (
        <Item icon={Sparkles}>
          <strong className="font-semibold text-silver">{compact(novelsUpdated)}</strong>
          &nbsp;updated today
        </Item>
      )}

      {latestPost && (
        <Link
          to={latestPost.href}
          className="flex min-w-0 shrink items-center gap-1.5 hover:text-crimson-soft"
        >
          <span className="shrink-0 text-silver-muted" aria-hidden="true">·</span>
          <span className="truncate">
            newest: <span className="text-silver">{latestPost.title}</span> in {latestPost.space}
          </span>
        </Link>
      )}
    </div>
  );
};

export default PulseStrip;
