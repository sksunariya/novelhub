# Admin Portal Specification

**Status:** Design proposal
**Date:** 2026-08-08
**Companion doc:** [`monetization-architecture.md`](./monetization-architecture.md) — data models, flows, revenue attribution

This document covers the full admin portal after monetization: information architecture, every configurable control, and the analytics with per-novel and per-chapter revenue.

---

## 1. The problem with the current navigation

Today `AdminLayout.jsx` renders a flat list of seven links: Dashboard, Hero Carousel, Novels, Users, Moderation, Notifications, Site Settings. Adding monetization would push that to twenty-plus flat items — unusable.

The fix is a **two-level sidebar**: six collapsible groups, each holding related pages. Group headers are labels, not links; the active group auto-expands. Mobile keeps the existing horizontal scroller but shows only the active group's pages, with a group switcher above.

---

## 2. Information architecture

```
◈ OVERVIEW
    Dashboard                    at-a-glance health: content, community, money

▸ CONTENT
    Novels                       existing, + monetization panel per novel
    Chapters                     global cross-novel chapter search + bulk pricing
    Pricing Rules                the dynamic pricing engine
    Hero Carousel                existing

▸ MONETIZATION
    Money Overview               the money landing page
    Credit Packs                 store SKUs
    Currencies & FX              rate table, settlement modes, live preview
    Coupons                      codes + bulk generation
    Subscriptions                plans + subscriber list
    Free Credit Grants           campaign builder with live audience count
    Orders                       every purchase, searchable
    Wallets & Ledger             per-user balances, manual adjustments, full ledger
    Refunds & Disputes           request queue + chargebacks
    Author Payouts               revenue-share statements

▸ ANALYTICS
    Revenue                      money in, over time, by everything
    Novel Performance            per-novel revenue leaderboard + drill-down
    Chapter Performance          per-chapter revenue across the catalogue
    Credit Economy               issued vs spent vs expired, liability
    Conversion Funnel            gate impression → purchase
    Subscriptions                MRR, churn, cohorts
    Readers & Cohorts            LTV, whales, segments

▸ COMMUNITY
    Users                        existing, + wallet/spend columns
    Moderation                   existing
    Notifications & Campaigns    existing broadcast + template editor

▸ SETTINGS
    Site                         existing site settings
    Reading Gate                 existing engagement gate
    Monetization                 the big one — 19 sub-tabs (§4)
    Notifications                channel × event matrix + templates
    Tax & Compliance             VAT/GST rules, invoicing, policies
    Feature Flags                kill switches, rollout controls

▸ SYSTEM
    Webhooks                     PayPal delivery health + replay
    Jobs & Schedules             cron status, manual triggers
    Audit Log                    who changed what
    Reconciliation               ledger integrity checks
```

**Icons** (lucide-react, already a dependency): `LayoutDashboard`, `BookOpen`, `FileText`, `Tags`, `Images`, `Wallet`, `Package`, `Globe`, `Ticket`, `Repeat`, `Gift`, `Receipt`, `Coins`, `Undo2`, `Banknote`, `TrendingUp`, `BarChart3`, `LineChart`, `PieChart`, `Filter`, `UsersRound`, `ShieldAlert`, `Bell`, `Settings`, `Scale`, `ToggleLeft`, `Webhook`, `Clock`, `ScrollText`, `CheckCircle2`.

---

## 3. Interaction conventions

Consistency is what makes a portal this large manageable. Every page follows these rules.

**Settings pages**
- Sticky save bar appears on first change: *"3 unsaved changes"* + Save / Discard. Navigating away warns.
- Every control has a label, help text below, and a **`Default`** badge when unchanged. Changed-from-default rows get a left accent bar so drift is visible at a glance.
- **Reset to default** on each row (hover) and each section.
- Every section header carries a master toggle. Off = the section body dims to 40% and inputs disable, but values stay visible so you can see what will resume.
- Destructive or wide-impact changes open a confirmation with an **impact preview** — see below.

