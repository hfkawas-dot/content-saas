const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex'); // 8 character alphanumeric
}

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = verifyToken(token);
    const user = await db.get('SELECT id, email, name, plan, generations_used, generations_limit, referral_code, referred_by, bonus_generations FROM users WHERE id = $1', decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function register(email, password, name, referralCode) {
  const existing = await db.get('SELECT id FROM users WHERE email = $1', email);
  if (existing) throw new Error('Email already registered');

  const hash = await bcrypt.hash(password, 12);
  // Generate a unique referral code for the new user
  let newReferralCode;
  for (let i = 0; i < 10; i++) {
    const candidate = generateReferralCode();
    const exists = await db.get('SELECT id FROM users WHERE referral_code = $1', candidate);
    if (!exists) { newReferralCode = candidate; break; }
  }
  if (!newReferralCode) throw new Error('Failed to generate referral code, please try again');

  const result = await db.run('INSERT INTO users (email, password_hash, name, referral_code) VALUES ($1, $2, $3, $4) RETURNING id', email, hash, name, newReferralCode);
  const newUserId = result.lastID;

  // Apply referral code if provided
  if (referralCode) {
    const referrer = await db.get('SELECT id FROM users WHERE referral_code = $1', referralCode);
    if (referrer && referrer.id !== newUserId) {
      // Credit both users with 5 bonus generations
      await db.run('UPDATE users SET referred_by = $1, bonus_generations = bonus_generations + 5 WHERE id = $2', referrer.id, newUserId);
      await db.run('UPDATE users SET bonus_generations = bonus_generations + 5 WHERE id = $1', referrer.id);
    }
  }

  const user = await db.get('SELECT id, email, name, plan, generations_used, generations_limit, referral_code, referred_by, bonus_generations FROM users WHERE id = $1', newUserId);
  return { user, token: createToken(user) };
}

async function login(email, password) {
  const user = await db.get('SELECT * FROM users WHERE email = $1', email);
  if (!user) throw new Error('Invalid email or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error('Invalid email or password');

  const safeUser = { id: user.id, email: user.email, name: user.name, plan: user.plan, generations_used: user.generations_used, generations_limit: user.generations_limit, referral_code: user.referral_code, referred_by: user.referred_by, bonus_generations: user.bonus_generations };
  return { user: safeUser, token: createToken(user) };
}

module.exports = { authMiddleware, register, login, createToken };
