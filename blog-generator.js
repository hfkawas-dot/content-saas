const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');
const { repurposeBlogPost } = require('./content-repurposer');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 50+ SEO keywords related to content generation, copywriting, marketing
const SEO_KEYWORDS = [
  // Content generation & AI writing
  'ai content generation for small business',
  'automated copywriting tools',
  'ai product description generator',
  'how to write product descriptions with ai',
  'best ai writing tools for ecommerce',
  'ai powered content marketing',
  'automated blog writing for business',
  'ai email marketing copy generator',
  'machine learning content creation',
  'generative ai for marketing teams',

  // Copywriting & product descriptions
  'how to write compelling product descriptions',
  'ecommerce copywriting tips',
  'product description best practices',
  'converting product descriptions that sell',
  'seo product description writing guide',
  'product listing optimization tips',
  'how to write amazon product listings',
  'product copy that increases conversions',
  'writing product descriptions for online stores',
  'ecommerce content strategy guide',

  // Marketing emails
  'email marketing copywriting tips',
  'how to write marketing emails that convert',
  'email subject line best practices',
  'automated email marketing campaigns',
  'email marketing for small business owners',
  'cold email copywriting strategies',
  'email newsletter content ideas',
  'how to improve email open rates',
  'welcome email sequence best practices',
  'abandoned cart email copywriting',

  // Social media content
  'social media content creation tips',
  'how to write engaging social media posts',
  'instagram caption writing guide',
  'linkedin content strategy for business',
  'social media copywriting formulas',
  'tiktok content ideas for brands',
  'social media content calendar planning',
  'how to increase social media engagement',
  'writing viral social media content',
  'social media marketing for startups',

  // Ad copy & paid marketing
  'facebook ad copy best practices',
  'google ads copywriting tips',
  'how to write converting ad headlines',
  'ppc ad copy optimization guide',
  'instagram ad copywriting strategies',
  'retargeting ad copy examples',
  'a b testing ad copy effectively',
  'writing ad copy for different platforms',
  'direct response copywriting techniques',
  'ad copy frameworks that convert',

  // SEO & content marketing
  'seo content writing best practices',
  'how to write seo friendly blog posts',
  'content marketing strategy for 2025',
  'keyword research for content creators',
  'long form content vs short form content',
  'content repurposing strategies',
  'blogging for business growth',
  'how to create a content marketing funnel',
  'seo meta description writing tips',
  'pillar content strategy guide',

  // General marketing & business
  'small business marketing automation',
  'brand voice development guide',
  'how to create a brand messaging framework',
  'content personalization strategies',
  'marketing roi measurement guide',
  'customer journey content mapping',
  'b2b content marketing strategies',
  'startup marketing on a budget',
  'scaling content production efficiently',
  'ai tools for digital marketing',
];

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 120);
}

async function getUsedKeywords() {
  const rows = await db.all('SELECT keywords FROM blog_posts');
  return rows.map(r => r.keywords).filter(Boolean);
}

async function pickUnusedKeyword() {
  const used = await getUsedKeywords();
  const unused = SEO_KEYWORDS.filter(kw => !used.includes(kw));
  if (unused.length === 0) {
    // All keywords used; pick a random one to reuse
    return SEO_KEYWORDS[Math.floor(Math.random() * SEO_KEYWORDS.length)];
  }
  return unused[Math.floor(Math.random() * unused.length)];
}

async function generateBlogPost(keyword) {
  if (!keyword) {
    keyword = await pickUnusedKeyword();
  }

  const systemPrompt = `You are an expert SEO content writer and digital marketing specialist. You write in-depth, helpful, well-structured blog posts that rank well on Google and provide genuine value to readers. Your articles are informative, actionable, and well-organized with clear headings and subheadings.

You write for ContentAI, an AI-powered content generation platform that helps small businesses create professional marketing content.

IMPORTANT FORMATTING RULES:
- Write in clean HTML using <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em> tags
- Do NOT use <h1> (the page template handles the title)
- Use short paragraphs (2-3 sentences max)
- Include subheadings every 2-3 paragraphs
- Naturally incorporate the target keyword 3-5 times
- Write between 800 and 1200 words
- End with a brief conclusion paragraph`;

  const userPrompt = `Write a comprehensive SEO blog article targeting the keyword: "${keyword}"

The article should:
1. Have an engaging, SEO-optimized title (include the keyword naturally)
2. Open with a compelling introduction that hooks the reader
3. Cover the topic thoroughly with practical advice and actionable tips
4. Use real-world examples where appropriate
5. Include a clear conclusion with a takeaway

Return your response in EXACTLY this JSON format (no markdown code fences, just raw JSON):
{
  "title": "The Article Title Here",
  "content": "<h2>First Section</h2><p>Content here...</p>...",
  "meta_description": "A compelling 150-character meta description with the keyword."
}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = message.content[0].text.trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Failed to parse blog post response as JSON');
    }
  }

  const { title, content, meta_description } = parsed;
  const slug = slugify(title);

  // Check for duplicate slug
  const existing = await db.get('SELECT id FROM blog_posts WHERE slug = $1', slug);
  const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

  const result = await db.run(
    'INSERT INTO blog_posts (title, slug, content, meta_description, keywords, published) VALUES ($1, $2, $3, $4, $5, 1)',
    title, finalSlug, content, meta_description, keyword
  );

  const postData = {
    id: result.lastID,
    title,
    slug: finalSlug,
    content,
    meta_description,
    keywords: keyword,
  };

  // Fire-and-forget: repurpose blog post into marketing content
  try {
    repurposeBlogPost(postData).catch(err => {
      console.error('[blog-generator] Repurposing failed:', err.message);
    });
  } catch (err) {
    console.error('[blog-generator] Error starting repurposing:', err.message);
  }

  return {
    id: postData.id,
    title,
    slug: finalSlug,
    meta_description,
    keyword,
  };
}

module.exports = { generateBlogPost, pickUnusedKeyword, SEO_KEYWORDS };
