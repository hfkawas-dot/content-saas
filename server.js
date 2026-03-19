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
const { generateBlogPost, pickUnusedKeyword, SEO_KEYWORDS } = require('./blog-generator');
const { sendDripEmails } = require('./email-drip');
const { registerFreeToolRoutes, FREE_TOOLS } = require('./free-tools');
const { postNextTweet, postNextThread } = require('./twitter-poster');
const { postNextPin } = require('./pinterest-poster');
const { generateSubmissions } = require('./directory-submitter');
const { generateVideoContent, renderVideoPage } = require('./video-generator');

const app = express();
const PORT = process.env.PORT || 3001;

// Stripe webhook needs raw body - must be before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const s = getStripe();
  if (!s) return res.status(400).send('Stripe not configured');

  try {
    const event = s.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    await handleWebhook(event);
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
    const { email, password, name, referral_code } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'Email, password, and name required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const result = await register(email, password, name, referral_code || null);
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

    // Check usage limits (bonus generations are used before monthly limit)
    const user = await db.get('SELECT generations_used, generations_limit, bonus_generations FROM users WHERE id = $1', req.user.id);
    const totalAvailable = user.generations_limit + user.bonus_generations;
    if (user.generations_used >= totalAvailable) {
      return res.status(403).json({ error: 'Generation limit reached. Please upgrade your plan.', needsUpgrade: true });
    }

    const result = await generateContent(type, input);

    // Save to DB and decrement: use bonus_generations first, then count against monthly limit
    await db.run('INSERT INTO generations (user_id, type, prompt, result) VALUES ($1, $2, $3, $4)', req.user.id, type, JSON.stringify(input), result.content);

    if (user.bonus_generations > 0) {
      await db.run('UPDATE users SET bonus_generations = bonus_generations - 1 WHERE id = $1', req.user.id);
    } else {
      await db.run('UPDATE users SET generations_used = generations_used + 1 WHERE id = $1', req.user.id);
    }

    const updated = await db.get('SELECT generations_used, generations_limit, bonus_generations FROM users WHERE id = $1', req.user.id);
    const remaining = (updated.generations_limit - updated.generations_used) + updated.bonus_generations;
    res.json({ ...result, remaining });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: 'Failed to generate content. Check your API key.' });
  }
});

app.get('/api/history', authMiddleware, async (req, res) => {
  const history = await db.all('SELECT id, type, prompt, result, created_at FROM generations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', req.user.id);
  res.json({ history });
});

// ===== API KEY ROUTES =====
app.post('/api/keys', authMiddleware, async (req, res) => {
  if (req.user.plan === 'free') return res.status(403).json({ error: 'API keys require a paid plan' });

  const key = `cai_${crypto.randomBytes(24).toString('hex')}`;
  const name = req.body.name || 'Default';
  await db.run('INSERT INTO api_keys (user_id, key, name) VALUES ($1, $2, $3)', req.user.id, key, name);
  res.json({ key, name });
});

app.get('/api/keys', authMiddleware, async (req, res) => {
  const keys = await db.all("SELECT id, name, substr(key, 1, 8) || '...' as key_preview, created_at FROM api_keys WHERE user_id = $1", req.user.id);
  res.json({ keys });
});

// ===== REFERRAL ROUTES =====
app.get('/api/referral', authMiddleware, async (req, res) => {
  const user = await db.get('SELECT referral_code, bonus_generations FROM users WHERE id = $1', req.user.id);
  const referralRow = await db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = $1', req.user.id);
  res.json({
    referral_code: user.referral_code,
    referral_count: referralRow.count,
    bonus_generations: user.bonus_generations,
  });
});

