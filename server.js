require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { v2: cloudinary } = require('cloudinary');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL，請先建立 PostgreSQL 並設定環境變數。');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(requiredRole) {
  return asyncRoute(async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: '未登入' });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      if (requiredRole && req.user.role !== requiredRole) return res.status(403).json({ error: '權限不足' });
      next();
    } catch {
      return res.status(401).json({ error: '登入已失效，請重新登入' });
    }
  });
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name VARCHAR(80) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'player',
      stamps INTEGER NOT NULL DEFAULT 0 CHECK (stamps >= 0),
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lotteries (
      id SERIAL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      banner_url TEXT,
      stamp_cost INTEGER NOT NULL DEFAULT 1 CHECK (stamp_cost > 0),
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      round_no INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS prizes (
      id SERIAL PRIMARY KEY,
      lottery_id INTEGER NOT NULL REFERENCES lotteries(id) ON DELETE CASCADE,
      rank VARCHAR(30) NOT NULL,
      name VARCHAR(120) NOT NULL,
      image_url TEXT,
      initial_quantity INTEGER NOT NULL DEFAULT 1 CHECK (initial_quantity >= 0),
      remaining_quantity INTEGER NOT NULL DEFAULT 1 CHECK (remaining_quantity >= 0),
      is_losing BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS draws (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      lottery_id INTEGER NOT NULL REFERENCES lotteries(id),
      prize_id INTEGER NOT NULL REFERENCES prizes(id),
      round_no INTEGER NOT NULL,
      stamp_cost INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stamp_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      admin_id INTEGER REFERENCES users(id),
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_draws_user ON draws(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_draws_lottery ON draws(lottery_id, round_no, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prizes_lottery ON prizes(lottery_id, sort_order);
  `);

  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminUsername && adminPassword) {
    const found = await pool.query('SELECT id FROM users WHERE username=$1', [adminUsername]);
    if (!found.rowCount) {
      const hash = await bcrypt.hash(adminPassword, 12);
      await pool.query(
        `INSERT INTO users(username,password_hash,display_name,role,stamps)
         VALUES($1,$2,$3,'admin',0)`,
        [adminUsername, hash, '管理員']
      );
      console.log('管理員帳號已建立');
    }
  }
}

async function uploadImage(file) {
  if (!file) return null;
  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error('尚未設定 Cloudinary，無法永久保存圖片');
  if (!file.mimetype.startsWith('image/')) throw new Error('只能上傳圖片');
  return await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'girlfriend-kuji', resource_type: 'image', transformation: [{ quality: 'auto', fetch_format: 'auto' }] },
      (err, result) => err ? reject(err) : resolve(result.secure_url)
    );
    stream.end(file.buffer);
  });
}

app.get('/api/health', (req, res) => res.json({ ok: true, version: '3.0.0' }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  if (String(process.env.ALLOW_REGISTRATION || 'true').toLowerCase() !== 'true') return res.status(403).json({ error: '目前未開放註冊' });
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || username).trim();
  if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: '帳號需為 3～30 位英數字或底線' });
  if (password.length < 6) return res.status(400).json({ error: '密碼至少 6 位' });
  if (!displayName) return res.status(400).json({ error: '請輸入玩家名稱' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      `INSERT INTO users(username,password_hash,display_name,role) VALUES($1,$2,$3,'player') RETURNING id,username,display_name,role,stamps`,
      [username, hash, displayName]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: '帳號已被使用' });
    throw e;
  }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: '帳號或密碼錯誤' });
  res.json({
    token: signToken(user),
    user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, stamps: user.stamps, avatar_url: user.avatar_url }
  });
}));

app.get('/api/me', auth(), asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT id,username,display_name,role,stamps,avatar_url,created_at FROM users WHERE id=$1', [req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: '找不到帳號' });
  res.json(result.rows[0]);
}));

app.patch('/api/me', auth(), asyncRoute(async (req, res) => {
  const displayName = String(req.body.displayName || '').trim();
  if (!displayName || displayName.length > 80) return res.status(400).json({ error: '玩家名稱格式不正確' });
  const result = await pool.query('UPDATE users SET display_name=$1 WHERE id=$2 RETURNING id,username,display_name,role,stamps,avatar_url', [displayName, req.user.id]);
  res.json(result.rows[0]);
}));

app.get('/api/lotteries', asyncRoute(async (req, res) => {
  const statusClause = req.query.all === '1' ? '' : "WHERE l.status='published'";
  const result = await pool.query(`
    SELECT l.*,
      COALESCE(SUM(p.remaining_quantity),0)::int AS remaining_total,
      COALESCE(SUM(p.initial_quantity),0)::int AS initial_total
    FROM lotteries l LEFT JOIN prizes p ON p.lottery_id=l.id
    ${statusClause}
    GROUP BY l.id ORDER BY l.created_at DESC
  `);
  res.json(result.rows);
}));

app.get('/api/lotteries/:id', asyncRoute(async (req, res) => {
  const lottery = await pool.query('SELECT * FROM lotteries WHERE id=$1', [req.params.id]);
  if (!lottery.rowCount) return res.status(404).json({ error: '找不到一番賞' });
  const prizes = await pool.query('SELECT * FROM prizes WHERE lottery_id=$1 ORDER BY sort_order,id', [req.params.id]);
  res.json({ ...lottery.rows[0], prizes: prizes.rows });
}));

app.post('/api/lotteries/:id/draw', auth(), asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lotteryR = await client.query('SELECT * FROM lotteries WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!lotteryR.rowCount || lotteryR.rows[0].status !== 'published') throw Object.assign(new Error('此一番賞目前不可抽'), { status: 400 });
    const lottery = lotteryR.rows[0];
    const userR = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
    const user = userR.rows[0];
    if (!user || user.stamps < lottery.stamp_cost) throw Object.assign(new Error('好寶寶印章不足'), { status: 400 });

    const prizeR = await client.query(`
      SELECT * FROM prizes
      WHERE lottery_id=$1 AND remaining_quantity>0
      ORDER BY random() LIMIT 1 FOR UPDATE
    `, [lottery.id]);
    if (!prizeR.rowCount) throw Object.assign(new Error('此一番賞已抽完'), { status: 400 });
    const prize = prizeR.rows[0];

    await client.query('UPDATE users SET stamps=stamps-$1 WHERE id=$2', [lottery.stamp_cost, user.id]);
    await client.query('UPDATE prizes SET remaining_quantity=remaining_quantity-1 WHERE id=$1', [prize.id]);
    const drawR = await client.query(`
      INSERT INTO draws(user_id,lottery_id,prize_id,round_no,stamp_cost)
      VALUES($1,$2,$3,$4,$5) RETURNING id,created_at
    `, [user.id, lottery.id, prize.id, lottery.round_no, lottery.stamp_cost]);
    await client.query('COMMIT');
    res.json({
      drawId: drawR.rows[0].id,
      createdAt: drawR.rows[0].created_at,
      stampsRemaining: user.stamps - lottery.stamp_cost,
      prize: { id: prize.id, rank: prize.rank, name: prize.name, image_url: prize.image_url, is_losing: prize.is_losing }
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || '抽獎失敗' });
  } finally {
    client.release();
  }
}));

app.get('/api/me/draws', auth(), asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT d.id,d.round_no,d.stamp_cost,d.created_at,l.title,p.rank,p.name,p.image_url,p.is_losing
    FROM draws d JOIN lotteries l ON l.id=d.lottery_id JOIN prizes p ON p.id=d.prize_id
    WHERE d.user_id=$1 ORDER BY d.created_at DESC LIMIT 300
  `, [req.user.id]);
  res.json(result.rows);
}));

app.get('/api/admin/users', auth('admin'), asyncRoute(async (req, res) => {
  const result = await pool.query(`SELECT id,username,display_name,role,stamps,avatar_url,created_at FROM users ORDER BY role DESC,created_at DESC`);
  res.json(result.rows);
}));

app.post('/api/admin/users/:id/stamps', auth('admin'), asyncRoute(async (req, res) => {
  const amount = Number(req.body.amount);
  const reason = String(req.body.reason || '').trim();
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) return res.status(400).json({ error: '印章數量不正確' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userR = await client.query('SELECT stamps FROM users WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!userR.rowCount) throw Object.assign(new Error('找不到玩家'), { status: 404 });
    if (userR.rows[0].stamps + amount < 0) throw Object.assign(new Error('扣除後不能小於 0'), { status: 400 });
    const updated = await client.query('UPDATE users SET stamps=stamps+$1 WHERE id=$2 RETURNING id,stamps', [amount, req.params.id]);
    await client.query('INSERT INTO stamp_logs(user_id,admin_id,amount,reason) VALUES($1,$2,$3,$4)', [req.params.id, req.user.id, amount, reason]);
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message });
  } finally { client.release(); }
}));

