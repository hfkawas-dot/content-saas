const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function repurposeBlogPost(blogPost) {
  const { id, title, content, meta_description, keywords } = blogPost;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are an expert social media marketer and content repurposing specialist. You take blog posts and create engaging marketing content for multiple platforms. Always return valid JSON.`,
      messages: [{
        role: 'user',
        content: `Repurpose the following blog post into marketing content for multiple channels.

Blog Title: ${title}
Meta Description: ${meta_description || ''}
Keywords: ${keywords || ''}
Blog Content:
${content}

Return your response in EXACTLY this JSON format (no markdown code fences, just raw JSON):
{
  "tweets": [
    "Tweet 1 text here (under 280 chars, include relevant hashtags, use {{BLOG_URL}} as placeholder for the blog link)",
    "Tweet 2 text here",
    "Tweet 3 text here"
  ],
  "thread": [
    "Thread tweet 1 (hook/intro, under 280 chars)",
    "Thread tweet 2 (key insight, under 280 chars)",
    "Thread tweet 3 (actionable tip, under 280 chars)",
    "Thread tweet 4 (CTA with {{BLOG_URL}} placeholder, under 280 chars)"
  ],
  "video_script": {
    "hook": "Attention-grabbing opening line (5-10 seconds)",
    "scenes": [
      {"text": "Narrator text for scene 1", "overlay": "Text overlay for scene 1"},
      {"text": "Narrator text for scene 2", "overlay": "Text overlay for scene 2"},
      {"text": "Narrator text for scene 3", "overlay": "Text overlay for scene 3"}
    ],
    "cta": "Call to action text"
  },
  "pinterest_description": "Keyword-rich Pinterest pin description under 500 characters with relevant keywords and a call to action"
}

Requirements:
- Each tweet must be under 280 characters including hashtags
- Include 2-3 relevant hashtags per tweet
- Thread should tell a compelling mini-story about the topic
- Video script should be suitable for a 30-60 second marketing video
- Pinterest description should be keyword-rich and actionable
- Use {{BLOG_URL}} as placeholder for the blog post URL`
      }],
    });

    const raw = message.content[0].text.trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse repurposed content as JSON');
      }
    }

    const { tweets, thread, video_script, pinterest_description } = parsed;

    // Insert standalone tweets into marketing_queue
    if (tweets && Array.isArray(tweets)) {
      const insertStmt = db.prepare(
        'INSERT INTO marketing_queue (platform, content_type, content, blog_post_id, status) VALUES (?, ?, ?, ?, ?)'
      );
      for (const tweet of tweets) {
        insertStmt.run('twitter', 'tweet', JSON.stringify({ text: tweet }), id, 'pending');
      }
    }

    // Insert thread tweets into marketing_queue with parent_id linking
    if (thread && Array.isArray(thread) && thread.length > 0) {
      const insertStmt = db.prepare(
        'INSERT INTO marketing_queue (platform, content_type, content, blog_post_id, status, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      );

      // Insert first tweet of thread, get its ID
      const firstResult = db.prepare(
        'INSERT INTO marketing_queue (platform, content_type, content, blog_post_id, status) VALUES (?, ?, ?, ?, ?)'
      ).run('twitter', 'thread', JSON.stringify({ text: thread[0], position: 1 }), id, 'pending');

      const parentId = firstResult.lastInsertRowid;

      // Insert remaining thread tweets linked to the first
      for (let i = 1; i < thread.length; i++) {
        insertStmt.run(
          'twitter', 'thread',
          JSON.stringify({ text: thread[i], position: i + 1 }),
          id, 'pending', parentId
        );
      }
    }

    // Insert Pinterest pin into marketing_queue
    if (pinterest_description) {
      db.prepare(
        'INSERT INTO marketing_queue (platform, content_type, content, blog_post_id, status) VALUES (?, ?, ?, ?, ?)'
      ).run('pinterest', 'pin', JSON.stringify({ title, description: pinterest_description }), id, 'pending');
    }

    console.log(`[content-repurposer] Repurposed blog post "${title}" (id=${id}) into marketing content`);

    // Return video_script for downstream use (e.g., video-generator)
    return { video_script };

  } catch (err) {
    console.error(`[content-repurposer] Error repurposing blog post "${title}" (id=${id}):`, err.message);
    return null;
  }
}

module.exports = { repurposeBlogPost };