**Impact previews.** Any change with blast radius shows what it will do before it commits:
- Change `creditsPerUsd` → *"Outstanding balances (2.4M credits) revalue from $24,000 to $48,000 of content. Pack prices unchanged."*
- Change `freeChapterCount` → *"1,204 currently-paid chapters become free across 18 novels. 340 users previously paid for these."*
- Delete a chapter → *"412 purchases, 4,120 credits, $34.20 attributed. All will be refunded."*
- Execute a grant → *"12,483 users × 100 credits = 1,248,300 credits issued. Adds $12,483 to deferred liability."*

**Settings search.** `⌘K` opens a search across every setting in the portal — label, help text, and current value. With this many toggles, search is not optional. Selecting a result deep-links and highlights the row.

**Tables.** Column chooser, sticky header, server-side sort/filter/pagination, saved views, CSV + XLSX export, bulk actions with a selection count bar.

**Audit affordance.** Every settings row and record has a small history icon showing the last change (who, when, old → new), linking into the full Audit Log.

**Permissions.** Roles beyond the existing `admin`: `finance` (monetization + analytics, no content), `editor` (content only, sees prices read-only), `support` (users, refunds, manual adjustments up to a cap), `analyst` (read-only analytics). Extends `ROLES` in `config/constants.js`. Every money-moving action records the actor.

---

## 4. Settings → Monetization

Nineteen sub-tabs in a left rail. This is the complete configuration surface — **every open question from v1 is resolved here as a toggle**.

### 4.1 General
| Control | Type | Default | Notes |
|---|---|---|---|
| Enable monetization | toggle | off | Master kill switch. Off = every chapter free, store hidden |
| Read-only mode | toggle | off | Browse store, no new orders. For maintenance |
| Credit name (singular / plural) | text | Credit / Credits | Rebrand to Gems, Coins, Stones… |
| Credit icon | icon picker + upload | coin | Used everywhere credits render |
| **Credits per USD** | number | **100** | The core conversion. Impact preview on change |
| Show credit-to-currency calculator | toggle | on | The public "what do I get" widget |
| Minimum / maximum purchase | money | $1 / $500 | Fraud + PayPal floor guardrails |
| Allow negative balance | toggle | off | Only reachable via refund clawback |
| Credit rounding for computed grants | select | round | floor / round / ceil |
| Low balance threshold | number | 20 | Triggers the nudge |
| Show lifetime stats on profile | toggle | on | |

### 4.2 Chapter Pricing
Default chapter price (credits) · default free chapter count · default free-after-days · preview paragraphs before the paywall · gate stacking (`both` / `credits bypass engagement` / `engagement bypass credits`) · allow bulk unlock · bulk discount tiers (repeatable: min chapters → discount %) · allow "unlock all remaining" · allow auto-unlock + max auto price + auto-unlock requires confirmation above N credits · round prices to nearest N credits · show price on chapter list · show locked chapters in the list at all.

### 4.3 Access & Rentals — *resolves open question 2*
| Control | Type | Default |
|---|---|---|
| Enable rentals | toggle | off |
| Access mode | select | permanent (permanent / rental / hybrid — user chooses) |
| Rental duration (hours) | number | 72 |
| Rental price multiplier | number | 0.5 |
| Allow upgrade rental → permanent | toggle | on |
| Upgrade credits the rental price | toggle | on |
| Re-reading is always free once owned | toggle | on |
| Warn user before rental expires | toggle + hours | on, 12h |
| Per-novel / per-chapter override | — | exposed on the novel and chapter editors |

### 4.4 Credit Expiry — *resolves open question 1*
| Control | Type | Default |
|---|---|---|
| Enable credit expiry | toggle | **off** |
| Default expiry (days) | number | 0 = never |
| Expiry by source | per-source days | purchase 0, grant 90, subscription 30, referral 90 |
| Consumption order | select | expiry-first (expiry-first / FIFO / granted-first / purchased-first) |
| Warn before expiry | toggle + days | on, 7 |
| Notify on expiry | toggle | on |
| Sweep schedule | cron | daily 03:00 |
| Show expiry dates in wallet | toggle | on |

> Buckets always exist because cost-basis attribution needs them; this tab only controls whether they *expire*. Leaving expiry off is the safe default.