app.post('/api/referral/apply', authMiddleware, async (req, res) => {
  const { referral_code } = req.body;
  if (!referral_code) return res.status(400).json({ error: 'Referral code required' });

  // Check if user was already referred
  const user = await db.get('SELECT id, referred_by FROM users WHERE id = $1', req.user.id);
  if (user.referred_by) return res.status(400).json({ error: 'You have already used a referral code' });

  const referrer = await db.get('SELECT id FROM users WHERE referral_code = $1', referral_code);
  if (!referrer) return res.status(400).json({ error: 'Invalid referral code' });
  if (referrer.id === req.user.id) return res.status(400).json({ error: 'You cannot refer yourself' });

  // Credit both users with 5 bonus generations
  await db.run('UPDATE users SET referred_by = $1, bonus_generations = bonus_generations + 5 WHERE id = $2', referrer.id, req.user.id);
  await db.run('UPDATE users SET bonus_generations = bonus_generations + 5 WHERE id = $1', referrer.id);

  res.json({ success: true, message: 'Referral applied! You both earned 5 bonus generations.' });
});

// ===== EXTERNAL API (for customers' API keys) =====
app.post('/api/v1/generate', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  const keyRow = await db.get('SELECT user_id FROM api_keys WHERE key = $1', apiKey);
  if (!keyRow) return res.status(401).json({ error: 'Invalid API key' });

  const user = await db.get('SELECT * FROM users WHERE id = $1', keyRow.user_id);
  const totalAvailable = user.generations_limit + (user.bonus_generations || 0);
  if (user.generations_used >= totalAvailable) {
    return res.status(403).json({ error: 'Generation limit reached' });
  }

  try {
    const { type, input } = req.body;
    const result = await generateContent(type, input);
    await db.run('INSERT INTO generations (user_id, type, prompt, result) VALUES ($1, $2, $3, $4)', user.id, type, JSON.stringify(input), result.content);
    if (user.bonus_generations > 0) {
      await db.run('UPDATE users SET bonus_generations = bonus_generations - 1 WHERE id = $1', user.id);
    } else {
      await db.run('UPDATE users SET generations_used = generations_used + 1 WHERE id = $1', user.id);
    }
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

// ===== PUBLIC STATS (for social proof) =====
let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.get('/api/stats', async (req, res) => {
  const now = Date.now();
  if (statsCache && (now - statsCacheTime) < STATS_CACHE_TTL) {
    return res.json(statsCache);
  }

  const totalUsersRow = await db.get('SELECT COUNT(*) as count FROM users');
  const totalGenerationsRow = await db.get('SELECT COUNT(*) as count FROM generations');
  const totalBlogPostsRow = await db.get('SELECT COUNT(*) as count FROM blog_posts WHERE published = 1');

  statsCache = {
    totalUsers: totalUsersRow.count,
    totalGenerations: totalGenerationsRow.count,
    totalBlogPosts: totalBlogPostsRow.count,
  };
  statsCacheTime = now;
  res.json(statsCache);
});

// ===== ADMIN STATS =====
app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  // Simple admin check — first user is admin
  if (req.user.id !== 1) return res.status(403).json({ error: 'Not authorized' });

  const totalUsersRow = await db.get('SELECT COUNT(*) as count FROM users');
  const paidUsersRow = await db.get("SELECT COUNT(*) as count FROM users WHERE plan != 'free'");
  const totalGenerationsRow = await db.get('SELECT COUNT(*) as count FROM generations');
  const revenue = await db.all("SELECT plan, COUNT(*) as count FROM users WHERE plan != 'free' GROUP BY plan");

  let mrr = 0;
  for (const r of revenue) {
    mrr += (PLANS[r.plan]?.price || 0) * r.count / 100;
  }

  res.json({ totalUsers: totalUsersRow.count, paidUsers: paidUsersRow.count, totalGenerations: totalGenerationsRow.count, mrr: mrr.toFixed(2) });
});

// ===== EMAIL SUBSCRIBER ROUTES =====

// Subscribe — public endpoint for email capture
app.post('/api/subscribe', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email format' });

  // Check for duplicate
  const existing = await db.get('SELECT id FROM email_subscribers WHERE email = $1', email.toLowerCase().trim());
  if (existing) return res.json({ ok: true, message: 'You are already subscribed!' });

  await db.run('INSERT INTO email_subscribers (email, name) VALUES ($1, $2)', email.toLowerCase().trim(), name || null);
  res.json({ ok: true, message: 'Successfully subscribed!' });
});

