# ContentAI — Setup Guide

## Quick Start (3 minutes)

### 1. Add your API keys to `.env`

Open `content-saas/.env` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-your-new-key-here
```

Get a new key from: https://console.anthropic.com/settings/keys

### 2. Start the server

```bash
cd content-saas
npm start
```

Visit http://localhost:3000 — you're live!

### 3. Create your account

Click "Get Started Free" and register. The first account (id=1) gets admin access.

---

## Adding Stripe Payments (required to charge customers)

### 1. Create a Stripe account
Go to https://dashboard.stripe.com/register

### 2. Get your API keys
Go to https://dashboard.stripe.com/test/apikeys

Add to `.env`:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 3. Set up webhook (for subscription events)
```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe listen --forward-to localhost:3000/api/stripe/webhook
```
Copy the webhook signing secret to `.env`:
```
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 4. Go live
When ready, switch from test keys to live keys in `.env`.

---

## Deploying to Production (so customers can reach you)

### Option A: Railway (easiest, ~$5/mo)
1. Push code to GitHub
2. Go to https://railway.app
3. New Project → Deploy from GitHub
4. Add your .env variables in Railway's dashboard
5. Done — you get a public URL

### Option B: Render (free tier available)
1. Push to GitHub
2. Go to https://render.com
3. New Web Service → connect repo
4. Set environment variables
5. Deploy

### Option C: VPS (DigitalOcean, $6/mo)
```bash
# On your server:
git clone <your-repo>
cd content-saas
npm install
cp .env.example .env
# Edit .env with your keys
npm start
```

Use PM2 to keep it running:
```bash
npm install -g pm2
pm2 start server.js --name contentai
pm2 save
pm2 startup
```

---

## Revenue Math

| Plan      | Price  | Customers | Monthly Revenue |
|-----------|--------|-----------|-----------------|
| Starter   | $29/mo | 50        | $1,450          |
| Pro       | $79/mo | 50        | $3,950          |
| Unlimited | $149/mo| 30        | $4,470          |
| **Total** |        | **130**   | **$9,870/mo**   |

Your costs: ~$50-100/mo (hosting + API usage)

---

## Marketing Checklist

- [ ] Set up a custom domain
- [ ] Create landing page with SEO keywords
- [ ] Post in relevant subreddits, Facebook groups, indie hacker communities
- [ ] Create demo videos showing the tool
- [ ] Offer free tier to get users in the door
- [ ] Collect testimonials from free users
- [ ] Run Google Ads targeting "AI content generator for small business"
