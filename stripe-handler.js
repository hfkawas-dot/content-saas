const stripe = require('stripe');
const db = require('./db');

let stripeClient = null;

function getStripe() {
  if (!stripeClient && process.env.STRIPE_SECRET_KEY) {
    stripeClient = stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

const PLANS = {
  free: { name: 'Free', price: 0, generations: 5, priceId: null },
  starter: { name: 'Starter', price: 2900, generations: 100, priceId: null }, // $29/mo
  pro: { name: 'Pro', price: 7900, generations: 500, priceId: null },         // $79/mo
  unlimited: { name: 'Unlimited', price: 14900, generations: 999999, priceId: null }, // $149/mo
};

// Create Stripe products/prices on first run
async function ensureStripePrices() {
  const s = getStripe();
  if (!s) return;

  for (const [key, plan] of Object.entries(PLANS)) {
    if (key === 'free' || plan.priceId) continue;
    try {
      const product = await s.products.create({ name: `ContentAI - ${plan.name}` });
      const price = await s.prices.create({
        product: product.id,
        unit_amount: plan.price,
        currency: 'usd',
        recurring: { interval: 'month' },
      });
      plan.priceId = price.id;
    } catch (err) {
      console.log(`Note: Stripe setup skipped for ${key} plan (${err.message})`);
    }
  }
}

async function createCheckoutSession(userId, planKey) {
  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');

  const plan = PLANS[planKey];
  if (!plan || !plan.priceId) throw new Error('Invalid plan');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await s.customers.create({ email: user.email, metadata: { userId: String(userId) } });
    customerId = customer.id;
    db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, userId);
  }

  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: plan.priceId, quantity: 1 }],
    success_url: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard?upgraded=true`,
    cancel_url: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard?cancelled=true`,
    metadata: { userId: String(userId), plan: planKey },
  });

  return session;
}

function handleWebhook(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const planKey = session.metadata?.plan;
      if (userId && planKey) {
        const plan = PLANS[planKey];
        db.prepare('UPDATE users SET plan = ?, generations_limit = ?, stripe_subscription_id = ? WHERE id = ?')
          .run(planKey, plan.generations, session.subscription, parseInt(userId));
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      db.prepare('UPDATE users SET plan = ?, generations_limit = ?, stripe_subscription_id = NULL WHERE stripe_subscription_id = ?')
        .run('free', PLANS.free.generations, sub.id);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`Payment failed for customer ${invoice.customer}`);
      break;
    }
  }
}

module.exports = { PLANS, ensureStripePrices, createCheckoutSession, handleWebhook, getStripe };
