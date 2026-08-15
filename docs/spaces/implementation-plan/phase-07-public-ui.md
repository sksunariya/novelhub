# Phase 7 — Public UI

**Status:** ✅ Substantially complete — 12 pages/components, profiles, report modal, and the full SEO surface
**Depends on:** Phases 1–5
**Runs in parallel with:** Phase 6
**Reference:** [architecture](../architecture.md) §11 · [readiness](../platform-readiness.md) §4, §5, §13.7

---

## Decision: client-side rendering only — **settled 15 Aug 2026**

**No SSR, no prerendering.** The community ships as part of the existing Vite SPA. Build it the same way every other page in this app is built.

Revisit only if organic discovery becomes a goal. It may never be — a community that grows through direct sharing and existing site traffic does not need to be crawlable.

### What this costs

Recorded so a future reader knows it was priced, not overlooked.

**1. Link previews are generic.** WhatsApp, Discord, Slack, iMessage and Twitter fetch HTML and read meta tags without executing JavaScript. Every shared community link will preview as the contents of `frontend/index.html` — "Apex NovelHub", one generic description, no image — regardless of which post it points to.

**2. AI crawlers see nothing.** GPTBot, ClaudeBot and PerplexityBot largely do not execute JavaScript. The community will be absent from AI-generated answers.

**3. Search indexing is unreliable.** Google renders JavaScript, but in a deferred second wave that consumes crawl budget and degrades at scale. Bing and others are weaker still.

The SEO items later in this phase — canonical URLs, sitemaps, structured data, `nofollow ugc`, thin-content `noindex` — **still apply and are still worth doing.** They cost little, they are correct regardless, and they are what makes a later reversal cheap rather than expensive.

### The reversal path, when and if it is wanted

Recorded now while the analysis is fresh. Options, cheapest first:

| Approach | Effort | Ongoing cost | Recovers |
|---|---|---|---|
| **Metadata + content injection** — an Express route for `/c/*` injecting real `<title>`, OG/Twitter tags, JSON-LD and the post body as escaped HTML into the SPA shell. String templating, not React SSR | ~1 week | ~0 | 1, 2, most of 3 |
| **Prerender service** — headless Chrome snapshots served to crawler user-agents | 1–2 weeks | $90–500/mo, or a Puppeteer instance | 1, 2, 3 |
| **React SSR on community routes** via Vite SSR mode | 4–8 weeks | Server CPU, plus a tax on every component written thereafter | all, plus first paint |
| **Next.js migration** | 8–16 weeks | as above | all, plus first paint |

**Two constraints specific to this codebase**, which is why full SSR was never the obvious choice:

- **Auth is a JWT in `localStorage`** (`frontend/src/api/client.js`). A server render cannot know who the user is, so every SSR render would be the logged-out view with personalization arriving at hydration. Most of SSR's perceived-performance benefit does not reach logged-in users.
- **Express does not currently serve the frontend.** `app.js` mounts only `/uploads`; `dist/` goes to a separate static host. Any of the first two options above requires routing community URLs through Express, which is a deployment change rather than a code change.

If the first option is ever taken, the injected content must faithfully match what the SPA renders. Divergence is cloaking.

---

## Goal

The community people actually use. Modern, fast, keyboard-driven, and accessible by construction.

---

## Routes

```
/community                      Feed hub (Home | Popular | All)
/community/spaces               Directory + search
/community/create               Creation wizard
/community/submit               Composer with space picker
/c/:slug                        Space feed
/c/:slug/about                  Rules, mods, stats
/c/:slug/submit                 Composer, space preselected
/c/:slug/p/:postId/:titleSlug   Post detail          ← canonical
/c/:slug/mod                    Mod tools (community mods, not admins)
/u/:username                    Profile
/community/saved                Saved items
```

All lazy-loaded, so a reader who never opens the community pays nothing — the same reasoning already applied to the PayPal SDK.

---

## Components

