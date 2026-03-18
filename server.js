const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const db = require('./db');
const { authMiddleware, register, login } = require('./auth');
const { generateContent, TEMPLATES } = require('./generate');
const { PLANS, ensureStripePrices, createCheckoutSession, handleWebhook, getStripe } = require('./stripe-handler');

const app = express();
const PORT = process.env.PORT || 3001;

// Stripe webhook needs raw body - must be before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const s = getStripe();
  if (!s) return res.status(400).send('Stripe not configured');

  try {
    const event = s.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    handleWebhook(event);
    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many requests' } });
app.use('/api/', apiLimiter);

// ===== AUTH ROUTES =====
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'Email, password, and name required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const result = await register(email, password, name);
    res.cookie('token', result.token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await login(email, password);
    res.cookie('token', result.token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ===== GENERATION ROUTES =====
app.get('/api/templates', (req, res) => {
  const templates = Object.entries(TEMPLATES).map(([key, t]) => ({ id: key, name: t.name }));
  res.json({ templates });
});

app.post('/api/generate', authMiddleware, async (req, res) => {
  try {
    const { type, input } = req.body;
    if (!type || !input) return res.status(400).json({ error: 'Type and input required' });

    // Check usage limits
    const user = db.prepare('SELECT generations_used, generations_limit FROM users WHERE id = ?').get(req.user.id);
    if (user.generations_used >= user.generations_limit) {
      return res.status(403).json({ error: 'Generation limit reached. Please upgrade your plan.', needsUpgrade: true });
    }

    const result = await generateContent(type, input);

    // Save to DB and increment usage
    db.prepare('INSERT INTO generations (user_id, type, prompt, result) VALUES (?, ?, ?, ?)')
      .run(req.user.id, type, JSON.stringify(input), result.content);
    db.prepare('UPDATE users SET generations_used = generations_used + 1 WHERE id = ?').run(req.user.id);

    const updated = db.prepare('SELECT generations_used, generations_limit FROM users WHERE id = ?').get(req.user.id);
    res.json({ ...result, remaining: updated.generations_limit - updated.generations_used });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: 'Failed to generate content. Check your API key.' });
  }
});

app.get('/api/history', authMiddleware, (req, res) => {
  const history = db.prepare('SELECT id, type, prompt, result, created_at FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json({ history });
});

// ===== API KEY ROUTES =====
app.post('/api/keys', authMiddleware, (req, res) => {
  if (req.user.plan === 'free') return res.status(403).json({ error: 'API keys require a paid plan' });

  const key = `cai_${crypto.randomBytes(24).toString('hex')}`;
  const name = req.body.name || 'Default';
  db.prepare('INSERT INTO api_keys (user_id, key, name) VALUES (?, ?, ?)').run(req.user.id, key, name);
  res.json({ key, name });
});

app.get('/api/keys', authMiddleware, (req, res) => {
  const keys = db.prepare('SELECT id, name, substr(key, 1, 8) || \'...\' as key_preview, created_at FROM api_keys WHERE user_id = ?').all(req.user.id);
  res.json({ keys });
});

// ===== EXTERNAL API (for customers' API keys) =====
app.post('/api/v1/generate', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  const keyRow = db.prepare('SELECT user_id FROM api_keys WHERE key = ?').get(apiKey);
  if (!keyRow) return res.status(401).json({ error: 'Invalid API key' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(keyRow.user_id);
  if (user.generations_used >= user.generations_limit) {
    return res.status(403).json({ error: 'Generation limit reached' });
  }

  try {
    const { type, input } = req.body;
    const result = await generateContent(type, input);
    db.prepare('INSERT INTO generations (user_id, type, prompt, result) VALUES (?, ?, ?, ?)')
      .run(user.id, type, JSON.stringify(input), result.content);
    db.prepare('UPDATE users SET generations_used = generations_used + 1 WHERE id = ?').run(user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Generation failed' });
  }
});

// ===== STRIPE ROUTES =====
app.get('/api/plans', (req, res) => {
  const plans = Object.entries(PLANS).map(([key, p]) => ({
    id: key, name: p.name, price: p.price / 100, generations: p.generations,
  }));
  res.json({ plans });
});

app.post('/api/checkout', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    const session = await createCheckoutSession(req.user.id, plan);
    res.json({ url: session.url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== ADMIN STATS =====
app.get('/api/admin/stats', authMiddleware, (req, res) => {
  // Simple admin check — first user is admin
  if (req.user.id !== 1) return res.status(403).json({ error: 'Not authorized' });

  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const paidUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE plan != 'free'").get().count;
  const totalGenerations = db.prepare('SELECT COUNT(*) as count FROM generations').get().count;
  const revenue = db.prepare("SELECT plan, COUNT(*) as count FROM users WHERE plan != 'free' GROUP BY plan").all();

  let mrr = 0;
  for (const r of revenue) {
    mrr += (PLANS[r.plan]?.price || 0) * r.count / 100;
  }

  res.json({ totalUsers, paidUsers, totalGenerations, mrr: mrr.toFixed(2) });
});

// SPA fallback
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
async function start() {
  await ensureStripePrices();
  app.listen(PORT, () => {
    console.log(`ContentAI running at http://localhost:${PORT}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('⚠ ANTHROPIC_API_KEY not set — generation will fail');
    if (!process.env.STRIPE_SECRET_KEY) console.log('⚠ STRIPE_SECRET_KEY not set — payments disabled');
  });
}

start();
