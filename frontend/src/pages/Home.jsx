import { useState, useEffect } from 'react';
import { getSpotlight } from '../api/spotlight';
import HeroCarousel from '../components/HeroCarousel';
import SpotlightSection from '../components/home/SpotlightSection';
import PageTransition from '../components/PageTransition';
import Spinner from '../components/Spinner';

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

const Home = () => {
  const [payload, setPayload] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getSpotlight()
      .then((data) => { if (alive) setPayload(data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const rails = payload?.rails || [];

  return (
    <PageTransition>
      <div className="mb-6 sm:mb-10">
        <HeroCarousel />
      </div>

      {!payload && !failed && <Spinner full />}

      {/* The hero still renders, so a failed rail fetch is a thinner homepage
          rather than an empty one. Saying so beats an unexplained blank space. */}
      {failed && (
        <p role="alert" className="rounded-lg border border-line bg-night-surface p-4 text-sm text-silver-muted">
          The rest of the homepage could not be loaded just now.{' '}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="cursor-pointer underline hover:text-crimson-soft"
          >
            Try again
          </button>
        </p>
      )}

      <div className="space-y-12">
        {rails.map((rail) => (
          <SpotlightSection key={rail.key} rail={rail} pulse={payload.pulse} />
        ))}
      </div>

      {/* Every rail resolved to nothing: a new site with no novels, or an admin
          who deactivated all of them. Silence here looks like a broken page. */}
      {payload && !rails.length && (
        <p className="py-12 text-center text-sm text-silver-muted">
          Nothing to show here yet — check back soon.
        </p>
      )}
    </PageTransition>
  );
};

export default Home;
