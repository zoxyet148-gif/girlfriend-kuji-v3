const API='/api',key='kuji_admin_token_v4';
let token=localStorage.getItem(key)||localStorage.getItem('kuji_admin_token_v3')||'',lotteries=[];
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const EFFECTS=[['none','無特效'],['rainbow','🌈 彩虹'],['gold','✨ 金色'],['purple','💜 紫色'],['pink','🩷 粉紅'],['cry','😭 哭哭']];
function toast(msg){const e=document.createElement('div');e.className='toast';e.textContent=msg;document.body.appendChild(e);setTimeout(()=>e.remove(),2800)}
async function api(url,opt={}){opt.headers={...(opt.headers||{}),'Content-Type':'application/json'};if(token)opt.headers.Authorization=`Bearer ${token}`;const r=await fetch(API+url,opt),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'操作失敗');return d}
async function upload(file){const fd=new FormData();fd.append('image',file);const r=await fetch(API+'/admin/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:fd}),d=await r.json();if(!r.ok)throw new Error(d.error||'上傳失敗');return d.url}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
async function boot(){if(!token)return;try{const me=await api('/me');if(me.role!=='admin')throw 0;$('#adminLogin').classList.add('hidden');$('#adminApp').classList.remove('hidden');loadLotteries()}catch{localStorage.removeItem(key);token=''}}
boot();
$('#adminLoginForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});if(d.user.role!=='admin')throw new Error('此帳號不是管理員');token=d.token;localStorage.setItem(key,token);location.reload()}catch(x){toast(x.message)}};
$('#adminLogout').onclick=()=>{localStorage.removeItem(key);localStorage.removeItem('kuji_admin_token_v3');location.reload()};
$$('.sidebar [data-page]').forEach(b=>b.onclick=()=>{$$('.sidebar button').forEach(x=>x.classList.remove('active'));b.classList.add('active');['lotteries','players','rewards','logs'].forEach(n=>$('#'+n+'Page').classList.toggle('hidden',n!==b.dataset.page));if(b.dataset.page==='players')loadPlayers();if(b.dataset.page==='rewards')loadRewards();if(b.dataset.page==='logs')loadLogs()});
async function loadLotteries(){try{lotteries=await api('/lotteries?all=1');const g=$('#adminLotteryGrid');g.innerHTML='';for(const l of lotteries){const c=document.createElement('article');c.className='card';c.innerHTML=`<img class="banner" src="${l.banner_url||'https://placehold.co/800x450/ffd6e7/e83e83?text=Kuji'}"><div class="card-body"><h3>${esc(l.title)}</h3><div class="meta"><span class="badge">${esc(l.status)}</span><span class="badge">第 ${l.round_no} 彈</span><span class="badge">剩 ${l.remaining_total}/${l.initial_total}</span></div><div class="card-actions"><button class="btn edit">編輯</button><button class="btn secondary tickets">查看籤位</button><button class="btn secondary reset">開始下一彈</button><button class="btn danger del">刪除</button></div></div>`;c.querySelector('.edit').onclick=()=>editLottery(l.id);c.querySelector('.tickets').onclick=()=>showTickets(l.id,l.title);c.querySelector('.reset').onclick=()=>resetLottery(l.id);c.querySelector('.del').onclick=()=>deleteLottery(l.id);g.appendChild(c)}}catch(e){toast(e.message)}}
function suggestedRank(){const rows=$$('.prize-row');const used=rows.map(r=>r.querySelector('.p-rank').value.trim());for(let i=1;i<26;i++){const rank=String.fromCharCode(65+i)+'賞';if(!used.includes(rank))return rank}return '特別賞'}
function effectOptions(selected){return EFFECTS.map(([v,t])=>`<option value="${v}" ${v===selected?'selected':''}>${t}</option>`).join('')}
function updateTotal(){const total=$$('.p-qty').reduce((sum,input)=>sum+Math.max(0,Number(input.value)||0),0);$('#totalTickets').textContent=total;$('#ticketSummaryText').textContent=total?`建立後會自動產生 001～${String(total).padStart(3,'0')}，並隨機分配獎項。`:'請設定各獎項數量';$('#saveLotteryBtn').disabled=total<1}
function addPrizeRow(p={rank:'',name:'',quantity:1,imageUrl:'',isLosing:false,effect:'none'},fixed=false){const row=document.createElement('article');row.className='prize-row prize-card';row.dataset.fixed=fixed?'1':'0';row.innerHTML=`<div class="prize-card-head"><div><span class="prize-index">${fixed?'固定獎項':'動態獎項'}</span><strong>${esc(p.rank||'新獎項')}</strong></div><button type="button" class="icon-btn danger remove" ${fixed?'disabled title="A賞不可刪除"':''}>×</button></div><div class="prize-card-grid"><label class="field">獎項名稱<input class="p-rank" placeholder="例如 B賞、最後賞" value="${esc(p.rank)}" ${fixed?'readonly':''}></label><label class="field">獎品名稱<input class="p-name" placeholder="例如 大餐兌換券" value="${esc(p.name)}" required></label><label class="field">數量<input class="p-qty" type="number" min="0" step="1" value="${Number(p.quantity??1)}"></label><label class="field">中獎特效<select class="p-effect">${effectOptions(p.effect||'none')}</select></label><label class="field editor-span-2">獎品圖片<input class="p-file" type="file" accept="image/*"><input class="p-url" type="hidden" value="${esc(p.imageUrl||'')}">${p.imageUrl?`<img class="prize-thumb" src="${esc(p.imageUrl)}" alt="獎品預覽">`:''}</label><label class="lose-toggle editor-span-2"><input class="p-lose" type="checkbox" ${p.isLosing?'checked':''}><span>這是「未中獎」項目</span></label></div>`;
  row.querySelector('.remove').onclick=()=>{if(!fixed){row.remove();updateTotal()}};
  row.querySelector('.p-rank').addEventListener('input',e=>row.querySelector('.prize-card-head strong').textContent=e.target.value||'新獎項');
  row.querySelector('.p-qty').addEventListener('input',updateTotal);
  row.querySelector('.p-lose').addEventListener('change',e=>{if(e.target.checked){row.querySelector('.p-effect').value='cry';if(!row.querySelector('.p-rank').value.trim())row.querySelector('.p-rank').value='未中獎'}updateTotal()});
  $('#prizeEditor').appendChild(row);updateTotal()
}
$('#addPrize').onclick=()=>addPrizeRow({rank:suggestedRank(),name:'',quantity:1,effect:'none'});
function closeLotteryModal(){$('#lotteryModal').classList.add('hidden')}
$('#newLottery').onclick=()=>{const f=$('#lotteryForm');f.reset();f.id.value='';f.bannerUrl.value='';$('#bannerPreview').classList.add('hidden');$('#prizeEditor').innerHTML='';addPrizeRow({rank:'A賞',name:'神秘大獎',quantity:1,effect:'rainbow'},true);addPrizeRow({rank:'B賞',name:'',quantity:1,effect:'gold'});addPrizeRow({rank:'C賞',name:'',quantity:1,effect:'purple'});addPrizeRow({rank:'未中獎',name:'再接再厲',quantity:10,isLosing:true,effect:'cry'});$('#lotteryModalTitle').textContent='建立一番賞';$('#lotteryModal').classList.remove('hidden')};
$('#cancelLottery').onclick=closeLotteryModal;$('#cancelLotteryTop').onclick=closeLotteryModal;
async function editLottery(id){try{const d=await api('/lotteries/'+id),f=$('#lotteryForm');f.reset();f.id.value=d.id;f.title.value=d.title;f.description.value=d.description||'';f.bannerUrl.value=d.banner_url||'';f.stampCost.value=d.stamp_cost;f.status.value=d.status;if(d.banner_url){$('#bannerPreview').src=d.banner_url;$('#bannerPreview').classList.remove('hidden')}else $('#bannerPreview').classList.add('hidden');$('#prizeEditor').innerHTML='';d.prizes.forEach((p,i)=>addPrizeRow({rank:p.rank,name:p.name,quantity:p.initial_quantity,imageUrl:p.image_url,isLosing:p.is_losing,effect:p.effect||'none'},i===0));$('#lotteryModalTitle').textContent='編輯一番賞';$('#lotteryModal').classList.remove('hidden')}catch(e){toast(e.message)}}
$('#bannerFile').onchange=async e=>{if(!e.target.files[0])return;try{toast('圖片上傳中…');const url=await upload(e.target.files[0]);$('#lotteryForm [name=bannerUrl]').value=url;$('#bannerPreview').src=url;$('#bannerPreview').classList.remove('hidden');toast('上傳完成')}catch(x){toast(x.message)}};
$('#lotteryForm').onsubmit=async e=>{e.preventDefault();const save=$('#saveLotteryBtn');save.disabled=true;try{const prizes=[];for(const row of $$('.prize-row')){let imageUrl=row.querySelector('.p-url').value;const file=row.querySelector('.p-file').files[0];if(file){toast('獎品圖片上傳中…');imageUrl=await upload(file)}prizes.push({rank:row.querySelector('.p-rank').value.trim(),name:row.querySelector('.p-name').value.trim(),quantity:Number(row.querySelector('.p-qty').value),imageUrl,isLosing:row.querySelector('.p-lose').checked,effect:row.querySelector('.p-effect').value})}const f=new FormData(e.target),body={title:f.get('title'),description:f.get('description'),bannerUrl:f.get('bannerUrl'),stampCost:Number(f.get('stampCost')),status:f.get('status'),prizes},id=f.get('id');await api(id?'/admin/lotteries/'+id:'/admin/lotteries',{method:id?'PUT':'POST',body:JSON.stringify(body)});closeLotteryModal();toast('已儲存並完成號碼洗牌');loadLotteries()}catch(x){toast(x.message)}finally{save.disabled=false;updateTotal()}};
async function showTickets(id,title){try{
  const rows=await api('/admin/lotteries/'+id+'/tickets'),w=window.open('','_blank');
  const cards=rows.map(x=>{
    const search=[String(x.ticket_number).padStart(3,'0'),x.ticket_number,x.rank,x.name,x.is_drawn?'已抽':'未抽',x.display_name||''].join(' ').toLowerCase();
    return `<div class="c ${x.is_drawn?'d':''}" data-search="${esc(search)}"><b>${String(x.ticket_number).padStart(3,'0')} 號</b><br>${esc(x.rank)}・${esc(x.name)}<br><small>${x.is_drawn?'已由 '+esc(x.display_name||'玩家')+' 抽出':'尚未抽出'}</small></div>`
  }).join('');
  w.document.write(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} 籤位</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:20px;margin:0;color:#402a33}.bar{position:sticky;top:0;background:#fff;padding:12px 0 14px;z-index:2}.search{width:100%;box-sizing:border-box;border:1px solid #e6cbd5;border-radius:14px;padding:12px 14px;font-size:16px}.count{font-size:13px;color:#765463;margin-top:7px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.c{border:1px solid #ead8df;border-radius:12px;padding:12px;background:#fff8fb}.d{opacity:.55;background:#eee}.hide{display:none}.empty{padding:25px;text-align:center;color:#765463;display:none}</style><h1>${esc(title)}｜本彈籤位</h1><div class="bar"><input id="q" class="search" type="search" placeholder="搜尋票號、獎項、玩家或狀態"><div id="count" class="count">共 ${rows.length} 張</div></div><div id="g" class="g">${cards}</div><div id="empty" class="empty">找不到符合的籤位。</div><script>const q=document.getElementById('q'),cards=[...document.querySelectorAll('.c')],count=document.getElementById('count'),empty=document.getElementById('empty');q.oninput=()=>{const s=q.value.trim().toLowerCase();let n=0;cards.forEach(c=>{const ok=!s||c.dataset.search.includes(s);c.classList.toggle('hide',!ok);if(ok)n++});count.textContent='顯示 '+n+'/${rows.length} 張';empty.style.display=n?'none':'block'}<\/script>`)
}catch(e){toast(e.message)}}
async function resetLottery(id){const t=prompt('會保留所有舊紀錄並開始新一彈，請輸入 RESET：');if(t!=='RESET')return;try{await api('/admin/lotteries/'+id+'/reset',{method:'POST',body:JSON.stringify({confirm:'RESET'})});toast('已開始下一彈並重新洗牌');loadLotteries()}catch(e){toast(e.message)}}
async function deleteLottery(id){const l=lotteries.find(x=>String(x.id)===String(id));const title=l?.title||'這個一番賞';const ok=confirm(`確定永久刪除「${title}」？\n\n此操作會一起刪除：\n・所有籤位\n・所有獎項\n・所有抽獎紀錄\n\n玩家帳號與目前印章不會改變，刪除後無法復原。`);if(!ok)return;try{const r=await api('/admin/lotteries/'+id,{method:'DELETE'});toast(`已刪除「${r.title||title}」，並清除 ${r.deletedDraws||0} 筆抽獎紀錄`);loadLotteries()}catch(e){toast(e.message)}}
$('#backupBtn').onclick=async()=>{try{const r=await fetch(API+'/admin/backup',{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error((await r.json()).error);const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`girlfriend-kuji-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast('備份已下載')}catch(e){toast(e.message)}};
async function loadPlayers(){try{const users=await api('/admin/users');$('#playersTable').innerHTML=`<div class="table-wrap"><table><thead><tr><th>玩家</th><th>帳號</th><th>印章</th><th>操作</th></tr></thead><tbody>${users.filter(u=>u.role==='player').map(u=>`<tr><td>${esc(u.display_name)}</td><td>${esc(u.username)}</td><td>${u.stamps}</td><td><div class="player-actions"><button class="btn stamp" data-id="${u.id}" data-name="${esc(u.display_name)}">調整印章</button><button class="btn danger delete-user" data-id="${u.id}" data-name="${esc(u.display_name)}" data-username="${esc(u.username)}">刪除帳號</button></div></td></tr>`).join('')}</tbody></table></div>`;$$('.stamp').forEach(b=>b.onclick=()=>{$('#stampForm').reset();$('#stampForm [name=userId]').value=b.dataset.id;$('#stampTarget').textContent=`玩家：${b.dataset.name}`;$('#stampModal').classList.remove('hidden')});$$('.delete-user').forEach(b=>b.onclick=()=>deletePlayer(b.dataset.id,b.dataset.name,b.dataset.username))}catch(e){toast(e.message)}}
async function deletePlayer(id,name,username){const ok=confirm(`確定永久刪除玩家「${name}」(@${username})？\n\n會一起清除：\n・玩家帳號與目前印章\n・所有抽獎紀錄\n・所有獎品兌換紀錄\n・所有印章異動紀錄\n\n如果這個玩家在目前這一彈抽過籤，該籤會恢復成可抽狀態，獎品數量也會補回。\n\n刪除後無法復原。`);if(!ok)return;try{const r=await api('/admin/users/'+id,{method:'DELETE'});toast(`已刪除 ${r.displayName||name}，清除 ${r.deletedDraws||0} 筆抽獎紀錄`);loadPlayers()}catch(e){toast(e.message)}}
$('#cancelStamp').onclick=()=>$('#stampModal').classList.add('hidden');
$('#stampForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));try{await api('/admin/users/'+f.userId+'/stamps',{method:'POST',body:JSON.stringify({amount:Number(f.amount),reason:f.reason})});$('#stampModal').classList.add('hidden');toast('印章已更新');loadPlayers()}catch(x){toast(x.message)}};
async function loadRewards(){try{
  const rows=await api('/admin/rewards'),box=$('#rewardsBox');
  if(!rows.length){box.innerHTML='<div class="card card-body">目前沒有需要兌換的獎品。</div>';return}

  const people=new Map();
  for(const r of rows){
    if(!people.has(r.user_id))people.set(r.user_id,{id:r.user_id,name:r.display_name,username:r.username,items:[]});
    people.get(r.user_id).items.push(r)
  }

  const rankOrder=s=>{
    const m=String(s||'').toUpperCase().match(/^([A-Z])/);
    return m?m[1].charCodeAt(0):999
  };
  const dateText=d=>new Date(d).toLocaleString('zh-TW');

  const personHtml=[...people.values()].map(person=>{
    const pendingTotal=person.items.filter(x=>!x.redeemed).length;
    const ranks=new Map();
    for(const item of person.items){
      const rk=item.rank||'其他獎項';
      if(!ranks.has(rk))ranks.set(rk,[]);
      ranks.get(rk).push(item)
    }

    const rankHtml=[...ranks.entries()].sort((a,b)=>rankOrder(a[0])-rankOrder(b[0])||a[0].localeCompare(b[0],'zh-Hant')).map(([rank,rankItems])=>{
      const prizes=new Map();
      for(const item of rankItems){
        const k=[item.lottery_id||item.title,item.round_no,item.name].join('||');
        if(!prizes.has(k))prizes.set(k,{sample:item,items:[]});
        prizes.get(k).items.push(item)
      }

      const prizeHtml=[...prizes.values()].map(group=>{
        const s=group.sample;
        const items=[...group.items].sort((a,b)=>{
          if(a.redeemed!==b.redeemed)return a.redeemed?1:-1;
          return new Date(b.draw_created_at)-new Date(a.draw_created_at)
        });
        const pending=items.filter(x=>!x.redeemed).length;
        const redeemed=items.length-pending;

        return `<section class="admin-prize-subgroup">
          <div class="admin-prize-subhead">
            ${s.image_url?`<img src="${esc(s.image_url)}" alt="${esc(s.name)}">`:'<div class="reward-category-placeholder">🎁</div>'}
            <div><h4>${esc(s.name)}</h4><span>${esc(s.title)}・第 ${s.round_no} 彈</span></div>
            <div class="reward-category-counts"><span class="reward-count-main">共 ${items.length} 件</span>${pending?`<span class="badge">待兌換 ${pending}</span>`:''}${redeemed?`<span class="badge reward-done-badge">已兌換 ${redeemed}</span>`:''}</div>
          </div>
          <div class="reward-category-items">
          ${items.map(x=>{
            const search=[person.name,person.username,x.rank,x.name,x.title,`第${x.round_no}彈`,x.ticket_number?String(x.ticket_number).padStart(3,'0'):'',x.redeemed?'已兌換':'待兌換',dateText(x.draw_created_at),x.redeemed_at?dateText(x.redeemed_at):''].join(' ').toLowerCase();
            return `<article class="reward-admin-entry admin-reward-search-item ${x.redeemed?'redeemed':''}" data-search="${esc(search)}">
              <div class="reward-entry-meta">
                <span class="reward-entry-ticket">${x.ticket_number?String(x.ticket_number).padStart(3,'0')+' 號':'無票號'}</span>
                <div><b>抽中日期</b><span>${dateText(x.draw_created_at)}</span>${x.redeemed&&x.redeemed_at?`<span class="redeemed-text">兌換日期：${dateText(x.redeemed_at)}</span>`:''}</div>
              </div>
              ${x.redeemed?'<span class="badge reward-done-badge">✓ 已兌換</span>':`<button class="btn redeem-btn" data-id="${x.redemption_id}" data-name="${esc(x.rank+'・'+x.name)}" data-player="${esc(person.name)}">確認兌換</button>`}
            </article>`
          }).join('')}
          </div>
        </section>`
      }).join('');

      return `<details class="admin-rank-group" open>
        <summary><span class="admin-rank-name">🎁 ${esc(rank)}</span><span class="badge">${rankItems.length} 件</span></summary>
        <div class="admin-rank-body">${prizeHtml}</div>
      </details>`
    }).join('');

    return `<section class="reward-admin-group admin-person-group">
      <div class="reward-admin-head"><div><h2>👤 ${esc(person.name)}</h2><span class="small">@${esc(person.username)}</span></div><div class="reward-person-summary"><span class="badge">獎品 ${person.items.length} 件</span><span class="badge">待兌換 ${pendingTotal} 件</span></div></div>
      <div class="admin-person-body">${rankHtml}</div>
    </section>`
  }).join('');

  box.innerHTML=`<div class="admin-reward-searchbar search-toolbar">
    <label class="search-box">🔎<input id="adminRewardSearch" type="search" placeholder="搜尋玩家、獎項、獎品、票號或日期"></label>
    <select id="adminRewardStatus" class="search-select"><option value="">全部狀態</option><option value="待兌換">待兌換</option><option value="已兌換">已兌換</option></select>
    <span id="adminRewardSearchCount" class="small">共 ${rows.length} 件</span>
  </div>${personHtml}<div id="adminRewardSearchEmpty" class="search-empty hidden">找不到符合的兌換獎品。</div>`;

  const filterRewards=()=>{
    const q=$('#adminRewardSearch').value.trim().toLowerCase();
    const status=$('#adminRewardStatus').value;
    let visible=0;

    $$('.admin-reward-search-item').forEach(item=>{
      const okQ=!q||item.dataset.search.includes(q);
      const okS=!status||item.dataset.search.includes(status);
      const ok=okQ&&okS;
      item.classList.toggle('search-hidden',!ok);
      if(ok)visible++
    });

    $$('.admin-prize-subgroup').forEach(g=>{
      const any=[...g.querySelectorAll('.admin-reward-search-item')].some(x=>!x.classList.contains('search-hidden'));
      g.classList.toggle('search-hidden',!any)
    });
    $$('.admin-rank-group').forEach(g=>{
      const any=[...g.querySelectorAll('.admin-prize-subgroup')].some(x=>!x.classList.contains('search-hidden'));
      g.classList.toggle('search-hidden',!any);
      if((q||status)&&any)g.open=true
    });
    $$('.admin-person-group').forEach(g=>{
      const any=[...g.querySelectorAll('.admin-rank-group')].some(x=>!x.classList.contains('search-hidden'));
      g.classList.toggle('search-hidden',!any)
    });

    $('#adminRewardSearchCount').textContent=`找到 ${visible}/${rows.length} 件`;
    $('#adminRewardSearchEmpty').classList.toggle('hidden',visible!==0)
  };

  $('#adminRewardSearch').oninput=filterRewards;
  $('#adminRewardStatus').onchange=filterRewards;

  $$('.redeem-btn').forEach(b=>b.onclick=async()=>{
    if(!confirm(`確定已將「${b.dataset.name}」交給 ${b.dataset.player}？\n\n確認後會記錄兌換時間。`))return;
    try{
      await api('/admin/rewards/'+b.dataset.id+'/redeem',{method:'POST'});
      toast('已標記為兌換完成');
      loadRewards()
    }catch(e){toast(e.message)}
  })
}catch(e){toast(e.message)}}
async function loadLogs(){try{const d=await api('/admin/logs');$('#logsBox').innerHTML=`<h2>抽獎紀錄</h2><div class="table-wrap"><table><thead><tr><th>時間</th><th>玩家</th><th>一番賞</th><th>號碼</th><th>結果</th><th>彈數</th></tr></thead><tbody>${d.draws.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('zh-TW')}</td><td>${esc(x.display_name)}</td><td>${esc(x.title)}</td><td>${x.ticket_number?String(x.ticket_number).padStart(3,'0'):'-'}</td><td>${esc(x.rank)}・${esc(x.name)}</td><td>${x.round_no}</td></tr>`).join('')}</tbody></table></div><h2>印章紀錄</h2><div class="table-wrap"><table><thead><tr><th>時間</th><th>玩家</th><th>異動</th><th>原因</th></tr></thead><tbody>${d.stamps.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('zh-TW')}</td><td>${esc(x.display_name)}</td><td>${x.amount>0?'+':''}${x.amount}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>`}catch(e){toast(e.message)}}
