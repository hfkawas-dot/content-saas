const db = require('./db');

const PINTEREST_ACCESS_TOKEN = process.env.PINTEREST_ACCESS_TOKEN;
const PINTEREST_BOARD_ID = process.env.PINTEREST_BOARD_ID;

function getBlogPostUrl(blogPostId) {
  if (!blogPostId) return null;
  const post = db.prepare('SELECT slug FROM blog_posts WHERE id = ?').get(blogPostId);
  if (!post) return null;
  const baseUrl = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3001);
  return `${baseUrl}/blog/${post.slug}`;
}

async function pinterestApiRequest(endpoint, method, body) {
  const url = `https://api.pinterest.com/v5${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${PINTEREST_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const errMsg = data.message || data.error || JSON.stringify(data);
    throw new Error(`Pinterest API error (${response.status}): ${errMsg}`);
  }

  return data;
}

async function postNextPin() {
  if (!PINTEREST_ACCESS_TOKEN || !PINTEREST_BOARD_ID) {
    console.warn('Pinterest not configured. Set PINTEREST_ACCESS_TOKEN and PINTEREST_BOARD_ID in .env');
    return { posted: false, message: 'Pinterest not configured' };
  }

  const item = db.prepare(
    "SELECT * FROM marketing_queue WHERE platform = 'pinterest' AND status = 'pending' ORDER BY id ASC LIMIT 1"
  ).get();

  if (!item) {
    return { posted: false, message: 'No pending pins' };
  }

  try {
    let parsed;
    try {
      parsed = JSON.parse(item.content);
    } catch {
      parsed = { title: 'ContentAI', description: item.content };
    }

    const title = parsed.title || 'ContentAI';
    const description = parsed.description || parsed.text || item.content;
    const imageUrl = parsed.image_url || null;

    // Get the blog post link
    const blogUrl = getBlogPostUrl(item.blog_post_id);

    const pinBody = {
      board_id: PINTEREST_BOARD_ID,
      title: title.substring(0, 100), // Pinterest title limit
      description: description.substring(0, 500), // Pinterest description limit
    };

    // Add link to the blog post if available
    if (blogUrl) {
      pinBody.link = blogUrl;
    }

    // Add media source if we have an image URL
    if (imageUrl) {
      pinBody.media_source = {
        source_type: 'image_url',
        url: imageUrl,
      };
    }

    const pin = await pinterestApiRequest('/pins', 'POST', pinBody);

    db.prepare(
      "UPDATE marketing_queue SET status = 'posted', posted_at = CURRENT_TIMESTAMP, external_id = ? WHERE id = ?"
    ).run(pin.id, item.id);

    return { posted: true, pinId: pin.id, title };
  } catch (err) {
    db.prepare(
      "UPDATE marketing_queue SET status = 'failed', error = ? WHERE id = ?"
    ).run(err.message, item.id);

    return { posted: false, error: err.message };
  }
}

module.exports = { postNextPin };
