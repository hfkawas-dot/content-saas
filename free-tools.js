const { generateContent } = require('./generate');

// ===== IP-BASED RATE LIMITER (in-memory) =====
const freeUsageMap = new Map(); // key: IP, value: { count, resetDate }

const FREE_LIMIT_PER_DAY = 3;

function getFreeUsage(ip) {
  const today = new Date().toISOString().split('T')[0];
  const entry = freeUsageMap.get(ip);
  if (!entry || entry.resetDate !== today) {
    return { count: 0, resetDate: today };
  }
  return entry;
}

function incrementFreeUsage(ip) {
  const today = new Date().toISOString().split('T')[0];
  const entry = getFreeUsage(ip);
  entry.count += 1;
  entry.resetDate = today;
  freeUsageMap.set(ip, entry);
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || '127.0.0.1';
}

// Cleanup stale entries every hour
setInterval(() => {
  const today = new Date().toISOString().split('T')[0];
  for (const [ip, entry] of freeUsageMap) {
    if (entry.resetDate !== today) {
      freeUsageMap.delete(ip);
    }
  }
}, 60 * 60 * 1000);

// ===== TOOL DEFINITIONS =====
const FREE_TOOLS = {
  'product-description-generator': {
    title: 'Free AI Product Description Generator | ContentAI',
    metaDesc: 'Generate compelling, SEO-optimized product descriptions instantly with AI. Free tool — no signup required. Create descriptions that convert browsers into buyers.',
    heading: 'AI Product Description Generator',
    subheading: 'Create compelling product descriptions that sell. Powered by AI, free to use.',
    generateType: 'product-description',
    fields: [
      { name: 'product', label: 'Product Name', type: 'input', placeholder: 'e.g., Wireless Bluetooth Earbuds Pro', required: true },
      { name: 'details', label: 'Key Features', type: 'textarea', placeholder: 'List key features, materials, specs, benefits...' },
      { name: 'audience', label: 'Target Audience', type: 'input', placeholder: 'e.g., Fitness enthusiasts, busy professionals' },
      { name: 'tone', label: 'Tone', type: 'select', options: ['Professional', 'Casual & Friendly', 'Luxurious & Premium', 'Urgent & Persuasive', 'Fun & Playful'] },
    ],
    buildInput: (body) => ({
      product: body.product || '',
      details: [body.details, body.audience ? `Target audience: ${body.audience}` : ''].filter(Boolean).join('\n'),
      tone: body.tone || 'Professional',
    }),
  },
  'email-writer': {
    title: 'Free AI Marketing Email Writer | ContentAI',
    metaDesc: 'Write high-converting marketing emails in seconds with AI. Free tool — no signup required. Subject lines, body copy, and CTAs that drive results.',
    heading: 'AI Marketing Email Writer',
    subheading: 'Write emails that get opened, read, and clicked. Powered by AI, free to use.',
    generateType: 'marketing-email',
    fields: [
      { name: 'business', label: 'Business Name', type: 'input', placeholder: 'e.g., TechGadgets Inc.', required: true },
      { name: 'purpose', label: 'Email Purpose', type: 'input', placeholder: 'e.g., Product launch announcement, seasonal sale', required: true },
      { name: 'cta', label: 'Key Message / CTA', type: 'input', placeholder: 'e.g., Shop Now, Learn More, Get 20% Off' },
      { name: 'tone', label: 'Tone', type: 'select', options: ['Professional', 'Casual & Friendly', 'Urgent & Persuasive', 'Fun & Playful'] },
    ],
    buildInput: (body) => ({
      purpose: body.purpose || '',
      business: body.business || '',
      audience: 'General',
      cta: body.cta || 'Learn more',
      tone: body.tone || 'Professional',
    }),
  },
  'social-media-post-generator': {
    title: 'Free AI Social Media Post Generator | ContentAI',
    metaDesc: 'Generate engaging social media posts for Instagram, Twitter, LinkedIn, Facebook, and TikTok. Free AI tool — no signup required. Includes hashtags and hooks.',
    heading: 'AI Social Media Post Generator',
    subheading: 'Create scroll-stopping social media posts in seconds. Powered by AI, free to use.',
    generateType: 'social-media',
    fields: [
      { name: 'platform', label: 'Platform', type: 'select', options: ['Instagram', 'Twitter/X', 'LinkedIn', 'Facebook', 'TikTok'], required: true },
      { name: 'topic', label: 'Topic', type: 'input', placeholder: 'e.g., New product launch, behind the scenes, tips', required: true },
      { name: 'tone', label: 'Tone', type: 'select', options: ['Casual & Friendly', 'Professional', 'Fun & Playful', 'Urgent & Persuasive', 'Inspirational'] },
      { name: 'hashtags', label: 'Include Hashtags', type: 'checkbox', checked: true },
    ],
    buildInput: (body) => ({
      platform: body.platform || 'Instagram',
      topic: body.topic || '',
      tone: body.tone || 'Casual and friendly',
      goal: 'Engagement',
      hashtags: body.hashtags !== 'false' && body.hashtags !== false,
    }),
  },
  'ad-copy-generator': {
    title: 'Free AI Ad Copy Generator | ContentAI',
    metaDesc: 'Generate high-converting ad copy for Google, Facebook, and Instagram ads. Free AI tool — no signup required. Write ads that drive clicks and conversions.',
    heading: 'AI Ad Copy Generator',
    subheading: 'Write ad copy that drives clicks and conversions. Powered by AI, free to use.',
    generateType: 'ad-copy',
    fields: [
      { name: 'platform', label: 'Ad Platform', type: 'select', options: ['Google Ads', 'Facebook Ads', 'Instagram Ads'], required: true },
      { name: 'product', label: 'Product / Service', type: 'input', placeholder: 'e.g., Online fitness coaching program', required: true },
      { name: 'audience', label: 'Target Audience', type: 'input', placeholder: 'e.g., Women 25-40 interested in wellness' },
      { name: 'usp', label: 'Call-to-Action / USP', type: 'input', placeholder: 'e.g., Start your free trial, 50% off today' },
    ],
    buildInput: (body) => ({
      platform: body.platform || 'Facebook Ads',
      product: body.product || '',
      audience: body.audience || 'Not specified',
      usp: body.usp || 'Not specified',
      goal: 'Conversions',
    }),
  },
};