// List subscribers — admin only (user id 1)
app.get('/api/subscribers', authMiddleware, async (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: 'Not authorized' });

  const subscribers = await db.all(
    'SELECT id, email, name, subscribed_at, last_email_sent, emails_sent_count, converted FROM email_subscribers ORDER BY subscribed_at DESC'
  );
  res.json({ subscribers, total: subscribers.length });
});

// Send drip emails — admin or cron
app.post('/api/email/send-drip', async (req, res) => {
  const cronSecret = process.env.BLOG_CRON_SECRET;
  const providedSecret = req.headers['x-cron-secret'] || req.body.secret;

  if (cronSecret && providedSecret === cronSecret) {
    // Authorized via cron secret
  } else {
    // Fall back to auth middleware check
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.token;
    if (!authHeader && !cookieToken) {
      return res.status(401).json({ error: 'Unauthorized. Provide x-cron-secret header or admin auth.' });
    }
    try {
      const jwt = require('jsonwebtoken');
      const token = authHeader?.replace('Bearer ', '') || cookieToken;
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
      if (decoded.id !== 1) return res.status(403).json({ error: 'Admin only' });
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  try {
    const result = await sendDripEmails();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Drip email error:', err);
    res.status(500).json({ error: 'Failed to send drip emails: ' + err.message });
  }
});

// ===== MARKETING ROUTES =====

// Helper: authenticate via cron secret or admin JWT (reusable for marketing routes)
function cronOrAdminAuth(req, res) {
  const cronSecret = process.env.BLOG_CRON_SECRET;
  const providedSecret = req.headers['x-cron-secret'] || req.body.secret;

  if (cronSecret && providedSecret === cronSecret) {
    return true; // Authorized via cron secret
  }

  // Fall back to admin JWT check
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.token;
  if (!authHeader && !cookieToken) {
    res.status(401).json({ error: 'Unauthorized. Provide x-cron-secret header or admin auth.' });
    return false;
  }

  try {
    const jwt = require('jsonwebtoken');
    const token = authHeader?.replace('Bearer ', '') || cookieToken;
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    if (decoded.id !== 1) {
      res.status(403).json({ error: 'Admin only' });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return false;
  }
}

// Seed marketing queue with promotional tweets (no blog post needed)
app.post('/api/marketing/seed-tweets', async (req, res) => {
  if (!cronOrAdminAuth(req, res)) return;
  const siteUrl = process.env.BASE_URL || 'https://contentai-o1s4.onrender.com';
  const tweets = [
    `Stop staring at a blank page. ContentAI writes your product descriptions, emails, and ad copy in seconds. Try 5 free generations:\n${siteUrl}`,
    `Small business owners: how much time do you spend writing content each week? What if AI could do it in seconds?\n\nTry ContentAI free: ${siteUrl}`,
    `Writing product descriptions is tedious. Let AI handle it.\n\nContentAI generates professional copy for your business in seconds.\n\n${siteUrl}`,
    `Need marketing emails that actually convert? ContentAI writes high-converting email campaigns using proven frameworks.\n\nTry free: ${siteUrl}`,
    `Etsy sellers, Amazon sellers, Shopify owners — stop spending hours on product descriptions.\n\nContentAI does it in seconds: ${siteUrl}`,
    `Your ad copy shouldn't sound like everyone else's. ContentAI creates unique, compelling ads for Facebook, Google & Instagram.\n\n${siteUrl}`,
    `Social media posts taking too long? ContentAI generates scroll-stopping posts for any platform.\n\nTry 5 free: ${siteUrl}`,
    `The secret to great marketing? Great copy. Let AI write yours.\n\nContentAI — professional content in seconds: ${siteUrl}`,
    `Still writing your own product descriptions? There's a faster way.\n\nContentAI uses AI to generate SEO-optimized descriptions instantly.\n\n${siteUrl}`,
    `Every small business needs great content. Not every small business can afford a copywriter.\n\nContentAI: $29/mo for unlimited AI content.\n${siteUrl}`,
  ];
  // Reset any failed tweets back to pending
  const reset = await db.run("UPDATE marketing_queue SET status = 'pending', error = NULL WHERE platform = 'twitter' AND status = 'failed'");
  let seeded = 0;
  for (const tweet of tweets) {
    const exists = await db.get("SELECT id FROM marketing_queue WHERE content = $1 AND platform = 'twitter'", JSON.stringify({ text: tweet }));
    if (!exists) {
      await db.run(
        "INSERT INTO marketing_queue (platform, content_type, content, status) VALUES ('twitter', 'tweet', $1, 'pending')",
        JSON.stringify({ text: tweet })
      );
      seeded++;
    }
  }
  const pending = await db.get("SELECT COUNT(*) as count FROM marketing_queue WHERE platform = 'twitter' AND status = 'pending'");
  res.json({ success: true, seeded, reset: reset.changes, pending: pending.count, total: tweets.length });
});

// Post next pending tweet
app.post('/api/marketing/post-tweet', async (req, res) => {
  if (!cronOrAdminAuth(req, res)) return;
  try {
    const result = await postNextTweet();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Tweet post error:', err);
    res.status(500).json({ error: 'Failed to post tweet: ' + err.message });
  }
});

// Post next pending thread
app.post('/api/marketing/post-thread', async (req, res) => {
  if (!cronOrAdminAuth(req, res)) return;
  try {
    const result = await postNextThread();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Thread post error:', err);
    res.status(500).json({ error: 'Failed to post thread: ' + err.message });
  }
});

// Post next pending pin
app.post('/api/marketing/post-pin', async (req, res) => {
  if (!cronOrAdminAuth(req, res)) return;
  try {
    const result = await postNextPin();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Pin post error:', err);
    res.status(500).json({ error: 'Failed to post pin: ' + err.message });
  }
});

// Generate directory submissions
app.post('/api/marketing/generate-submissions', async (req, res) => {
  if (!cronOrAdminAuth(req, res)) return;
  try {
    const result = await generateSubmissions();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Directory submission error:', err);
    res.status(500).json({ error: 'Failed to generate submissions: ' + err.message });
  }
});

// View marketing queue (admin only via JWT)
app.get('/api/marketing/queue', authMiddleware, async (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: 'Not authorized' });

  const items = await db.all(
    'SELECT * FROM marketing_queue ORDER BY created_at DESC'
  );
  res.json({ items, total: items.length });
});

// Marketing stats (public)
app.get('/api/marketing/stats', async (req, res) => {
  const stats = await db.all(`
    SELECT platform, status, COUNT(*) as count
    FROM marketing_queue
    GROUP BY platform, status
  `);

  const summary = {};
  for (const row of stats) {
    if (!summary[row.platform]) summary[row.platform] = {};
    summary[row.platform][row.status] = row.count;
  }

  const totals = await db.get(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM marketing_queue
  `);

  res.json({ byPlatform: summary, totals });
});

// ===== VIDEO PREVIEW ROUTES =====

// Generate a new video script and return the HTML presentation page
app.get('/api/marketing/video-preview', async (req, res) => {
  if (!cronOrAdminAuth(req, res)) return;
  try {
    const { id, script } = await generateVideoContent(db);
    const html = renderVideoPage(script);
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('Video generation error:', err);
    res.status(500).json({ error: 'Failed to generate video: ' + err.message });
  }
});

// Return a previously generated video page by ID
app.get('/api/marketing/video-preview/:id', async (req, res) => {
  if (!cronOrAdminAuth(req, res)) return;
  try {
    const video = await db.get('SELECT * FROM marketing_videos WHERE id = $1', req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });

    const script = JSON.parse(video.script);
    const html = renderVideoPage(script);
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('Video preview error:', err);
    res.status(500).json({ error: 'Failed to load video: ' + err.message });
  }
});

// List all generated videos (admin only)
app.get('/api/marketing/videos', authMiddleware, async (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: 'Not authorized' });
  const videos = await db.all(
    'SELECT id, template, title, status, duration_seconds, created_at FROM marketing_videos ORDER BY created_at DESC'
  );
  res.json({ videos, total: videos.length });
});

// ===== BLOG API ROUTES =====

// List all published blog posts (JSON API)
app.get('/api/blog', async (req, res) => {
  const posts = await db.all(
    'SELECT id, title, slug, meta_description, keywords, created_at FROM blog_posts WHERE published = 1 ORDER BY created_at DESC'
  );
  res.json({ posts });
});

// Schedule info endpoint (must be before :slug route)
app.get('/api/blog/schedule-info', async (req, res) => {
  const totalPostsRow = await db.get('SELECT COUNT(*) as count FROM blog_posts');
  const lastPost = await db.get('SELECT created_at FROM blog_posts ORDER BY created_at DESC LIMIT 1');
  const keywordRows = await db.all('SELECT keywords FROM blog_posts');
  const usedKeywords = keywordRows.map(r => r.keywords).filter(Boolean);
  const remainingKeywords = SEO_KEYWORDS.filter(kw => !usedKeywords.includes(kw));

  // Suggest generating one post per day
  let nextGenerationDate = new Date();
  if (lastPost) {
    const lastDate = new Date(lastPost.created_at);
    nextGenerationDate = new Date(lastDate.getTime() + 24 * 60 * 60 * 1000);
    if (nextGenerationDate < new Date()) {
      nextGenerationDate = new Date(); // overdue, should generate now
    }
  }

  res.json({
    totalPosts: totalPostsRow.count,
    totalKeywords: SEO_KEYWORDS.length,
    remainingKeywords: remainingKeywords.length,
    lastPostDate: lastPost?.created_at || null,
    nextSuggestedGeneration: nextGenerationDate.toISOString(),
    frequency: 'daily',
    nextKeywordSuggestion: remainingKeywords.length > 0 ? remainingKeywords[0] : null,
  });
});

// Get single blog post by slug (JSON API)
app.get('/api/blog/:slug', async (req, res) => {
  const post = await db.get(
    'SELECT * FROM blog_posts WHERE slug = $1 AND published = 1',
    req.params.slug
  );
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ post });
});

// Generate a blog post (admin only - user id 1)
app.post('/api/blog/generate', authMiddleware, async (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: 'Not authorized' });
  try {
    const keyword = req.body.keyword || null;
    const result = await generateBlogPost(keyword);
    res.json({ success: true, post: result });
  } catch (err) {
    console.error('Blog generation error:', err);
    res.status(500).json({ error: 'Failed to generate blog post: ' + err.message });
  }
});

// Auto-generate a blog post (can be called by cron, secured by secret)
app.post('/api/blog/auto-generate', async (req, res) => {
  // Allow access via admin auth OR a shared secret for cron jobs
  const cronSecret = process.env.BLOG_CRON_SECRET;
  const providedSecret = req.headers['x-cron-secret'] || req.body.secret;

  if (cronSecret && providedSecret === cronSecret) {
    // Authorized via cron secret
  } else {
    // Fall back to auth middleware check
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.token;
    if (!authHeader && !cookieToken) {
      return res.status(401).json({ error: 'Unauthorized. Provide x-cron-secret header or admin auth.' });
    }
    // Manual auth check
    try {
      const jwt = require('jsonwebtoken');
      const token = authHeader?.replace('Bearer ', '') || cookieToken;
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
      if (decoded.id !== 1) return res.status(403).json({ error: 'Admin only' });
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  // Respond immediately so cron services don't timeout
  res.json({ success: true, message: 'Blog generation started in background' });

  // Run generation in background
  generateBlogPost()
    .then(result => console.log('Blog post generated:', result?.title || 'done'))
    .catch(err => console.error('Auto blog generation error:', err));
});

// ===== BLOG SERVER-RENDERED PAGES =====

// Helper: render blog page HTML shell
function renderBlogPage(title, metaDesc, canonical, ogType, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-JE6KT383HE"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-JE6KT383HE');</script>
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(metaDesc)}">
  <meta name="robots" content="index, follow">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0f; --surface: #12121a; --border: #1e1e2e; --text: #e4e4e7;
      --muted: #71717a; --primary: #6366f1; --primary-hover: #818cf8;
      --success: #22c55e;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; }
    a { color: var(--primary); text-decoration: none; }
    a:hover { color: var(--primary-hover); }
    .container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }

    nav { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 0; position: sticky; top: 0; z-index: 100; }
    nav .container { display: flex; justify-content: space-between; align-items: center; }
    .logo { font-size: 20px; font-weight: 700; color: var(--text); }
    .logo span { color: var(--primary); }
    .nav-links { display: flex; gap: 16px; align-items: center; }
    .nav-links a { color: var(--muted); font-size: 14px; }
    .nav-links a:hover { color: var(--text); }
    .btn { display: inline-block; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }
    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-sm { padding: 6px 16px; font-size: 13px; }

    .blog-header { padding: 60px 0 30px; text-align: center; }
    .blog-header h1 { font-size: 40px; font-weight: 800; margin-bottom: 12px; }
    .blog-header h1 span { background: linear-gradient(135deg, var(--primary), #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .blog-header p { font-size: 18px; color: var(--muted); max-width: 600px; margin: 0 auto; }

    .blog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 24px; padding: 40px 0 60px; }
    .blog-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 28px; transition: border-color 0.2s, transform 0.2s; }
    .blog-card:hover { border-color: var(--primary); transform: translateY(-2px); }
    .blog-card .card-date { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
    .blog-card h2 { font-size: 20px; font-weight: 700; margin-bottom: 10px; line-height: 1.3; }
    .blog-card h2 a { color: var(--text); }
    .blog-card h2 a:hover { color: var(--primary); }
    .blog-card .card-excerpt { font-size: 14px; color: var(--muted); margin-bottom: 14px; line-height: 1.6; }
    .blog-card .card-keyword { display: inline-block; font-size: 11px; background: var(--border); color: var(--muted); padding: 3px 10px; border-radius: 20px; }
    .blog-card .read-more { font-size: 13px; font-weight: 600; color: var(--primary); }

    .article-container { max-width: 760px; margin: 0 auto; padding: 40px 20px 60px; }
    .article-meta { font-size: 13px; color: var(--muted); margin-bottom: 24px; }
    .article-meta .keyword-tag { display: inline-block; background: var(--border); color: var(--muted); padding: 3px 10px; border-radius: 20px; font-size: 11px; margin-left: 8px; }
    .article-content h2 { font-size: 26px; font-weight: 700; margin: 36px 0 16px; color: var(--text); }
    .article-content h3 { font-size: 20px; font-weight: 600; margin: 28px 0 12px; color: var(--text); }
    .article-content p { font-size: 16px; color: var(--text); margin-bottom: 18px; line-height: 1.8; }
    .article-content ul, .article-content ol { margin: 0 0 18px 24px; }
    .article-content li { font-size: 16px; color: var(--text); margin-bottom: 8px; line-height: 1.7; }
    .article-content strong { color: #f4f4f5; }
    .article-content blockquote { border-left: 3px solid var(--primary); padding: 12px 20px; margin: 20px 0; background: var(--surface); border-radius: 0 8px 8px 0; }
    .article-content a { color: var(--primary); }

    .cta-banner { background: var(--surface); border: 1px solid var(--primary); border-radius: 12px; padding: 40px; text-align: center; margin: 48px 0; }
    .cta-banner h3 { font-size: 24px; font-weight: 700; margin-bottom: 12px; }
    .cta-banner p { font-size: 16px; color: var(--muted); margin-bottom: 20px; max-width: 500px; margin-left: auto; margin-right: auto; }

    .back-link { display: inline-block; margin-bottom: 24px; font-size: 14px; color: var(--muted); }
    .back-link:hover { color: var(--primary); }

    footer { padding: 40px 0; text-align: center; color: var(--muted); font-size: 13px; border-top: 1px solid var(--border); }
    footer a { color: var(--muted); margin: 0 12px; }
    footer a:hover { color: var(--primary); }

    .no-posts { text-align: center; padding: 80px 20px; color: var(--muted); font-size: 18px; }

    @media (max-width: 768px) {
      .blog-header h1 { font-size: 28px; }
      .blog-grid { grid-template-columns: 1fr; }
      .article-content h2 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <nav>
    <div class="container">
      <a href="/" class="logo">Content<span>AI</span></a>
      <div class="nav-links">
        <a href="/blog">Blog</a>
        <a href="/#features">Features</a>
        <a href="/#pricing">Pricing</a>
        <a href="/" class="btn btn-primary btn-sm">Get Started Free</a>
      </div>
    </div>
  </nav>
  ${bodyContent}
  <footer>
    <div class="container">
      <p>ContentAI &mdash; AI-powered content generation for businesses</p>
      <p style="margin-top:8px">
        <a href="/">Home</a>
        <a href="/blog">Blog</a>
        <a href="/#features">Features</a>
        <a href="/#pricing">Pricing</a>
      </p>
      <p style="margin-top:10px;font-size:12px">
        <a href="/free/product-description-generator">Free Product Descriptions</a>
        <a href="/free/email-writer">Free Email Writer</a>
        <a href="/free/social-media-post-generator">Free Social Posts</a>
        <a href="/free/ad-copy-generator">Free Ad Copy</a>
      </p>
    </div>
  </footer>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function stripHtmlForExcerpt(html, maxLen) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

// Blog listing page (server-rendered)
app.get('/blog', async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const posts = await db.all(
    'SELECT id, title, slug, content, meta_description, keywords, created_at FROM blog_posts WHERE published = 1 ORDER BY created_at DESC'
  );

  let cardsHtml;
  if (posts.length === 0) {
    cardsHtml = '<div class="no-posts">No blog posts yet. Check back soon!</div>';
  } else {
    cardsHtml = `<div class="container"><div class="blog-grid">${posts.map(post => {
      const excerpt = post.meta_description || stripHtmlForExcerpt(post.content, 160);
      return `<div class="blog-card">
        <div class="card-date">${formatDate(post.created_at)}</div>
        <h2><a href="/blog/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2>
        <p class="card-excerpt">${escapeHtml(excerpt)}</p>
        ${post.keywords ? `<span class="card-keyword">${escapeHtml(post.keywords)}</span>` : ''}
        <div style="margin-top:14px"><a href="/blog/${escapeHtml(post.slug)}" class="read-more">Read article &rarr;</a></div>
      </div>`;
    }).join('')}</div></div>`;
  }

  const body = `
    <div class="blog-header">
      <div class="container">
        <h1>The Content<span>AI</span> Blog</h1>
        <p>Tips, strategies, and insights on AI-powered content creation, copywriting, and digital marketing.</p>
      </div>
    </div>
    ${cardsHtml}
  `;

  const html = renderBlogPage(
    'Blog - ContentAI | AI Content Generation Tips & Strategies',
    'Expert tips on AI content generation, copywriting, product descriptions, marketing emails, and SEO. Learn how to create better content faster.',
    `${baseUrl}/blog`,
    'website',
    body
  );

  res.send(html);
});

// Single blog post page (server-rendered)
app.get('/blog/:slug', async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const post = await db.get(
    'SELECT * FROM blog_posts WHERE slug = $1 AND published = 1',
    req.params.slug
  );

  if (!post) {
    const notFoundBody = `
      <div class="article-container" style="text-align:center;padding:80px 20px">
        <h2 style="font-size:32px;margin-bottom:16px">Post Not Found</h2>
        <p style="color:var(--muted);margin-bottom:24px">The article you are looking for does not exist or has been removed.</p>
        <a href="/blog" class="btn btn-primary">Browse All Articles</a>
      </div>
    `;
    return res.status(404).send(renderBlogPage(
      'Post Not Found - ContentAI Blog',
      'This blog post could not be found.',
      `${baseUrl}/blog`,
      'website',
      notFoundBody
    ));
  }

  // Build structured data (JSON-LD)
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.meta_description || '',
    datePublished: post.created_at,
    author: { '@type': 'Organization', name: 'ContentAI' },
    publisher: { '@type': 'Organization', name: 'ContentAI' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${baseUrl}/blog/${post.slug}` },
  });

  const body = `
    <script type="application/ld+json">${jsonLd}</script>
    <div class="article-container">
      <a href="/blog" class="back-link">&larr; Back to all articles</a>
      <h1 style="font-size:36px;font-weight:800;margin-bottom:8px;line-height:1.2">${escapeHtml(post.title)}</h1>
      <div class="article-meta">
        ${formatDate(post.created_at)}
        ${post.keywords ? `<span class="keyword-tag">${escapeHtml(post.keywords)}</span>` : ''}
      </div>
      <div class="article-content">
        ${post.content}
      </div>

      <div class="cta-banner">
        <h3>Generate Content Like This in Seconds</h3>
        <p>ContentAI helps small businesses create professional marketing content with AI. Product descriptions, emails, social posts, and more.</p>
        <a href="/" class="btn btn-primary">Start Free &mdash; 5 Generations</a>
      </div>

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <p style="font-size:14px;color:var(--muted);margin-bottom:12px">Try our free AI tools — no signup required:</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px">
          <a href="/free/product-description-generator" style="font-size:13px;padding:6px 14px;background:var(--surface);border:1px solid var(--border);border-radius:6px">Product Descriptions</a>
          <a href="/free/email-writer" style="font-size:13px;padding:6px 14px;background:var(--surface);border:1px solid var(--border);border-radius:6px">Email Writer</a>
          <a href="/free/social-media-post-generator" style="font-size:13px;padding:6px 14px;background:var(--surface);border:1px solid var(--border);border-radius:6px">Social Media Posts</a>
          <a href="/free/ad-copy-generator" style="font-size:13px;padding:6px 14px;background:var(--surface);border:1px solid var(--border);border-radius:6px">Ad Copy</a>
        </div>
        <p style="font-size:14px;color:var(--muted);margin-bottom:12px">More from the ContentAI blog:</p>
        <a href="/blog" style="font-size:14px">Browse all articles &rarr;</a>
      </div>
    </div>
  `;

  const html = renderBlogPage(
    `${post.title} - ContentAI Blog`,
    post.meta_description || stripHtmlForExcerpt(post.content, 155),
    `${baseUrl}/blog/${post.slug}`,
    'article',
    body
  );

  res.send(html);
});