### 4.5 Packs & Store
Store enabled · store page heading / subheading / footnote · pack layout (grid / list / carousel) · highlight pack · show "best value" auto-badge · show bonus as credits or percent · show compare-at strikethrough · require terms acceptance before checkout · post-purchase redirect · show recently-purchased social proof.

### 4.6 Currencies & FX
Default currency · auto-detect from geo · allow user override · lock currency after first purchase · FX provider URL · API key · refresh cron · stale-after hours · **on stale rates** (`fallback to USD` / `use last known` / `block purchases`) · global markup % · **Refresh Rates Now** button · rate history chart.

Plus the per-currency table (enable · settlement mode · rate source · manual rate · markup · rounding · decimals) with a **live preview column** showing every pack's resulting local price as you edit. Zero-decimal currencies reject charm rounding with an inline error.

### 4.7 Payments (PayPal)
Environment (sandbox / live) · client ID · client secret (write-only, masked, env-backed) · webhook ID · **Test Connection** · brand name · locale · landing page · user action (PAY_NOW / CONTINUE) · enabled funding sources (card, Venmo, Pay Later, credit) · shipping preference (NO_SHIPPING) · order quote TTL · auto-expire stale orders · webhook health panel (last received, 24h success rate, failure count, replay).

### 4.8 Subscriptions
Enabled · plan CRUD with perks matrix · **Sync to PayPal** (with the immutability warning) · grace period days · dunning schedule · allow plan change · prorate on upgrade · cancellation flow copy · offer a retention discount on cancel · what happens to unspent cycle credits on cancel.

### 4.9 Coupons
Enabled · allow stacking · max stacked · case-insensitive codes · code length + charset for generation · show a coupon field at checkout · publicly listed promos.

### 4.10 Grants (defaults)
Default expiry days · default channels · require two-person approval above N credits · max credits per campaign · max campaigns per day · always dry-run first · default notification template · allow reversal window (days).

### 4.11 Refunds — *resolves open question 5*
| Control | Type | Default |
|---|---|---|
| Self-service refunds | toggle | off |
| Refund window (hours) | number | 48 |
| Max refunds per user per year | number | 2 |
| Require credits unspent | toggle | on |
| **If credits already spent** | select | **refuse** (refuse / allow negative balance / revoke chapter access / prorate) |
| Revoke chapter access on refund | toggle | off |
| Auto-approve under | money | $5 |
| Require a reason | toggle | on |
| Block purchases after N refunds | number | 3 |
| **Accidental unlock refunds** | toggle | on |
| — window (minutes) | number | 5 |
| — max per month | number | 3 |
| — only if less than N% read | number | 10 |

### 4.12 Tax & Invoicing — *resolves open question 4*
Collect tax (toggle, **off** by default) · prices include tax (inclusive / exclusive) · default rate · **tax rate table** (country / state / rate / digital goods / B2B reverse charge / registration threshold / tax-ID label) · collect customer tax ID · validate VAT ID · EU VAT-MOSS mode · invoice numbering prefix + sequence · receipt template · show tax breakdown on receipt · merchant legal name / address / tax ID · refund policy text · "credits are not redeemable for cash" notice · export tax transactions for filing.

> Selling digital goods to EU consumers triggers VAT obligations and **PayPal does not handle this for you**. Same for India GST and US economic nexus. The system can compute and record it; whether you must register is a question for an accountant. Default off is deliberate.

### 4.13 Author Revenue Share — *resolves open question 3*
| Control | Type | Default |
|---|---|---|
| Enable revenue share | toggle | off |
| Default author share % | number | 50 |
| **Basis** | select | net after fees (gross / net after fees / net after fees and tax) |
| Include subscription-attributed revenue | toggle | on |
| Include grant-funded unlocks | toggle | off (they generated no cash) |
| Payout schedule | select | monthly |
| Minimum payout | money | $50 |
| Holdback period (days) | number | 30 (chargeback protection) |
| Payout method | select | PayPal Payouts / manual |
| Require tax form on file | toggle | on |
| Author-visible statements | toggle | off |
| Per-novel override | — | on the novel editor |

