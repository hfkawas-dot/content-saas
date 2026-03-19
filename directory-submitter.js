const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DIRECTORIES = [
  {
    name: 'Product Hunt',
    fields: ['name', 'tagline', 'description', 'topics'],
  },
  {
    name: 'BetaList',
    fields: ['name', 'url', 'tagline', 'email'],
  },
  {
    name: 'AlternativeTo',
    fields: ['name', 'url', 'description', 'category'],
  },
  {
    name: 'SaaSHub',
    fields: ['name', 'url', 'description', 'category', 'pricing'],
  },
  {
    name: "There's An AI For That",
    fields: ['name', 'url', 'description', 'category'],
  },
  {
    name: 'Toolify.ai',
    fields: ['name', 'url', 'description'],
  },
];

async function generateSubmissions() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set -- cannot generate directory submissions');
    return { submissions: [], error: 'Anthropic API key not configured' };
  }

  const directoryList = DIRECTORIES.map(d =>
    `- ${d.name}: needs ${d.fields.join(', ')}`
  ).join('\n');

  const prompt = `Generate optimized submission text for ContentAI to be listed on the following SaaS directories.

About ContentAI:
- AI-powered content generation platform for small businesses
- Generates product descriptions, marketing emails, social media posts, ad copy, blog posts, and SEO meta tags
- Uses advanced AI (Claude) to create professional, ready-to-publish content in seconds
- Free tier: 5 generations, no credit card required
- Pro plan: $29/month for 100 generations
- URL: https://contentai.app
- Key benefits: saves 10+ hours/week on content creation, conversion-optimized copy, multiple content types in one tool

Directories and their required fields:
${directoryList}

For each directory, tailor the tone and content to what performs best on that platform. For example:
- Product Hunt: exciting, launch-focused, emphasize what's new and innovative
- BetaList: concise, early-adopter focused
- AlternativeTo: comparison-focused, highlight what makes it different from competitors like Jasper, Copy.ai
- SaaSHub: professional, feature-rich description
- There's An AI For That: AI-capabilities focused
- Toolify.ai: tool-focused, practical description

Return a JSON array where each element has:
- "directory": the directory name
- "content": an object with each required field filled in

Return ONLY valid JSON, no markdown formatting or code blocks.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const text = response.content[0].text.trim();

    // Try to parse JSON from the response, handling possible markdown wrapping
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try extracting JSON from markdown code block
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        throw new Error('Failed to parse AI response as JSON');
      }
    }

    // Normalize to array of {directory, content}
    const submissions = Array.isArray(parsed) ? parsed : [];

    return { submissions };
  } catch (err) {
    console.error('Directory submission generation error:', err.message);
    return { submissions: [], error: err.message };
  }
}

module.exports = { generateSubmissions, DIRECTORIES };