```
components/community/
  PostCard/       Card | Compact | Classic behind one API
  VoteControl     Optimistic, rolls back on error, respects hidden-score window
  PostMedia       Gallery, lightbox, blur-until-click for NSFW/spoiler
  LinkPreview     Domain chip, thumbnail, safe external target
  PollWidget      Vote, live results, countdown, closed state
  CommentTree     Recursive, collapsible, continuation threads
  CommentNode     Vote rail, byline, OP/mod badges, actions
  PostComposer    Type tabs, drag-drop with live limit feedback, alt-text prompt
  SpaceHeader     Banner, icon, join button, member count
  SpaceSidebar    Description, rules, mods, related spaces
  SortBar         Sticky: sort, timeframe, density
  FlairPill       Contrast-checked
  ReportModal     Reasons rendered from the registry setting
  ModActionMenu   Shown only where the resolver grants permission
  FeedSkeleton    Layout-stable
```

---

## State

`CommunityContext` — joined spaces, per-space permission cache, feed preferences persisted per user. Feed pages held in a cursor-keyed map so navigating into a post and back restores scroll without refetching. Votes optimistic against a local delta layer; failure rolls back and surfaces the reason.

No global store library — matches the existing `AuthContext` / `SettingsContext` / `MonetizationContext` pattern.

---

## UI direction

Built on the existing dark-gothic tokens (`night`, `crimson`, `silver`, `line`, Cinzel display) so the community reads as part of the site. Then:

- **Layered surfaces** — `night` → `night-surface` → `night-raised`, hairline borders, existing `shadow-card`. Not boxes inside boxes.
- **One crimson accent per view.** Vote state, active tab, primary action. Everything else silver. Restraint is what reads as modern.
- **Per-space accent theming** — a space's `theme.primary` overrides `--color-primary` within its own routes only.
- **Motion with intent** — vote springs, comment collapse, skeleton crossfade. No decorative scroll animation.
- **Density is the user's choice** — card, compact, classic.
- **Keyboard-first** — `j`/`k` navigate, `Enter` open, `u`/`d` vote, `c` comment, `s` save, `?` help. The strongest single signal of a serious community product.
- **Mobile as a first-class layout**, not a reflow. Bottom-sheet composer, swipe-to-vote, one-handed reach.

---

## FREE — accessibility, built in not audited in