// ===== ESCAPE HTML HELPER =====
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== RENDER FREE TOOL PAGE =====
function renderFreeToolPage(tool, slug, baseUrl) {
  const canonical = `${baseUrl}/free/${slug}`;

  const fieldsHtml = tool.fields.map(f => {
    if (f.type === 'select') {
      return `<div class="form-group">
        <label for="field-${f.name}">${escapeHtml(f.label)}</label>
        <select id="field-${f.name}" name="${f.name}"${f.required ? ' required' : ''}>
          ${f.options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
        </select>
      </div>`;
    }
    if (f.type === 'textarea') {
      return `<div class="form-group">
        <label for="field-${f.name}">${escapeHtml(f.label)}</label>
        <textarea id="field-${f.name}" name="${f.name}" placeholder="${escapeHtml(f.placeholder || '')}" rows="3"${f.required ? ' required' : ''}></textarea>
      </div>`;
    }
    if (f.type === 'checkbox') {
      return `<div class="form-group" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="field-${f.name}" name="${f.name}" style="width:auto"${f.checked ? ' checked' : ''}>
        <label for="field-${f.name}" style="margin-bottom:0">${escapeHtml(f.label)}</label>
      </div>`;
    }
    return `<div class="form-group">
      <label for="field-${f.name}">${escapeHtml(f.label)}</label>
      <input type="text" id="field-${f.name}" name="${f.name}" placeholder="${escapeHtml(f.placeholder || '')}"${f.required ? ' required' : ''}>
    </div>`;
  }).join('\n            ');

  // Build JSON-LD structured data
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: tool.heading,
    description: tool.metaDesc,
    url: canonical,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    provider: { '@type': 'Organization', name: 'ContentAI' },
  });

  // All free tool slugs for the sidebar
  const allTools = Object.entries(FREE_TOOLS).filter(([s]) => s !== slug);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(tool.title)}</title>
  <meta name="description" content="${escapeHtml(tool.metaDesc)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${escapeHtml(tool.title)}">
  <meta property="og:description" content="${escapeHtml(tool.metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(tool.title)}">
  <meta name="twitter:description" content="${escapeHtml(tool.metaDesc)}">
  <meta name="robots" content="index, follow">
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0f; --surface: #12121a; --border: #1e1e2e; --text: #e4e4e7;
      --muted: #71717a; --primary: #6366f1; --primary-hover: #818cf8;
      --success: #22c55e; --danger: #ef4444;
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
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover { border-color: var(--primary); }
    .btn-sm { padding: 6px 16px; font-size: 13px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .tool-header { padding: 50px 0 30px; text-align: center; }
    .tool-header h1 { font-size: 36px; font-weight: 800; margin-bottom: 12px; line-height: 1.2; }
    .tool-header h1 em { font-style: normal; background: linear-gradient(135deg, var(--primary), #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .tool-header p { font-size: 18px; color: var(--muted); max-width: 600px; margin: 0 auto; }
    .tool-badge { display: inline-block; background: var(--success); color: #000; font-size: 12px; font-weight: 700; padding: 4px 14px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 0.5px; }

    .tool-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 0 0 60px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 28px; }

    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; font-weight: 500; }
    input, textarea, select {
      width: 100%; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border);
      border-radius: 8px; color: var(--text); font-size: 14px; font-family: inherit;
    }
    input:focus, textarea:focus, select:focus { outline: none; border-color: var(--primary); }
    textarea { resize: vertical; min-height: 80px; }
    input[type="checkbox"] { width: auto; }

    .output-box { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; min-height: 320px; white-space: pre-wrap; font-size: 14px; line-height: 1.8; position: relative; }
    .output-box.empty { color: var(--muted); display: flex; align-items: center; justify-content: center; text-align: center; }
    .copy-btn { position: absolute; top: 10px; right: 10px; }

    .cta-banner { background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(167,139,250,0.1)); border: 1px solid var(--primary); border-radius: 12px; padding: 36px; text-align: center; margin: 0 0 50px; }
    .cta-banner h3 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
    .cta-banner p { font-size: 15px; color: var(--muted); margin-bottom: 18px; max-width: 500px; margin-left: auto; margin-right: auto; }

    .rate-info { font-size: 12px; color: var(--muted); text-align: center; margin-top: 12px; }

    .other-tools { padding: 0 0 60px; }
    .other-tools h2 { font-size: 24px; font-weight: 700; margin-bottom: 20px; text-align: center; }
    .tools-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .tool-card { padding: 22px; transition: border-color 0.2s, transform 0.2s; }
    .tool-card:hover { border-color: var(--primary); transform: translateY(-2px); }
    .tool-card h3 { font-size: 16px; margin-bottom: 6px; }
    .tool-card h3 a { color: var(--text); }
    .tool-card h3 a:hover { color: var(--primary); }
    .tool-card p { font-size: 13px; color: var(--muted); }

    .loading { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .error-msg { color: var(--danger); font-size: 14px; margin-top: 10px; text-align: center; }

    footer { padding: 40px 0; text-align: center; color: var(--muted); font-size: 13px; border-top: 1px solid var(--border); }
    footer a { color: var(--muted); margin: 0 12px; }
    footer a:hover { color: var(--primary); }
    .footer-tools { margin-top: 10px; }
    .footer-tools a { font-size: 12px; margin: 0 8px; }

    @media (max-width: 768px) {
      .tool-layout { grid-template-columns: 1fr; }
      .tool-header h1 { font-size: 26px; }
      .tools-grid { grid-template-columns: 1fr; }
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

  <div class="container">
    <div class="tool-header">
      <div class="tool-badge">100% FREE - NO SIGNUP</div>
      <h1><em>${escapeHtml(tool.heading)}</em></h1>
      <p>${escapeHtml(tool.subheading)}</p>
    </div>

    <div class="tool-layout">
      <div class="card">
        <h3 style="margin-bottom:18px;font-size:17px">Enter Your Details</h3>
        <form id="toolForm" onsubmit="handleGenerate(event)">
          ${fieldsHtml}
          <button type="submit" class="btn btn-primary" style="width:100%;margin-top:8px" id="generateBtn">Generate Now</button>
        </form>
        <div class="rate-info">Free: ${FREE_LIMIT_PER_DAY} generations per day. <a href="/">Sign up</a> for more.</div>
      </div>
      <div class="card">
        <h3 style="margin-bottom:18px;font-size:17px">Generated Content</h3>
        <div class="output-box empty" id="outputBox">
          Your generated content will appear here. Fill in the form and click Generate.
        </div>
        <div id="errorMsg" class="error-msg" style="display:none"></div>
      </div>
    </div>

    <div class="cta-banner">
      <h3>Want Unlimited Generations?</h3>
      <p>Sign up free and get 5 generations, or upgrade to a paid plan for up to unlimited AI content generation with API access.</p>
      <a href="/" class="btn btn-primary">Sign Up Free &mdash; No Credit Card</a>
    </div>

    <div class="other-tools">
      <h2>More Free AI Tools</h2>
      <div class="tools-grid">
        ${allTools.map(([s, t]) => `<div class="card tool-card">
          <h3><a href="/free/${s}">${escapeHtml(t.heading.replace('AI ', ''))}</a></h3>
          <p>${escapeHtml(t.subheading)}</p>
        </div>`).join('\n        ')}
      </div>
    </div>
  </div>

  <footer>
    <div class="container">
      <p>ContentAI &mdash; AI-powered content generation for businesses</p>
      <p style="margin-top:8px">
        <a href="/">Home</a>
        <a href="/blog">Blog</a>
        <a href="/#features">Features</a>
        <a href="/#pricing">Pricing</a>
      </p>
      <p class="footer-tools">
        <a href="/free/product-description-generator">Product Descriptions</a>
        <a href="/free/email-writer">Email Writer</a>
        <a href="/free/social-media-post-generator">Social Media Posts</a>
        <a href="/free/ad-copy-generator">Ad Copy</a>
      </p>
    </div>
  </footer>

  <script>
    const TOOL_TYPE = '${tool.generateType}';
    const TOOL_SLUG = '${slug}';

    async function handleGenerate(e) {
      e.preventDefault();
      const btn = document.getElementById('generateBtn');
      const box = document.getElementById('outputBox');
      const errEl = document.getElementById('errorMsg');

      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span> Generating...';
      box.className = 'output-box empty';
      box.textContent = 'Generating your content...';
      errEl.style.display = 'none';

      // Collect form fields
      const formData = {};
      const form = document.getElementById('toolForm');
      const inputs = form.querySelectorAll('input, textarea, select');
      inputs.forEach(inp => {
        if (inp.type === 'checkbox') {
          formData[inp.name] = inp.checked;
        } else if (inp.name) {
          formData[inp.name] = inp.value;
        }
      });

      try {
        const res = await fetch('/api/free/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: TOOL_SLUG, fields: formData }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Generation failed');
        }
        box.className = 'output-box';
        box.innerHTML = '<button class="btn btn-outline btn-sm copy-btn" onclick="copyOutput()">Copy</button>' +
          document.createElement('div').appendChild(document.createTextNode(data.content)).parentNode.innerHTML;
        box.style.position = 'relative';
      } catch (err) {
        box.className = 'output-box empty';
        box.textContent = 'Generation failed. Please try again.';
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Now';
      }
    }

    function copyOutput() {
      const box = document.getElementById('outputBox');
      const text = box.textContent.replace('Copy', '').trim();
      navigator.clipboard.writeText(text).then(() => {
        const copyBtn = box.querySelector('.copy-btn');
        if (copyBtn) { copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy', 2000); }
      });
    }
  </script>
</body>
</html>`;
}

// ===== REGISTER ROUTES =====
function registerFreeToolRoutes(app) {
  // Serve each free tool page
  for (const [slug, tool] of Object.entries(FREE_TOOLS)) {
    app.get(`/free/${slug}`, (req, res) => {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      res.send(renderFreeToolPage(tool, slug, baseUrl));
    });
  }

  // Free generation API endpoint
  app.post('/api/free/generate', async (req, res) => {
    const ip = getClientIp(req);
    const usage = getFreeUsage(ip);

    if (usage.count >= FREE_LIMIT_PER_DAY) {
      return res.status(429).json({
        error: `Daily free limit reached (${FREE_LIMIT_PER_DAY}/day). Sign up for a free account to get 5 more generations, or upgrade for unlimited access.`,
        limitReached: true,
      });
    }

    const { type, fields } = req.body;
    if (!type || !fields) {
      return res.status(400).json({ error: 'Missing type or fields' });
    }

    const tool = FREE_TOOLS[type];
    if (!tool) {
      return res.status(400).json({ error: 'Unknown tool type' });
    }

    // Build the input using the tool's buildInput function
    const input = tool.buildInput(fields);

    try {
      const result = await generateContent(tool.generateType, input);
      incrementFreeUsage(ip);
      const remaining = FREE_LIMIT_PER_DAY - getFreeUsage(ip).count;
      res.json({
        content: result.content,
        remaining,
      });
    } catch (err) {
      console.error('Free generation error:', err);
      res.status(500).json({ error: 'Failed to generate content. Please try again later.' });
    }
  });
}

module.exports = { registerFreeToolRoutes, FREE_TOOLS };
