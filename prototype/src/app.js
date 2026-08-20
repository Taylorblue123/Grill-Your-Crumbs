/* ============================================================
   Grill Your Crumbs — 交互原型
   五屏：landing → dash → setup → wb → done →（回）dash

   状态：
     screenName   当前屏
     intakeWay    'write' 自己写 / 'pick' 从材料里挑
     cursor       正在问第几题
     sessionCrumbs 本场装载了哪些材料（可拖进拖出）
     active       生效中的新事实 id  ← 撤回、计数、稿子长短全靠它
     promoted     被手动拖进简历的候补事实 id
     killed       被删掉的无出处片段
     panelState   四个面板各自的 min/norm/max

   稿子不是另一份状态：每个金色片段绑着 hs（依赖哪几条事实），
   每个蓝色片段绑着 ref（依赖哪条材料）。集合一变，稿子自己跟着变。
   ============================================================ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (t,c,h)=>{const n=document.createElement(t);if(c)n.className=c;if(h!=null)n.innerHTML=h;return n;};
const esc = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const SCREENS = ['landing','dash','opps','setup','wb','done'];
let screenName = 'landing';
let cursor = 0, rounds = [], answering = false, typing = null;
let active = new Set(), promoted = new Set(), killed = new Set();
let sessionCrumbs = new Set(CRUMBS.filter(c=>!c.off).map(c=>c.id));
let undoStack = [], sessionSaved = false;
let intakeWay = 'write', pickedExp = 'e1', ledgerKey = 'dim';
let targetId = 'tg1', jdPasted = false;   // 本场的 Target（null = 不设目标）

/* ═══════ 主题 ═══════ */
function toggleTheme(){
  const d = document.documentElement;
  const next = d.dataset.theme === 'dark' ? 'light' : 'dark';
  d.dataset.theme = next;
  $$('.theme span').forEach(s=>s.textContent = next==='dark' ? '☀' : '◐');
  toast(next==='dark' ? '深色：整套系统一起换，落地页也一样。' : '浅色：整套系统一起换，落地页也一样。');
}

/* ═══════ 面板系统 ═══════
   三态循环：norm → min → norm；⤢ 单独切 max。列宽全在这里算。 */
const PANELS = ['crumbs','grill','draft','ledger','target'];
const PANEL_LABEL = { crumbs:'材料', grill:'拷问', draft:'简历活稿', ledger:'收获账本', target:'目标 JD' };
const BASE = { crumbs:'minmax(196px,236px)', grill:'minmax(300px,1.05fr)',
               draft:'minmax(320px,1.25fr)', ledger:'minmax(260px,0.95fr)',
               target:'minmax(260px,0.95fr)' };
const MAXW = { crumbs:'minmax(320px,0.9fr)', grill:'minmax(460px,2.4fr)',
               draft:'minmax(460px,2.4fr)', ledger:'minmax(400px,2.2fr)',
               target:'minmax(400px,2.2fr)' };
/* 目标面板默认收起：Target 的「上下文」由顶部常驻条负责，
   这个面板只在需要和简历并排比对时才展开。 */
const PANEL_DEFAULT = { crumbs:'norm', grill:'norm', draft:'norm', ledger:'norm', target:'min' };
let panelState = {...PANEL_DEFAULT};
let barHidden = false;

function layout(){
  // 窄屏放不下四栏：自动把优先级低的收起，但用户的手动选择优先
  const w = innerWidth;
  const auto = {...panelState};
  if(w < 1180 && auto.crumbs === 'norm' && !panelState._userCrumbs) auto.crumbs = 'min';
  if(w < 900  && auto.ledger === 'norm' && !panelState._userLedger) auto.ledger = 'min';
  if(w < 700  && auto.draft  === 'norm' && !panelState._userDraft)  auto.draft  = 'min';

  $('#panels').style.gridTemplateColumns = PANELS
    .map(k => auto[k]==='min' ? '46px' : auto[k]==='max' ? MAXW[k] : BASE[k]).join(' ');
  PANELS.forEach(k=>{
    $('#p-'+k).classList.toggle('min', auto[k]==='min');
    const chip = $('#chip-'+k);
    chip.classList.toggle('on', auto[k]!=='min');
    chip.classList.toggle('big', auto[k]==='max');
    chip.title = auto[k]==='min' ? `展开${PANEL_LABEL[k]}` : `收起${PANEL_LABEL[k]}`;
  });
}
function cyclePanel(k){
  panelState[k] = panelState[k]==='min' ? 'norm' : 'min';
  panelState['_user'+k[0].toUpperCase()+k.slice(1)] = true;
  layout();
}
function maxPanel(k){
  const was = panelState[k]==='max';
  PANELS.forEach(p=>{ if(panelState[p]==='max') panelState[p]='norm'; });
  panelState[k] = was ? 'norm' : 'max';
  if(!was) PANELS.forEach(p=>{ if(p!==k && panelState[p]==='min') return; });
  layout();
  toast(was ? `${PANEL_LABEL[k]}恢复正常宽度。` : `${PANEL_LABEL[k]}放大了。再点 ⤢ 恢复。`);
}
function openPanel(k){ if(panelState[k]==='min'){ panelState[k]='norm'; layout(); } }
function resetLayout(){ panelState = {...PANEL_DEFAULT}; layout(); toast('布局重置了。目标面板默认收起——顶上那条已经告诉你这场是为谁做的。'); }
function toggleBar(){
  barHidden = !barHidden;
  $('#panelbar').classList.toggle('hid', barHidden);
  $('#barToggle').textContent = barHidden ? '▼ 展开面板条' : '▲ 收起面板条';
}
addEventListener('resize', ()=>{ if(screenName==='wb') layout(); });

/* ═══════ 屏幕切换 ═══════ */
function go(name){
  screenName = name;
  $$('.screen').forEach(s=>s.classList.toggle('on', s.id === 's-'+name));
  if(name==='done')  renderReveal();
  if(name==='dash')  renderDash();
  if(name==='opps')  renderOpps();
  if(name==='setup') renderSetup();
  if(name==='wb'){ layout(); renderTarget(); $('#cpIn').focus({preventScroll:true}); }
  drawSteppers();
  const sc = $('.screen.on .scroll'); if(sc) sc.scrollTop = 0;
}
function drawSteppers(){
  const labels = ['投喂','拷问','成果'], names = ['setup','wb','done'];
  const cur = SCREENS.indexOf(screenName);
  ['#stepper1','#stepper2','#stepper3'].forEach(sel=>{
    const nav = $(sel); if(!nav) return;
    nav.innerHTML = `<button class="step" onclick="go('dash')" title="回工作区"><b>⌂</b>工作区</button><span class="sep"></span>`
      + labels.map((l,i)=>{
        const idx = SCREENS.indexOf(names[i]);
        const cls = idx===cur ? 'on' : (idx<cur ? 'done' : '');
        return `<button class="step ${cls}" onclick="go('${names[i]}')"><b>${idx<cur?'✓':i+1}</b>${l}</button>`
          + (i<2 ? '<span class="sep"></span>' : '');
      }).join('');
  });
}

/* ═══════ 片段 ═══════ */
function segHTML(s, force){
  if(s.o==='grill'){
    const on = force || s.hs.every(h=>active.has(h));
    return `<span class="sg grill${on?'':' ghost'}" data-turn="${s.turn}" data-hs='${JSON.stringify(s.hs)}'>${s.t}</span> `;
  }
  if(s.o==='inferred')
    return `<span class="sg inferred" data-note="${esc(s.note)}">${s.t}${s.verified===false?'<span class="badge">无出处</span>':''}</span> `;
  const orphan = !force && !sessionCrumbs.has(s.ref);
  return `<span class="sg source${orphan?' orphan':''}" data-ref="${s.ref}">${s.t}${
    orphan?'<span class="badge">出处已移出</span>':''}</span> `;
}
function promotedSeg(id){ return { t:HARVEST[id].promote, o:'grill', turn:HARVEST[id].turn, hs:[id] }; }
function sheetHTML(force){
  const base = ARTIFACT.resume_bullets.map((b,i)=>{
    if(killed.has(i)) return '';
    const bad  = b.some(s=>s.o==='inferred' && s.verified===false);
    const thin = b.every(s=>s.o==='grill') && !b.some(s=>force||s.hs.every(h=>active.has(h)));
    const shown = force || b.some(x=>x.o!=='grill' || x.hs.every(h=>active.has(h)));
    const chips = shown ? jdChips((ARTIFACT.bullet_req[i]||[]).filter(rid=>{
      const t2 = curTarget(); if(!t2) return false;
      return reqState(t2.reqs.find(x=>x.id===rid)||{}) === 'ok';
    })) : '';
    return `<div class="bul${thin?' thin':''}" data-b="${i}"><span class="bd">—</span><span>${b.map(s=>segHTML(s,force)).join('')}
      ${chips?`<div class="jdrow" style="padding-left:0">${chips}</div>`:''}
      ${bad?`<div class="rowacts"><button class="mini del" onclick="killSeg(${i})">删掉这条</button>
        <button class="mini" onclick="ev('confirm_segment')">我确认，属实</button></div>`:''}</span></div>`;
  }).join('');
  const extra = [...promoted].filter(id=>force||active.has(id)).map(id=>
    `<div class="bul promoted" data-p="${id}"><span class="bd">—</span><span>${segHTML(promotedSeg(id),force)}
      <span class="pbadge">你手动加的</span>${jdChips(ARTIFACT.promoted_req[id])}
      <div class="rowacts"><button class="mini del" onclick="demote('${id}')">从简历移走</button></div></span></div>`).join('');
  return { bul: base + extra, intro: ARTIFACT.self_intro.map(s=>segHTML(s,force)).join('') };
}