// ===== FREE TOOL PAGES =====
registerFreeToolRoutes(app);

// ===== SITEMAP =====
app.get('/sitemap.xml', async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const posts = await db.all(
    'SELECT slug, created_at FROM blog_posts WHERE published = 1 ORDER BY created_at DESC'
  );

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/blog</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
`;

  // Free tool pages
  for (const slug of Object.keys(FREE_TOOLS)) {
    xml += `  <url>
    <loc>${baseUrl}/free/${slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
`;
  }

  for (const post of posts) {
    const lastmod = new Date(post.created_at).toISOString().split('T')[0];
    xml += `  <url>
    <loc>${baseUrl}/blog/${post.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
  }

  xml += '</urlset>';

  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type', 'text/plain');
  res.send(`User-agent: *
Allow: /
Allow: /blog
Allow: /free/
Sitemap: ${baseUrl}/sitemap.xml
`);
});

// SPA fallback
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
async function start() {
  await db.initTables();
  await ensureStripePrices();
  app.listen(PORT, () => {
    console.log(`ContentAI running at http://localhost:${PORT}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('⚠ ANTHROPIC_API_KEY not set — generation will fail');
    if (!process.env.STRIPE_SECRET_KEY) console.log('⚠ STRIPE_SECRET_KEY not set — payments disabled');
  });
}

start();
