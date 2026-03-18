const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TEMPLATES = {
  'product-description': {
    name: 'Product Description',
    systemPrompt: 'You are an expert e-commerce copywriter. Write compelling, SEO-friendly product descriptions that convert browsers into buyers. Be specific, highlight benefits over features, and use sensory language.',
    userTemplate: (input) => `Write a product description for: ${input.product}\n\nKey details: ${input.details || 'None provided'}\nTone: ${input.tone || 'Professional'}\nLength: ${input.length || 'Medium (150-200 words)'}`,
  },
  'marketing-email': {
    name: 'Marketing Email',
    systemPrompt: 'You are an expert email marketer. Write emails that get opened and drive action. Use proven frameworks (PAS, AIDA). Keep subject lines under 50 characters. Be conversational but professional.',
    userTemplate: (input) => `Write a marketing email for: ${input.purpose}\n\nBusiness: ${input.business || 'Not specified'}\nTarget audience: ${input.audience || 'General'}\nCall to action: ${input.cta || 'Learn more'}\nTone: ${input.tone || 'Professional'}`,
  },
  'social-media': {
    name: 'Social Media Post',
    systemPrompt: 'You are a social media expert. Write posts that drive engagement. Use hooks, create curiosity, and include clear CTAs. Adapt your style to the platform.',
    userTemplate: (input) => `Write a social media post for: ${input.platform || 'Instagram'}\n\nTopic: ${input.topic}\nGoal: ${input.goal || 'Engagement'}\nBrand voice: ${input.tone || 'Casual and friendly'}\nInclude hashtags: ${input.hashtags !== false ? 'Yes' : 'No'}`,
  },
  'ad-copy': {
    name: 'Ad Copy',
    systemPrompt: 'You are a direct response copywriter. Write ad copy that stops the scroll and drives clicks. Use proven formulas (PAS, AIDA, BAB). Be concise and punchy.',
    userTemplate: (input) => `Write ad copy for: ${input.platform || 'Facebook Ads'}\n\nProduct/Service: ${input.product}\nTarget audience: ${input.audience || 'Not specified'}\nUnique selling point: ${input.usp || 'Not specified'}\nGoal: ${input.goal || 'Conversions'}`,
  },
  'blog-post': {
    name: 'Blog Post',
    systemPrompt: 'You are an expert content writer and SEO specialist. Write engaging, well-structured blog posts that rank well and keep readers engaged. Use headers, short paragraphs, and include actionable takeaways.',
    userTemplate: (input) => `Write a blog post about: ${input.topic}\n\nTarget keyword: ${input.keyword || 'Not specified'}\nWord count: ${input.length || '800-1000 words'}\nTone: ${input.tone || 'Informative and engaging'}\nAudience: ${input.audience || 'General'}`,
  },
  'seo-meta': {
    name: 'SEO Meta Tags',
    systemPrompt: 'You are an SEO expert. Write meta titles (under 60 chars) and descriptions (under 160 chars) that maximize click-through rates from search results.',
    userTemplate: (input) => `Write SEO meta tags for a page about: ${input.topic}\n\nTarget keyword: ${input.keyword || 'Not specified'}\nPage type: ${input.pageType || 'Landing page'}`,
  },
};

async function generateContent(type, input) {
  const template = TEMPLATES[type];
  if (!template) throw new Error(`Unknown content type: ${type}`);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: template.systemPrompt,
    messages: [{ role: 'user', content: template.userTemplate(input) }],
  });

  return {
    type,
    typeName: template.name,
    content: message.content[0].text,
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
  };
}

module.exports = { generateContent, TEMPLATES };