Retrofitting accessibility into a finished component tree costs several times what building it in does. The [European Accessibility Act](https://www.levelaccess.com/blog/eu-accessibility-requirements-and-eaa-compliance/) has been enforceable since June 2025, with penalties up to €100,000 or 4% of annual revenue, and a feature launched now does not get the 2030 transition period.

Target **WCAG 2.2 AA**:

- One `h1` per page, ordered headings, landmark regions, skip links.
- **Comment tree** — `role="tree"`, arrow-key traversal, `aria-expanded` on collapse, announced comment count. The hard one.
- **Vote controls** — real `<button>`, `aria-pressed`, live region announcing the new score.
- **Infinite scroll** — an accessible "load more" alternative and focus management, so a screen reader is not stranded.
- Alt text surfaced in the composer for every image (field added Phase 4).
- Contrast checked against **custom space accents** (validated server-side in Phase 1).
- `prefers-reduced-motion` respected.
- Zoom to 200% without loss of function; 44×44px minimum touch targets.
- axe-core in CI, plus one real screen-reader pass. Automation catches roughly a third.

---

## FREE — SEO

UGC at scale is a crawl-budget problem, and `noindex` still consumes budget because the page must be fetched to see the directive.

- **Canonical URL** is `/c/:slug/p/:postId/:titleSlug`. Every sort, filter and pagination variant canonicalises to it.
- **`robots.txt` blocks** on sort variants, filtered views, search results and pagination past page 2 — blocking earlier than `noindex` does.
- **`noindex`** for thin content: zero-comment near-zero-score posts after N days, empty spaces, dead profiles.
- **Segmented XML sitemaps** by content type, regenerated by a job, `lastmod` from `lastActivityAt`.
- **Structured data** — `DiscussionForumPosting`, `Comment`, `BreadcrumbList`.
- **`rel="nofollow ugc"`** on user links (enforced server-side in Phase 0's sanitizer; the UI must not strip it).
- Per-post OpenGraph and Twitter cards, plus generated OG images.
- Crawlable pagination links even where the UI uses infinite scroll.

---

## FREE — drafts and autosave

Losing a long post to a stray navigation is the most infuriating bug a forum can have. Local draft persistence in the composer, restored on return, cleared on submit.

---

## What landed

`api/spaces.js` · `context/CommunityContext.jsx` · `components/community/{VoteControl,PostCard,SortBar,FeedSkeleton,CommentTree}.jsx` · `pages/community/{CommunityHub,SpacePage,PostDetail}.jsx` · routes and a settings-driven nav entry.

### The comment tree

The hardest accessibility surface in the product, and the one most often shipped as nested divs a keyboard cannot enter. It implements the WAI-ARIA tree pattern properly:

- `role="tree"` / `role="treeitem"` / `role="group"`.
- `aria-expanded` **only on nodes that have children** — putting it on a leaf tells a screen reader there is something to open when there is not.
- `aria-level`, `aria-posinset`, `aria-setsize`, so "3 of 7, level 2" is announced. Without them, nesting is only conveyed by indentation, which is invisible to a screen reader.
- **Roving tabindex** — exactly one node is tabbable. The alternative means tabbing through 500 comments to reach the reply box.
- Full arrow-key contract: Down/Up move through *visible* nodes only (so a collapsed thread is genuinely skipped), Right expands or descends, Left collapses or walks to the parent, Home/End jump to the ends.
- Focus moves to the composer when Reply is pressed. Leaving focus on the comment is the classic broken pattern.

Orphaned nodes — replies whose parent was not in this page — are promoted to roots rather than dropped, so a lazily loaded subtree never disappears.

### Drafts

`PostComposer` writes everything typed to `localStorage` on an 800ms debounce and restores it on return. Losing a long post to a stray navigation, a closed tab or a refresh is the most infuriating bug a forum can have and it is entirely preventable.

Two details that matter: the draft is **keyed by space**, so a half-written post in one place is not clobbered by starting another somewhere else; and it is cleared **only after the server accepts the post**, because clearing on submit means a failed request loses the work.

Title length is counted in **graphemes** via `Intl.Segmenter`, matching the server. A limit measured in UTF-16 units is a limit nobody can predict — a family emoji is 11 of those and one character to the person typing it.

### The creation gate explains itself

`CreateSpace` calls the eligibility endpoint first and renders the server's own `message` when creation is refused. Someone below the karma threshold is told the number and their current standing; someone in a cooldown is told when it lifts. The message is written server-side precisely so the explanation and the rule can never drift apart.

### Profiles

`/u/:username`, backed by `/api/u/*`. Two leaks the endpoint had to avoid: a profile listing "member of /c/private-thing" exposes both the space and the person, so **only public, active spaces appear**; and a profile is a convenient index of everything someone wrote, so **removed content never shows** — otherwise it is a way to read around moderation entirely.

A suspension is visible only to the person themselves. Announcing it publicly is a punishment nobody decided to impose.

### The report dialog

Reasons render from `spaces.moderation.reportReasons`, so the taxonomy is admin-editable without a deploy. **Severity is never sent to the client** — knowing which reason hides content fastest is exactly what an abuser wants. The confirmation says a moderator will look, never "that worked, it's gone": telling a reporter whether the threshold was reached turns the button into something they can calibrate.

Proper dialog semantics: `role="dialog"`, `aria-modal`, focus moved in on open, Escape to close, and a Tab trap. Without the last two a keyboard user is stranded behind a modal they cannot dismiss.

### SEO — done, despite no SSR

- **Canonical URLs** — `PostDetail` sets `<link rel="canonical">` and the document title on mount.
- **`DiscussionForumPosting` JSON-LD** with interaction counts. Google has explicit forum markup support, and the rendered DOM is what a JS-executing crawler reads.
- **Thin-content `noindex`** — a post with no comments and no score, or one that is hidden or removed. Accumulated thin pages suppress a whole domain's performance.
- **Segmented sitemaps** at `/sitemap.xml`, `/sitemap-spaces.xml`, `/sitemap-posts.xml`. Cached for an hour, because a crawler hitting an uncached sitemap over a large collection is a self-inflicted load spike. The post sitemap applies the **same thin-content rule** as the page's own `noindex` — a sitemap that contradicts a page's robots directive wastes crawl budget on pages it has been told to ignore.
- **`robots.txt`** blocks sort, filter and cursor variants at the **robots layer, not with `noindex`**. A `noindex` page still has to be fetched for the directive to be seen, so it consumes crawl budget; a robots rule stops the crawl before it starts. On a large UGC site that difference is the whole game.

Sitemaps and `robots.txt` are mounted outside `/api` at the site root, and outside the maintenance guard so a crawl during downtime does not record the site as gone. Both return empty while `spaces.enabled` is false.

### Landed after the end-to-end audit

Appeals (`/community/appeals`) and the public space modlog (`/c/:slug/modlog`),
both of which were linked from the UI before they existed. Appeals is the DSA
Article 17 mechanism and had been counted as done on the strength of its
backend; the page is what makes the obligation real. Full findings and fixes in
[issue 003](../../issues/003-community-end-to-end-audit.md).

### Remaining

Space mod tools (`/c/:slug/mod`), media upload wired into the composer, saved items, and the keyboard shortcut layer (`j`/`k`/`u`/`d`/`?`).

## Decisions taken during the build

**Votes are optimistic against a local delta layer** merged over server data at render. On failure the delta rolls back **and the reason is shown** — a vote that silently reverts reads as a bug rather than as a refusal.

**`VoteControl` is the accessibility showcase**, because it is the most-used control on the site and the one most often built wrong. Real `<button>` elements, `aria-pressed` so the current state is announced rather than just "button", and a polite live region announcing the new score — without which a screen-reader user presses upvote and hears nothing at all. The numeral itself is `aria-hidden`, since announcing it twice is worse than once.

**Infinite scroll has a real "Load more" button beside it.** The IntersectionObserver is an enhancement for people who scroll; without the button a keyboard or screen-reader user cannot reach page two.

**Sort and density are radiogroups, not button rows.** They are mutually exclusive choices, which is what a radiogroup means to assistive tech. Eight plain buttons announce as eight unrelated controls.

**The timeframe selector only appears for Top.** Showing it always implies the other sorts are time-filtered, which they are not.

**Skeletons match real card dimensions.** A skeleton of the wrong size causes the exact layout shift it exists to prevent.

**Body previews are suppressed for spoiler and NSFW posts.** Not seeing it by accident is the entire point of those flags.

**The nav entry is settings-driven** — visible only when `spaces.enabled` is true *and* `spaces.entryPoint` is `nav`. Both come from the public settings projection, so launching or hiding the community is an admin toggle rather than a deploy. One `visibleLinks()` helper serves the desktop row and the mobile drawer, so they cannot disagree.

**Still to build:** space page, post detail with the comment tree (`role="tree"` with arrow-key traversal is the hard accessibility piece), composer with drafts and autosave, profiles, mod tools, and the SEO work — canonical URLs, sitemaps, structured data, thin-content `noindex`.

---

## Definition of done

- [ ] axe-core CI green; one manual screen-reader pass completed
- [ ] Comment tree fully keyboard-navigable
- [ ] Canonical URLs, sitemaps and structured data validated by a crawler
- [ ] Composer autosaves and restores
- [ ] All three densities usable; keyboard shortcuts documented behind `?`
- [ ] Mobile layout tested one-handed on a real device
