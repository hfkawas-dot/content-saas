const db = require('./db');

let TwitterApi;
try {
  TwitterApi = require('twitter-api-v2').TwitterApi;
} catch (e) {
  TwitterApi = null;
}

const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;

function getClient() {
  if (!TwitterApi) {
    console.warn('twitter-api-v2 package not installed. Run: npm install twitter-api-v2');
    return null;
  }
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    console.warn('Twitter API credentials not configured. Set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET in .env');
    return null;
  }
  return new TwitterApi({
    appKey: TWITTER_API_KEY,
    appSecret: TWITTER_API_SECRET,
    accessToken: TWITTER_ACCESS_TOKEN,
    accessSecret: TWITTER_ACCESS_SECRET,
  });
}

function getBlogPostUrl(blogPostId) {
  if (!blogPostId) return null;
  const post = db.prepare('SELECT slug FROM blog_posts WHERE id = ?').get(blogPostId);
  if (!post) return null;
  const baseUrl = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3001);
  return `${baseUrl}/blog/${post.slug}`;
}

async function postNextTweet() {
  const client = getClient();
  if (!client) {
    return { posted: false, message: 'Twitter not configured' };
  }

  const item = db.prepare(
    "SELECT * FROM marketing_queue WHERE platform = 'twitter' AND status = 'pending' AND content_type = 'tweet' ORDER BY id ASC LIMIT 1"
  ).get();

  if (!item) {
    return { posted: false, message: 'No pending tweets' };
  }

  try {
    let parsed;
    try {
      parsed = JSON.parse(item.content);
    } catch {
      parsed = { text: item.content };
    }

    let text = parsed.text || parsed.tweet || item.content;

    // Replace URL placeholders with actual blog post URL
    if (item.blog_post_id) {
      const blogUrl = getBlogPostUrl(item.blog_post_id);
      if (blogUrl) {
        text = text.replace(/\{blog_url\}/g, blogUrl);
        text = text.replace(/\{url\}/g, blogUrl);
      }
    }

    const tweet = await client.v2.tweet(text);

    db.prepare(
      "UPDATE marketing_queue SET status = 'posted', posted_at = CURRENT_TIMESTAMP, external_id = ? WHERE id = ?"
    ).run(tweet.data.id, item.id);

    return { posted: true, tweetId: tweet.data.id, text };
  } catch (err) {
    db.prepare(
      "UPDATE marketing_queue SET status = 'failed', error = ? WHERE id = ?"
    ).run(err.message, item.id);

    return { posted: false, error: err.message };
  }
}

async function postNextThread() {
  const client = getClient();
  if (!client) {
    return { posted: false, message: 'Twitter not configured' };
  }

  // Get the first pending thread group (find the oldest parent_id or the oldest thread item)
  const firstItem = db.prepare(
    "SELECT * FROM marketing_queue WHERE platform = 'twitter' AND status = 'pending' AND content_type = 'thread' ORDER BY parent_id ASC, id ASC LIMIT 1"
  ).get();

  if (!firstItem) {
    return { posted: false, message: 'No pending threads' };
  }

  // Get all items in this thread (same parent_id, or if parent_id is null, group by the first item's id)
  const threadParentId = firstItem.parent_id || firstItem.id;
  const threadItems = db.prepare(
    "SELECT * FROM marketing_queue WHERE platform = 'twitter' AND content_type = 'thread' AND status = 'pending' AND (parent_id = ? OR id = ?) ORDER BY id ASC"
  ).all(threadParentId, threadParentId);

  if (threadItems.length === 0) {
    return { posted: false, message: 'No pending threads' };
  }

  const postedIds = [];
  let lastTweetId = null;

  try {
    for (const item of threadItems) {
      let parsed;
      try {
        parsed = JSON.parse(item.content);
      } catch {
        parsed = { text: item.content };
      }

      let text = parsed.text || parsed.tweet || item.content;

      // Replace URL placeholders
      if (item.blog_post_id) {
        const blogUrl = getBlogPostUrl(item.blog_post_id);
        if (blogUrl) {
          text = text.replace(/\{blog_url\}/g, blogUrl);
          text = text.replace(/\{url\}/g, blogUrl);
        }
      }

      const tweetOptions = lastTweetId
        ? { reply: { in_reply_to_tweet_id: lastTweetId } }
        : undefined;

      const tweet = await client.v2.tweet(text, tweetOptions);
      lastTweetId = tweet.data.id;

      db.prepare(
        "UPDATE marketing_queue SET status = 'posted', posted_at = CURRENT_TIMESTAMP, external_id = ? WHERE id = ?"
      ).run(tweet.data.id, item.id);

      postedIds.push(item.id);
    }

    return { posted: true, threadLength: postedIds.length, postedIds };
  } catch (err) {
    // Mark remaining unposted items as failed
    for (const item of threadItems) {
      if (!postedIds.includes(item.id)) {
        db.prepare(
          "UPDATE marketing_queue SET status = 'failed', error = ? WHERE id = ?"
        ).run(err.message, item.id);
      }
    }

    return { posted: false, partiallyPosted: postedIds.length, error: err.message };
  }
}

module.exports = { postNextTweet, postNextThread };
