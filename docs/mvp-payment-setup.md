# MVP payments — turning it on

The loop this covers, and nothing more:

> A reader buys credits with PayPal in USD → the credits land once the payment
> is verified → an admin has set how many credits a chapter costs → the reader
> spends credits to unlock it → they can read it forever.

Everything else that exists in the codebase (subscriptions, coupons, grants,
analytics) is **off by default** and irrelevant to this path. You do not need to
touch any of it.

---

## 1. PayPal credentials

Get a **sandbox** client ID and secret from the PayPal developer dashboard.

The secret must never reach the browser, so it comes from the environment:

```bash
# backend/.env
PAYPAL_CLIENT_ID=<your sandbox client id>
PAYPAL_CLIENT_SECRET=<your sandbox secret>
PAYPAL_WEBHOOK_ID=<created in step 4>
```

The client ID can alternatively be set in the admin portal under
**Settings → Payments → PayPal**, and the store now reads it from there. Either
works; the env var wins if both are set.

Then check it with the **Test connection** button at the top of
**Settings → Payments → PayPal**. It asks PayPal for a token with whatever
credentials are configured and tells you which environment answered — so a typo
in the secret surfaces here rather than at a reader's checkout.

> The client ID is public — PayPal embeds it in their JS SDK on every checkout
> page. Only the secret is sensitive, and it never leaves the server.

## 2. Switch monetization on

**Settings → Monetization → General**

| Setting | Set to | Why |
|---|---|---|
| `monetization.enabled` | **on** | Off by default. Nothing is priced until this is on. |
| `store.enabled` | **on** | Off by default. Controls whether readers can buy. |
| `credits.perUsd` | `100` | Your "1 USD = 100 credits". |
| `pricing.defaultFreeChapterCount` | `10` | First N chapters of every novel are free. Set `0` if you want to price everything yourself. |
| `pricing.defaultChapterCredits` | `10` | What a paid chapter costs when nothing more specific applies. |
| `access.mode` | `permanent` | Already the default. An unlock never expires. |

## 3. Create at least one credit pack

**Admin → Credit packs → New pack.** Nothing can be bought until one exists.

A reasonable starting ladder:

| Name | Credits | Bonus | Price |
|---|---|---|---|
| Starter | 500 | 0 | $4.99 |
| Popular | 1200 | 100 | $9.99 |
| Best value | 3000 | 500 | $24.99 |

The form shows credits-per-dollar as you type, so you can see whether the larger
packs are actually the better deal.

USD works with no currency setup at all. Ignore **Admin → Currencies** for now.

## 4. Webhook

In the PayPal dashboard, add a webhook pointing at:

```
https://<your-domain>/webhooks/paypal
```

Subscribe to at least `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED` and
`PAYMENT.CAPTURE.REFUNDED`. Put the webhook ID in `PAYPAL_WEBHOOK_ID`.

**This is not optional.** The browser calls capture directly, but if the buyer
closes the tab mid-payment, the webhook is the only thing that delivers their
credits. Unverified webhooks are rejected and recorded, so a missing
`PAYPAL_WEBHOOK_ID` means every webhook is dropped.

The endpoint sits outside `/api` deliberately, so maintenance mode cannot 503 it.

## 5. Price some chapters

Three ways, in increasing order of scale:

- **One chapter** — Admin → Novels → Chapters → edit → **Access**: "Set a price".
- **A whole novel** — Admin → Novels → edit → **Price this novel differently**:
  first N free, then X credits each.
- **A range** — Admin → Novels → Chapters → **Set prices**: "chapters 21 to 500,
  paid, 10 credits". This is how you price a long novel.

Precedence, highest first:

1. A price set on the chapter itself
2. A matching pricing rule (leave these alone for the MVP)
3. The novel's own setting, **if** its override switch is on
4. The site-wide default

The chapter list shows the *effective* price of every chapter, so you can see
what a reader will actually be charged rather than just what was overridden.

---

## How a reader buys

Credits are bought in a dialog that opens over whatever they were doing, not on
a separate page. Three places open it:

- **The paywall.** When they cannot afford a chapter, "Get credits" opens the
  dialog over the chapter. The pack that covers the shortfall is pre-selected —
  the cheapest one that does, not the largest. After paying, the balance updates
  in place and the unlock button becomes usable without any navigation.
- **The balance chip** in the navbar.
- **Get credits** in the profile wallet panel.

The `/store` page still exists for readers who want to browse packs deliberately,
and it shares the same purchase code as the dialog, so the two cannot drift.

## Checking it works

1. Sign in as a normal reader.
2. Open a priced chapter — you should hit the paywall, not the text.
3. Click **Get credits** and buy a pack with a PayPal sandbox buyer account.
4. The dialog should confirm, your balance updates, and the unlock button on the
   paywall behind it becomes usable — no page change at any point.
5. Unlock the chapter and read it.
6. Sign out, sign back in, reopen it — still unlocked.

If step 3 shows "Payments are not set up yet", the client ID is not reaching the
browser: check step 1 and the **Test connection** button.

If credits do not arrive after a successful payment, look at
**Admin → Jobs → webhook events** for a rejected or failed event.

---

## Things deliberately not part of this

- Non-USD currencies. The machinery exists and is tested, but PayPal settles in
  only 25 currencies, and getting that right is its own piece of work.
- Subscriptions, coupons, referrals, auto-unlock, rentals.
- Free-credit grant campaigns.
- Bulk unlock for readers (the API exists; there is no button).

None of these need to be removed or hidden — they are inert while their settings
are off.