/* ═══════ 面板 ①：材料（本场使用中 / 材料库，可互拖） ═══════ */
function crumbCard(c){
  const on = sessionCrumbs.has(c.id);
  return `<div class="src${on?'':' off'}" data-id="${c.id}" draggable="true">
    <div class="top2"><span class="ic">${SOURCE_ICON[c.type]}</span>
      <span class="nm">${c.name}</span><span class="n num" data-n="${c.id}">1</span></div>
    <div class="tx">${c.text}</div>
    <button class="pm2" onclick="toggleCrumb('${c.id}')" title="${on?'移出本场':'加进本场'}">${on?'−':'＋'}</button>
  </div>`;
}
function renderCrumbs(){
  const inS  = CRUMBS.filter(c=>sessionCrumbs.has(c.id));
  const outS = CRUMBS.filter(c=>!sessionCrumbs.has(c.id));
  $('#crumbsBody').innerHTML =
    `<div class="crumbsec">
       <div class="csec-h">本场使用中<span class="n on num">${inS.length}</span></div>
       <div class="cdrop" id="dropIn" data-zone="in">${inS.map(crumbCard).join('') ||
         '<p class="railnote" style="margin:6px 2px">一条都没有了。成稿里所有蓝色片段都会变成「出处已移出」。</p>'}</div>
     </div>
     <div class="crumbsec">
       <div class="csec-h">材料库 · 没进本场<span class="n num">${outS.length}</span></div>
       <div class="cdrop" id="dropOut" data-zone="out">${outS.map(crumbCard).join('') ||
         '<p class="railnote" style="margin:6px 2px">全都装进本场了。</p>'}</div>
     </div>
     <p class="railnote">悬停右边稿子里的<b style="color:var(--blue)">蓝色</b>片段 → 这里对应那条会高亮。<br>
       把材料拖出本场，引用它的句子会当场标红——<b>出处不在了，那句话就不再算「有出处」</b>。</p>`;
  const used = {};
  $$('#viewA .sg.source').forEach(s=>{used[s.dataset.ref]=(used[s.dataset.ref]||0)+1});
  Object.entries(used).forEach(([id,n])=>{
    const s = $(`.src[data-id="${id}"]`); if(!s) return;
    s.classList.add('hit'); s.querySelector('.n').textContent = n;
  });
  $('#pcCrumbs').textContent = inS.length;
  $('#minCrumbs').textContent = inS.length;
}
function toggleCrumb(id){
  const on = sessionCrumbs.has(id);
  const cited = $$(`#viewA .sg.source[data-ref="${id}"]`).length;
  if(on) sessionCrumbs.delete(id); else sessionCrumbs.add(id);
  undoStack.push({k:'crumb', id, was:on});
  mountSheetKeepScroll(); syncSegs(false); renderCrumbs();
  toast(on
    ? (cited ? `移出本场。成稿里有 ${cited} 处引用了它，已标成「出处已移出」。`
             : '移出本场了。成稿里没有句子引用它，所以稿子没变化。')
    : '加进本场了。下一轮提问会把它算进「我读过的材料」。', ()=>undo());
}
function aim(ids){ $$('.src').forEach(s=>s.classList.toggle('aim', ids.includes(s.dataset.id))); }


/* ═══════ Target（JD）══════════════════════════════════════
   一条要求的状态完全由「你有没有证据」决定，不是由匹配分决定：
     ok    已有材料证据，或者依赖的事实已经被挖到
     weak  只有沾边的证据
     none  还没有，但问得出来
     gap   你确实没有 —— 绝不为它生成文案
   最后一种是这一版的核心：JD 是检查表，不是模板。 */
function curTarget(){ return targetId ? TARGETS.find(t=>t.id===targetId) : null; }
/* 换目标的唯一入口：JD 对齐标记长在简历片段上，所以换目标必须重挂稿子，
   否则会留下上一个 JD 的 ↳ JD #n 标记。 */
function applyTarget(id){
  targetId = id;
  mountSheetKeepScroll(); syncSegs(false); renderTarget(); counts();
}
function reqState(r){
  if(r.fills && r.fills.length && r.fills.every(h=>active.has(h))) return 'ok';
  if(r.ev && r.ev.length) return 'ok';
  if(r.weak) return 'weak';
  return r.gap ? 'gap' : 'none';
}
function reqTally(t){
  const n = { ok:0, weak:0, none:0, gap:0 };
  (t ? t.reqs : []).forEach(r=>n[reqState(r)]++);
  return n;
}
/* 这条要求是刚刚被这一轮补上的吗 —— 用来做「○ → ●」的翻牌动画 */
function justFilled(r, ids){
  return r.fills && r.fills.length && ids && r.fills.some(h=>ids.includes(h)) && reqState(r)==='ok';
}
const REQ_MARK = { ok:'✓', weak:'◐', none:'○', gap:'✕' };
const REQ_WORD = { ok:'已对上', weak:'只有弱证据', none:'还没有 · 问得出来', gap:'你确实没有' };

function renderTarget(justIds){
  const t = curTarget();
  const bar = $('#tbar');
  if(!t){
    bar.innerHTML = `<span class="lb">目标</span>
      <span class="tt none2">这一场没有设定目标 —— 只做通用打磨</span>
      <span class="score"><button class="gbtn" style="padding:3px 10px;font-size:11.5px" onclick="go('setup')">去挑一个目标</button></span>`;
    $('#reqList').innerHTML = `<p class="reqnote">这一场没设目标。<br><br>
      设了目标之后，这里会是一张<b>要求清单</b>：哪几条你已经有证据、哪几条只有你能补、哪几条你确实没有。
      提问也会按缺口排优先级。</p>`;
    $('#pcTarget').textContent = '—'; $('#minTarget').textContent = '—';
    return;
  }
  const n = reqTally(t), total = t.reqs.length;
  bar.innerHTML = `<span class="lb">目标</span>
    <span class="tt">${t.title}<small>${t.org}</small></span>
    <span class="score">
      <button class="rstat ok jump"   onclick="jumpReq('ok')"><i class="d"></i>对上 <b>${n.ok}</b></button>
      <button class="rstat weak jump" onclick="jumpReq('weak')"><i class="d"></i>弱 <b>${n.weak}</b></button>
      <button class="rstat none jump" onclick="jumpReq('none')"><i class="d"></i>还能问出 <b>${n.none}</b></button>
      <button class="rstat gap jump"  onclick="jumpReq('gap')"><i class="d"></i>确实没有 <b>${n.gap}</b></button>
      <button class="gbtn" style="padding:3px 10px;font-size:11.5px" onclick="openPanel('target');maxPanel('target')">看清单 →</button>
    </span>`;
  $('#pcTarget').textContent = `${n.ok}/${total}`;
  $('#minTarget').textContent = n.ok;

  const order = ['none','weak','ok','gap'];
  $('#reqList').innerHTML =
    `<p class="reqnote">${t.title} · ${t.org}　共 <b>${total} 条</b>要求。<br>
       这里报的是<b>可数的状态</b>，不是「匹配度 78%」。</p>`
    + order.map(st=>{
      const list = t.reqs.filter(r=>reqState(r)===st);
      if(!list.length) return '';
      return `<div class="reqsec"><h6>${REQ_WORD[st]}<span class="ln"></span>${list.length}</h6>`
        + list.map(r=>{
          const jf = justFilled(r, justIds);
          const ev = (r.fills||[]).filter(h=>active.has(h));
          return `<div class="req ${st}${jf?' just':''}" data-r="${r.id}">
            <div class="rh"><span class="mk">${REQ_MARK[st]}</span>
              <span class="rt">${r.text}</span>
              <span class="kd ${r.kind}">${REQ_KIND[r.kind]}</span></div>
            ${st==='ok' && ev.length ? `<div class="ev2">↳ 第 ${TURN_BY_ID[HARVEST[ev[0]].turn].round} 轮挖到：${ev.map(h=>HARVEST[h].text).join(' ／ ')}</div>` : ''}
            ${st==='ok' && !ev.length && r.ev ? `<div class="ev2">↳ ${r.ev.map(c=>`<span class="tg src">${SOURCE_ICON[CRUMB_BY_ID[c].type]} ${CRUMB_BY_ID[c].name}</span>`).join('')}</div>` : ''}
            ${st==='weak' ? `<div class="ev2">↳ <b>差在哪：</b>${r.weak.text}
                ${(r.weak.refs||[]).map(c=>`<span class="tg src">${CRUMB_BY_ID[c].name}</span>`).join('')}
                ${r.fills?`<button class="ask" onclick="askFor('${r.id}')">去问这条 →</button>`:''}</div>` : ''}
            ${st==='none' ? `<div class="ev2">↳ 材料里 <b>0 条</b>证据，但这件事<b>问得出来</b>
                <button class="ask" onclick="askFor('${r.id}')">去问这条 →</button></div>` : ''}
            ${st==='gap' ? `<div class="ev2">↳ 这条<b>问不出来</b>——你确实没有。不会为它生成任何文案。</div>` : ''}
          </div>`;
        }).join('') + '</div>';
    }).join('')
    + (n.gap ? `<div class="gapnote"><b>那 ${n.gap} 条「确实没有」的，我们不会替你圆。</b><br>
        市面上按 JD 改简历的工具会给你编一句出来。我们把它留在这儿，是因为
        <b>你需要知道自己真正缺什么</b>——那是去补技能的信号，不是去补文案的信号。</div>` : '');
}
function jumpReq(st){
  openPanel('target');
  const t = curTarget(); if(!t) return;
  const n = reqTally(t)[st];
  if(!n){ toast(`「${REQ_WORD[st]}」现在是 0 条。`); return; }
  const first = t.reqs.find(r=>reqState(r)===st);
  const node = $(`.req[data-r="${first.id}"]`);
  if(node){ node.scrollIntoView({block:'center',behavior:'smooth'});
    node.style.outline='2px solid var(--fg)'; node.style.outlineOffset='2px';
    setTimeout(()=>{node.style.outline='';}, 1300); }
  toast(`${REQ_WORD[st]}：${n} 条`);
}
/* 从要求清单直接跳到会补上它的那一轮 */
function askFor(rid){
  const t = curTarget(); const r = t.reqs.find(x=>x.id===rid);
  const turn = TURNS.find(tn=>tn.jdReq && tn.jdReq.includes(rid))
            || TURNS.find(tn=>(tn.harvest||[]).some(h=>(r.fills||[]).includes(h)));
  if(!turn){ toast('这条没有对应的问题——它属于「问不出来」那一类。'); return; }
  openPanel('grill');
  if(TURNS.indexOf(turn) < cursor){
    peekTurn(turn.id);
    toast(`第 ${turn.round} 轮已经问过了，它补的就是这一条。`);
  }else{
    toast(`这条会在<b>第 ${turn.round} 轮</b>问到：${turn.question.slice(0,34)}…`);
  }
}
/* 简历片段上的 JD 对齐标记 —— 和三色出处正交的第二个轴 */
function jdChips(reqIds){
  const t = curTarget(); if(!t || !reqIds || !reqIds.length) return '';
  return reqIds.map(id=>{
    const r = t.reqs.find(x=>x.id===id); if(!r) return '';
    const i = t.reqs.indexOf(r) + 1;
    return `<span class="jdchip" data-req="${id}" title="JD 第 ${i} 条：${esc(r.text)}">↳ JD #${i}</span>`;
  }).join('');
}

/* ═══════ 面板 ④：收获账本（原 Thread 成果已并入） ═══════
   栏目 = 维度或标签；每条只标它来自第几轮，不重复问题本身。 */