### 4.14 Geo & Regions — *resolves open question 6*
| Control | Type | Default |
|---|---|---|
| Enable geo detection | toggle | on |
| **Source** | select | CF-IPCountry header (`CF-IPCountry` / `X-Forwarded-For` + lookup / custom header / GeoIP database / off) |
| Custom header name | text | — |
| Fallback country | select | US |
| Allow user override | toggle | on |
| Restricted countries | multi-select | — blocks order creation |
| Region-specific pricing | toggle | off — PPP-style per-region multipliers |
| Region multiplier table | repeatable | country group → multiplier |
| VPN/proxy detection | toggle | off — flags for review, never auto-blocks |

### 4.15 Analytics & Attribution
| Control | Type | Default |
|---|---|---|
| **Revenue basis** | select | attributed cash (attributed cash / face value / both) |
| **Subscription attribution** | select | per-chapter pro-rata (none / per-chapter / per-novel) |
| Include tax in reported revenue | toggle | off |
| Deduct PayPal fees | toggle | on |
| Rollup schedule | cron | hourly incremental, nightly full |
| Retain daily rollups (days) | number | 0 = forever |
| Dashboard default range | select | last 30 days |
| Reporting currency | select | USD |
| Scheduled email reports | repeatable | recipients, cadence, sections |

### 4.16 Notifications
The channel × event matrix. Each cell toggles independently and links to an editable template with variable insertion (`{{username}}`, `{{amount}}`, `{{balance}}`, `{{chapterTitle}}`, `{{expiresAt}}`, `{{orderNumber}}`).

| Event | In-app | Email | Default |
|---|---|---|---|
| Purchase succeeded | ✓ | ✓ | both on |
| Purchase failed | ✓ | ✓ | both on |
| Credits granted | ✓ | ✓ | both on |
| Credits expiring soon | ✓ | ✓ | both on |
| Low balance | ✓ | ✓ | in-app only |
| Chapter unlocked | ✓ | ✓ | both off |
| Rental expiring | ✓ | ✓ | in-app only |
| Subscription activated / renewed / failed / cancelled | ✓ | ✓ | both on |
| Refund processed | ✓ | ✓ | both on |
| Author payout sent | ✓ | ✓ | both on |

Plus: respect per-user preferences (on) · quiet hours · max emails per user per day · test-send to yourself.

### 4.17 Safety & Guards
The gap-analysis fixes, all configurable.

Block deleting purchased chapters (on) · on chapter delete (`block` / `refund credits` / `refund and notify`) · on novel delete (same) · freeze free-chapter-count by original number (on) · warn when renumbering paid chapters (on) · bulk import default access type (`inherit` / `free` / `paid`) · require pricing confirmation on bulk import (on) · require confirmation when changing credits-per-USD (on) · max manual wallet adjustment without approval · prevent price changes on novels with active orders.

### 4.18 Rate Limits
Per-endpoint windows and caps, all editable: order creation (5/min/user) · capture (10/min) · coupon validate (10/min, lockout after 20 failures/hour) · unlock (30/min) · bulk unlock (5/min) · refund request (3/day) · store browse (60/min/IP). Plus a global enable and a bypass list for admin IPs.

### 4.19 Danger Zone
Disable new purchases · disable all unlocks · force-free entire catalogue · wipe FX cache · rebuild all rollups · **reconcile ledger vs wallets** (dry-run then apply) · export full financial dataset · rotate PayPal credentials.

---

## 5. Analytics

### 5.1 Global controls (on every analytics page)

A sticky toolbar: **date range** with presets (7d / 30d / 90d / YTD / custom) · **compare to** (previous period / same period last year / none) · **currency** (report in USD or a selected currency) · **revenue basis** (attributed cash / face value — overrides the default per-view) · **segment** filter (country, novel, plan, cohort) · **Export** (CSV / XLSX / PNG of the chart) · **Save view** · **Schedule as email report**.

Charts built with `recharts` (React 18 compatible, includes a Sankey). All charts inherit the site's dark gothic palette from `themeColors`.

### 5.2 Money Overview

**KPI strip** — eight tiles, each with a 30-day sparkline and Δ% vs the comparison period:
Gross revenue · Net after fees · **Recognized revenue** · **Deferred liability** · MRR · Paying users · ARPPU · Conversion rate.

