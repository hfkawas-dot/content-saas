const nodemailer = require('nodemailer');
const db = require('./db');

// Drip email sequence definitions
const DRIP_EMAILS = [
  {
    // Email 1: Sent immediately (0 days after subscribe)
    delayDays: 0,
    subject: "Welcome to ContentAI — Here's what AI can do for your business",
    html: (name, baseUrl) => `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#333">
        <div style="background:#6366f1;padding:24px;text-align:center;border-radius:8px 8px 0 0">
          <h1 style="color:white;margin:0;font-size:24px">Content<span style="opacity:0.9">AI</span></h1>
        </div>
        <div style="padding:32px 24px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
          <h2 style="margin-top:0">Welcome${name ? ', ' + name : ''}!</h2>
          <p>Thanks for signing up. Here is what ContentAI can do for your business:</p>
          <ul style="line-height:1.8">
            <li><strong>Product Descriptions</strong> that convert browsers into buyers</li>
            <li><strong>Marketing Emails</strong> with proven frameworks that get opened</li>
            <li><strong>Social Media Posts</strong> with scroll-stopping hooks and hashtags</li>
            <li><strong>Ad Copy</strong> for Facebook, Google, and Instagram that drives clicks</li>
            <li><strong>Blog Posts</strong> optimized for SEO that rank on Google</li>
            <li><strong>SEO Meta Tags</strong> that maximize your click-through rate</li>
          </ul>
          <p>Every new account starts with <strong>5 free generations</strong> — no credit card required.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${baseUrl}" style="background:#6366f1;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">Try ContentAI Free</a>
          </div>
          <p style="color:#71717a;font-size:13px">Questions? Just reply to this email. We read every message.</p>
        </div>
        <div style="text-align:center;padding:16px;color:#71717a;font-size:12px">
          <p>ContentAI &mdash; AI-powered content generation for businesses</p>
        </div>
      </div>
    `,
  },
  {
    // Email 2: Sent 3 days after subscribe
    delayDays: 3,
    subject: 'See how businesses are saving 10+ hours per week on content',
    html: (name, baseUrl) => `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#333">
        <div style="background:#6366f1;padding:24px;text-align:center;border-radius:8px 8px 0 0">
          <h1 style="color:white;margin:0;font-size:24px">Content<span style="opacity:0.9">AI</span></h1>
        </div>
        <div style="padding:32px 24px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
          <h2 style="margin-top:0">${name ? name + ', ' : ''}businesses are saving 10+ hours per week</h2>
          <p>Small business owners spend an average of <strong>6-10 hours per week</strong> writing content. Product descriptions, emails, social posts, blog articles — it adds up fast.</p>
          <p>With ContentAI, you can generate professional, ready-to-publish content in <strong>seconds</strong> instead of hours:</p>
          <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:20px 0">
            <p style="margin:0 0 8px"><strong>Before ContentAI:</strong> 45 minutes writing one product description</p>
            <p style="margin:0"><strong>After ContentAI:</strong> Professional description in 15 seconds</p>
          </div>
          <p>That is time you could spend growing your business, serving customers, or simply taking a break.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${baseUrl}" style="background:#6366f1;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">See What AI Can Write For You</a>
          </div>
          <p style="color:#71717a;font-size:13px">Have questions? Just reply to this email.</p>
        </div>
        <div style="text-align:center;padding:16px;color:#71717a;font-size:12px">
          <p>ContentAI &mdash; AI-powered content generation for businesses</p>
        </div>
      </div>
    `,
  },
  {
    // Email 3: Sent 7 days after subscribe
    delayDays: 7,
    subject: 'Your free trial is waiting — 5 free generations, no credit card',
    html: (name, baseUrl) => `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#333">
        <div style="background:#6366f1;padding:24px;text-align:center;border-radius:8px 8px 0 0">
          <h1 style="color:white;margin:0;font-size:24px">Content<span style="opacity:0.9">AI</span></h1>
        </div>
        <div style="padding:32px 24px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
          <h2 style="margin-top:0">${name ? name + ', your' : 'Your'} free trial is still waiting</h2>
          <p>We noticed you have not tried ContentAI yet. Your <strong>5 free generations</strong> are still available — no credit card needed, no strings attached.</p>
          <p>Here is what you can create right now:</p>
          <ol style="line-height:2">
            <li>A compelling product description for your best seller</li>
            <li>A marketing email that actually gets opened</li>
            <li>A week of social media posts in under a minute</li>
            <li>Google or Facebook ad copy that converts</li>
            <li>A blog post optimized for SEO</li>
          </ol>
          <p>That is <strong>5 pieces of professional content</strong> you would normally spend hours writing — completely free.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${baseUrl}" style="background:#6366f1;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">Start Your Free Trial Now</a>
          </div>
          <p style="color:#71717a;font-size:13px">This is our last email in this series. If you ever want to give ContentAI a try, your free generations will be waiting.</p>
        </div>
        <div style="text-align:center;padding:16px;color:#71717a;font-size:12px">
          <p>ContentAI &mdash; AI-powered content generation for businesses</p>
        </div>
      </div>
    `,
  },
];

// Create reusable transporter
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

// Send a single email
async function sendEmail(transporter, to, subject, html) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return transporter.sendMail({
    from,
    to,
    subject,
    html,
  });
}

// Process all subscribers and send the next appropriate drip email
async function sendDripEmails() {
  const transporter = createTransporter();
  if (!transporter) {
    return { sent: 0, skipped: 0, error: 'SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env' };
  }

  const baseUrl = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3001);
  const subscribers = await db.all(
    'SELECT * FROM email_subscribers WHERE converted = 0 AND emails_sent_count < $1',
    DRIP_EMAILS.length
  );

  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (const sub of subscribers) {
    const nextEmailIndex = sub.emails_sent_count; // 0-based index
    const dripEmail = DRIP_EMAILS[nextEmailIndex];
    if (!dripEmail) { skipped++; continue; }

    // Check if enough time has passed since subscription
    const subscribedAt = new Date(sub.subscribed_at);
    const now = new Date();
    const daysSinceSubscribe = (now - subscribedAt) / (1000 * 60 * 60 * 24);

    if (daysSinceSubscribe < dripEmail.delayDays) {
      skipped++;
      continue;
    }

    // For emails after the first one, also check time since last email sent
    if (nextEmailIndex > 0 && sub.last_email_sent) {
      const lastSent = new Date(sub.last_email_sent);
      const daysSinceLastEmail = (now - lastSent) / (1000 * 60 * 60 * 24);
      // Require at least 1 day between emails to avoid spamming
      if (daysSinceLastEmail < 1) {
        skipped++;
        continue;
      }
    }

    try {
      const htmlContent = dripEmail.html(sub.name, baseUrl);
      await sendEmail(transporter, sub.email, dripEmail.subject, htmlContent);

      await db.run(
        'UPDATE email_subscribers SET last_email_sent = CURRENT_TIMESTAMP, emails_sent_count = emails_sent_count + 1 WHERE id = $1',
        sub.id
      );

      sent++;
      console.log(`Drip email ${nextEmailIndex + 1} sent to ${sub.email}`);
    } catch (err) {
      errors.push({ email: sub.email, error: err.message });
      console.error(`Failed to send drip email to ${sub.email}:`, err.message);
    }
  }

  return { sent, skipped, totalSubscribers: subscribers.length, errors: errors.length > 0 ? errors : undefined };
}

module.exports = { sendDripEmails, DRIP_EMAILS };
