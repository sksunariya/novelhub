import { useState, useEffect } from 'react';
import { getSpotlight } from '../api/spotlight';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import HeroCarousel from '../components/HeroCarousel';
import SpotlightSection from '../components/home/SpotlightSection';
import GenreStrip from '../components/home/GenreStrip';
import ContinueReading from '../components/home/ContinueReading';
import PageTransition from '../components/PageTransition';

// The homepage.
//
// This file used to BE the homepage: six sections declared here as a constant,
// each with its own fetch, shown or hidden by six booleans in site settings.
// Reordering them, adding one, running one for a week, or showing anything that
// was not a novel all meant editing this file and deploying.
//
// Now it renders whatever the server says the homepage is. The rails, their
// order, their contents, their schedule and their audience are all data —
// models/SpotlightRail on the backend, editable in the admin portal. What is
// left here is layout and loading, which is all a page component should have
// been doing.
//
// ONE REQUEST, not one per section. The old version fired six calls in parallel
// and rendered them in arrival order, so the page reflowed while it loaded and
// the section order depended on the network rather than on anyone's decision.
//
// Two small additions sit above the rails and are not admin-curated: genre
// shortcuts (from the public genre list) and, for a signed-in reader, their own
// reading history. Both fail silently to nothing — neither is worth an error
// message on the front page.
//
// The page is full-bleed (see Layout): the hero runs edge to edge and the rest
// sits in the standard centred column below it.

const RailsSkeleton = () => (
  <div className="space-y-12" aria-hidden="true">
    {[0, 1].map((row) => (
      <div key={row}>
        <div className="mb-5 flex items-center gap-3">
          <div className="skeleton h-10 w-10" />
          <div className="skeleton h-6 w-48" />
        </div>
        <div className="flex gap-4 overflow-hidden sm:gap-5">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="w-[8.75rem] shrink-0 sm:w-40 md:w-44 lg:w-[11.25rem]">
              <div className="skeleton aspect-[2/3]" />
              <div className="skeleton mt-3 h-4 w-4/5" />
              <div className="skeleton mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

const Home = () => {
  const { user } = useAuth();
  const [payload, setPayload] = useState(null);
  const [failed, setFailed] = useState(false);
  const [genres, setGenres] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let alive = true;
    getSpotlight()
      .then((data) => { if (alive) setPayload(data); })
      .catch(() => { if (alive) setFailed(true); });
    client
      .get('/novels/genres')
      .then(({ data }) => { if (alive) setGenres(data.genres || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return undefined;
    }
    let alive = true;
    client
      .get('/library/history/list')
      .then(({ data }) => { if (alive) setHistory(data.history || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  const rails = payload?.rails || [];

  return (
    <PageTransition>
      <HeroCarousel />

      <div className="mx-auto max-w-7xl space-y-14 px-4 pb-4 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <GenreStrip genres={genres} />

        {user && <ContinueReading history={history} />}

        {!payload && !failed && <RailsSkeleton />}

        {/* The hero still renders, so a failed rail fetch is a thinner homepage
            rather than an empty one. Saying so beats an unexplained blank space. */}
        {failed && (
          <p role="alert" className="panel p-5 text-sm text-silver-muted">
            The rest of the homepage could not be loaded just now.{' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="cursor-pointer font-semibold text-crimson-soft underline-offset-4 hover:underline"
            >
              Try again
            </button>
          </p>
        )}

        {rails.length > 0 && (
          <div className="space-y-14">
            {rails.map((rail) => (
              <SpotlightSection key={rail.key} rail={rail} pulse={payload.pulse} />
            ))}
          </div>
        )}

        {/* Every rail resolved to nothing: a new site with no novels, or an admin
            who deactivated all of them. Silence here looks like a broken page. */}
        {payload && !rails.length && (
          <p className="py-12 text-center text-sm text-silver-muted">
            Nothing to show here yet — check back soon.
          </p>
        )}
      </div>
    </PageTransition>
  );
};

export default Home;