| Chart | Type | Why |
|---|---|---|
| Revenue over time | Stacked area — packs / subscriptions / refunds (negative) | The headline trend |
| Recognized vs deferred | Dual line + shaded band | Shows the gap between money taken and content delivered. If deferred climbs while recognized flattens, users are hoarding credits |
| Revenue waterfall | Waterfall — Gross → discounts → tax → PayPal fees → **Net** | Where the money actually goes; makes fee drag visible |
| Revenue by currency | Donut + table with settlement mode | Tells you which currencies justify local settlement |
| Revenue by country | Ranked horizontal bars (top 15) + world map toggle | Market concentration |
| Payment funnel | Horizontal funnel with drop-off % between stages | Store view → pack click → order → approved → captured |
| Top novels by revenue | Horizontal bars, top 10, click to drill down | |
| Recent orders | Table, live | |

### 5.3 Novel Performance

**Leaderboard table** — cover thumb, title, author, unlocks, credits earned, **attributed USD**, unique payers, ARPPU, reader→payer conversion, refund rate, author share owed, 30-day sparkline. Sortable on every column, exportable, click-through to drill-down.

| Chart | Type | Why |
|---|---|---|
| Revenue treemap | Treemap — area = revenue, colour = growth vs prior period | Whole catalogue at a glance; green blocks are what to promote |
| **Readers vs revenue** | Scatter — x readers, y revenue, bubble = chapter count, quadrant lines at medians | The most commercially useful chart on this page. High-readers/low-revenue in the bottom-right = popular novels you are under-monetizing |
| Revenue concentration | Pareto — cumulative % of revenue by novel rank | Tells you if 3 novels carry the platform |
| Revenue by genre | Stacked bars over time | Which genres pay, not just which get read |
| New vs returning payers | 100% stacked area per novel | Acquisition vs milking |

### 5.4 Novel drill-down — the per-chapter revenue view

Reached from any novel. Header: cover, title, status, chapter count, free/paid split, lifetime revenue, active readers, author share.

| Chart | Type | Why |
|---|---|---|
| **Chapter revenue** | Bar chart, x = chapter number, y = attributed USD, bars coloured free / paid / early-access | The core per-chapter view you asked for. Shows exactly which chapters earn |
| **Retention vs paywall** ★ | Combo — line of unique readers per chapter + bars of revenue + a vertical marker at the paywall boundary | **The single most actionable chart in the portal.** The reader-count cliff at the paywall tells you instantly whether your free-chapter count is too low. A gentle slope means the hook landed; a wall means you are paywalling before readers are invested |
| Conversion at paywall | Radial gauge + trend line | Of readers reaching the first paid chapter, what % unlocked |
| Cumulative revenue | Area, cumulative by chapter | Where the novel earns out |
| Price vs unlock rate | Scatter — x price in credits, y unlock rate | Empirical demand curve. Answers "would 15 credits sell worse than 10" with data |
| Chapter × week heatmap | Heatmap — rows chapters, columns weeks, colour revenue | Shows back-catalogue earning vs new-release spikes |
| Funding mix | 100% stacked bars per chapter — paid credits / granted credits / subscription | How much "revenue" is actually free credits |
| Time to unlock | Histogram — hours between publish and unlock | Urgency; informs early-access windows |

**Chapter table** below: number, title, published, price, access type, unlocks, unique users, credits, attributed USD, face value USD, unlock rate %, reader drop-off %, refunds, revenue sparkline. Inline-editable price and access type with bulk apply.

### 5.5 Chapter Performance (cross-catalogue)

Every chapter on the platform in one table, filterable by novel / price / access type / date. Plus:
- Unlock-rate distribution histogram — where a healthy chapter sits
- Top 20 and bottom 20 earners
- Revenue per 1,000 words scatter — is long-form worth it
- Chapters where reader drop-off exceeds a threshold, flagged for pricing review

### 5.6 Credit Economy