function setLedgerKey(k){
  ledgerKey = k;
  $('#lkDim').classList.toggle('on', k==='dim');
  $('#lkTag').classList.toggle('on', k==='tag');
  renderLedger();
}
function itemHTML(id, isNew){
  const h = HARVEST[id], t = TURN_BY_ID[h.turn];
  const cand = isCand(id) && !promoted.has(id);
  const dest = promoted.has(id) ? '简历（你加的）' : h.dest;
  return `<div class="item${cand?' cand':''}${isNew?' born':''}" data-i="${id}"${cand?' draggable="true"':''}>
    ${cand?'<span class="grip2">⠿</span>':''}
    <div class="tx">${h.text}</div>
    <div class="tagrow">${
      (ledgerKey==='dim' ? h.tags : [h.dim].concat(h.tags))
        .map((x,i)=>`<span class="tg${ledgerKey==='tag'&&i===0?' dim':''}">#${x}</span>`).join('')}</div>
    <div class="meta">
      <button onclick="peekTurn('${h.turn}')" title="跳到左边那一轮">第 ${t.round} 轮 ↗</button>
      <span class="s">·</span><span class="dest">→ ${dest}</span>
      ${cand?`<span class="s">·</span><button class="add" onclick="promote('${id}')">拖进简历 ＋</button>`:''}
      <span class="s">·</span><button class="undo" onclick="dropItem('${id}')">撤回</button>
    </div></div>`;
}
function renderLedger(newIds){
  const box = $('#ledger');
  const ids = [...active];
  let groups;
  if(ledgerKey === 'dim'){
    groups = DIMS.map(k => [k, ids.filter(id=>HARVEST[id].dim===k)]);
  }else{
    const seen = [];
    ids.forEach(id=>HARVEST[id].tags.forEach(t=>{ if(!seen.includes(t)) seen.push(t); }));
    groups = seen.map(k => [k, ids.filter(id=>HARVEST[id].tags.includes(k))]);
  }
  const open = new Set($$('#ledger .lgroup.open').map(g=>g.dataset.k));

  const head = `<div style="display:flex;align-items:center;gap:8px;padding:0 2px 9px">
      <span class="lgHint" style="padding:0">${ledgerKey==='dim'
        ? '按<b>维度</b>分栏。空栏＝这场还没问到那个角度，不是「完成度 0%」。'
        : '按<b>标签</b>分栏。同一条事实可以同时出现在几个标签下。'}</span></div>`;

  box.innerHTML = head + (groups.length ? groups.map(([k, list])=>{
    const isOpen = list.length && (open.has(k) || (newIds||[]).some(id=>
      ledgerKey==='dim' ? HARVEST[id].dim===k : HARVEST[id].tags.includes(k)) || !open.size);
    return `<div class="lgroup${list.length?'':' empty'}${isOpen?' open':''}" data-k="${k}">
      <button class="lg-h" onclick="this.parentNode.classList.toggle('open')">
        <span class="caret">▶</span><span class="k">${k}</span>
        <span class="b${list.length?' has':''} num">${list.length}</span></button>
      <div class="lg-b">${list.map(id=>itemHTML(id,(newIds||[]).includes(id))).join('')}</div></div>`;
  }).join('') : `<p class="lgHint">还没有收获。<br>每答完一题，这里按栏目长出可数的条目——<b>问题本身在左边拷问栏，这里不重复一遍</b>。</p>`);

  ['#pcLedger','#minLedger'].forEach(s=>$(s).textContent = active.size);
  if(newIds && newIds.length){
    const c = $('#pcLedger'); c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse');
  }
}

/* ═══════ 面板 ③：计数 ═══════ */
function syncSegs(anim){
  $$('#viewA .sg.grill').forEach(s=>{
    const hs = JSON.parse(s.dataset.hs);
    const on = hs.every(h=>active.has(h));
    const was = !s.classList.contains('ghost');
    s.classList.toggle('ghost', !on);
    const b = s.closest('.bul');
    if(on && !was && anim){
      s.classList.add('born'); setTimeout(()=>s.classList.remove('born'), 820);
      if(b){ b.classList.remove('thin'); b.classList.add('flash'); setTimeout(()=>b.classList.remove('flash'),1100); }
    }
    if(b && !b.querySelector('.sg.source') && !b.querySelector('.sg.grill:not(.ghost)')) b.classList.add('thin');
  });
  counts();
}
function counts(){
  const srcOK  = $$('#viewA .sg.source:not(.orphan)').length;
  const orphan = $$('#viewA .sg.source.orphan').length;
  const totalGrill = $$('#viewA .sg.grill').length;
  const gold = $$('#viewA .sg.grill:not(.ghost)').length;
  const inf  = ARTIFACT.stats.n_inferred - killed.size + orphan;
  const total = srcOK + totalGrill + inf;
  $('#cS').style.width = srcOK/total*100 + '%';
  $('#cG').style.width = gold/total*100 + '%';
  $('#cF').style.width = (totalGrill-gold)/total*100 + '%';
  $('#nS').textContent = srcOK;
  $('#nG').textContent = gold;
  $('#nF').textContent = totalGrill - gold;
  $('#nI').textContent = inf;
  $('#denom').textContent = `共 ${total} 个片段 ⓘ`;
  $('#pcDraft').textContent = gold;
  $('#minDraft').textContent = gold;
  $('#rounds').textContent = `${Math.min(cursor,TURNS.length)} / ${TURNS.length}`;
  $('#minGrill').textContent = rounds.length;
  $('#undoBtn').disabled = !undoStack.length;
}

/* ═══════ 面板 ②：grill ═══════ */
function renderGrill(){
  const g = $('#grill');
  g.innerHTML = rounds.map(r=>{
    const t = TURNS[r.ti];
    const sub = r.kind==='flagged' ? '你判定：这问题没意义 → 已记为负样本'
              : r.kind==='skipped' ? '（跳过）' : r.text;
    return `<div class="past${r.kind==='flagged'?' dead':''}" data-ti="${r.ti}">
      <button class="pu" onclick="undoRound(${r.ti})">撤回这一轮</button>
      <div class="pq">第 ${t.round} 轮 · ${t.question}</div><div class="pa">${esc(sub)}</div></div>`;
  }).join('');

  if(cursor >= TURNS.length){
    g.appendChild(el('div','finish',
      `<h4>问完了。右边那份稿子，就是刚才这几轮的产物。</h4>
       <p>没有“揭晓”动作——因为你一路都看着它长出来。</p>
       <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
         <button class="act go" onclick="go('done')">看成果 →</button>
         <button class="act" onclick="undo()">撤回上一轮</button></div>`));
    tip0('问完了。也可以撤回任意一轮，稿子会跟着回退。');
    g.scrollTop = g.scrollHeight; counts(); return;
  }

  const t = TURNS[cursor], dead = t.status==='flagged_useless';
  g.appendChild(el('div','qcard',
   `<div class="qc-h"><span class="dimtag">${t.dim}</span>第 ${t.round} 轮 · 共 ${TURNS.length} 轮
      <span style="margin-left:auto"><span class="qsrc ${t.src}">${
        t.src==='jd' && curTarget() ? 'JD 缺口驱动' : '通用维度'}</span></span></div>
    <div class="qc-b">
      <div class="q">${t.question}</div>
      <div class="grip">
        <span class="lv${t.grip.lv==='中'?' mid':''}">把握 ${t.grip.lv}</span>
        <span class="ev">${t.grip.ev}</span>
        ${t.grip.refs.length?`<button class="ref" onclick="showRefs(${JSON.stringify(t.grip.refs).replace(/"/g,'&quot;')})">看是哪 ${t.grip.refs.length} 条 →</button>`:''}
      </div>
      ${(!dead && t.jdLine && curTarget() && t.src==='jd')?`<div class="jdwhy"><span class="h6">这一题是 JD 逼出来的</span>${t.jdLine}</div>`:''}
      ${(!dead && t.src==='general' && curTarget())?`<div class="jdwhy" style="border-left-color:var(--gold);background:var(--gold-bg);color:var(--gold-ink)"><span class="h6" style="color:var(--gold)">这一题不是 JD 逼出来的</span>${t.jdLine||'预算里留了 2 轮打「只有你有」的东西——只盯着 JD 会把你身上最独特的部分漏掉。'}</div>`:''}
      ${dead?'':`<div class="why"><b>我为什么问这个</b>${t.why}</div>
      <div class="guess"><b>我的猜测 · 点头就行，不用从头写</b><div class="gbox">${t.guess}</div></div>`}
    </div>`));
  g.appendChild(el('div','acts', dead
    ? `<button class="act bad" style="background:var(--red-bg);border-color:var(--red-bd);color:var(--red);font-weight:600"
        onclick="flagBad()">这问题没意义 ✕</button>
       <button class="act" onclick="skip()">跳过这题</button>`
    : `<button class="act go" onclick="startAnswer()">我来补充</button>
       <button class="act" onclick="acceptGuess()">就按你猜的算</button>
       <button class="act" onclick="skip()">跳过这题</button>
       <button class="act bad" onclick="flagBad()">这问题没意义</button>`));
  if(curTarget()){
    const used = rounds.map(r=>TURNS[r.ti].src);
    g.appendChild(el('div','budget',
      `<span>提问预算 <b>4 : 2</b>（JD 缺口 : 只有你有）</span>
       <span class="bseg">${TURNS.map((tn,i)=>
         `<i class="bs2 ${tn.src==='jd'?'jd':'gen'}${i>=cursor?' pend':''}" title="第 ${tn.round} 轮 · ${tn.src==='jd'?'JD 驱动':'通用维度'}"></i>`).join('')}</span>
       <span>已用 ${used.filter(x=>x==='jd').length} : ${used.filter(x=>x==='general').length}</span>`));
  }
  answering = false;
  tip0(dead ? '这一轮它问砸了——点「这问题没意义」，它会承认并换一个。'
            : '想自己说？直接在下面的输入框里写，回车发送。');
  g.scrollTop = g.scrollHeight;
  counts();
}
function showRefs(ids){ openPanel('crumbs'); aim(ids); toast(`高亮了 ${ids.length} 条材料 —— 它就是靠这几条判断自己有没有把握。`); }

/* ═══════ 常驻输入框 ═══════ */
function tip0(m){ $('#cpTip').classList.remove('hot'); $('#cpTipTxt').textContent = m; }
function tipHot(m){ $('#cpTip').classList.add('hot'); $('#cpTipTxt').textContent = m; }
function composerReady(on){
  $('#cpSend').classList.toggle('ready', on);
  if(on){ $('#cpSend').classList.remove('pulse'); void $('#cpSend').offsetWidth; $('#cpSend').classList.add('pulse'); }
}
function typeInto(text){
  return new Promise(res=>{
    const box = $('#cpBox'), inp = $('#cpIn');
    if(typing) clearInterval(typing);
    box.classList.add('typing'); inp.textContent = '';
    const car = el('span','car'); inp.appendChild(car);
    let i = 0;
    typing = setInterval(()=>{
      if(i >= text.length){
        clearInterval(typing); typing = null; car.remove();
        box.classList.remove('typing'); composerReady(true);
        tipHot('写好了 → 按「发送」，或者继续改。'); res(); return;
      }
      car.insertAdjacentText('beforebegin', text[i++]);
      inp.scrollTop = inp.scrollHeight;
    }, 15);
  });
}
async function startAnswer(){
  if(cursor >= TURNS.length || answering) return;
  openPanel('grill');
  tipHot('正在把你的回答打进输入框…（演示：真实产品里这里是你自己敲）');
  $('#cpIn').focus({preventScroll:true});
  await typeInto(TURNS[cursor].answer);
}
async function acceptGuess(){
  if(cursor >= TURNS.length || answering) return;
  tipHot('把它的猜测填进输入框——你可以直接发，也可以先改两个字。');
  await typeInto(TURNS[cursor].guess.replace(/[？?]$/,'，对。'));
  await sleep(520); send();
}
function send(){
  if(cursor >= TURNS.length){ toast('已经问完了。可以去成果页，或者撤回某一轮再答一次。'); return; }
  if(answering) return;
  const text = $('#cpIn').textContent.trim();
  if(!text){ toast('先写点什么 —— 或者点上面的「就按你猜的算」，我会替你填。'); $('#cpIn').focus(); return; }
  if(TURNS[cursor].status === 'flagged_useless'){
    toast('这一轮我问砸了，你写什么我都接不住。点「这问题没意义」我换一个。'); return;
  }
  commit(text);
}
async function commit(text){
  answering = true;
  const t = TURNS[cursor];
  $('#grill .acts')?.remove();
  const card = $('#grill .qcard');
  const ub = el('div','ublock',
    `<button class="uu" onclick="undo()">撤回</button>
     <div class="uh"><span class="av">你</span>你的回答</div>
     <div class="ut">${esc(text)}</div>`);
  card.querySelector('.qc-b').appendChild(ub);
  $('#cpIn').textContent = ''; composerReady(false);
  $('#grill').scrollTop = $('#grill').scrollHeight;

  const ids = t.harvest.slice();
  ids.forEach(id=>active.add(id));
  undoStack.push({k:'round', ti:cursor, kind:'answered', text, ids});

  await sleep(420);
  const nCand = ids.filter(isCand).length;
  ub.appendChild(el('div','harv',
    `<span class="hl">拆出 ${ids.length} 条 →</span>`
    + ids.map(id=>`<span class="tg dim">#${HARVEST[id].dim}</span>`).join('')
    + (nCand?`<span class="tg">${nCand} 条列为候补</span>`:'')));
  renderLedger(ids); mountSheetKeepScroll(); syncSegs(true); renderTarget(ids);
  const nFill = curTarget() ? curTarget().reqs.filter(r=>justFilled(r,ids)).length : 0;
  if(nFill) setTimeout(()=>toast(`这一轮补上了 JD 的 ${nFill} 条要求。`), 900);
  bump(`+${ids.length} 条 · 稿子里 ${$$('#viewA .sg.grill:not(.ghost)').length} 处金色`);
  tipHot(`记进账本了：${ids.length} 条。不满意随时撤回，稿子会跟着退回去。`);
  $('#grill').scrollTop = $('#grill').scrollHeight;

  await sleep(1500);
  rounds.push({ti:cursor, kind:'answered', text});
  cursor++; renderGrill();
}
function skip(){
  if(cursor >= TURNS.length || answering) return;
  undoStack.push({k:'round', ti:cursor, kind:'skipped', text:'', ids:[]});
  rounds.push({ti:cursor, kind:'skipped', text:''});
  cursor++; renderGrill();
  toast('跳过了。跳过不会丢——回头还能从「撤回上一步」倒回来。');
}
function flagBad(){
  if(cursor >= TURNS.length || answering) return;
  undoStack.push({k:'round', ti:cursor, kind:'flagged', text:'', ids:[]});
  rounds.push({ti:cursor, kind:'flagged', text:''});
  cursor++; renderGrill();
  toast('已写入 events.jsonl → Good-Question-Rate 负样本。评测集长在交互里，不用另外标注。');
}

