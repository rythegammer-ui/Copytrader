# Connecting a real Stripe account

The store ships with two payment providers behind one interface
(`src/lib/payments/provider.ts`): a built-in **mock** used for demos, and
**Stripe**. Which one runs is decided by a single fact — whether
`STRIPE_SECRET_KEY` is set. Nothing else needs changing to go live.

```
STRIPE_SECRET_KEY unset  ->  mock provider, /api/payments/mock/confirm is open
STRIPE_SECRET_KEY set    ->  Stripe provider, mock confirm endpoint returns 404
```

## 1. The three environment variables

| Variable | Where it comes from | Needed at |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys → Secret key (`sk_test_…` / `sk_live_…`) | build + runtime |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | same page, Publishable key (`pk_test_…` / `pk_live_…`) | **build** |
| `STRIPE_WEBHOOK_SECRET` | created in step 3 below (`whsec_…`) | build + runtime |

Set all three on the hosting project (on Vercel: Project → Settings →
Environment Variables, all environments), **not** in a committed file. The
build script picks them up automatically; `scripts/bake-runtime-env.js` inlines
the two server-side ones, and Next.js inlines the publishable key into the
browser bundle.

The publishable key is needed at **build** time. Adding it later without
redeploying leaves the payment form showing "Stripe is active on the server but
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set". **Always redeploy after
changing any of the three.**

Both keys must be from the **same mode**. A `sk_test_` secret with a `pk_live_`
publishable key fails in a way that is easy to miss — see step 4.

## 2. The site has to be publicly reachable

Stripe delivers webhooks from its own servers. If the deployment sits behind
Vercel Authentication (or any password protection), Stripe's POST gets a 302 to
a sign-in page, the delivery fails, and **orders never flip to paid even though
the customer was charged**.

Turn deployment protection off for production before creating the webhook:
Vercel → Project → Settings → Deployment Protection → Vercel Authentication →
"Only Preview Deployments".

## 3. The webhook endpoint

In Stripe: Developers → Webhooks → Add endpoint.

- **URL** — `https://<your-domain>/api/webhooks/stripe`
- **Events** — subscribe to exactly these:
  - `payment_intent.succeeded` — flips the order to PAID, draws down stock, fans out purchase orders and books appointments
  - `payment_intent.payment_failed` — records the failure on the payment
  - `refund.updated` — settles a refund's final status, and pages admins when one fails
  - `charge.refund.updated` — the older spelling of the same thing; harmless to include

Copy the endpoint's **Signing secret** into `STRIPE_WEBHOOK_SECRET` and
redeploy.

The endpoint verifies every delivery's signature and rejects anything that does
not match with a 400. It is idempotent: Stripe retries for up to three days and
may deliver duplicates or deliver out of order, and the `WebhookEvent` ledger
means a replayed event changes nothing.

## 4. Confirm it took

```
curl -s https://<your-domain>/api/health | jq .stripe
```

```json
{
  "secretKey": "live",
  "publishableKey": "live",
  "webhookSecret": true,
  "ready": true,
  "modeMismatch": false
}
```

- `ready: false` — something is missing; the other fields say which.
- `modeMismatch: true` — the keys are from different modes. Fix before taking
  real orders: a test secret key accepts card numbers that will never settle.

Only key **prefixes** are read, never the keys themselves, and nothing in the
response contains key material.

## 5. Test before going live

Use the test keys first and place a full order with card `4242 4242 4242 4242`,
any future expiry, any CVC. Then check:

1. The order reaches PAID on the order page.
2. Stripe → Webhooks shows a 200 for `payment_intent.succeeded`.
3. Purchase orders appear in the supplier portal and the appointment is booked.
4. Refunding a line from admin produces a refund in Stripe of the same amount.

Then swap both keys to live mode, create a **separate** live-mode webhook
endpoint (signing secrets differ per endpoint), update
`STRIPE_WEBHOOK_SECRET`, and redeploy.

## Notes

- **Orders taken under the mock provider stay on the mock provider.** Each
  `Payment` row records which provider created it, and refunds route back
  through that same one, so switching to Stripe never tries to refund a demo
  order through Stripe.
- **Redirect payment methods work.** `automatic_payment_methods` is enabled, so
  Stripe offers wallets and bank redirects where eligible; the confirm call
  passes a `return_url` back to `/checkout/success/<orderId>`.
- **A customer can land back before the webhook arrives.** The order is only
  marked paid by the webhook, so the success page may briefly show the order as
  still processing. This is normal and resolves within seconds.
- **The amount is asserted.** Before flipping an order to PAID the handler
  checks the intent's amount and currency against the order total, and records a
  mismatch for review rather than trusting the event.