| Chart | Type | Why |
|---|---|---|
| **Credit flow** ★ | **Sankey** — Purchased / Granted / Subscription / Referral → Balance → Spent on chapters / Expired / Refunded / Still outstanding | The best single picture of a credit economy. Shows at a glance what share of spending is funded by free credits |
| Outstanding liability | Area over time, in USD | Money owed in content. Watch it after grant campaigns |
| Issued vs spent vs expired | Grouped bars by week | Is the economy inflating or deflating |
| Balance distribution | Histogram, log-scale x | Are credits concentrated in a few wallets |
| Paid vs granted spend | 100% stacked area over time | If granted credits dominate, your paywall is decorative |
| Grant campaign ROI | Grouped bars — recipient spend vs holdout spend, per campaign | Whether free credits actually drive purchases. **Requires reserving a holdout group** — an option on the campaign builder |
| Credit velocity | Line — average days from issue to spend | Slow velocity means hoarding and rising liability |

### 5.7 Conversion Funnel

Funnel bars with drop-off between each stage: chapter gate impression → store visit → pack click → order created → PayPal approved → captured. Segmentable by country, novel, device, first-time vs returning.

Plus: time-to-first-purchase histogram · repeat-purchase cohort heatmap (acquisition month × month N repurchase rate, triangle) · pack popularity (units vs revenue, dual bars) · coupon performance table with incremental-vs-cannibalized estimate · price-point elasticity.

### 5.8 Subscriptions

**MRR waterfall** — new / expansion / contraction / churn / reactivation per month. The standard subscription chart and the only one that explains *why* MRR moved.

Plus: active subscribers by tier (stacked area) · retention cohort triangle · churn curve by tenure · cancellation reason donut · dunning recovery funnel · LTV by plan · trial→paid conversion · subscription vs pack revenue mix.

### 5.9 Readers & Cohorts

LTV curve by acquisition cohort (multi-line, cumulative) · **whale concentration** (Lorenz curve + Gini, with "top 1% = X% of revenue" callout — most platforms are far more concentrated than they expect) · RFM segment bubble grid · spend distribution histogram · reader→payer conversion by acquisition source · geographic revenue map · churn risk list (was active + paying, now dormant).

### 5.10 Dashboard (Overview)

The landing page mixes content, community and money so the daily check is one screen:
row 1 KPI tiles (revenue today / MTD, new users, active readers, chapters published, pending moderation) · row 2 revenue trend + credit flow mini-Sankey · row 3 top novels, recent orders, moderation queue · row 4 system health strip (webhook success rate, failed jobs, FX rate age, ledger drift).

---

## 6. Novel and chapter editor additions

**Novel editor → new "Monetization" tab**: override toggle · monetized · free chapter count · default chapter price · free-after-days · bulk discount tiers · access mode + rental hours · subscription included · author + revenue share % · a live preview strip showing the computed price of every chapter with the resolution reason ("rule: *first 20 free*"), so admins can see the chain's outcome without guessing.

**Chapter editor → pricing row**: access type (inherit / free / paid) · price credits (with the inherited value shown as placeholder) · free-after-days · early access until · rental hours. Plus a read-only line: *"Resolved price: 10 credits — from novel default"*.

**Chapters list**: price column, access-type chip, unlock count, revenue, and bulk actions (set price, make free, make paid, apply rule) across selected chapters.

---

## 7. Build order

| Stage | Ships |
|---|---|
| **A** | Sidebar regroup + settings search + save-bar/impact-preview conventions. Pure IA, no new features — makes everything after it cheaper |
| **B** | Settings → Monetization tabs 4.1, 4.2, 4.4, 4.17 + Grants + Wallets & Ledger. Matches architecture Phase 1 |
| **C** | Packs, Currencies, Payments, Orders, Refunds + Money Overview. Matches Phase 2 |
| **D** | Rollup jobs, then Revenue / Novel Performance / novel drill-down / Chapter Performance / Credit Economy |
| **E** | Coupons, Subscriptions, Rentals, Tax, Author Payouts + their analytics |
| **F** | System group: webhooks, jobs, audit log, reconciliation |

Analytics pages depend on the rollup collections from architecture §5.16, so stage D cannot start before the jobs exist. Everything before D is CRUD over models that Phases 1–2 already create.