/* ═══════ 候补 → 简历 ═══════ */
function promote(id){
  if(!active.has(id)){ toast('这条已经被撤回了，先放回来再加。'); return; }
  if(promoted.has(id)){ toast('它已经在简历里了。'); return; }
  promoted.add(id); openPanel('draft');
  mountSheetKeepScroll(); syncSegs(true); renderLedger(); counts(); renderTarget();
  const b = $(`.bul[data-p="${id}"]`);
  if(b){ b.classList.add('flash'); b.scrollIntoView({block:'center',behavior:'smooth'});
         setTimeout(()=>b.classList.remove('flash'),1100); }
  undoStack.push({k:'promote', id});
  toast(`「${HARVEST[id].text.slice(0,13)}…」写进简历了。出处仍然绑着第 ${TURN_BY_ID[HARVEST[id].turn].round} 轮。`, ()=>undo());
}
function demote(id){
  if(!promoted.has(id)) return;
  promoted.delete(id);
  mountSheetKeepScroll(); syncSegs(false); renderLedger(); counts(); renderTarget();
  undoStack.push({k:'demote', id});
  toast('移回候补了。事实还在账本里，只是不进这份简历。', ()=>undo());
}

/* ═══════ 撤回 ═══════ */
function undo(){
  const u = undoStack.pop();
  if(!u){ toast('没有可撤回的了。'); return; }
  if(u.k === 'round'){
    u.ids.forEach(id=>{ active.delete(id); promoted.delete(id); });
    const i = rounds.findIndex(r=>r.ti===u.ti);
    if(i >= 0) rounds.splice(i,1);
    cursor = u.ti; answering = false;
    renderGrill(); renderLedger(); mountSheetKeepScroll(); syncSegs(false); renderTarget(); renderTarget();
    toast(`撤回了第 ${TURNS[u.ti].round} 轮${u.ids.length?`，账本少了 ${u.ids.length} 条，稿子里对应的金色片段已退回骨架`:''}。`);
  } else if(u.k === 'item'){
    active.add(u.id); renderLedger([u.id]); mountSheetKeepScroll(); syncSegs(true);
    toast(`「${HARVEST[u.id].text.slice(0,14)}…」放回来了。`);
  } else if(u.k === 'kill'){
    killed.delete(u.i); mountSheetKeepScroll(); syncSegs(false);
    toast('那句无出处的套话放回来了。');
  } else if(u.k === 'promote'){
    promoted.delete(u.id); mountSheetKeepScroll(); syncSegs(false); renderLedger();
    toast('从简历里移走了，事实仍然留在账本。');
  } else if(u.k === 'demote'){
    promoted.add(u.id); mountSheetKeepScroll(); syncSegs(true); renderLedger();
    toast('又加回简历了。');
  } else if(u.k === 'crumb'){
    if(u.was) sessionCrumbs.add(u.id); else sessionCrumbs.delete(u.id);
    mountSheetKeepScroll(); syncSegs(false); renderCrumbs();
    toast(u.was ? '材料放回本场了。' : '材料又移出去了。');
  }
  counts();
}
function undoRound(ti){
  const last = rounds[rounds.length-1];
  if(!last || last.ti !== ti){
    toast(`要先撤回第 ${TURNS[last.ti].round} 轮——回退是按顺序来的，不然稿子会对不上。`); return;
  }
  const idx = undoStack.map(u=>u.k==='round' ? u.ti : -1).lastIndexOf(ti);
  if(idx < 0){ toast('这一轮撤不了。'); return; }
  undoStack.splice(idx+1); undo();
}
function dropItem(id){
  if(!active.has(id)) return;
  active.delete(id); promoted.delete(id);
  undoStack.push({k:'item', id});
  renderLedger(); mountSheetKeepScroll(); syncSegs(false); renderTarget();
  toast('撤回了 1 条新事实，稿子里依赖它的句子已退回骨架。', ()=>undo());
}
function killSeg(i){
  killed.add(i); undoStack.push({k:'kill', i});
  mountSheetKeepScroll(); syncSegs(false);
  toast('删掉了。已写入 events.jsonl → 幻觉样本，这就是评测集的原料。', ()=>undo());
}