app.post('/api/admin/upload', auth('admin'), upload.single('image'), asyncRoute(async (req, res) => {
  const url = await uploadImage(req.file);
  res.json({ url });
}));

app.post('/api/admin/lotteries', auth('admin'), asyncRoute(async (req, res) => {
  const { title, description = '', bannerUrl = null, stampCost = 1, status = 'draft', prizes = [] } = req.body;
  if (!String(title || '').trim()) return res.status(400).json({ error: '請輸入一番賞名稱' });
  if (!Array.isArray(prizes) || !prizes.length) return res.status(400).json({ error: '至少需要一個獎項' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lotteryR = await client.query(`INSERT INTO lotteries(title,description,banner_url,stamp_cost,status) VALUES($1,$2,$3,$4,$5) RETURNING *`, [String(title).trim(), description, bannerUrl, Number(stampCost), status]);
    for (let i = 0; i < prizes.length; i++) {
      const p = prizes[i];
      const qty = Number(p.quantity || 0);
      if (!String(p.rank || '').trim() || !String(p.name || '').trim() || !Number.isInteger(qty) || qty < 0) throw new Error('獎項資料不完整');
      await client.query(`INSERT INTO prizes(lottery_id,rank,name,image_url,initial_quantity,remaining_quantity,is_losing,sort_order) VALUES($1,$2,$3,$4,$5,$5,$6,$7)`, [lotteryR.rows[0].id, String(p.rank).trim(), String(p.name).trim(), p.imageUrl || null, qty, Boolean(p.isLosing), i]);
    }
    await client.query('COMMIT');
    res.status(201).json(lotteryR.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
}));

app.put('/api/admin/lotteries/:id', auth('admin'), asyncRoute(async (req, res) => {
  const { title, description = '', bannerUrl = null, stampCost = 1, status = 'draft', prizes = [] } = req.body;
  if (!String(title || '').trim() || !Array.isArray(prizes) || !prizes.length) return res.status(400).json({ error: '資料不完整' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const drawCount = await client.query('SELECT COUNT(*)::int AS count FROM draws WHERE lottery_id=$1 AND round_no=(SELECT round_no FROM lotteries WHERE id=$1)', [req.params.id]);
    if (drawCount.rows[0].count > 0) {
      const old = await client.query('SELECT id,initial_quantity,remaining_quantity FROM prizes WHERE lottery_id=$1 ORDER BY sort_order,id', [req.params.id]);
      if (old.rows.length !== prizes.length) throw new Error('本輪已開始抽獎，請先重置後再增減獎項');
      for (let i = 0; i < old.rows.length; i++) {
        const consumed = old.rows[i].initial_quantity - old.rows[i].remaining_quantity;
        if (Number(prizes[i].quantity) < consumed) throw new Error('新數量不能少於本輪已抽出的數量');
      }
    }
    await client.query(`UPDATE lotteries SET title=$1,description=$2,banner_url=$3,stamp_cost=$4,status=$5,updated_at=NOW() WHERE id=$6`, [String(title).trim(), description, bannerUrl, Number(stampCost), status, req.params.id]);
    const oldPrizes = await client.query('SELECT * FROM prizes WHERE lottery_id=$1 ORDER BY sort_order,id', [req.params.id]);
    if (drawCount.rows[0].count === 0) await client.query('DELETE FROM prizes WHERE lottery_id=$1', [req.params.id]);
    for (let i = 0; i < prizes.length; i++) {
      const p = prizes[i];
      const qty = Number(p.quantity || 0);
      if (drawCount.rows[0].count === 0) {
        await client.query(`INSERT INTO prizes(lottery_id,rank,name,image_url,initial_quantity,remaining_quantity,is_losing,sort_order) VALUES($1,$2,$3,$4,$5,$5,$6,$7)`, [req.params.id,p.rank,p.name,p.imageUrl||null,qty,Boolean(p.isLosing),i]);
      } else {
        const old = oldPrizes.rows[i];
        const consumed = old.initial_quantity - old.remaining_quantity;
        await client.query(`UPDATE prizes SET rank=$1,name=$2,image_url=$3,initial_quantity=$4,remaining_quantity=$5,is_losing=$6,sort_order=$7 WHERE id=$8`, [p.rank,p.name,p.imageUrl||null,qty,qty-consumed,Boolean(p.isLosing),i,old.id]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
}));

app.post('/api/admin/lotteries/:id/reset', auth('admin'), asyncRoute(async (req, res) => {
  if (String(req.body.confirm || '') !== 'RESET') return res.status(400).json({ error: '請輸入 RESET 確認重置' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('UPDATE lotteries SET round_no=round_no+1,updated_at=NOW() WHERE id=$1 RETURNING round_no', [req.params.id]);
    if (!result.rowCount) throw Object.assign(new Error('找不到一番賞'), { status: 404 });
    await client.query('UPDATE prizes SET remaining_quantity=initial_quantity WHERE lottery_id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true, roundNo: result.rows[0].round_no });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message });
  } finally { client.release(); }
}));

app.delete('/api/admin/lotteries/:id', auth('admin'), asyncRoute(async (req, res) => {
  const count = await pool.query('SELECT COUNT(*)::int AS count FROM draws WHERE lottery_id=$1', [req.params.id]);
  if (count.rows[0].count > 0) return res.status(400).json({ error: '已有抽獎紀錄，請改為下架，不建議刪除' });
  await pool.query('DELETE FROM lotteries WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/admin/logs', auth('admin'), asyncRoute(async (req, res) => {
  const draws = await pool.query(`SELECT d.id,d.round_no,d.stamp_cost,d.created_at,u.display_name,l.title,p.rank,p.name FROM draws d JOIN users u ON u.id=d.user_id JOIN lotteries l ON l.id=d.lottery_id JOIN prizes p ON p.id=d.prize_id ORDER BY d.created_at DESC LIMIT 500`);
  const stamps = await pool.query(`SELECT s.id,s.amount,s.reason,s.created_at,u.display_name,a.display_name AS admin_name FROM stamp_logs s JOIN users u ON u.id=s.user_id LEFT JOIN users a ON a.id=s.admin_id ORDER BY s.created_at DESC LIMIT 500`);
  res.json({ draws: draws.rows, stamps: stamps.rows });
}));

app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);

app.get('/{*splat}', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '伺服器錯誤' });
});

initDb().then(() => app.listen(PORT, () => console.log(`Girlfriend Kuji V3 running on port ${PORT}`))).catch(err => {
  console.error('資料庫初始化失敗', err);
  process.exit(1);
});
