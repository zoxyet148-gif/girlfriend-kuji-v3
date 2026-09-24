require('dotenv').config();
const express=require('express');const path=require('path');const crypto=require('crypto');const multer=require('multer');const bcrypt=require('bcryptjs');const jwt=require('jsonwebtoken');const {Pool}=require('pg');const {v2:cloudinary}=require('cloudinary');
const app=express(),PORT=Number(process.env.PORT||10000),JWT_SECRET=process.env.JWT_SECRET||'dev-only-change-this-secret';
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024}});
if(!process.env.DATABASE_URL){console.error('缺少 DATABASE_URL');process.exit(1)}
const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false
});
if(process.env.CLOUDINARY_CLOUD_NAME&&process.env.CLOUDINARY_API_KEY&&process.env.CLOUDINARY_API_SECRET)cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET});
app.use(express.json({limit:'4mb'}));app.use(express.urlencoded({extended:true}));app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});app.use(express.static(path.join(__dirname,'public')));
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const signToken=u=>jwt.sign({id:u.id,role:u.role,username:u.username},JWT_SECRET,{expiresIn:'30d'});
function auth(role){return asyncRoute(async(req,res,next)=>{const h=req.headers.authorization||'',t=h.startsWith('Bearer ')?h.slice(7):'';if(!t)return res.status(401).json({error:'未登入'});try{req.user=jwt.verify(t,JWT_SECRET);if(role&&req.user.role!==role)return res.status(403).json({error:'權限不足'});next()}catch{return res.status(401).json({error:'登入已失效，請重新登入'})}})}
function optionalAuth(req,res,next){const h=req.headers.authorization||'',t=h.startsWith('Bearer ')?h.slice(7):'';if(!t)return next();try{req.user=jwt.verify(t,JWT_SECRET)}catch{}next()}
async function initDb(){
await pool.query(`
SET search_path TO public;
CREATE TABLE IF NOT EXISTS public.users(id SERIAL PRIMARY KEY,username VARCHAR(50) UNIQUE NOT NULL,password_hash TEXT NOT NULL,display_name VARCHAR(80) NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'player',stamps INTEGER NOT NULL DEFAULT 0 CHECK(stamps>=0),avatar_url TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.lotteries(id SERIAL PRIMARY KEY,title VARCHAR(120) NOT NULL,description TEXT NOT NULL DEFAULT '',banner_url TEXT,stamp_cost INTEGER NOT NULL DEFAULT 1 CHECK(stamp_cost>0),status VARCHAR(20) NOT NULL DEFAULT 'draft',round_no INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.prizes(id SERIAL PRIMARY KEY,lottery_id INTEGER NOT NULL REFERENCES public.lotteries(id) ON DELETE CASCADE,rank VARCHAR(30) NOT NULL,name VARCHAR(120) NOT NULL,image_url TEXT,initial_quantity INTEGER NOT NULL DEFAULT 1 CHECK(initial_quantity>=0),remaining_quantity INTEGER NOT NULL DEFAULT 1 CHECK(remaining_quantity>=0),is_losing BOOLEAN NOT NULL DEFAULT FALSE,effect VARCHAR(20) NOT NULL DEFAULT 'none',sort_order INTEGER NOT NULL DEFAULT 0);
ALTER TABLE public.prizes ADD COLUMN IF NOT EXISTS effect VARCHAR(20) NOT NULL DEFAULT 'none';
ALTER TABLE public.prizes ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS public.draws(id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES public.users(id),lottery_id INTEGER NOT NULL REFERENCES public.lotteries(id),prize_id INTEGER NOT NULL REFERENCES public.prizes(id),round_no INTEGER NOT NULL,stamp_cost INTEGER NOT NULL,ticket_number INTEGER,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE public.draws ADD COLUMN IF NOT EXISTS ticket_number INTEGER;
CREATE TABLE IF NOT EXISTS public.lottery_tickets(id BIGSERIAL PRIMARY KEY,lottery_id INTEGER NOT NULL REFERENCES public.lotteries(id) ON DELETE CASCADE,round_no INTEGER NOT NULL,ticket_number INTEGER NOT NULL,prize_id INTEGER NOT NULL REFERENCES public.prizes(id) ON DELETE CASCADE,is_drawn BOOLEAN NOT NULL DEFAULT FALSE,drawn_by INTEGER REFERENCES public.users(id),drawn_at TIMESTAMPTZ,UNIQUE(lottery_id,round_no,ticket_number));
CREATE TABLE IF NOT EXISTS public.stamp_logs(id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES public.users(id),admin_id INTEGER REFERENCES public.users(id),amount INTEGER NOT NULL,reason TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS public.prize_redemptions(id BIGSERIAL PRIMARY KEY,draw_id BIGINT UNIQUE REFERENCES public.draws(id) ON DELETE SET NULL,user_id INTEGER NOT NULL REFERENCES public.users(id),redeemed BOOLEAN NOT NULL DEFAULT FALSE,redeemed_at TIMESTAMPTZ,redeemed_by INTEGER REFERENCES public.users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);

const rewardColumns=[
  ['lottery_title','TEXT'],
  ['round_no','INTEGER'],
  ['ticket_number','INTEGER'],
  ['prize_rank','VARCHAR(50)'],
  ['prize_name','VARCHAR(200)'],
  ['prize_image_url','TEXT'],
  ['draw_created_at','TIMESTAMPTZ']
];
for(const [name,type] of rewardColumns){
  await pool.query(`ALTER TABLE public.prize_redemptions ADD COLUMN IF NOT EXISTS ${name} ${type}`);
}

// Make draw_id optional and keep the reward snapshot if its original draw is deleted.
await pool.query('ALTER TABLE public.prize_redemptions ALTER COLUMN draw_id DROP NOT NULL');
const fk=(await pool.query(`
  SELECT c.conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='prize_redemptions'
    AND c.contype='f'
    AND pg_get_constraintdef(c.oid) ILIKE 'FOREIGN KEY (draw_id)%'
`)).rows;
for(const x of fk)await pool.query(`ALTER TABLE public.prize_redemptions DROP CONSTRAINT IF EXISTS "${String(x.conname).replace(/"/g,'""')}"`);
await pool.query(`ALTER TABLE public.prize_redemptions ADD CONSTRAINT prize_redemptions_draw_id_fkey FOREIGN KEY(draw_id) REFERENCES public.draws(id) ON DELETE SET NULL`);