/* ═══════ 成果页 ═══════ */
function goldCount(){
  const base = ARTIFACT.resume_bullets.flat().concat(ARTIFACT.self_intro)
    .filter(s=>s.o==='grill' && s.hs.every(h=>active.has(h))).length;
  return base + [...promoted].filter(id=>active.has(id)).length;
}
function renderReveal(){
  const gold = goldCount();
  const inf = ARTIFACT.stats.n_inferred - killed.size;
  const ansRounds = rounds.filter(r=>r.kind==='answered').length;
  const flagged   = rounds.filter(r=>r.kind==='flagged').length;
  const totalGrill = ARTIFACT.stats.n_grill + promoted.size;

  $('#rS').textContent = ARTIFACT.stats.n_source;
  $('#rG').textContent = gold;
  $('#rI').textContent = inf;
  $('#bsG').textContent = active.size;
  $('#bsR').textContent = ansRounds;
  $('#bsX').textContent = flagged;
  $('#bsI').textContent = inf;
  $('#lsN').textContent = active.size;
  $('#hbSum').textContent = `共 ${active.size} 条新事实，来自 ${ansRounds} 轮回答`;
  $('.rv-h h2').innerHTML = gold
    ? `同一段经历，<em id="rvN">${gold} 处</em>是刚刚从你嘴里挖出来的——<br>你原来那${intakeWay==='pick'?'堆材料里':'  73 个字里'}，一个都没有。`
    : `你一题都没答，所以成稿里只剩<em id="rvN">材料里本来就有的东西</em>。<br>回工作台答两题，这一栏就会变样。`;

  // 方式 B 没有用户原文，BEFORE 换成「材料里只有这些」
  if(intakeWay === 'pick'){
    const e = EXPERIENCES.find(x=>x.id===pickedExp) || EXPERIENCES[0];
    $('.pn.before .pn-t').innerHTML = '<span>BEFORE</span>你的材料里只有这些';
    $('#oldText').innerHTML = e.crumbs.map(id=>{
      const c = CRUMB_BY_ID[id];
      return `<div style="margin-bottom:8px;font-size:13px"><b style="color:var(--fg-mute);font-size:11px">${c.name}</b><br>${c.text}</div>`;
    }).join('');
    $('.old-note').innerHTML = `${e.crumbs.length} 条材料，全是<b>事实碎片</b>：有代码、有事故、有一句吵架记录，<br>
      但没有一条说清了<b>结局、取舍和你的角色</b>。<br>你一个字都没写，这一整段是问出来的。`;
  }else{
    $('.pn.before .pn-t').innerHTML = '<span>BEFORE</span>你自己写的那一版';
    $('#oldText').textContent = BASELINE;
    $('.old-note').innerHTML = '73 个字，零个数字，零个决策，零个困难。<br>这不是你写得差——是<b>没人问过你正确的问题</b>。';
  }

  const bulHTML = ARTIFACT.resume_bullets.map((b,i)=>{
    if(killed.has(i)) return '';
    const segs = b.filter(s=>s.o!=='grill' || s.hs.every(h=>active.has(h)));
    if(!segs.length) return '';
    return `<div class="bul"><span class="bd">—</span><span>${segs.map(s=>segHTML(s,true)).join('')}</span></div>`;
  }).join('')
  + [...promoted].filter(id=>active.has(id)).map(id=>
    `<div class="bul promoted"><span class="bd">—</span><span>${segHTML(promotedSeg(id),true)}<span class="pbadge">你手动加的</span></span></div>`).join('');
  const missing = totalGrill - gold;
  $('#bullets2').innerHTML = bulHTML + (missing
    ? `<div class="hint" style="margin-top:12px">还有 <b>${missing} 处</b>没挖到，所以这份稿子比它能有的样子薄。
       <button class="mini" style="margin-left:6px" onclick="go('wb')">回工作台继续问 →</button></div>` : '');
  $('#intro2').innerHTML = ARTIFACT.self_intro
    .filter(s=>s.o!=='grill' || s.hs.every(h=>active.has(h))).map(s=>segHTML(s,true)).join('');

  renderJDBoard();
  $('#hbBody').innerHTML = DIMS.map(k=>{
    const items = [...active].filter(id=>HARVEST[id].dim===k);
    return `<div class="hcol"><h5>${k}<span class="b${items.length?'':' zero'} num">${items.length}</span></h5>
      ${items.length
        ? `<ul>${items.map(id=>{const h=HARVEST[id];return `<li><i>◆</i><span>${h.text}
            <span class="tagrow" style="margin-top:4px">${h.tags.map(x=>`<span class="tg">#${x}</span>`).join('')}
            <span class="tg src">第 ${TURN_BY_ID[h.turn].round} 轮</span>
            <span class="tg">→ ${promoted.has(id)?'简历（你加的）':h.dest}</span></span></span></li>`}).join('')}</ul>`
        : `<p class="none">这一维度这次没挖到——不是“完成度 0%”，是这场没问到。</p>`}
    </div>`;
  }).join('');
}
function renderJDBoard(){
  const t = curTarget(), box = $('#jdBoard');
  if(!t){ box.innerHTML = ''; box.style.display='none'; return; }
  box.style.display = '';
  const n = reqTally(t), matched = t.reqs.filter(r=>reqState(r)==='ok');
  const gaps = t.reqs.filter(r=>reqState(r)==='gap');
  const left = t.reqs.filter(r=>['none','weak'].includes(reqState(r)));
  box.innerHTML = `
    <div class="hb-h"><h3>对上这个 JD 了吗 · ${t.title}</h3>
      <small>${t.org} · 共 ${t.reqs.length} 条要求</small></div>
    <div class="jdb-b">
      <div class="jdcol"><h5>对上了<span class="b" style="background:var(--blue-bg);color:var(--blue-ink);border:1px solid var(--blue-bd)">${matched.length}</span></h5>
        <ul>${matched.map(r=>`<li><i style="color:var(--blue)">✓</i><span>${r.text}
          ${(r.fills||[]).some(h=>active.has(h))?`<span class="tg dim">第 ${TURN_BY_ID[HARVEST[r.fills.find(h=>active.has(h))].turn].round} 轮挖到的</span>`:'<span class="tg src">材料里本来就有</span>'}</span></li>`).join('')}</ul></div>
      <div class="jdcol"><h5>还没补上<span class="b" style="background:var(--sunk2);color:var(--fg-mute)">${left.length}</span></h5>
        ${left.length?`<ul>${left.map(r=>`<li><i>○</i><span>${r.text}<span class="tg">问得出来 · 回工作台</span></span></li>`).join('')}</ul>`
          :'<p class="hcol none" style="font-style:italic;color:var(--fg-mute);font-size:11.5px">能问出来的都问完了。</p>'}</div>
      <div class="honest">
        <b>这份稿子对上了 ${matched.length} / ${t.reqs.length} 条。</b>
        剩下 ${t.reqs.length-matched.length} 条里，有 <b>${gaps.length} 条是你确实没有的</b>：${gaps.map(r=>`「${r.text}」`).join('、')}。<br>
        我们<b>没有替你圆这几条</b>——市面上按 JD 改简历的工具会给你编一句出来。
        把它留在这儿，是因为你需要知道自己真正缺什么：那是去补技能的信号，不是去补文案的信号。
      </div>
    </div>`;
}
function finishToDash(){
  sessionSaved = true; ev('save_thread'); go('dash');
  setTimeout(()=>toast(`存好了。「校园二手交易平台 · 推荐系统」这段经历多了 ${active.size} 条事实，产出物挂在它下面。`), 400);
}

/* ═══════ ① Dashboard：以经历为单位 ═══════ */
function liveExp(){
  const dims = {};
  [...active].forEach(id=>{ const d=HARVEST[id].dim; dims[d]=(dims[d]||0)+1; });
  return {
    id:'x1', now:true, title:'校园二手交易平台 · 推荐系统', span:'2025.03 – 2025.09',
    crumbs:sessionCrumbs.size, rounds:`${rounds.length} / ${TURNS.length}`,
    when: sessionSaved ? '刚刚' : (rounds.length ? '进行中' : '还没开始'),
    state: sessionSaved ? 'done' : (rounds.length ? 'live' : 'new'), dims,
    arts: sessionSaved ? ['实习简历 · EXPERIENCE','60 秒自我介绍'] : [],
    facts:[...active].map(id=>({ ...HARVEST[id], id,
      dest: promoted.has(id) ? '简历（你加的）' : HARVEST[id].dest,
      from:`第 ${TURN_BY_ID[HARVEST[id].turn].round} 轮` }))
  };
}
function expCard(e){
  const total = Object.values(e.dims).reduce((a,b)=>a+b,0);
  const filled = Object.keys(e.dims).filter(k=>e.dims[k]).length;
  const st = { done:'已成型', live:'进行中', thin:'还很薄', new:'待开始' }[e.state] || '';
  const stc = { done:'done', live:'live', thin:'draft', new:'draft' }[e.state] || 'draft';
  return `<div class="exp${e.now?' now':''}" data-e="${e.id}">
    <div class="exp-h">
      <div class="t1">${e.title}<span class="state ${stc}">${st}</span></div>
      <div class="t2">${e.span}</div>
    </div>
    <div class="matrix">${DIMS.map(d=>{
      const n = e.dims[d]||0;
      return `<div class="mcell${n?' has':''}" title="${d}：${n} 条"><b>${n||'·'}</b><span>${d}</span></div>`;
    }).join('')}</div>
    <div class="exp-stat">
      <span>材料 <b>${e.crumbs}</b> 条</span>
      <span>事实 <b>${total}</b> 条</span>
      <span>维度 <b>${filled}</b> / 6</span>
      <span>问过 <b>${e.rounds}</b> 轮</span>
    </div>
    <div class="exp-arts">${e.arts.length
      ? e.arts.map(a=>`<span class="artchip">${a}</span>`).join('')
      : '<span class="artchip none">还没喂给任何一份稿子</span>'}</div>
    <div class="expfacts">${
      DIMS.filter(d=>e.facts.some(f=>f.dim===d)).map(d=>
        `<div class="dimgroup">${d}<span class="ln"></span><span class="c num">${e.facts.filter(f=>f.dim===d).length}</span></div>`
        + e.facts.filter(f=>f.dim===d).map(f=>`
          <div class="fb${String(f.dest).startsWith('候补')?' cand':''}">
            <div class="tx">${f.text}</div>
            <div class="mt">${f.tags.map(x=>`<span class="tg">#${x}</span>`).join('')}
              <span class="s">·</span>${f.from}<span class="s">·</span>→ ${f.dest}</div></div>`).join('')
      ).join('') || '<p class="lgHint" style="padding:0">这段还没有事实。开一场 Grill 就会开始攒。</p>'}</div>
    <div class="exp-f">
      ${e.now
        ? `<button class="mini2 ${sessionSaved?'':'pri'}" onclick="go('${rounds.length?'wb':'setup'}')">${rounds.length&&!sessionSaved?'继续拷问':'再挖几轮'}</button>`
        : `<button class="mini2" onclick="ev('resume_thread')">继续拷问</button>`}
      <button class="mini2" onclick="toggleFacts('${e.id}')">看事实 (${total})</button>
      ${e.now && sessionSaved ? `<button class="mini2" onclick="go('done')">看成果</button>` : ''}
      <span class="when">${e.when}</span>
    </div></div>`;
}
function toggleFacts(id){ $(`.exp[data-e="${id}"]`)?.classList.toggle('open'); }
function renderDash(){
  const live = liveExp();
  const exps = [live].concat(PAST_EXP);
  $('#expCnt').textContent = exps.length;
  $('#expGrid').innerHTML = exps.map(expCard).join('');

  // 待办：候补 + 没问完的经历
  const candNow  = [...active].filter(id=>isCand(id) && !promoted.has(id)).length;
  const candPast = PAST_EXP.reduce((n,e)=>n + e.facts.filter(f=>f.dest==='候补').length, 0);
  const unfinished = PAST_EXP.filter(e=>e.state==='thin').length + (rounds.length && !sessionSaved ? 1 : 0);
  const bits = [];
  if(candNow+candPast) bits.push(`<b>${candNow+candPast} 条候补事实</b>还没进任何一份稿子`);
  if(unfinished)       bits.push(`<b>${unfinished} 段经历</b>问到一半`);
  $('#inbox').className = bits.length ? 'inbox' : 'inbox calm';
  $('#inbox').innerHTML = bits.length
    ? `<span class="t">待你决定：${bits.join('　·　')}。<br>
        <span style="opacity:.8">候补不是垃圾——是「这次用不上，但面试被追问能展开」的料。</span></span>
       <span class="a">
         <button class="mini2 gold" onclick="go('wb');openPanel('ledger')">去处理候补</button>
         ${rounds.length&&!sessionSaved?`<button class="mini2" onclick="go('wb')">继续没问完的那场</button>`:''}
       </span>`
    : `<span class="t">没有待办。挖到的每条事实都有去处，每段经历都问到了自然停下的地方。</span>
       <span class="a"><button class="mini2" onclick="go('setup')">＋ 开一场新的</button></span>`;

  const arts = (sessionSaved ? [{ title:'实习简历 · EXPERIENCE ＋ 60 秒自我介绍', kind:'简历',
      exps:['校园二手交易平台 · 推荐系统'], when:'刚刚', now:true,
      prov:[ARTIFACT.stats.n_source, goldCount(), ARTIFACT.stats.n_inferred-killed.size] }] : [])
    .concat(PAST_ARTIFACTS);
  $('#artCnt2').textContent = arts.length;
  $('#artStrip').innerHTML = arts.map(a=>{
    const tot = a.prov[0]+a.prov[1]+a.prov[2] || 1;
    return `<div class="scard">
      <div class="t1">${a.title}${a.now?'<span class="state done">刚刚生成</span>':''}</div>
      <div class="t2">${a.kind} · 由 ${a.exps.map(x=>`<b>${x}</b>`).join(' ＋ ')} 喂出来 · ${a.when}<br>
        <b>${a.prov[0]}</b> 有材料出处 / <b>${a.prov[1]}</b> 挖出来的 / <b>${a.prov[2]}</b> 待确认</div>
      <div class="provbar"><i class="s" style="width:${a.prov[0]/tot*100}%"></i><i class="g" style="width:${a.prov[1]/tot*100}%"></i><i class="f" style="width:${a.prov[2]/tot*100}%"></i></div>
      <div class="a"><button class="mini2" onclick="${a.now?"go('done')":"ev('open_artifact')"}">打开</button>
        <button class="mini2" onclick="ev('export_md')">导出</button></div></div>`;
  }).join('');

  $('#srcGrid').innerHTML = CRUMBS.map(c=>
    `<div class="scell"><div class="t1"><span class="ic">${SOURCE_ICON[c.type]}</span>${c.name}</div>
      <div class="t2">${SOURCE_LABEL[c.type]}${sessionCrumbs.has(c.id)?' · 本场使用中':''}</div></div>`).join('');
}


/* ═══════ 投喂页的 Target 选择 ═══════ */
function setTarget(id){
  jdPasted = false;
  $('#jdPaste').style.display = id==='paste' ? 'block' : 'none';
  applyTarget(id==='paste' ? null : id);
  renderSetup();
}
function parseJD(){
  const txt = $('#jdText').value.trim();
  if(txt.length < 20){ toast('粘一段真的 JD 进来——职责和要求都要，我才拆得出条目。'); return; }
  jdPasted = true; applyTarget('tg1');
  renderSetup();
  toast('拆成 14 条要求了。demo 里解析结果是预设的，真实产品里这一步是模型做的。');
  setTimeout(()=>$('#tgSummary').scrollIntoView({block:'center',behavior:'smooth'}), 200);
}
function renderTargetPicker(){
  const opts = TARGETS.filter(t=>!t.entryOnly).map(t=>{
    const n = reqTally(t);
    return `<button class="tgopt${targetId===t.id&&!$('#jdPaste')?'':''}${targetId===t.id?' on':''}" onclick="setTarget('${t.id}')">
      <span class="tk">${t.kind} · 已收藏</span>
      <h5>${t.title}</h5>
      <p>${t.org} · ${t.reqs.length} 条要求<br>现在对上 <b>${n.ok}</b> · 还能问出 <b>${n.none+n.weak}</b> · 确实没有 <b>${n.gap}</b></p></button>`;
  }).join('');
  $('#tgOpts').innerHTML = opts
    + `<button class="tgopt${$('#jdPaste')&&$('#jdPaste').style.display==='block'?' on':''}" onclick="setTarget('paste')">
        <span class="tk">＋ 新的</span><h5>贴一段 JD</h5>
        <p>把岗位描述整段粘进来，我拆成一条一条的要求。</p></button>`
    + `<button class="tgopt${targetId===null&&$('#jdPaste').style.display!=='block'?' on':''}" onclick="setTarget(null)">
        <span class="tk none">不设目标</span><h5>只做通用打磨</h5>
        <p>不对任何岗位，就把这段经历本身讲清楚。提问全部走通用维度。</p></button>`;

  const t = curTarget();
  $('#tgSummary').innerHTML = !t
    ? `<div class="hint">没设目标也能跑——提问会全部走通用维度，成果页不会有 JD 对齐那一栏。</div>`
    : (()=>{ const n = reqTally(t);
        return `<div class="picked" style="margin-top:14px">
          <h5>${t.title} · ${t.org}　共 ${t.reqs.length} 条要求</h5>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
            <span class="rstat ok"><i class="d"></i>已对上 <b>${n.ok}</b></span>
            <span class="rstat weak"><i class="d"></i>只有弱证据 <b>${n.weak}</b></span>
            <span class="rstat none"><i class="d"></i>还没有，但问得出来 <b>${n.none}</b></span>
            <span class="rstat gap"><i class="d"></i>你确实没有 <b>${n.gap}</b></span>
          </div>
          <div class="reqlist" style="padding:12px 0 0">${
            ['weak','none','gap'].map(st=>{
              const list = t.reqs.filter(r=>reqState(r)===st).slice(0, st==='gap'?2:3);
              if(!list.length) return '';
              return list.map(r=>`<div class="req ${st}"><div class="rh">
                <span class="mk">${REQ_MARK[st]}</span><span class="rt">${r.text}</span>
                <span class="kd ${r.kind}">${REQ_KIND[r.kind]}</span></div>
                ${st==='gap'?'<div class="ev2">↳ 这条问不出来，不会为它生成任何文案。</div>':
                  '<div class="ev2">↳ 这条<b>只有你能补</b>，拷问时会优先问。</div>'}</div>`).join('');
            }).join('')
          }<p class="reqnote" style="padding-top:6px">…完整清单在工作台右边第五个面板里，随时能展开。</p></div>
          <p class="note">提问预算 <b>4 : 2</b> —— 6 轮里 4 轮打 JD 缺口，2 轮打「只有你有」的东西。
            只盯着 JD 会把你身上最独特的部分漏掉。</p>
        </div>`; })();
}


/* ═══════ ①b 机会页 ═══════
   岗位和人是同一件事：拿我的事实去对外部的要求。
   所以这一页和工作区共用同一个事实库，只是换了个方向看。 */
function renderOpps(){
  const real = TARGETS.filter(t=>!t.entryOnly);
  $('#oppCnt').textContent = TARGETS.length;

  const totalNone = real.reduce((a,t)=>a+reqTally(t).none+reqTally(t).weak, 0);
  $('#oppInbox').className = totalNone ? 'inbox' : 'inbox calm';
  $('#oppInbox').innerHTML = totalNone
    ? `<span class="t">待你决定：<b>${real.length} 个机会</b>还有 <b>${totalNone} 条要求</b>能靠拷问补上。<br>
        <span style="opacity:.8">补缺口不是改文案——是把你其实做过、但从没说出口的事挖出来。</span></span>
       <span class="a"><button class="mini2 gold" onclick="startFromTarget('${real[0].id}')">从「${real[0].title}」开始补</button></span>`
    : `<span class="t">所有机会的缺口都补完了。剩下的是你确实没有的，那不是文案能解决的。</span>`;

  $('#oppGrid').innerHTML = real.map(t=>{
    const n = reqTally(t);
    const best = bestExpFor(t);
    return `<div class="opp">
      <div class="opp-h">
        <div class="t1">${t.title}<span class="kindtag ${t.kind==='RA'?'ra':''}">${t.kind}</span></div>
        <div class="t2">${t.org} · 共 ${t.reqs.length} 条要求</div>
      </div>
      <div class="opp-score">
        <span class="rstat ok"><i class="d"></i>对上 <b>${n.ok}</b></span>
        <span class="rstat weak"><i class="d"></i>弱 <b>${n.weak}</b></span>
        <span class="rstat none"><i class="d"></i>还能问出 <b>${n.none}</b></span>
        <span class="rstat gap"><i class="d"></i>确实没有 <b>${n.gap}</b></span>
      </div>
      <div class="opp-rel">最相关的经历：<b>${best.title}</b>${best.note?` · ${best.note}`:''}<br>
        ${n.gap?`那 <b>${n.gap}</b> 条确实没有的（${t.reqs.filter(r=>reqState(r)==='gap').map(r=>r.text.replace(/（.*?）/g,'')).join(' / ')}）<b>不会被写进稿子</b>。`:''}</div>
      <div class="opp-f">
        <button class="mini2 pri" onclick="startFromTarget('${t.id}')">去补缺口</button>
        <button class="mini2" onclick="previewTarget('${t.id}')">看要求清单</button>
        <button class="mini2" onclick="ev('tailor_resume')">出一版稿子</button>
        <span class="when">${t.when}</span>
      </div></div>`;
  }).join('')
  + (()=>{ const e = TARGETS.find(t=>t.entryOnly); return `<div class="opp entry">
      <div class="opp-h"><div class="t1">${e.title}<span class="kindtag soon">先留个入口</span></div>
        <div class="t2">对称匹配 · 和实习/RA 走的不是同一条路</div></div>
      <div class="opp-rel" style="padding-top:4px">实习和 RA 是<b>不对称</b>的：对方发布要求，你去对。<br>
        合伙人是<b>对称</b>的：双方都是一堆事实，要互相看。<br>
        这一版先不做设计——它更接近下面「同频的人」那条路，而不是上面的要求清单。</div>
      <div class="opp-f"><button class="mini2" onclick="ev('cofounder_waitlist')">留个位置</button>
        <span class="when">未开始</span></div></div>`; })();

  $('#peerGrid').innerHTML = PEERS.map(p=>`
    <div class="peer">
      <div class="ph"><span class="av2">${p.handle[1].toUpperCase()}</span>
        <span><span class="hn">${p.handle}</span><span class="ln2">${p.line}</span></span></div>
      <div class="why2">为什么给你看他</div>
      <div class="ovl">${p.overlap.map(x=>`<span class="tg dim">#${x}</span>`).join('')}</div>
      <div class="quote">${p.theirs}</div>
      <div class="mine">↳ ${p.mineHint}</div>
      <div class="a2"><button class="mini2" onclick="ev('open_peer_thread')">看他的 thread</button>
        <button class="mini2" onclick="ev('say_hi')">打招呼</button></div>
    </div>`).join('');

  $('#visGrid').innerHTML = VISIBILITY.map(v=>`
    <div class="vlayer${v.locked?' lock':''}">
      <div class="vh"><span class="vn">${v.name}</span>
        <span class="toggle2${v.on?' on':''}${v.locked?' dis':''}"><i></i></span></div>
      <div class="vd">${v.desc}</div>
      <span class="vs ${v.locked?'lockv':(v.on?'on':'off')}">${v.state}</span>
    </div>`).join('');
}
function bestExpFor(t){
  const cands = [{ id:'e1', title:'校园二手交易平台 · 推荐系统' }]
    .concat(PAST_EXP.map(e=>({ id:e.id, title:e.title })));
  if(t.id === 'tg2') return { title:'校园二手交易平台 · 推荐系统', note:'双塔召回 + 精排，方向完全对得上' };
  return { title:'校园二手交易平台 · 推荐系统', note:`本场正在挖，已经补上 ${reqTally(t).ok} 条` };
}
/* 「去补缺口」＝ 开一场以这个目标为锚的拷问 —— 两块功能在这里合流 */
function startFromTarget(id){
  applyTarget(id); go('setup');
  setTimeout(()=>toast(`目标换成「${curTarget().title}」了。下面的经历列表已经按「能对上几条」重排。`), 300);
}
function previewTarget(id){
  applyTarget(id); go('wb'); openPanel('target'); maxPanel('target');
}

/* ═══════ ② 投喂：两种方式 ═══════ */
function setWay(w){
  intakeWay = w;
  $('#wayA').classList.toggle('on', w==='write');
  $('#wayB').classList.toggle('on', w==='pick');
  $('#bodyWrite').classList.toggle('on', w==='write');
  $('#bodyPick').classList.toggle('on', w==='pick');
  renderSetup();
}
function pickExp(id){ pickedExp = id; renderSetup(); }
function expCovers(e){
  const t = curTarget(); if(!t) return null;
  // 这段经历能对上 JD 的哪几条：它自己的材料 + 它能问出来的事实
  const own = new Set(e.crumbs);
  return t.reqs.filter(r=>
    (r.ev||[]).some(c=>own.has(c)) ||
    (r.weak && (r.weak.refs||[]).some(c=>own.has(c))) ||
    (e.id==='e1' && (r.fills||[]).length)
  ).length;
}
function renderSetup(){
  renderTargetPicker();
  const sorted = [...EXPERIENCES].sort((a,b)=>(expCovers(b)||0)-(expCovers(a)||0));
  $('#expOpts').innerHTML = sorted.map(e=>{
    const na = e.id !== 'e1';
    return `<button class="eopt${pickedExp===e.id?' on':''}${na?' na':''}" onclick="pickExp('${e.id}')">
      <span class="et">${e.title}<span class="span">${e.span}</span>
        <span class="heat ${e.heat}">材料${e.heat}</span>
        ${expCovers(e)!==null?`<span class="heat 中">能对上 JD ${expCovers(e)} 条</span>`:''}
        ${e.recommend?'<span class="heat 厚">建议先挖这段</span>':''}</span>
      <div class="why">${e.why}</div>
      <div class="fromrow"><span class="lb">聚自</span>${e.crumbs.map(c=>
        `<span class="tg src">${SOURCE_ICON[CRUMB_BY_ID[c].type]} ${CRUMB_BY_ID[c].name}</span>`).join('')}</div>
      <span class="est">${na?'demo 未含这段脚本':e.est}</span></button>`;
  }).join('');

  const e = EXPERIENCES.find(x=>x.id===pickedExp);
  const na = pickedExp !== 'e1';
  $('#pickedBox').innerHTML = na
    ? `<h5>已选：${e.title}</h5>
       <p class="note">这个原型只跑通了第一段的拷问脚本（6 轮问答是手写的假数据）。
         <b>换回「校园二手交易平台」才能开始</b>——真实产品里三段都能问。</p>`
    : `<h5>已选：${e.title} · 这就是本场的基准</h5>
       <div class="bl">${e.crumbs.map(id=>CRUMB_BY_ID[id].text).join(' ／ ')}</div>
       <p class="note">注意：<b>这段基准是从你材料里拼的，不是你写的</b>。所以最后的对比不是「你写的 vs 成稿」，
         而是「<b>材料里本来有的 vs 问出来之后的</b>」。成果页会照这个口径展示。</p>`;
  $('#startBtn').disabled = intakeWay==='pick' && na;
  $('#startBtn').style.opacity = $('#startBtn').disabled ? .45 : 1;
  $('#startBtn').style.pointerEvents = $('#startBtn').disabled ? 'none' : 'auto';

  $('#crumbgrid').innerHTML = CRUMBS.filter(c=>sessionCrumbs.has(c.id)).map(c=>
    `<div class="cr"><span class="ic">${SOURCE_ICON[c.type]}</span>
      <span style="min-width:0"><span class="nm">${c.name}</span><span class="tx">${c.text}</span></span>
      <span class="ck">✓</span></div>`).join('');
  $('#crumbHint').innerHTML = `本场装了 <b>${sessionCrumbs.size}</b> 条（库里共 ${CRUMBS.length} 条），
    约 4,200 tokens，<b>全部塞进 context，不做检索</b>。进了工作台还能随时拖进拖出。`;
}

/* ═══════ 挂载 / 重置 ═══════ */
function mountSheet(){
  const s = sheetHTML(false);
  $('#bullets').innerHTML = s.bul;
  $('#intro').innerHTML = s.intro;
  renderCrumbs();
}
function mountSheetKeepScroll(){
  const b = $('#outBody'), top = b ? b.scrollTop : 0;
  mountSheet();
  if(b) b.scrollTop = top;
}
function restart(){
  cursor = 0; rounds = []; answering = false; sessionSaved = false;
  active = new Set(); promoted = new Set(); killed = new Set(); undoStack = [];
  sessionCrumbs = new Set(CRUMBS.filter(c=>!c.off).map(c=>c.id));
  $('#cpIn').textContent = ''; composerReady(false);
  panelState = {...PANEL_DEFAULT};
  mountSheet(); renderLedger(); renderGrill(); syncSegs(false); layout(); counts(); renderTarget();
}

/* ═══════ 交互杂项 ═══════ */
function flash(kind){
  const sel = kind==='ghost' ? '#viewA .sg.grill.ghost'
            : kind==='grill' ? '#viewA .sg.grill:not(.ghost)'
            : kind==='source' ? '#viewA .sg.source:not(.orphan)' : `#viewA .sg.${kind}`;
  openPanel('draft');
  const ns = $$(sel);
  if(!ns.length){ toast('这一类现在是 0 个。'); return; }
  ns.forEach(n=>{ n.style.outline='2px solid var(--fg)'; n.style.outlineOffset='2px';
    setTimeout(()=>{n.style.outline='';n.style.outlineOffset='';}, 1200); });
  ns[0].scrollIntoView({block:'center',behavior:'smooth'});
}
/* 账本条目 →「第 N 轮 ↗」：跳到左边那一轮，而不是把问题再抄一遍 */
function peekTurn(tid){
  const t = TURN_BY_ID[tid];
  openPanel('grill');
  const ti = TURNS.findIndex(x=>x.id===tid);
  const node = $(`#grill .past[data-ti="${ti}"]`) || (cursor===ti ? $('#grill .qcard') : null);
  if(node){
    node.scrollIntoView({block:'center',behavior:'smooth'});
    node.style.background='var(--gold-bg)'; node.style.borderRadius='8px';
    setTimeout(()=>{node.style.background='';}, 1400);
  }
  toast(`第 ${t.round} 轮：${t.question.slice(0,42)}…`);
}

/* ═══════ 拖拽 ═══════ */
document.addEventListener('dragstart', e=>{
  const cand = e.target.closest('.item.cand');
  if(cand){
    e.dataTransfer.setData('text/plain','fact:'+cand.dataset.i);
    e.dataTransfer.effectAllowed='copy';
    cand.classList.add('drag'); document.body.classList.add('dragging');
    openPanel('draft'); return;
  }
  const src = e.target.closest('.src');
  if(src){
    e.dataTransfer.setData('text/plain','crumb:'+src.dataset.id);
    e.dataTransfer.effectAllowed='move';
    src.classList.add('drag'); document.body.classList.add('cdrag');
  }
});
document.addEventListener('dragend', ()=>{
  document.body.classList.remove('dragging','cdrag');
  $$('.item.drag,.src.drag').forEach(n=>n.classList.remove('drag'));
  $$('.cdrop.over').forEach(n=>n.classList.remove('over'));
  $('#dropzone').classList.remove('over');
});
document.addEventListener('dragover', e=>{
  const dz = e.target.closest('#dropzone');
  if(dz){ e.preventDefault(); e.dataTransfer.dropEffect='copy'; dz.classList.add('over'); return; }
  const cd = e.target.closest('.cdrop');
  if(cd){ e.preventDefault(); e.dataTransfer.dropEffect='move';
    $$('.cdrop').forEach(n=>n.classList.toggle('over', n===cd)); }
});
document.addEventListener('dragleave', e=>{
  if(e.target.closest('#dropzone')) $('#dropzone').classList.remove('over');
});
document.addEventListener('drop', e=>{
  const data = e.dataTransfer.getData('text/plain') || '';
  const dz = e.target.closest('#dropzone');
  if(dz && data.startsWith('fact:')){
    e.preventDefault(); dz.classList.remove('over');
    document.body.classList.remove('dragging');
    promote(data.slice(5)); return;
  }
  const cd = e.target.closest('.cdrop');
  if(cd && data.startsWith('crumb:')){
    e.preventDefault(); cd.classList.remove('over');
    const id = data.slice(6), wantIn = cd.dataset.zone === 'in';
    if(sessionCrumbs.has(id) !== wantIn) toggleCrumb(id);
  }
});

/* ═══════ 出处 popover ═══════ */
const pop = $('#pop');
document.addEventListener('mouseover', e=>{
  const d = e.target.closest('#denom');
  if(d){
    const tg = $$('#viewA .sg.grill').length, or = $$('#viewA .sg.source.orphan').length;
    pop.innerHTML = `<div class="h"><em>分母是怎么来的</em></div>
      成稿被切成 <b>${$$('#viewA .sg.source').length + tg + ARTIFACT.stats.n_inferred - killed.size} 个可数片段</b>（句子/从句级），
      每个只有三种归属：有材料出处、刚从你嘴里挖出来、AI 自己补的。<br><br>
      报的是<b>片段个数</b>，不是「完成度」——没人能确定你把一件事讲完了没有，但谁都能数清有几句指得出出处。
      ${or?`<br><br>其中 <b>${or} 处</b>的材料被你移出了本场，所以它们现在算「无出处」。`:''}`;
    place(pop, d); return;
  }
  const t = e.target.closest('.sg');
  if(!t || t.classList.contains('ghost')){ pop.style.display='none'; aim([]); return; }
  let h = '';
  if(t.dataset.ref){
    const c = CRUMB_BY_ID[t.dataset.ref], gone = !sessionCrumbs.has(c.id);
    h = `<div class="h"><em>${SOURCE_ICON[c.type]} ${c.name}</em> · ${SOURCE_LABEL[c.type]} · ${c.id}</div>${c.text}
      ${gone?'<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--pop-line);color:var(--red)">⚠ 这条材料已被移出本场，所以这句话现在没有出处。</div>':''}`;
    aim([t.dataset.ref]); if(screenName==='wb') openPanel('crumbs');
  } else if(t.dataset.turn){
    const tn = TURN_BY_ID[t.dataset.turn], hs = JSON.parse(t.dataset.hs||'[]');
    h = `<div class="h">🔥 <em>第 ${tn.round} 轮 · ${tn.id}</em> · 你的原话</div>${tn.answer}
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--pop-line);opacity:.72">
      依赖 ${hs.length} 条新事实：${hs.map(x=>HARVEST[x].text).join(' ／ ')}</div>`;
    aim([]);
  } else if(t.dataset.note){ h = `<div class="h">⚠ <em>无出处</em></div>${t.dataset.note}`; aim([]); }
  pop.innerHTML = h; place(pop, t);
});
function place(p, t){
  p.style.display = 'block';
  const r = t.getBoundingClientRect();
  p.style.left = Math.max(10, Math.min(r.left, innerWidth - p.offsetWidth - 14)) + 'px';
  p.style.top  = (r.bottom + 8 > innerHeight - 130 ? r.top - p.offsetHeight - 8 : r.bottom + 8) + 'px';
}
document.addEventListener('mouseout', e=>{ if(e.target.closest('.sg,#denom')) pop.style.display='none'; });

/* ═══════ toast / bump / 埋点 ═══════ */
let tt;
function toast(m, undoFn){
  const t = $('#toast');
  t.innerHTML = esc(m).replace(/&lt;br&gt;/g,'<br>') + (undoFn ? ' <span class="u" id="tU">撤回</span>' : '');
  if(undoFn) $('#tU').onclick = ()=>{ undoFn(); t.classList.remove('on'); };
  t.classList.add('on'); clearTimeout(tt);
  tt = setTimeout(()=>t.classList.remove('on'), undoFn ? 4600 : 3200);
}
function bump(m){ const b = $('#bump'); b.textContent = m; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
function ev(type){ toast(`已埋点 events.jsonl → {"type":"${type}"}　这就是评测集的原料`); }

/* ═══════ 自动演示 ═══════ */
let tour = false;
function stopTour(){ tour = false; $('#autobar').classList.remove('on');
  $$('#tourBtn0,#tourBtn1,#tourBtn2').forEach(b=>{b.textContent='自动演示 ▶';b.classList.remove('on')}); }
function tourSay(s){ $('#autoTxt').innerHTML = '自动演示 · <b>'+s+'</b>'; }
async function wait(ms){ const step = 60; for(let i=0;i<ms;i+=step){ if(!tour) throw 'stop'; await sleep(step); } }
async function autoTour(){
  if(tour){ stopTour(); return; }
  tour = true; $('#autobar').classList.add('on');
  $$('#tourBtn0,#tourBtn1,#tourBtn2').forEach(b=>{b.textContent='停止演示 ❚❚';b.classList.add('on')});
  try{
    restart(); setWay('write'); targetId='tg1'; go('landing'); tourSay('⓪ 落地页');
    const sc = $('#s-landing .scroll');
    await wait(2200); sc.scrollTo({top:$('#why').offsetTop-40,behavior:'smooth'});
    await wait(2600); sc.scrollTo({top:$('#how').offsetTop-40,behavior:'smooth'});
    await wait(2400);

    go('dash'); tourSay('① 工作区 · 按「经历」组织'); await wait(3200);
    go('opps'); tourSay('①b 机会 · 岗位和人，都是拿事实去对外部要求'); await wait(4200);
    go('setup'); tourSay('② 投喂 · ① 产出什么（格式） ② 为谁做（Target）'); await wait(2400);
    tourSay('② Target · JD 拆成 14 条要求：对上 / 弱 / 能问出 / 确实没有'); await wait(4000);
    setWay('pick'); tourSay('② 方式 B · 经历按「能对上 JD 几条」重排'); await wait(3600);
    setWay('write');
    go('wb'); tourSay('③ 工作台 · 顶上常驻 Target 条，五个面板'); await wait(2600);
    openPanel('target'); maxPanel('target'); tourSay('③ 第五面板 · 要求清单（默认收起，需要时展开）'); await wait(3600);
    maxPanel('target'); cyclePanel('target'); await wait(900);

    for(let i=0;i<TURNS.length;i++){
      if(!tour) throw 'stop';
      const t = TURNS[i];
      tourSay(`第 ${t.round}/6 轮 · ${t.dim}`);
      await wait(1300);
      if(t.status === 'flagged_useless'){
        tourSay(`第 ${t.round}/6 轮 · 它问砸了，用户判它没意义`);
        await wait(1200); flagBad(); await wait(1400); continue;
      }
      await startAnswer(); await wait(600);
      send(); await wait(2200);
      if(i === 1){
        tourSay('面板可收可放：材料收到边上，简历放大'); await wait(400);
        cyclePanel('crumbs'); await wait(1500); maxPanel('draft'); await wait(2200);
        maxPanel('draft'); cyclePanel('crumbs'); await wait(900);
      }
      if(i === 2){
        tourSay('账本可以按维度分栏，也可以按标签分栏'); await wait(1200);
        setLedgerKey('tag'); await wait(2400); setLedgerKey('dim'); await wait(1200);
        tourSay('候补事实：默认不进简历，用户手动拖进去'); await wait(1200);
        promote('h10'); await wait(2400);
      }
      if(i === 3){
        tourSay('答完 → JD 清单上那几条从 ○ 翻成 ✓'); await wait(1000);
        openPanel('target'); await wait(2800); cyclePanel('target'); await wait(700);
        tourSay('把材料拖出本场 → 引用它的句子当场变成「无出处」'); await wait(1000);
        toggleCrumb('c4'); await wait(2400); toggleCrumb('c4'); await wait(1200);
      }
    }
    tourSay('④ 成果 · 原文 vs 成稿'); await wait(1200);
    go('done'); await wait(2600);
    tourSay('④ 诚实的收尾：对上 12/14，剩下 2 条你确实没有');
    $('#s-done .rv-b').scrollTo({top:$('#jdBoard').offsetTop-120, behavior:'smooth'}); await wait(4200);
    tourSay('⑤ 存回工作区 —— 那段经历变厚了一截');
    finishToDash(); await wait(3800);
    tourSay('演示结束 · 现在你可以自己点了');
    await wait(2400); stopTour();
  }catch(e){ /* 用户接管 */ }
}

/* ═══════ 键盘 ═══════ */
$('#cpIn').addEventListener('keydown', e=>{ if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
$('#cpIn').addEventListener('focus', ()=>$('#cpBox').classList.add('focus'));
$('#cpIn').addEventListener('blur',  ()=>$('#cpBox').classList.remove('focus'));
$('#cpIn').addEventListener('input', ()=>composerReady(!!$('#cpIn').textContent.trim()));
document.addEventListener('keydown', e=>{
  const typingNow = e.target.closest('[contenteditable],input,textarea');
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); if(screenName==='wb') undo(); return; }
  if(e.key === 'Escape'){ stopTour(); pop.style.display='none'; return; }
  if(screenName==='wb' && !typingNow && ['1','2','3','4','5'].includes(e.key)){
    e.preventDefault(); cyclePanel(PANELS[+e.key-1]);
  }
});

/* ═══════ 初始化 ═══════ */
$('#ta').value = BASELINE;
$('#taCount').textContent = `　当前 ${BASELINE.length} 字。`;
$('#forx').innerHTML = GOALS.map((g,i)=>`<button class="chip${i?'':' on'}" onclick="pickGoal(this,'${g}')">${g}</button>`).join('');
function pickGoal(b, g){ $$('#forx .chip').forEach(c=>c.classList.remove('on')); b.classList.add('on'); $('#goalTxt').textContent = g; }
$('#specBody').innerHTML = ARTIFACT.self_intro.map(s=>segHTML(s,true)).join('');

restart(); renderSetup();

/* 跳到某个状态：#screen=wb&round=3&panel=crumbs:min&theme=dark&promote=h10&way=pick */
function seek(n){
  restart();
  for(let i=0;i<n && cursor<TURNS.length;i++){
    const t = TURNS[cursor];
    const kind = t.status==='flagged_useless' ? 'flagged' : 'answered';
    const ids  = kind==='answered' ? t.harvest.slice() : [];
    ids.forEach(id=>active.add(id));
    undoStack.push({k:'round', ti:cursor, kind, text:kind==='answered'?t.answer:'', ids});
    rounds.push({ti:cursor, kind, text:kind==='answered'?t.answer:''});
    cursor++;
  }
  renderGrill(); renderLedger(); mountSheetKeepScroll(); syncSegs(false); renderTarget(); renderTarget(); counts();
}
(function bootFromHash(){
  const p = new URLSearchParams(location.hash.slice(1));
  if(p.get('theme')==='dark'){ document.documentElement.dataset.theme='dark'; $$('.theme span').forEach(s=>s.textContent='☀'); }
  if(p.has('round'))   seek(+p.get('round'));
  if(p.has('promote')) p.get('promote').split(',').forEach(id=>{ if(active.has(id)) promoted.add(id); });
  if(p.has('drop'))    p.get('drop').split(',').forEach(id=>sessionCrumbs.delete(id));
  if(p.has('saved'))   sessionSaved = true;
  if(p.has('target'))  targetId = p.get('target')==='none' ? null : p.get('target');
  if(p.has('way'))     setWay(p.get('way'));
  if(p.has('ledger'))  setLedgerKey(p.get('ledger'));
  if(p.has('panel'))   p.get('panel').split(',').forEach(x=>{
    const [k,v] = x.split(':'); if(PANELS.includes(k)) panelState[k] = v || 'min';
  });
  mountSheetKeepScroll(); syncSegs(false); renderLedger(); renderTarget(); layout();
  go(p.get('screen') || 'landing');
})();
