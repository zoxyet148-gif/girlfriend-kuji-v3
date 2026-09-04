const API='/api',tokenKey='kuji_token_v4';const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];let token=localStorage.getItem(tokenKey)||localStorage.getItem('kuji_token_v3')||'',me=null,currentLottery=null,selectedTicket=null;
function toast(msg){const e=document.createElement('div');e.className='toast';e.textContent=msg;document.body.appendChild(e);setTimeout(()=>e.remove(),2800)}
async function api(url,opt={}){opt.headers={...(opt.headers||{}),'Content-Type':'application/json'};if(token)opt.headers.Authorization=`Bearer ${token}`;const r=await fetch(API+url,opt),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'操作失敗');return d}
function saveAuth(d){token=d.token;localStorage.setItem(tokenKey,token);me=d.user;showApp()}function logout(){localStorage.removeItem(tokenKey);localStorage.removeItem('kuji_token_v3');location.reload()}
async function boot(){if(token){try{me=await api('/me');showApp()}catch{logout()}}else showAuth()}function showAuth(){$('#authView').classList.remove('hidden');$('#appView').classList.add('hidden')}function showApp(){$('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');$('#who').textContent=me.display_name;$('#stampCount').textContent=me.stamps;loadLotteries()}
$$('.tab').forEach(b=>b.onclick=()=>{$$('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#loginForm').classList.toggle('hidden',b.dataset.tab!=='login');$('#registerForm').classList.toggle('hidden',b.dataset.tab!=='register')});
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{saveAuth(await api('/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target))) }))}catch(x){toast(x.message)}};$('#registerForm').onsubmit=async e=>{e.preventDefault();try{saveAuth(await api('/auth/register',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target))) }))}catch(x){toast(x.message)}};$('#logoutBtn').onclick=logout;$('#homeBtn').onclick=()=>{showSection('home');loadLotteries()};$('#profileBtn').onclick=()=>{showSection('profile');loadProfile()};function showSection(n){['home','detail','profile'].forEach(x=>$('#'+x+'Section').classList.toggle('hidden',x!==n))}
async function loadLotteries(){try{const list=await api('/lotteries'),g=$('#lotteryGrid');g.innerHTML=list.length?'':'<div class="card card-body">目前還沒有開放的一番賞。</div>';list.forEach(l=>{const c=document.createElement('article');c.className='card';c.innerHTML=`<img class="banner" src="${l.banner_url||'https://placehold.co/800x450/ffd6e7/e83e83?text=Ichiban+Kuji'}"><div class="card-body"><h3>${esc(l.title)}</h3><div class="meta"><span class="badge">💗 每抽 ${l.stamp_cost} 印章</span><span class="badge">🎫 剩餘 ${l.remaining_total}/${l.initial_total}</span><span class="badge">第 ${l.round_no} 彈</span></div><p>${esc(l.description||'')}</p><button class="btn">自己選號碼</button></div>`;c.querySelector('button').onclick=()=>openLottery(l.id);g.appendChild(c)})}catch(e){toast(e.message)}}
async function openLottery(id){try{
  currentLottery=await api('/lotteries/'+id);
  selectedTicket=null;
  showSection('detail');
  const tickets=currentLottery.tickets||[],remaining=tickets.filter(t=>!t.is_drawn).length;
  $('#detailSection').innerHTML=`<div class="lottery-head">${currentLottery.banner_url?`<img src="${currentLottery.banner_url}">`:''}<div class="lottery-info"><h1>${esc(currentLottery.title)}</h1><p>${esc(currentLottery.description)}</p><div class="meta"><span class="badge">💗 每抽 ${currentLottery.stamp_cost}</span><span class="badge">第 ${currentLottery.round_no} 彈</span><span class="badge">剩餘 ${remaining}/${tickets.length}</span></div></div></div>
  <div class="section-title"><div><h2>請選一張籤</h2><p class="small">已抽過的號碼會變灰，選定後按確認抽獎。</p></div><button id="drawBtn" class="btn" disabled>確認抽取</button></div>
  <div class="search-toolbar ticket-search-toolbar">
    <label class="search-box">🔎<input id="ticketSearch" type="search" inputmode="numeric" placeholder="搜尋籤號，例如 016"></label>
    <span id="ticketSearchCount" class="small">共 ${tickets.length} 張</span>
  </div>
  <div id="ticketGrid" class="ticket-grid">${tickets.map(t=>`<button class="ticket-number ${t.is_drawn?'drawn':''}" data-number="${t.ticket_number}" data-search="${String(t.ticket_number).padStart(3,'0')} ${t.ticket_number} ${t.is_drawn?'已抽':'可抽'}" ${t.is_drawn?'disabled':''}>${String(t.ticket_number).padStart(3,'0')}<span>${t.is_drawn?'已抽':'選我'}</span></button>`).join('')}</div>
  <div id="ticketSearchEmpty" class="search-empty hidden">找不到這個籤號。</div>
  <h2>賞品一覽</h2><div class="grid">${currentLottery.prizes.map(p=>`<article class="card prize-card"><img src="${p.image_url||'https://placehold.co/500x500/fff1f7/e83e83?text='+encodeURIComponent(p.rank)}"><div class="card-body"><div class="rank">${esc(p.rank)}</div><h3>${esc(p.name)}</h3><span class="badge">剩餘 ${p.remaining_quantity}/${p.initial_quantity}</span></div></article>`).join('')}</div>`;

  $$('.ticket-number:not(.drawn)').forEach(b=>b.onclick=()=>{
    $$('.ticket-number').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
    selectedTicket=Number(b.dataset.number);
    $('#drawBtn').disabled=false;
    $('#drawBtn').textContent=`抽取 ${String(selectedTicket).padStart(3,'0')} 號`
  });
  $('#drawBtn').onclick=confirmDraw;

  const search=$('#ticketSearch');
  search.oninput=()=>{
    const q=search.value.trim().toLowerCase();
    let visible=0;
    $$('.ticket-number').forEach(b=>{
      const ok=!q || b.dataset.search.toLowerCase().includes(q);
      b.classList.toggle('search-hidden',!ok);
      if(ok)visible++
    });
    $('#ticketSearchCount').textContent=`顯示 ${visible}/${tickets.length} 張`;
    $('#ticketSearchEmpty').classList.toggle('hidden',visible!==0)
  };
}catch(e){toast(e.message)}}
function confirmDraw(){if(!selectedTicket)return toast('請先選一個號碼');if(me.stamps<currentLottery.stamp_cost)return toast(`印章不足，需要 ${currentLottery.stamp_cost} 個`);$('#confirmTitle').textContent=`抽取 ${String(selectedTicket).padStart(3,'0')} 號籤` ;$('#confirmText').innerHTML=`每抽需要 <b>${currentLottery.stamp_cost}</b> 個印章<br>目前：${me.stamps} 個<br>抽獎後：${me.stamps-currentLottery.stamp_cost} 個<br><br><span class="small">確認後不可取消。</span>`;$('#confirmModal').classList.remove('hidden')}
$('#cancelDraw').onclick=()=>$('#confirmModal').classList.add('hidden');$('#doDraw').onclick=async()=>{const btn=$('#doDraw');$('#confirmModal').classList.add('hidden');showTicketPreparing(selectedTicket);btn.disabled=true;try{const r=await api(`/lotteries/${currentLottery.id}/draw`,{method:'POST',body:JSON.stringify({ticketNumber:selectedTicket})});me.stamps=r.stampsRemaining;$('#stampCount').textContent=me.stamps;sessionStorage.setItem('kuji_pending_reveal',JSON.stringify({prize:r.prize,ticketNumber:r.ticketNumber,lotteryId:currentLottery.id}));showTearTicket(r.prize,r.ticketNumber)}catch(e){$('#drawStage').classList.add('hidden');toast(e.message);openLottery(currentLottery.id)}finally{btn.disabled=false}};
function showTicketPreparing(n){const s=$('#drawStage');s.className='draw-stage';s.innerHTML=`<div class="ticket-preparing"><div class="ticket-box">🎟️</div><h2>正在取出 ${String(n).padStart(3,'0')} 號籤</h2><p>抽獎結果已鎖定，準備好就把票撕開吧…</p></div>`;s.classList.remove('hidden')}
function resultFace(p,n){return `<div class="tear-result-face"><div class="tear-result-kicker">ICHIBAN KUJI</div><div class="tear-result-number">TICKET ${String(n).padStart(3,'0')}</div>${p.image_url?`<img src="${esc(p.image_url)}" alt="${esc(p.name)}">`:'<div class="tear-result-gift">🎁</div>'}<div class="tear-result-rank">${esc(p.rank)}</div><div class="tear-result-name">${esc(p.name)}</div><div class="tear-result-hint">再撕開一點就看得更清楚…</div></div>`}
function showTearTicket(p,n){const s=$('#drawStage');s.className='draw-stage tear-mode';s.innerHTML=`<div class="tear-shell"><div class="tear-topcopy">實體撕票模式</div><h2>用手指把 ${String(n).padStart(3,'0')} 號籤撕開</h2><p class="tear-help">從票券的 <b>左邊或右邊</b> 往內拖。可以慢慢撕、停下來咪牌 👀</p><div class="kuji-ticket" id="tearTicket" role="slider" aria-label="撕開抽獎券" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${resultFace(p,n)}<div class="tear-cover" id="tearCover"><div class="paper-fibers"></div><div class="ticket-print"><div class="ticket-brand">🎀 GIRLFRIEND KUJI</div><div class="ticket-label">一番賞 抽獎券</div><div class="ticket-big-number">${String(n).padStart(3,'0')}</div><div class="ticket-dash"></div><div class="ticket-instruction">◀ 從左右任一側撕開 ▶</div><div class="ticket-serial">GF-${String(currentLottery?.id||0).padStart(3,'0')}-${String(n).padStart(3,'0')}</div></div></div><div class="tear-edge" id="tearEdge"></div><div class="tear-flap" id="tearFlap"></div><div class="tear-start left">拉這裡</div><div class="tear-start right">拉這裡</div></div><div class="tear-progress"><span id="tearProgressText">還沒撕開</span><div><i id="tearProgressBar"></i></div></div><button id="tearReset" class="btn secondary tear-reset" type="button">重新從邊緣開始撕</button></div>`;s.classList.remove('hidden');initTearGesture(p,n)}
function initTearGesture(p,n){const ticket=$('#tearTicket'),cover=$('#tearCover'),edge=$('#tearEdge'),flap=$('#tearFlap'),bar=$('#tearProgressBar'),txt=$('#tearProgressText');let dragging=false,direction=null,startX=0,progress=0,lastBuzz=0,done=false;const render=()=>{const pct=Math.max(0,Math.min(1,progress)),x=pct*100;ticket.setAttribute('aria-valuenow',String(Math.round(x)));bar.style.width=x+'%';if(direction==='left'){cover.style.clipPath=`polygon(${x}% 0,100% 0,100% 100%,${x}% 100%)`;edge.style.left=`calc(${x}% - 8px)`;edge.style.right='auto';flap.style.left=`calc(${x}% - 44px)`;flap.style.right='auto';flap.style.transform=`perspective(500px) rotateY(${-20-55*pct}deg) rotateZ(${2+4*pct}deg)`}else if(direction==='right'){const r=100-x;cover.style.clipPath=`polygon(0 0,${r}% 0,${r}% 100%,0 100%)`;edge.style.right=`calc(${x}% - 8px)`;edge.style.left='auto';flap.style.right=`calc(${x}% - 44px)`;flap.style.left='auto';flap.style.transform=`perspective(500px) rotateY(${20+55*pct}deg) rotateZ(${-2-4*pct}deg)`}else{cover.style.clipPath='none';edge.style.left='-9999px';flap.style.left='-9999px'}if(pct===0)txt.textContent='還沒撕開';else if(pct<.32)txt.textContent='輕輕撕開中…';else if(pct<.72)txt.textContent='可以停在這裡咪牌 👀';else if(pct<.96)txt.textContent='快要完全揭曉了！';if(!done&&pct>=.97){done=true;progress=1;bar.style.width='100%';txt.textContent='完全撕開！';cover.classList.add('torn-away');edge.classList.add('torn-away');flap.classList.add('torn-away');sessionStorage.removeItem('kuji_pending_reveal');if(navigator.vibrate)navigator.vibrate([20,35,40]);setTimeout(()=>showResult(p,n),650)}};const down=e=>{if(done)return;const rect=ticket.getBoundingClientRect(),x=e.clientX-rect.left;if(!direction){if(x<=rect.width*.24)direction='left';else if(x>=rect.width*.76)direction='right';else{return toast('請從抽獎券左邊或右邊開始撕')}}dragging=true;startX=e.clientX-(direction==='left'?progress*rect.width:-progress*rect.width);ticket.setPointerCapture?.(e.pointerId);ticket.classList.add('tearing');render()};const move=e=>{if(!dragging||done)return;const rect=ticket.getBoundingClientRect();progress=direction==='left'?(e.clientX-startX)/rect.width:(startX-e.clientX)/rect.width;progress=Math.max(0,Math.min(1,progress));if(navigator.vibrate&&progress-lastBuzz>.12){navigator.vibrate(8);lastBuzz=progress}render()};const up=e=>{if(!dragging)return;dragging=false;ticket.releasePointerCapture?.(e.pointerId);ticket.classList.remove('tearing');render()};ticket.addEventListener('pointerdown',down);ticket.addEventListener('pointermove',move);ticket.addEventListener('pointerup',up);ticket.addEventListener('pointercancel',up);$('#tearReset').onclick=()=>{if(done)return;dragging=false;direction=null;progress=0;lastBuzz=0;cover.classList.remove('torn-away');edge.classList.remove('torn-away');flap.classList.remove('torn-away');render()};render()}
function confetti(){return `<div class="confetti">${Array.from({length:45},()=>`<i style="left:${Math.random()*100}%;animation-delay:${Math.random()*2}s;color:hsl(${Math.random()*360} 85% 60%)"></i>`).join('')}</div>`}
function showResult(p,n){const rank=String(p.rank).toUpperCase();let cls='',extra='',title='恭喜中獎！';if(p.is_losing){title='這次未中獎';extra='<div class="cry">😭</div><p>嗚嗚～下次一定會中大獎！</p>'}else if(rank.startsWith('A')){cls='effect-rainbow';extra=confetti()}else if(rank.startsWith('B')){cls='effect-gold';extra=confetti()}else if(rank.startsWith('C')){cls='effect-purple';extra=confetti()}$('#drawStage').innerHTML=`<div class="result-panel ${cls}">${extra}<div class="badge">${String(n).padStart(3,'0')} 號籤</div><h1>${title}</h1>${p.image_url?`<img src="${p.image_url}">`:''}<div class="rank">${esc(p.rank)}</div><h2>${esc(p.name)}</h2><div class="modal-actions"><button id="closeResult" class="btn secondary">返回</button><button id="againResult" class="btn">再選一張</button></div></div>`;const back=()=>{$('#drawStage').classList.add('hidden');openLottery(currentLottery.id)};$('#closeResult').onclick=back;$('#againResult').onclick=back}
async function loadProfile(){try{
  me=await api('/me');
  const [draws,rewards]=await Promise.all([api('/me/draws'),api('/me/rewards')]);
  const pending=rewards.filter(x=>!x.redeemed),redeemed=rewards.filter(x=>x.redeemed);

  const groupRewards=list=>{
    const m=new Map();
    for(const r of list){
      const k=[r.lottery_id||r.title,r.round_no,r.rank,r.name,r.redeemed?'1':'0'].join('||');
      if(!m.has(k))m.set(k,{...r,items:[]});
      m.get(k).items.push(r)
    }
    return [...m.values()].sort((a,b)=>b.items.length-a.items.length||new Date(b.draw_created_at)-new Date(a.draw_created_at))
  };

  const rewardGroupCard=g=>{
    const count=g.items.length;
    const tickets=g.items.map(x=>x.ticket_number?String(x.ticket_number).padStart(3,'0'):null).filter(Boolean);
    const times=g.items.map(x=>new Date(x.draw_created_at)).sort((a,b)=>b-a);
    const redeemedTimes=g.items.map(x=>x.redeemed_at?new Date(x.redeemed_at):null).filter(Boolean).sort((a,b)=>b-a);
    const search=[g.rank,g.name,g.title,`第${g.round_no}彈`,...tickets,g.redeemed?'已兌換':'待兌換'].join(' ').toLowerCase();
    return `<article class="my-reward-card grouped reward-search-item ${g.redeemed?'redeemed':''}" data-search="${esc(search)}">${g.image_url?`<div class="reward-image-wrap"><img src="${esc(g.image_url)}" alt="${esc(g.name)}">${count>1?`<span class="reward-count-bubble">×${count}</span>`:''}</div>`:`<div class="my-reward-placeholder reward-image-wrap">🎁${count>1?`<span class="reward-count-bubble">×${count}</span>`:''}</div>`}<div class="my-reward-body"><div class="reward-card-top"><div class="reward-status ${g.redeemed?'done':'pending'}">${g.redeemed?'✓ 已兌換':'待兌換'}</div><span class="reward-total">${count} 件</span></div><div class="rank">${esc(g.rank)}</div><h3>${esc(g.name)}</h3><div class="small">${esc(g.title)}・第 ${g.round_no} 彈</div>${tickets.length?`<div class="reward-ticket-list"><b>抽獎券</b>${tickets.map(t=>`<span>${t} 號</span>`).join('')}</div>`:''}<div class="small">最近抽中：${times[0].toLocaleString('zh-TW')}</div>${g.redeemed&&redeemedTimes.length?`<div class="small redeemed-time">最近兌換：${redeemedTimes[0].toLocaleString('zh-TW')}</div>`:''}</div></article>`
  };

  $('#profileSection').innerHTML=`<h1>我的專屬頁面</h1><div class="profile-grid"><div><div class="stat"><div>💗 好寶寶印章</div><strong>${me.stamps}</strong></div><br><div class="stat"><form id="nameForm" class="form-grid"><label class="field">玩家名稱<input name="displayName" value="${esc(me.display_name)}"></label><button class="btn">儲存名稱</button></form></div></div><div>
  <div class="section-title reward-title"><div><h2>🎁 我的獎品</h2><p class="small">抽中的獎品會保留在這裡，兌換後也不會消失。</p></div><span class="badge">待兌換 ${pending.length} 件</span></div>
  <div class="search-toolbar"><label class="search-box">🔎<input id="myRewardSearch" type="search" placeholder="搜尋獎項、獎品名稱或票號"></label><span id="myRewardSearchCount" class="small">共 ${rewards.length} 件</span></div>
  <h3>待兌換</h3><div class="my-reward-grid reward-search-grid">${pending.length?groupRewards(pending).map(rewardGroupCard).join(''):'<div class="empty-reward">目前沒有待兌換的獎品 ✨</div>'}</div>
  ${redeemed.length?`<details class="redeemed-details" open><summary>已兌換獎品（${redeemed.length}）</summary><div class="my-reward-grid reward-search-grid">${groupRewards(redeemed).map(rewardGroupCard).join('')}</div></details>`:''}
  <div id="myRewardSearchEmpty" class="search-empty hidden">找不到符合的獎品。</div>

  <h2 class="history-heading">我的抽獎紀錄</h2>
  <div class="search-toolbar"><label class="search-box">🔎<input id="myDrawSearch" type="search" placeholder="搜尋抽獎紀錄、獎項或票號"></label></div>
  <div class="history">${draws.length?draws.map(d=>{const ds=[d.title,d.rank,d.name,d.ticket_number?String(d.ticket_number).padStart(3,'0'):'',`第${d.round_no}彈`,new Date(d.created_at).toLocaleDateString('zh-TW')].join(' ').toLowerCase();return `<div class="history-item draw-search-item" data-search="${esc(ds)}"><img src="${d.image_url||'https://placehold.co/120x120/fff1f7/e83e83?text='+encodeURIComponent(d.rank)}"><div><b>${esc(d.title)}</b><br><b>${d.ticket_number?String(d.ticket_number).padStart(3,'0')+' 號・':''}</b>${esc(d.rank)}・${esc(d.name)}<br><span class="small">第 ${d.round_no} 彈・${new Date(d.created_at).toLocaleString('zh-TW')}</span></div></div>`}).join(''):'尚無紀錄'}</div>
  <div id="myDrawSearchEmpty" class="search-empty hidden">找不到符合的抽獎紀錄。</div>
  </div></div>`;

  const rs=$('#myRewardSearch');
  if(rs)rs.oninput=()=>{
    const q=rs.value.trim().toLowerCase();
    let groups=0,items=0;
    $$('.reward-search-item').forEach(card=>{
      const ok=!q || card.dataset.search.includes(q);
      card.classList.toggle('search-hidden',!ok);
      if(ok){groups++;const m=card.querySelector('.reward-total')?.textContent.match(/\d+/);items+=m?Number(m[0]):1}
    });
    $('#myRewardSearchCount').textContent=q?`找到 ${items} 件`:`共 ${rewards.length} 件`;
    $('#myRewardSearchEmpty').classList.toggle('hidden',groups!==0)
  };

  const ds=$('#myDrawSearch');
  if(ds)ds.oninput=()=>{
    const q=ds.value.trim().toLowerCase();let visible=0;
    $$('.draw-search-item').forEach(x=>{const ok=!q||x.dataset.search.includes(q);x.classList.toggle('search-hidden',!ok);if(ok)visible++});
    $('#myDrawSearchEmpty').classList.toggle('hidden',visible!==0)
  };

  $('#nameForm').onsubmit=async e=>{e.preventDefault();try{me=await api('/me',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});$('#who').textContent=me.display_name;toast('名稱已更新')}catch(x){toast(x.message)}}
}catch(e){toast(e.message)}}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}boot();setTimeout(()=>{try{const x=JSON.parse(sessionStorage.getItem('kuji_pending_reveal')||'null');if(x&&x.prize&&x.ticketNumber&&token){if(!currentLottery)currentLottery={id:x.lotteryId};showTearTicket(x.prize,x.ticketNumber)}}catch{}},700);