await pool.query('CREATE INDEX IF NOT EXISTS idx_tickets_round ON public.lottery_tickets(lottery_id,round_no,ticket_number)');
await pool.query('CREATE INDEX IF NOT EXISTS idx_draws_user ON public.draws(user_id,created_at DESC)');
await pool.query('CREATE INDEX IF NOT EXISTS idx_redemptions_user ON public.prize_redemptions(user_id,redeemed,created_at DESC)');

// Create missing reward rows from still-existing winning draws.
await pool.query(`
INSERT INTO public.prize_redemptions(draw_id,user_id,lottery_title,round_no,ticket_number,prize_rank,prize_name,prize_image_url,draw_created_at)
SELECT d.id,d.user_id,l.title,d.round_no,d.ticket_number,p.rank,p.name,p.image_url,d.created_at
FROM public.draws d
JOIN public.prizes p ON p.id=d.prize_id
JOIN public.lotteries l ON l.id=d.lottery_id
WHERE NOT p.is_losing
ON CONFLICT(draw_id) DO NOTHING
`);

// Fill snapshot fields for all older reward rows whose source draw still exists.
await pool.query(`
UPDATE public.prize_redemptions r SET
  lottery_title=COALESCE(r.lottery_title,l.title),
  round_no=COALESCE(r.round_no,d.round_no),
  ticket_number=COALESCE(r.ticket_number,d.ticket_number),
  prize_rank=COALESCE(r.prize_rank,p.rank),
  prize_name=COALESCE(r.prize_name,p.name),
  prize_image_url=COALESCE(r.prize_image_url,p.image_url),
  draw_created_at=COALESCE(r.draw_created_at,d.created_at)
FROM public.draws d
JOIN public.prizes p ON p.id=d.prize_id
JOIN public.lotteries l ON l.id=d.lottery_id
WHERE r.draw_id=d.id
`);

const au=process.env.ADMIN_USERNAME,ap=process.env.ADMIN_PASSWORD;
if(au&&ap){
  const hash=await bcrypt.hash(ap,12);
  const f=await pool.query('SELECT id,role FROM public.users WHERE username=$1',[au]);
  if(!f.rowCount){
    await pool.query("INSERT INTO users(username,password_hash,display_name,role,stamps) VALUES($1,$2,'管理員','admin',0)",[au,hash]);
    console.log('管理員帳號已建立')
  }else{
    await pool.query("UPDATE users SET password_hash=$1,role='admin' WHERE username=$2",[hash,au]);
    console.log('管理員帳號已同步')
  }
}
console.log('獎品快照資料表已檢查並完成遷移');
}
async function uploadImage(file){if(!file)return null;if(!process.env.CLOUDINARY_CLOUD_NAME)throw new Error('尚未設定 Cloudinary');if(!file.mimetype.startsWith('image/'))throw new Error('只能上傳圖片');return new Promise((resolve,reject)=>{const s=cloudinary.uploader.upload_stream({folder:'girlfriend-kuji',resource_type:'image',transformation:[{quality:'auto',fetch_format:'auto'}]},(e,r)=>e?reject(e):resolve(r.secure_url));s.end(file.buffer)})}
async function generateTickets(client,lotteryId,roundNo){await client.query('DELETE FROM lottery_tickets WHERE lottery_id=$1 AND round_no=$2',[lotteryId,roundNo]);const ps=(await client.query('SELECT id,initial_quantity FROM prizes WHERE lottery_id=$1 AND active=TRUE ORDER BY sort_order,id',[lotteryId])).rows;const bag=[];for(const p of ps)for(let i=0;i<p.initial_quantity;i++)bag.push(p.id);for(let i=bag.length-1;i>0;i--){const j=crypto.randomInt(i+1);[bag[i],bag[j]]=[bag[j],bag[i]]}for(let i=0;i<bag.length;i++)await client.query('INSERT INTO lottery_tickets(lottery_id,round_no,ticket_number,prize_id) VALUES($1,$2,$3,$4)',[lotteryId,roundNo,i+1,bag[i]]);return bag.length}
app.get('/api/health',(req,res)=>res.json({ok:true,version:'4.2.7-new-reward-sync-fix'}));
app.post('/api/auth/register',asyncRoute(async(req,res)=>{if(String(process.env.ALLOW_REGISTRATION||'true').toLowerCase()!=='true')return res.status(403).json({error:'目前未開放註冊'});const username=String(req.body.username||'').trim(),password=String(req.body.password||''),displayName=String(req.body.displayName||username).trim();if(!/^[A-Za-z0-9_]{3,30}$/.test(username))return res.status(400).json({error:'帳號需為 3～30 位英數字或底線'});if(password.length<6)return res.status(400).json({error:'密碼至少 6 位'});const hash=await bcrypt.hash(password,12);try{const r=await pool.query("INSERT INTO users(username,password_hash,display_name,role) VALUES($1,$2,$3,'player') RETURNING id,username,display_name,role,stamps",[username,hash,displayName]);res.status(201).json({token:signToken(r.rows[0]),user:r.rows[0]})}catch(e){if(e.code==='23505')return res.status(409).json({error:'帳號已被使用'});throw e}}));
app.post('/api/auth/login',asyncRoute(async(req,res)=>{const r=await pool.query('SELECT * FROM users WHERE username=$1',[String(req.body.username||'').trim()]),u=r.rows[0];if(!u||!(await bcrypt.compare(String(req.body.password||''),u.password_hash)))return res.status(401).json({error:'帳號或密碼錯誤'});res.json({token:signToken(u),user:{id:u.id,username:u.username,display_name:u.display_name,role:u.role,stamps:u.stamps,avatar_url:u.avatar_url}})}));
app.get('/api/me',auth(),asyncRoute(async(req,res)=>{const r=await pool.query('SELECT id,username,display_name,role,stamps,avatar_url,created_at FROM users WHERE id=$1',[req.user.id]);res.json(r.rows[0])}));
app.patch('/api/me',auth(),asyncRoute(async(req,res)=>{const n=String(req.body.displayName||'').trim();if(!n)return res.status(400).json({error:'名稱不能空白'});const r=await pool.query('UPDATE users SET display_name=$1 WHERE id=$2 RETURNING id,username,display_name,role,stamps,avatar_url',[n,req.user.id]);res.json(r.rows[0])}));
app.get('/api/lotteries',optionalAuth,asyncRoute(async(req,res)=>{const wantsAll=req.query.all==='1';if(wantsAll&&req.user?.role!=='admin')return res.status(403).json({error:'權限不足'});const where=wantsAll?'':"WHERE l.status='published'";const r=await pool.query(`SELECT l.*,CASE WHEN (SELECT COUNT(*) FROM lottery_tickets t WHERE t.lottery_id=l.id AND t.round_no=l.round_no)>0 THEN (SELECT COUNT(*) FROM lottery_tickets t WHERE t.lottery_id=l.id AND t.round_no=l.round_no AND NOT t.is_drawn) ELSE COALESCE(SUM(p.remaining_quantity),0) END::int remaining_total,CASE WHEN (SELECT COUNT(*) FROM lottery_tickets t WHERE t.lottery_id=l.id AND t.round_no=l.round_no)>0 THEN (SELECT COUNT(*) FROM lottery_tickets t WHERE t.lottery_id=l.id AND t.round_no=l.round_no) ELSE COALESCE(SUM(p.initial_quantity),0) END::int initial_total FROM lotteries l LEFT JOIN prizes p ON p.lottery_id=l.id AND p.active=TRUE ${where} GROUP BY l.id ORDER BY l.created_at DESC`);res.json(r.rows)}));
app.get('/api/lotteries/:id',optionalAuth,asyncRoute(async(req,res)=>{const lr=await pool.query('SELECT * FROM lotteries WHERE id=$1',[req.params.id]);if(!lr.rowCount)return res.status(404).json({error:'找不到一番賞'});const l=lr.rows[0];if(l.status!=='published'&&req.user?.role!=='admin')return res.status(404).json({error:'找不到一番賞'});const ps=await pool.query('SELECT * FROM prizes WHERE lottery_id=$1 AND active=TRUE ORDER BY sort_order,id',[l.id]);let ts=await pool.query('SELECT ticket_number,is_drawn FROM lottery_tickets WHERE lottery_id=$1 AND round_no=$2 ORDER BY ticket_number',[l.id,l.round_no]);if(!ts.rowCount&&ps.rows.reduce((s,p)=>s+p.initial_quantity,0)>0){const c=await pool.connect();try{await c.query('BEGIN');await generateTickets(c,l.id,l.round_no);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}ts=await pool.query('SELECT ticket_number,is_drawn FROM lottery_tickets WHERE lottery_id=$1 AND round_no=$2 ORDER BY ticket_number',[l.id,l.round_no])}res.json({...l,prizes:ps.rows,tickets:ts.rows})}));
app.post('/api/lotteries/:id/draw',auth(),asyncRoute(async(req,res)=>{const ticketNumber=Number(req.body.ticketNumber);if(!Number.isInteger(ticketNumber)||ticketNumber<1)return res.status(400).json({error:'請先選擇號碼'});const c=await pool.connect();try{await c.query('BEGIN');const lr=await c.query('SELECT * FROM lotteries WHERE id=$1 FOR UPDATE',[req.params.id]);if(!lr.rowCount||lr.rows[0].status!=='published')throw Object.assign(new Error('此一番賞目前不可抽'),{status:400});const l=lr.rows[0],ur=await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id]),u=ur.rows[0];if(u.stamps<l.stamp_cost)throw Object.assign(new Error('好寶寶印章不足'),{status:400});let tr=await c.query(`SELECT t.*,p.rank,p.name,p.image_url,p.is_losing,p.effect FROM lottery_tickets t JOIN prizes p ON p.id=t.prize_id WHERE t.lottery_id=$1 AND t.round_no=$2 AND t.ticket_number=$3 FOR UPDATE`,[l.id,l.round_no,ticketNumber]);if(!tr.rowCount)throw Object.assign(new Error('找不到這張籤'),{status:404});const t=tr.rows[0];if(t.is_drawn)throw Object.assign(new Error('這個號碼已經被抽走了'),{status:409});await c.query('UPDATE users SET stamps=stamps-$1 WHERE id=$2',[l.stamp_cost,u.id]);await c.query('UPDATE prizes SET remaining_quantity=GREATEST(remaining_quantity-1,0) WHERE id=$1',[t.prize_id]);await c.query('UPDATE lottery_tickets SET is_drawn=TRUE,drawn_by=$1,drawn_at=NOW() WHERE id=$2',[u.id,t.id]);const dr=await c.query('INSERT INTO draws(user_id,lottery_id,prize_id,round_no,stamp_cost,ticket_number) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at',[u.id,l.id,t.prize_id,l.round_no,l.stamp_cost,ticketNumber]);if(!t.is_losing)await c.query(`INSERT INTO public.prize_redemptions
(draw_id,user_id,lottery_title,round_no,ticket_number,prize_rank,prize_name,prize_image_url,draw_created_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT(draw_id) DO UPDATE SET
lottery_title=COALESCE(public.prize_redemptions.lottery_title,EXCLUDED.lottery_title),
round_no=COALESCE(public.prize_redemptions.round_no,EXCLUDED.round_no),
ticket_number=COALESCE(public.prize_redemptions.ticket_number,EXCLUDED.ticket_number),
prize_rank=COALESCE(public.prize_redemptions.prize_rank,EXCLUDED.prize_rank),
prize_name=COALESCE(public.prize_redemptions.prize_name,EXCLUDED.prize_name),
prize_image_url=COALESCE(public.prize_redemptions.prize_image_url,EXCLUDED.prize_image_url),
draw_created_at=COALESCE(public.prize_redemptions.draw_created_at,EXCLUDED.draw_created_at)`,
[dr.rows[0].id,u.id,l.title,l.round_no,ticketNumber,t.rank,t.name,t.image_url,dr.rows[0].created_at]);const rem=(await c.query('SELECT COUNT(*)::int n FROM lottery_tickets WHERE lottery_id=$1 AND round_no=$2 AND NOT is_drawn',[l.id,l.round_no])).rows[0].n;await c.query('COMMIT');res.json({drawId:dr.rows[0].id,createdAt:dr.rows[0].created_at,ticketNumber,remainingTickets:rem,stampsRemaining:u.stamps-l.stamp_cost,prize:{id:t.prize_id,rank:t.rank,name:t.name,image_url:t.image_url,is_losing:t.is_losing,effect:t.effect||'none'}})}catch(e){await c.query('ROLLBACK');res.status(e.status||500).json({error:e.message||'抽獎失敗'})}finally{c.release()}}));
app.get('/api/me/draws',auth(),asyncRoute(async(req,res)=>{const r=await pool.query('SELECT d.id,d.round_no,d.stamp_cost,d.ticket_number,d.created_at,l.title,p.rank,p.name,p.image_url,p.is_losing FROM draws d JOIN lotteries l ON l.id=d.lottery_id JOIN prizes p ON p.id=d.prize_id WHERE d.user_id=$1 ORDER BY d.created_at DESC LIMIT 300',[req.user.id]);res.json(r.rows)}));
app.get('/api/me/rewards',auth(),asyncRoute(async(req,res)=>{
await pool.query(`UPDATE public.prize_redemptions r SET
lottery_title=COALESCE(r.lottery_title,l.title),round_no=COALESCE(r.round_no,d.round_no),
ticket_number=COALESCE(r.ticket_number,d.ticket_number),prize_rank=COALESCE(r.prize_rank,p.rank),
prize_name=COALESCE(r.prize_name,p.name),prize_image_url=COALESCE(r.prize_image_url,p.image_url),
draw_created_at=COALESCE(r.draw_created_at,d.created_at)
FROM public.draws d JOIN public.prizes p ON p.id=d.prize_id JOIN public.lotteries l ON l.id=d.lottery_id
WHERE r.draw_id=d.id AND r.user_id=$1 AND (r.prize_name IS NULL OR r.lottery_title IS NULL OR r.draw_created_at IS NULL)`,[req.user.id]);
const r=await pool.query(`SELECT r.id redemption_id,r.redeemed,r.redeemed_at,r.created_at reward_created_at,
r.draw_id,r.round_no,r.ticket_number,r.draw_created_at,r.lottery_title title,r.prize_rank rank,
r.prize_name name,r.prize_image_url image_url
FROM public.prize_redemptions r WHERE r.user_id=$1
ORDER BY r.redeemed ASC,r.draw_created_at DESC NULLS LAST,r.created_at DESC`,[req.user.id]);res.json(r.rows)}));
app.get('/api/admin/rewards',auth('admin'),asyncRoute(async(req,res)=>{
await pool.query(`UPDATE public.prize_redemptions r SET
lottery_title=COALESCE(r.lottery_title,l.title),round_no=COALESCE(r.round_no,d.round_no),
ticket_number=COALESCE(r.ticket_number,d.ticket_number),prize_rank=COALESCE(r.prize_rank,p.rank),
prize_name=COALESCE(r.prize_name,p.name),prize_image_url=COALESCE(r.prize_image_url,p.image_url),
draw_created_at=COALESCE(r.draw_created_at,d.created_at)
FROM public.draws d JOIN public.prizes p ON p.id=d.prize_id JOIN public.lotteries l ON l.id=d.lottery_id
WHERE r.draw_id=d.id AND (r.prize_name IS NULL OR r.lottery_title IS NULL OR r.draw_created_at IS NULL)`);
const r=await pool.query(`SELECT r.id redemption_id,r.redeemed,r.redeemed_at,r.created_at reward_created_at,
u.id user_id,u.username,u.display_name,r.draw_id,r.round_no,r.ticket_number,r.draw_created_at,
r.lottery_title title,r.prize_rank rank,r.prize_name name,r.prize_image_url image_url
FROM public.prize_redemptions r JOIN public.users u ON u.id=r.user_id
ORDER BY r.redeemed ASC,u.display_name,r.draw_created_at DESC NULLS LAST,r.created_at DESC`);
res.json(r.rows)}));
app.post('/api/admin/rewards/:id/redeem',auth('admin'),asyncRoute(async(req,res)=>{const r=await pool.query(`UPDATE public.prize_redemptions SET redeemed=TRUE,redeemed_at=COALESCE(redeemed_at,NOW()),redeemed_by=$1 WHERE id=$2 RETURNING id,redeemed,redeemed_at`,[req.user.id,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'找不到這筆獎品'});res.json(r.rows[0])}));
app.get('/api/admin/users',auth('admin'),asyncRoute(async(req,res)=>res.json((await pool.query('SELECT id,username,display_name,role,stamps,avatar_url,created_at FROM users ORDER BY role DESC,created_at DESC')).rows)));
app.post('/api/admin/users/:id/stamps',auth('admin'),asyncRoute(async(req,res)=>{const amount=Number(req.body.amount),reason=String(req.body.reason||'');if(!Number.isInteger(amount)||amount===0)return res.status(400).json({error:'印章數量不正確'});const c=await pool.connect();try{await c.query('BEGIN');const u=await c.query('SELECT stamps FROM users WHERE id=$1 FOR UPDATE',[req.params.id]);if(!u.rowCount)throw new Error('找不到玩家');if(u.rows[0].stamps+amount<0)throw new Error('扣除後不能小於 0');const r=await c.query('UPDATE users SET stamps=stamps+$1 WHERE id=$2 RETURNING id,stamps',[amount,req.params.id]);await c.query('INSERT INTO stamp_logs(user_id,admin_id,amount,reason) VALUES($1,$2,$3,$4)',[req.params.id,req.user.id,amount,reason]);await c.query('COMMIT');res.json(r.rows[0])}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message})}finally{c.release()}}));
app.delete('/api/admin/users/:id',auth('admin'),asyncRoute(async(req,res)=>{const targetId=Number(req.params.id);if(!Number.isInteger(targetId))return res.status(400).json({error:'帳號 ID 不正確'});if(targetId===Number(req.user.id))return res.status(400).json({error:'不能刪除目前登入中的管理員帳號'});const c=await pool.connect();try{await c.query('BEGIN');const ur=await c.query('SELECT id,username,display_name,role FROM public.users WHERE id=$1 FOR UPDATE',[targetId]);if(!ur.rowCount)throw Object.assign(new Error('找不到玩家帳號'),{status:404});const u=ur.rows[0];if(u.role!=='player')throw Object.assign(new Error('只能刪除玩家帳號，管理員帳號不能在這裡刪除'),{status:400});const currentTickets=(await c.query(`SELECT t.prize_id,COUNT(*)::int n FROM public.lottery_tickets t JOIN public.lotteries l ON l.id=t.lottery_id WHERE t.drawn_by=$1 AND t.is_drawn=TRUE AND t.round_no=l.round_no GROUP BY t.prize_id`,[targetId])).rows;for(const x of currentTickets)await c.query('UPDATE public.prizes SET remaining_quantity=LEAST(initial_quantity,remaining_quantity+$1) WHERE id=$2',[x.n,x.prize_id]);const restored=(await c.query(`UPDATE public.lottery_tickets t SET is_drawn=FALSE,drawn_by=NULL,drawn_at=NULL FROM public.lotteries l WHERE t.lottery_id=l.id AND t.drawn_by=$1 AND t.round_no=l.round_no RETURNING t.id`,[targetId])).rowCount;await c.query('UPDATE public.lottery_tickets SET drawn_by=NULL WHERE drawn_by=$1',[targetId]);const drawCount=(await c.query('SELECT COUNT(*)::int n FROM public.draws WHERE user_id=$1',[targetId])).rows[0].n;const rewardCount=(await c.query('SELECT COUNT(*)::int n FROM public.prize_redemptions WHERE user_id=$1',[targetId])).rows[0].n;const stampCount=(await c.query('SELECT COUNT(*)::int n FROM public.stamp_logs WHERE user_id=$1 OR admin_id=$1',[targetId])).rows[0].n;await c.query('DELETE FROM public.prize_redemptions WHERE user_id=$1 OR redeemed_by=$1',[targetId]);await c.query('DELETE FROM public.draws WHERE user_id=$1',[targetId]);await c.query('DELETE FROM public.stamp_logs WHERE user_id=$1 OR admin_id=$1',[targetId]);await c.query('DELETE FROM public.users WHERE id=$1',[targetId]);await c.query('COMMIT');res.json({ok:true,username:u.username,displayName:u.display_name,deletedDraws:drawCount,deletedRewards:rewardCount,deletedStampLogs:stampCount,restoredCurrentTickets:restored})}catch(e){await c.query('ROLLBACK');res.status(e.status||400).json({error:e.message||'刪除帳號失敗'})}finally{c.release()}}));
app.post('/api/admin/upload',auth('admin'),upload.single('image'),asyncRoute(async(req,res)=>res.json({url:await uploadImage(req.file)})));
function validateLotteryInput({title,stampCost,status,prizes}){if(!String(title||'').trim())throw new Error('活動名稱不能空白');const cost=Number(stampCost);if(!Number.isInteger(cost)||cost<1)throw new Error('每抽印章必須是大於 0 的整數');if(!['draft','published','closed'].includes(status))throw new Error('活動狀態不正確');if(!Array.isArray(prizes)||!prizes.length)throw new Error('至少需要一個獎項');if(String(prizes[0].rank||'').trim()!=='A賞')throw new Error('第一個獎項必須固定為 A賞');let total=0;const effects=new Set(['none','rainbow','gold','purple','pink','cry']);for(const p of prizes){const q=Number(p.quantity);if(!String(p.rank||'').trim()||!String(p.name||'').trim()||!Number.isInteger(q)||q<0)throw new Error('獎項資料不完整');if(!effects.has(String(p.effect||'none')))throw new Error('獎項特效不正確');total+=q}if(Number(prizes[0].quantity)<1)throw new Error('A賞數量至少要 1 個');if(total<1)throw new Error('總籤數至少要 1 張')}
function prizeShape(rows){return rows.map(p=>({rank:String(p.rank).trim(),name:String(p.name).trim(),quantity:Number(p.quantity??p.initial_quantity),imageUrl:p.imageUrl??p.image_url??null,isLosing:!!(p.isLosing??p.is_losing),effect:String(p.effect||'none')}))}
app.post('/api/admin/lotteries',auth('admin'),asyncRoute(async(req,res)=>{const {title,description='',bannerUrl=null,stampCost=1,status='draft',prizes=[]}=req.body;validateLotteryInput({title,stampCost,status,prizes});const c=await pool.connect();try{await c.query('BEGIN');const l=(await c.query('INSERT INTO lotteries(title,description,banner_url,stamp_cost,status) VALUES($1,$2,$3,$4,$5) RETURNING *',[String(title).trim(),description,bannerUrl,Number(stampCost),status])).rows[0];for(let i=0;i<prizes.length;i++){const p=prizes[i],q=Number(p.quantity);await c.query('INSERT INTO prizes(lottery_id,rank,name,image_url,initial_quantity,remaining_quantity,is_losing,effect,sort_order) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8)',[l.id,p.rank.trim(),p.name.trim(),p.imageUrl||null,q,!!p.isLosing,String(p.effect||'none'),i])}await generateTickets(c,l.id,l.round_no);await c.query('COMMIT');res.status(201).json(l)}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message})}finally{c.release()}}));
app.put('/api/admin/lotteries/:id',auth('admin'),asyncRoute(async(req,res)=>{const {title,description='',bannerUrl=null,stampCost=1,status='draft',prizes=[]}=req.body;validateLotteryInput({title,stampCost,status,prizes});const c=await pool.connect();try{await c.query('BEGIN');const lr=await c.query('SELECT * FROM lotteries WHERE id=$1 FOR UPDATE',[req.params.id]);if(!lr.rowCount)throw new Error('找不到一番賞');const roundNo=lr.rows[0].round_no;const drawn=(await c.query('SELECT COUNT(*)::int n FROM lottery_tickets WHERE lottery_id=$1 AND round_no=$2 AND is_drawn',[req.params.id,roundNo])).rows[0].n;if(drawn>0)throw new Error('目前這一彈已經有人抽過，為避免改變已抽結果，請先開始下一彈再修改獎項');const existing=(await c.query('SELECT rank,name,image_url,initial_quantity,is_losing,effect FROM prizes WHERE lottery_id=$1 AND active=TRUE ORDER BY sort_order,id',[req.params.id])).rows;const changed=JSON.stringify(prizeShape(existing))!==JSON.stringify(prizeShape(prizes));await c.query('UPDATE lotteries SET title=$1,description=$2,banner_url=$3,stamp_cost=$4,status=$5,updated_at=NOW() WHERE id=$6',[String(title).trim(),description,bannerUrl,Number(stampCost),status,req.params.id]);if(!changed){await c.query('COMMIT');return res.json({ok:true,metadataOnly:true})}await c.query('DELETE FROM lottery_tickets WHERE lottery_id=$1 AND round_no=$2',[req.params.id,roundNo]);await c.query('UPDATE prizes SET active=FALSE WHERE lottery_id=$1 AND active=TRUE',[req.params.id]);for(let i=0;i<prizes.length;i++){const p=prizes[i],q=Number(p.quantity);await c.query('INSERT INTO prizes(lottery_id,rank,name,image_url,initial_quantity,remaining_quantity,is_losing,effect,sort_order,active) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,TRUE)',[req.params.id,p.rank.trim(),p.name.trim(),p.imageUrl||null,q,!!p.isLosing,String(p.effect||'none'),i])}await generateTickets(c,req.params.id,roundNo);await c.query('COMMIT');res.json({ok:true,prizesRebuilt:true})}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message})}finally{c.release()}}));
app.post('/api/admin/lotteries/:id/reset',auth('admin'),asyncRoute(async(req,res)=>{if(String(req.body.confirm)!=='RESET')return res.status(400).json({error:'請輸入 RESET'});const c=await pool.connect();try{await c.query('BEGIN');const lr=await c.query('SELECT * FROM lotteries WHERE id=$1 FOR UPDATE',[req.params.id]);if(!lr.rowCount)throw new Error('找不到一番賞');const oldPrizes=(await c.query('SELECT rank,name,image_url,initial_quantity,is_losing,effect,sort_order FROM prizes WHERE lottery_id=$1 AND active=TRUE ORDER BY sort_order,id',[req.params.id])).rows;if(!oldPrizes.length)throw new Error('目前沒有可延用的獎項');await c.query('UPDATE prizes SET active=FALSE WHERE lottery_id=$1 AND active=TRUE',[req.params.id]);for(const p of oldPrizes)await c.query('INSERT INTO prizes(lottery_id,rank,name,image_url,initial_quantity,remaining_quantity,is_losing,effect,sort_order,active) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,TRUE)',[req.params.id,p.rank,p.name,p.image_url,p.initial_quantity,p.is_losing,p.effect||'none',p.sort_order]);const r=await c.query('UPDATE lotteries SET round_no=round_no+1,updated_at=NOW() WHERE id=$1 RETURNING round_no',[req.params.id]);await generateTickets(c,req.params.id,r.rows[0].round_no);await c.query('COMMIT');res.json({ok:true,roundNo:r.rows[0].round_no,editable:true})}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message})}finally{c.release()}}));
app.get('/api/admin/lotteries/:id/tickets',auth('admin'),asyncRoute(async(req,res)=>{const l=(await pool.query('SELECT round_no FROM lotteries WHERE id=$1',[req.params.id])).rows[0];if(!l)return res.status(404).json({error:'找不到一番賞'});const r=await pool.query(`SELECT t.ticket_number,t.is_drawn,t.drawn_at,p.rank,p.name,u.display_name FROM lottery_tickets t JOIN prizes p ON p.id=t.prize_id LEFT JOIN users u ON u.id=t.drawn_by WHERE t.lottery_id=$1 AND t.round_no=$2 ORDER BY t.ticket_number`,[req.params.id,l.round_no]);res.json(r.rows)}));
app.delete('/api/admin/lotteries/:id',auth('admin'),asyncRoute(async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const lr=await c.query('SELECT id,title FROM lotteries WHERE id=$1 FOR UPDATE',[req.params.id]);if(!lr.rowCount)throw Object.assign(new Error('找不到一番賞'),{status:404});await c.query(`UPDATE public.prize_redemptions r SET lottery_title=COALESCE(r.lottery_title,l.title),round_no=COALESCE(r.round_no,d.round_no),ticket_number=COALESCE(r.ticket_number,d.ticket_number),prize_rank=COALESCE(r.prize_rank,p.rank),prize_name=COALESCE(r.prize_name,p.name),prize_image_url=COALESCE(r.prize_image_url,p.image_url),draw_created_at=COALESCE(r.draw_created_at,d.created_at) FROM public.draws d JOIN public.prizes p ON p.id=d.prize_id JOIN public.lotteries l ON l.id=d.lottery_id WHERE r.draw_id=d.id AND d.lottery_id=$1`,[req.params.id]);const drawCount=(await c.query('SELECT COUNT(*)::int n FROM draws WHERE lottery_id=$1',[req.params.id])).rows[0].n;const rewardCount=(await c.query('SELECT COUNT(*)::int n FROM public.prize_redemptions r JOIN public.draws d ON d.id=r.draw_id WHERE d.lottery_id=$1',[req.params.id])).rows[0].n;await c.query('DELETE FROM draws WHERE lottery_id=$1',[req.params.id]);await c.query('DELETE FROM lotteries WHERE id=$1',[req.params.id]);await c.query('COMMIT');res.json({ok:true,deletedDraws:drawCount,preservedRewards:rewardCount,title:lr.rows[0].title})}catch(e){await c.query('ROLLBACK');res.status(e.status||400).json({error:e.message||'刪除失敗'})}finally{c.release()}}));
app.get('/api/admin/logs',auth('admin'),asyncRoute(async(req,res)=>{const draws=(await pool.query('SELECT d.id,d.round_no,d.ticket_number,d.stamp_cost,d.created_at,u.display_name,l.title,p.rank,p.name FROM draws d JOIN users u ON u.id=d.user_id JOIN lotteries l ON l.id=d.lottery_id JOIN prizes p ON p.id=d.prize_id ORDER BY d.created_at DESC LIMIT 500')).rows;const stamps=(await pool.query('SELECT s.id,s.amount,s.reason,s.created_at,u.display_name,a.display_name admin_name FROM stamp_logs s JOIN users u ON u.id=s.user_id LEFT JOIN users a ON a.id=s.admin_id ORDER BY s.created_at DESC LIMIT 500')).rows;res.json({draws,stamps})}));
app.get('/api/admin/backup',auth('admin'),asyncRoute(async(req,res)=>{const [users,lotteries,prizes,draws,stamps,tickets,redemptions]=await Promise.all(['users','lotteries','prizes','draws','stamp_logs','lottery_tickets','prize_redemptions'].map(t=>pool.query(`SELECT * FROM public.${t}`)));res.setHeader('Content-Disposition',`attachment; filename=kuji-backup-${Date.now()}.json`);res.json({version:5,exportedAt:new Date().toISOString(),users:users.rows,lotteries:lotteries.rows,prizes:prizes.rows,draws:draws.rows,stampLogs:stamps.rows,tickets:tickets.rows,prizeRedemptions:redemptions.rows})}));
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:err.message||'伺服器錯誤'})});
initDb().then(()=>app.listen(PORT,()=>console.log(`Girlfriend Kuji V4 Formal running on port ${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
