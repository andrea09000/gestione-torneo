// =====================================================
// ORDINI - logica cliente / cassa / cucina / bar / admin
// I dati (menu, ordini, comande) vivono su Firestore, con
// ascolto in tempo reale (onSnapshot): niente localStorage,
// niente cache del browser, niente polling — ogni dispositivo
// vede subito gli aggiornamenti fatti dagli altri.
// =====================================================

import {
  db,
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from "./firebase-config.js";

/* ============ CREDENZIALI DEMO ============
   Login lato client, pensato come base funzionale.
   Per un uso reale andrebbero sostituite con autenticazione
   Firebase Auth (come probabilmente già fai altrove sul sito). */
const CREDENTIALS = {
  cassa:  {user:'cassa',  pass:'cassa123'},
  cucina: {user:'cucina', pass:'cucina123'},
  bar:    {user:'bar',    pass:'bar123'},
  admin:  {user:'admin',  pass:'admin123'},
};
const ROLE_META = {
  cassa:  {label:'Cassa',  colorVar:'--cassa',  desc:'Incassa gli ordini in attesa e crea nuovi ordini al banco.'},
  cucina: {label:'Cucina', colorVar:'--cucina', desc:'Gestisci le comande dei piatti in arrivo dalla sala.'},
  bar:    {label:'Bar',    colorVar:'--bar',    desc:'Gestisci le comande delle bevande in arrivo dalla sala.'},
  admin:  {label:'Admin',  colorVar:'--admin',  desc:'Gestione menu e andamento della giornata.'},
};
let session = { cassa:false, cucina:false, bar:false, admin:false };
function isAuthorized(role){ if(role==='admin') return session.admin; return session[role] || session.admin; }

/* ============ MENU DI DEFAULT (usato solo per il primo avvio) ============ */
const DEFAULT_MENU = [
  {name:'Margherita', desc:'Pomodoro, mozzarella, basilico', price:8.00, cat:'cibo', icon:'🍕'},
  {name:'Pasta al pomodoro', desc:'Pasta fresca, pomodoro San Marzano', price:9.50, cat:'cibo', icon:'🍝'},
  {name:'Tagliere di salumi', desc:'Selezione di salumi e formaggi locali', price:14.00, cat:'cibo', icon:'🧀'},
  {name:'Caprese', desc:'Mozzarella, pomodoro, basilico, olio evo', price:7.50, cat:'cibo', icon:'🥗'},
  {name:'Panino club', desc:'Pollo, bacon, lattuga, maionese', price:8.50, cat:'cibo', icon:'🥪'},
  {name:'Bruschette miste', desc:'Tre bruschette, gusti a scelta', price:6.50, cat:'cibo', icon:'🍞'},
  {name:'Coca-Cola', desc:'33cl', price:3.00, cat:'bevande', icon:'🥤'},
  {name:'Acqua naturale', desc:'50cl', price:2.00, cat:'bevande', icon:'💧'},
  {name:'Birra alla spina', desc:'40cl', price:4.50, cat:'bevande', icon:'🍺'},
  {name:'Spritz', desc:'Aperol, prosecco, soda', price:6.00, cat:'bevande', icon:'🥂'},
  {name:'Caffè', desc:'Espresso', price:1.30, cat:'bevande', icon:'☕'},
  {name:'Vino rosso — calice', desc:'Sangiovese', price:5.00, cat:'bevande', icon:'🍷'},
];

/* ============ DATI LIVE (mirror locale dei listener Firestore) ============ */
let menuItems = [];   // collection "menu_items"
let orders = [];      // collection "orders"
let tickets = [];     // collection "tickets"
let menuSeeded = false;

let carts = { cliente: {}, cassa: {} };
let filters = { cliente: 'tutto', cassa: 'tutto' };
let currentTab = 'cliente';
let cardModalContext = null;
let trackedOrderIds = [];   // tutti gli ordini attivi di questo cliente (può ordinare più volte)
let activeStatusOrderId = null; // quale ordine sta mostrando la schermata a tutto schermo in questo momento
let notifiedOrders = new Set();
let lastCucinaCount = 0, lastBarCount = 0, lastPendingCount = 0;
let lastMenuSig = null;
let lastCucinaTicketSig = null, lastBarTicketSig = null, lastPendingSig = null;

function menu(){ return menuItems; }
function iconFor(m){ return m.icon || (m.cat==='cibo' ? '🍽️' : '🥤'); }
function tsToMillis(ts){ return (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : Date.now(); }

/* ============ FIRESTORE: numero ordine progressivo ============
   Un contatore condiviso (counters/orders) incrementato dentro una
   transazione, così due ordini creati nello stesso istante da
   dispositivi diversi non ricevono mai lo stesso numero.
   Si resetta da solo a #1 al primo ordine di ogni nuovo giorno. */
async function getNextOrderNumber(){
  const counterRef = doc(db, 'counters', 'orders');
  const todayKey = new Date().toDateString(); // stessa convenzione usata per "oggi" nelle statistiche admin
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const data = snap.exists() ? snap.data() : null;
    const current = (data && data.date === todayKey) ? (data.value || 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { value: next, date: todayKey }, { merge: true });
    return next;
  });
}

/* Se il menu su Firestore è vuoto (primo avvio), lo popola con i valori di default */
async function seedMenuIfEmpty(){
  if(menuSeeded) return;
  menuSeeded = true;
  if(menuItems.length > 0) return;
  for(const item of DEFAULT_MENU){
    try{ await addDoc(collection(db, 'menu_items'), item); }
    catch(e){ console.error('Errore seed menu:', e); }
  }
}

/* ============ TOASTS ============ */
function toast(title, body, color){
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast'; el.style.borderLeftColor = color || 'var(--bar)';
  el.innerHTML = `<div class="tt">${title}</div><div class="tb">${body}</div>`;
  stack.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .3s ease, transform .3s ease'; el.style.opacity='0'; el.style.transform='translateX(20px)'; setTimeout(()=>el.remove(),300); }, 3800);
}

/* ============ LOGIN ============ */
function renderLoginGate(role){
  const meta = ROLE_META[role];
  const el = document.getElementById('gate-'+role);
  el.innerHTML = `
    <div class="login-wrap">
      <div class="login-card" id="login-card-${role}">
        <div class="role-icon" style="background:var(${meta.colorVar})">${meta.label[0]}</div>
        <h3>Accesso ${meta.label}</h3>
        <div class="desc">${meta.desc}</div>
        <div class="login-error" id="login-error-${role}">Utente o password non corretti.</div>
        <div class="field"><label>Utente</label><input type="text" id="login-user-${role}" autocomplete="username"></div>
        <div class="field"><label>Password</label><input type="password" id="login-pass-${role}" autocomplete="current-password"></div>
        <button class="login-btn" style="background:var(${meta.colorVar})" onclick="attemptLogin('${role}')">Accedi</button>
        <div class="login-hint">postazione: ${meta.label.toLowerCase()}</div>
      </div>
    </div>
  `;
  document.getElementById(`login-pass-${role}`).addEventListener('keydown', e=>{ if(e.key==='Enter') attemptLogin(role); });
}
function attemptLogin(role){
  const user = document.getElementById(`login-user-${role}`).value.trim();
  const pass = document.getElementById(`login-pass-${role}`).value;
  const cred = CREDENTIALS[role];
  if(user === cred.user && pass === cred.pass){
    session[role] = true;
    if(role === 'admin'){ session.cassa = true; session.cucina = true; session.bar = true; }
    refreshAuthUI();
  } else {
    document.getElementById(`login-error-${role}`).classList.add('show');
    const card = document.getElementById(`login-card-${role}`);
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  }
}
function logout(role){
  if(role === 'admin'){
    session.admin = false; session.cassa = false; session.cucina = false; session.bar = false;
    if(['cassa','cucina','bar','admin'].includes(currentTab)) switchTab('cliente');
  } else {
    session[role] = false;
    if(currentTab === role) switchTab('cliente');
  }
  refreshAuthUI();
}
function refreshAuthUI(){
  ['cassa','cucina','bar','admin'].forEach(role=>{
    const authed = isAuthorized(role);
    const gate = document.getElementById('gate-'+role);
    const content = document.getElementById('content-'+role);
    if(authed){
      gate.innerHTML = '';
      content.style.display = 'block';
      const directLogin = !!session[role] || role==='admin';
      document.getElementById('who-'+role).textContent = directLogin ? CREDENTIALS[role].user : (CREDENTIALS.admin.user + ' (admin)');
      document.getElementById('logout-'+role).style.display = (role==='admin' ? (session.admin?'inline-block':'none') : (session[role] ? 'inline-block' : (session.admin ? 'none' : 'inline-block')));
    } else {
      content.style.display = 'none';
      renderLoginGate(role);
    }
  });
  if(currentTab === 'admin' && session.admin) renderAdminAll();
  renderTabsBar();
  renderAll();
}

/* ============ CATEGORY TABS (kiosk) ============ */
const CAT_DEFS = [
  {v:'tutto',   l:'Tutto',        ico:'✨', cls:''},
  {v:'cibo',    l:'Da mangiare',  ico:'🍽️', cls:'food-active'},
  {v:'bevande', l:'Da bere',      ico:'🥤', cls:'drink-active'},
];
function renderCatTabs(cartKey){
  const el = document.getElementById('cat-tabs-'+cartKey);
  el.innerHTML = CAT_DEFS.map(c=>`
    <button class="cat-tab ${filters[cartKey]===c.v?'active '+c.cls:''}" onclick="setFilter('${cartKey}','${c.v}')">
      <span class="ico">${c.ico}</span><span class="lbl">${c.l}</span>
    </button>
  `).join('');
}
function setFilter(cartKey, val){ filters[cartKey] = val; renderCatTabs(cartKey); renderMenu(cartKey); }

/* ============ KIOSK MENU GRID ============ */
function renderMenu(cartKey){
  const el = document.getElementById(cartKey==='cliente' ? 'menu-cliente' : 'menu-cassa');
  const f = filters[cartKey];
  const items = menu().filter(m => f==='tutto' ? true : m.cat===f);
  el.innerHTML = items.map((m,idx)=>{
    const qty = carts[cartKey][m.id] || 0;
    return `
      <div class="kiosk-card ${m.cat}" style="animation-delay:${idx*0.02}s">
        <div class="art">${iconFor(m)}</div>
        <div class="info">
          <div class="kname">${m.name}</div>
          <div class="kdesc">${m.desc}</div>
          <div class="kprice">€${m.price.toFixed(2)}</div>
          <div class="kaction" id="kaction-${cartKey}-${m.id}">
            ${qty===0
              ? `<button class="kiosk-add-btn" onclick="addToCart('${cartKey}','${m.id}', event)">Aggiungi</button>`
              : `<div class="kiosk-stepper">
                   <button onclick="decFromCart('${cartKey}','${m.id}', event)">–</button>
                   <span class="qty">${qty}</span>
                   <button onclick="addToCart('${cartKey}','${m.id}', event)">+</button>
                 </div>`
            }
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function addToCart(cartKey, itemId, evt){
  carts[cartKey][itemId] = (carts[cartKey][itemId] || 0) + 1;
  renderMenu(cartKey); updateFab(cartKey);
  if(document.getElementById('sheet-bg-'+cartKey).classList.contains('open')) renderSheet(cartKey);
  if(evt){
    const btn = evt.currentTarget;
    const fly = document.createElement('span');
    fly.className='fly'; fly.textContent='+1';
    const r = btn.getBoundingClientRect();
    fly.style.left=(r.left+r.width/2-8)+'px'; fly.style.top=(r.top-4)+'px';
    document.body.appendChild(fly);
    setTimeout(()=>fly.remove(),650);
  }
}
function decFromCart(cartKey, itemId, evt){
  if(!carts[cartKey][itemId]) return;
  carts[cartKey][itemId]--;
  if(carts[cartKey][itemId] <= 0) delete carts[cartKey][itemId];
  renderMenu(cartKey); updateFab(cartKey);
  if(document.getElementById('sheet-bg-'+cartKey).classList.contains('open')) renderSheet(cartKey);
}
function cartTotal(cartKey){
  return Object.entries(carts[cartKey]).reduce((sum,[id,qty])=>{ const item = menu().find(m=>m.id===id); return sum + (item ? item.price*qty : 0); },0);
}
function cartCount(cartKey){ return Object.values(carts[cartKey]).reduce((a,b)=>a+b,0); }
function updateFab(cartKey){
  const count = cartCount(cartKey); const total = cartTotal(cartKey);
  document.getElementById('fab-'+cartKey).classList.toggle('hidden', count===0);
  document.getElementById('fab-'+cartKey+'-lbl').textContent = count + (count===1 ? ' articolo' : ' articoli');
  document.getElementById('fab-'+cartKey+'-amt').textContent = total.toFixed(2);
}
function renderSheet(cartKey){
  const lines = document.getElementById('cart-lines-'+cartKey);
  const entries = Object.entries(carts[cartKey]).filter(([id])=>menu().some(m=>m.id===id));
  if(entries.length===0){ lines.innerHTML = '<div class="cart-empty">Il carrello è vuoto.</div>'; }
  else {
    lines.innerHTML = entries.map(([id,qty])=>{
      const item = menu().find(m=>m.id===id);
      return `
        <div class="cart-line">
          <div>${iconFor(item)} ${item.name}</div>
          <div class="qtybox">
            <button onclick="decFromCart('${cartKey}','${id}')">–</button>
            <span class="mono">${qty}</span>
            <button onclick="addToCart('${cartKey}','${id}')">+</button>
            <span class="mono" style="min-width:54px;text-align:right;display:inline-block;">€${(item.price*qty).toFixed(2)}</span>
          </div>
        </div>
      `;
    }).join('');
  }
  document.getElementById(cartKey+'-total').textContent = cartTotal(cartKey).toFixed(2);
  const hasItems = entries.length > 0;
  if(cartKey==='cliente'){ document.getElementById('pay-card-btn').disabled = !hasItems; document.getElementById('pay-cassa-btn').disabled = !hasItems; }
  else { document.getElementById('cassa-confirm-btn').disabled = !hasItems; }
}
function openSheet(cartKey){ renderSheet(cartKey); document.getElementById('sheet-bg-'+cartKey).classList.add('open'); }
function closeSheet(cartKey){ document.getElementById('sheet-bg-'+cartKey).classList.remove('open'); }

/* ============ CREAZIONE ORDINI (Firestore) ============ */
function buildOrderItems(cartKey){
  return Object.entries(carts[cartKey]).map(([id,qty])=>{
    const item = menu().find(m=>m.id===id);
    return item ? {id:item.id, name:item.name, cat:item.cat, price:item.price, qty} : null;
  }).filter(Boolean);
}

async function createTicketsForOrder(orderId, orderNumber, items){
  const cats = [...new Set(items.map(i=>i.cat))];
  for(const cat of cats){
    await addDoc(collection(db, 'tickets'), {
      orderId, orderNumber, cat,
      items: items.filter(i=>i.cat===cat),
      status: 'coda',
      createdAt: serverTimestamp()
    });
  }
}

function resetCart(cartKey){ carts[cartKey] = {}; renderMenu(cartKey); updateFab(cartKey); closeSheet(cartKey); }

async function payAtCassa(){
  if(cartCount('cliente')===0) return;
  const items = buildOrderItems('cliente'); const total = cartTotal('cliente');
  const number = await getNextOrderNumber();
  const ref = await addDoc(collection(db, 'orders'), {
    number, items, total, source:'app', payment:'in_attesa', paymentStatus:'in_attesa', createdAt: serverTimestamp()
  });
  resetCart('cliente');
  showOrderStatus(ref.id);
}
function openCardModal(){
  if(cartCount('cliente')===0) return;
  cardModalContext = 'cliente';
  document.getElementById('modal-total').textContent = cartTotal('cliente').toFixed(2);
  closeSheet('cliente');
  document.getElementById('card-modal').classList.add('open');
}
function closeCardModal(){ document.getElementById('card-modal').classList.remove('open'); }
async function submitCardPayment(){
  if(cardModalContext !== 'cliente') return;
  const items = buildOrderItems('cliente'); const total = cartTotal('cliente');
  const number = await getNextOrderNumber();
  const ref = await addDoc(collection(db, 'orders'), {
    number, items, total, source:'app', payment:'carta', paymentStatus:'pagato', createdAt: serverTimestamp()
  });
  await createTicketsForOrder(ref.id, number, items);
  resetCart('cliente');
  closeCardModal();
  showOrderStatus(ref.id);
}
async function confirmCassaOrder(){
  if(cartCount('cassa')===0) return;
  const items = buildOrderItems('cassa'); const total = cartTotal('cassa');
  const number = await getNextOrderNumber();
  const ref = await addDoc(collection(db, 'orders'), {
    number, items, total, source:'cassa', payment:'contanti', paymentStatus:'pagato', createdAt: serverTimestamp()
  });
  await createTicketsForOrder(ref.id, number, items);
  resetCart('cassa');
  showOrderStatus(ref.id);
}
async function settlePending(orderId, method){
  const order = orders.find(o=>o.id===orderId);
  if(!order || order.paymentStatus==='pagato') return;
  await updateDoc(doc(db, 'orders', orderId), { paymentStatus:'pagato', payment: method });
  await createTicketsForOrder(orderId, order.number, order.items);
  toast('Incassato', `Ordine #${String(order.number).padStart(3,'0')} inviato in cucina/bar.`, 'var(--cassa)');
}

/* ============ ORDER STATUS SCREEN ============ */
function showOrderStatus(orderId){
  if(!trackedOrderIds.includes(orderId)) trackedOrderIds.push(orderId);
  activeStatusOrderId = orderId;
  renderOrderStatus();
  renderNotifRow();
  ensureNotificationPermission();
  document.getElementById('status-screen').classList.add('open');
}
function closeOrderStatus(){ document.getElementById('status-screen').classList.remove('open'); renderOrderChips(); }
function dismissChip(evt, orderId){
  evt.stopPropagation();
  trackedOrderIds = trackedOrderIds.filter(id => id !== orderId);
  renderOrderChips();
}
function openTrackedOrder(orderId){ showOrderStatus(orderId); }

function stationProgress(orderId, cat){
  const t = tickets.find(tk=>tk.orderId===orderId && tk.cat===cat);
  return t ? t.status : null;
}
function stepTrackHtml(cat, status){
  const label = cat==='cibo' ? 'Cucina' : 'Bar';
  const ico = cat==='cibo' ? '🍳' : '🍹';
  const accent = cat==='cibo' ? 'var(--cucina)' : 'var(--bar)';
  const idx = {coda:0, prep:1, pronto:2, consegnato:3}[status] ?? 0;
  const labels = ['Ricevuto','In preparazione','Pronto'];
  let stepsHtml = '';
  labels.forEach((lab,i)=>{
    const st = i < idx ? 'done' : (i===idx ? 'active' : '');
    stepsHtml += `<div class="step ${st}" style="--accent:${accent}"><div class="dot"></div><div class="slabel">${lab}</div></div>`;
    if(i < labels.length-1){
      stepsHtml += `<div class="step-line ${i < idx ? 'filled' : ''}" style="--accent:${accent}"></div>`;
    }
  });
  return `<div class="track-station"><div class="track-label">${ico} ${label}</div><div class="track-steps">${stepsHtml}</div></div>`;
}
function orderSummaryHtml(order){
  const lines = order.items.map(i => `
    <div class="summary-line">
      <span>${i.qty}× ${i.name}</span>
      <span class="mono">€${(i.price*i.qty).toFixed(2)}</span>
    </div>
  `).join('');
  return `
    <div class="order-summary">
      ${lines}
      <div class="summary-total"><span>Totale</span><span class="mono">€${order.total.toFixed(2)}</span></div>
    </div>
  `;
}
function renderOrderStatus(){
  const order = orders.find(o=>o.id===activeStatusOrderId);
  const body = document.getElementById('status-body');
  if(!order){ body.innerHTML = ''; return; }
  document.getElementById('status-number').textContent = '#' + String(order.number).padStart(3,'0');

  if(order.paymentStatus === 'in_attesa'){
    document.getElementById('status-eyebrow').textContent = 'Ordine registrato';
    body.innerHTML = `<div class="pending-banner"><span class="pb-dot"></span>In attesa di pagamento in cassa — mostra questo numero allo sportello.</div>${orderSummaryHtml(order)}`;
    return;
  }
  const cats = [...new Set(order.items.map(i=>i.cat))];
  const statuses = cats.map(cat=>stationProgress(order.id, cat));
  const allReady = statuses.length>0 && statuses.every(s=>s==='pronto' || s==='consegnato');
  const allPicked = statuses.length>0 && statuses.every(s=>s==='consegnato');
  document.getElementById('status-eyebrow').textContent = allPicked ? 'Ordine ritirato' : 'Ordine confermato';
  let html = '';
  if(allPicked){ html += `<div class="ready-banner">✓ Ordine ritirato</div>`; }
  else if(allReady){ html += `<div class="ready-banner">✓ Pronto per il ritiro!</div>`; }
  html += cats.map(cat=>stepTrackHtml(cat, stationProgress(order.id, cat) || 'coda')).join('');
  html += orderSummaryHtml(order);
  body.innerHTML = html;
  renderNotifRow();
}
function orderShortStatus(order){
  if(order.paymentStatus === 'in_attesa') return {text:'in attesa di pagamento', ready:false, done:false};
  const cats = [...new Set(order.items.map(i=>i.cat))];
  const statuses = cats.map(cat=>stationProgress(order.id, cat) || 'coda');
  if(statuses.every(s=>s==='consegnato')) return {text:'ritirato', ready:false, done:true};
  if(statuses.every(s=>s==='pronto'||s==='consegnato')) return {text:'pronto per il ritiro', ready:true, done:false};
  if(statuses.some(s=>s==='prep')) return {text:'in preparazione', ready:false, done:false};
  return {text:'ricevuto', ready:false, done:false};
}
function renderOrderChips(){
  const container = document.getElementById('order-chips');
  if(!container) return;

  // controlla ogni ordine tracciato: notifica se pronto, scarta quelli già ritirati
  const stillActive = [];
  trackedOrderIds.forEach(id=>{
    const order = orders.find(o=>o.id===id);
    if(!order) return; // non ancora arrivato dal listener, o rimosso
    const s = orderShortStatus(order);
    maybeNotifyReady(order, s);
    if(!s.done) stillActive.push({order, status:s});
  });
  trackedOrderIds = stillActive.map(x=>x.order.id);

  if(stillActive.length === 0){ container.innerHTML = ''; return; }
  container.innerHTML = stillActive.map(({order, status})=>`
    <div class="order-chip" onclick="openTrackedOrder('${order.id}')">
      <div class="oc-left">
        <div class="oc-num">#${String(order.number).padStart(3,'0')}</div>
        <div class="oc-status ${status.ready?'ready':''}">${status.text}</div>
      </div>
      <div class="oc-right">
        <span class="oc-go">Vedi ▸</span>
        <button class="oc-x" onclick="dismissChip(event,'${order.id}')">×</button>
      </div>
    </div>
  `).join('');
}

/* ============ NOTIFICHE ORDINE PRONTO ============ */
function ensureNotificationPermission(){
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission().catch(()=>{}).finally(()=>{ renderNotifRow(); });
  }
}
function renderNotifRow(){
  const el = document.getElementById('notif-row');
  if(!el) return;
  if(!('Notification' in window)){
    el.className = 'notif-row';
    el.innerHTML = 'Il browser non supporta le notifiche push — riceverai comunque un avviso sonoro in pagina.';
    return;
  }
  if(Notification.permission === 'granted'){
    el.className = 'notif-row granted';
    el.innerHTML = '🔔 Notifiche attive — ti avviseremo quando è pronto';
  } else if(Notification.permission === 'denied'){
    el.className = 'notif-row denied';
    el.innerHTML = '🔕 Notifiche bloccate dal browser — riceverai comunque un avviso sonoro in pagina';
  } else {
    el.className = 'notif-row';
    el.innerHTML = '<span>Vuoi essere avvisato quando è pronto?</span> <button onclick="ensureNotificationPermission()">Attiva notifiche</button>';
  }
}
function playChime(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    [880, 1174.66].forEach((freq, i)=>{
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      const t0 = ctx.currentTime + i*0.18;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + 0.4);
    });
  }catch(e){}
}
function fireReadyNotification(order){
  const title = 'Il tuo ordine è pronto! 🎉';
  const body = `Ordine #${String(order.number).padStart(3,'0')} pronto per il ritiro.`;
  if('Notification' in window && Notification.permission === 'granted'){
    try{ new Notification(title, {body, tag:'order-'+order.id}); }catch(e){}
  }
  playChime();
  if(navigator.vibrate) navigator.vibrate([200,100,200]);
  toast(title, body, 'var(--bar)');
}
function maybeNotifyReady(order, status){
  if(status.ready && !status.done && !notifiedOrders.has(order.id)){
    notifiedOrders.add(order.id);
    fireReadyNotification(order);
  }
}

/* ============ BARRA TAB DINAMICA per ruolo ============
   Cliente: nessuna barra, mai. Cucina/Bar: solo la propria
   sezione, nessuna barra. Cassa: Cliente + Cassa. Admin:
   tutte e 5 le sezioni, come oggi. */
const ALL_TABS = [
  {key:'cliente', label:'Cliente', sub:'ordina & paga'},
  {key:'cassa',   label:'Cassa',   badgeId:'badge-cassa'},
  {key:'cucina',  label:'Cucina',  badgeId:'badge-cucina'},
  {key:'bar',     label:'Bar',     badgeId:'badge-bar'},
  {key:'admin',   label:'Admin',   sub:'gestione'}
];
function visibleTabKeys(){
  if(session.admin) return ['cliente','cassa','cucina','bar','admin'];
  const tabs = [];
  if(session.cassa) tabs.push('cliente','cassa');
  if(session.cucina) tabs.push('cucina');
  if(session.bar) tabs.push('bar');
  if(tabs.length === 0) tabs.push('cliente');
  return tabs;
}
function renderTabsBar(){
  const keys = visibleTabKeys();
  const tabsEl = document.getElementById('tabs');
  const staffEntry = document.getElementById('staff-entry');
  const noStaffLoggedIn = !session.cassa && !session.cucina && !session.bar && !session.admin;
  staffEntry.classList.toggle('hidden', !noStaffLoggedIn);
  if(!noStaffLoggedIn) closeStaffMenu();

  const showBar = keys.length > 1;
  tabsEl.classList.toggle('hidden', !showBar);
  if(showBar){
    tabsEl.innerHTML = '<div class="tab-indicator" id="tab-indicator"></div>' + keys.map(k=>{
      const t = ALL_TABS.find(x=>x.key===k);
      const badgeSpan = t.badgeId ? `<span class="n" id="${t.badgeId}"></span>` : `<span class="n">${t.sub||''}</span>`;
      return `<button class="tab ${currentTab===k?'active':''}" data-tab="${k}" onclick="switchTab('${k}')">${t.label}${badgeSpan}</button>`;
    }).join('');
  }
  if(!keys.includes(currentTab)){
    currentTab = keys[0];
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-'+currentTab).classList.add('active');
  }
  positionIndicator();
}
function toggleStaffMenu(){ document.getElementById('staff-menu').classList.toggle('hidden'); }
function closeStaffMenu(){ document.getElementById('staff-menu').classList.add('hidden'); }
function goToRole(role){ closeStaffMenu(); switchTab(role); }
document.addEventListener('click', (e) => {
  const entry = document.getElementById('staff-entry');
  if(entry && !entry.contains(e.target)) closeStaffMenu();
});

/* ============ CASSA PENDING ============ */
function renderCassaPending(){
  const el = document.getElementById('cassa-pending');
  if(!el) return;
  const pending = orders.filter(o=>o.source==='app' && o.paymentStatus==='in_attesa').sort((a,b)=>a.createdAt-b.createdAt);
  if(pending.length===0){ el.innerHTML = '<div class="empty-rail">Nessun ordine in attesa di pagamento.</div>'; return; }
  el.innerHTML = pending.map(o=>`
    <div class="pending-order">
      <div class="row1"><div class="num">#${String(o.number).padStart(3,'0')}</div><div class="waittime mono" data-created="${o.createdAt}">${elapsedLabel(o.createdAt)}</div></div>
      <div class="items">${o.items.map(i=>`${i.qty}× ${i.name}`).join(' · ')} — <span class="mono" style="color:var(--text-onrail)">€${o.total.toFixed(2)}</span></div>
      <div class="actions">
        <button class="mini-btn" onclick="settlePending('${o.id}','contanti')">Incassa contanti</button>
        <button class="mini-btn" onclick="settlePending('${o.id}','carta')">Incassa con carta</button>
      </div>
    </div>
  `).join('');
}

/* ============ KANBAN ============ */
function elapsedSeconds(ts){ return Math.floor((Date.now()-ts)/1000); }
function elapsedLabel(ts){ const s=elapsedSeconds(ts); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function timerClass(ts){ const s=elapsedSeconds(ts); if(s>600) return 'late'; if(s>300) return 'warn'; return ''; }
const COLS = [ {key:'coda', label:'In coda'}, {key:'prep', label:'In preparazione'}, {key:'pronto', label:'Pronto'} ];
function nextStatus(s){ return {coda:'prep', prep:'pronto', pronto:'consegnato'}[s]; }
function advanceLabel(s){ return {coda:'Inizia preparazione', prep:'Segna come pronto', pronto:'Segna come ritirato'}[s]; }

function renderKanban(target, cat, theme){
  const el = document.getElementById(target); if(!el) return;
  const ownTickets = tickets.filter(t=>t.cat===cat && t.status!=='consegnato');
  const borrowedReady = theme==='bar' ? tickets.filter(t=>t.cat==='cibo' && t.status==='pronto') : [];

  el.innerHTML = COLS.map(col=>{
    let items;
    if(col.key==='pronto'){
      items = [...ownTickets.filter(t=>t.status==='pronto'), ...borrowedReady].sort((a,b)=>a.createdAt-b.createdAt);
    } else {
      items = ownTickets.filter(t=>t.status===col.key).sort((a,b)=>a.createdAt-b.createdAt);
    }
    return `
      <div class="kanban-col ${theme==='bar'?'bar-theme':''}">
        <div class="col-head"><div class="col-title"><span class="col-dot ${col.key}"></span>${col.label}</div><div class="col-count">${items.length}</div></div>
        ${items.length===0 ? `<div class="empty-col">Vuoto</div>` : items.map(t=>{
          const isBorrowed = borrowedReady.includes(t);
          const originTag = isBorrowed ? `<span class="origin-tag">🍳 dalla cucina</span>` : '';
          const readOnly = (theme==='cucina' && t.status==='pronto');
          const action = readOnly
            ? `<div class="ticket-waiting">In attesa di ritiro al bar</div>`
            : `<button class="advance-btn ${t.status==='pronto'?'done-btn':''}" onclick="advanceTicket('${t.id}')">${advanceLabel(t.status)}</button>`;
          return `
          <div class="ticket">
            <div class="ticket-head"><div class="ticket-num">#${String(t.orderNumber).padStart(3,'0')}${originTag}</div><div class="ticket-timer ${timerClass(t.createdAt)}" data-created="${t.createdAt}" id="timer-${t.id}">${elapsedLabel(t.createdAt)}</div></div>
            <div class="perf"></div>
            <div class="ticket-body">${t.items.map(i=>`<div class="ticket-item"><span><span class="q">${i.qty}×</span>${i.name}</span></div>`).join('')}</div>
            <div class="ticket-foot">${action}</div>
          </div>
        `;}).join('')}
      </div>
    `;
  }).join('');
}
async function advanceTicket(ticketId){
  const t = tickets.find(x=>x.id===ticketId); if(!t) return;
  await updateDoc(doc(db, 'tickets', ticketId), { status: nextStatus(t.status) });
}
setInterval(()=>{
  document.querySelectorAll('[id^="timer-"]').forEach(el=>{
    const created = parseInt(el.dataset.created,10);
    el.textContent = elapsedLabel(created);
    el.classList.remove('warn','late');
    const c = timerClass(created); if(c) el.classList.add(c);
  });
  document.querySelectorAll('.waittime[data-created]').forEach(el=>{ el.textContent = elapsedLabel(parseInt(el.dataset.created,10)); });
}, 1000);

/* ============ ADMIN: MENU ============ */
function renderAdminMenuList(){
  const el = document.getElementById('admin-menu-list'); if(!el) return;
  el.innerHTML = menu().map(m=>`
    <div class="admin-item-row">
      <div class="info"><span class="ico">${iconFor(m)}</span><span class="badge ${m.cat}"></span>
        <div><div class="name">${m.name}</div><div style="font-size:11.5px;color:var(--muted);">${m.desc}</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;">
        <div class="price">€${m.price.toFixed(2)}</div>
        <button class="mini-btn danger" onclick="removeMenuItem('${m.id}')">Rimuovi</button>
      </div>
    </div>
  `).join('');
}
async function addMenuItem(){
  const name = document.getElementById('new-item-name').value.trim();
  const desc = document.getElementById('new-item-desc').value.trim();
  const price = parseFloat(document.getElementById('new-item-price').value);
  const cat = document.getElementById('new-item-cat').value;
  const icon = document.getElementById('new-item-icon').value.trim();
  if(!name || isNaN(price) || price <= 0){ toast('Dati mancanti', 'Inserisci almeno nome e prezzo valido.', 'var(--cucina)'); return; }
  await addDoc(collection(db, 'menu_items'), { name, desc: desc || '—', price, cat, icon: icon || '' });
  document.getElementById('new-item-name').value=''; document.getElementById('new-item-desc').value='';
  document.getElementById('new-item-price').value=''; document.getElementById('new-item-icon').value='';
  toast('Articolo aggiunto', `${name} è ora nel menu.`, 'var(--admin)');
}
async function removeMenuItem(id){
  await deleteDoc(doc(db, 'menu_items', id));
}
function refreshMenusEverywhere(){ renderMenu('cliente'); renderMenu('cassa'); updateFab('cliente'); updateFab('cassa'); }

/* ============ ADMIN: STATS ============ */
function isToday(ts){ return new Date(ts).toDateString() === new Date().toDateString(); }
function renderAdminStats(){
  const grid = document.getElementById('stat-grid'); const topEl = document.getElementById('top-items'); if(!grid) return;
  const ordersToday = orders.filter(o=>isToday(o.createdAt));
  const paidToday = ordersToday.filter(o=>o.paymentStatus==='pagato');
  const incasso = paidToday.reduce((s,o)=>s+o.total,0);
  const scontrinoMedio = paidToday.length ? incasso/paidToday.length : 0;
  const contanti = paidToday.filter(o=>o.payment==='contanti').length;
  const carta = paidToday.filter(o=>o.payment==='carta').length;
  grid.innerHTML = `
    <div class="stat-card"><div class="label">Ordini oggi</div><div class="value">${ordersToday.length}</div></div>
    <div class="stat-card accent"><div class="label">Incasso oggi</div><div class="value">€${incasso.toFixed(2)}</div></div>
    <div class="stat-card"><div class="label">Scontrino medio</div><div class="value">€${scontrinoMedio.toFixed(2)}</div></div>
    <div class="stat-card"><div class="label">Contanti / Carta</div><div class="value" style="font-size:20px;">${contanti} / ${carta}</div></div>
  `;
  const qtyMap = {};
  paidToday.forEach(o=>o.items.forEach(i=>{ qtyMap[i.name] = (qtyMap[i.name]||0) + i.qty; }));
  const ranked = Object.entries(qtyMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if(ranked.length===0){ topEl.innerHTML = '<div class="empty-rail">Ancora nessun ordine pagato oggi.</div>'; return; }
  const max = ranked[0][1];
  topEl.innerHTML = ranked.map(([name,qty])=>`
    <div class="bar-row"><div class="bn">${name}</div><div class="bar-track"><div class="bar-fill" style="width:${(qty/max*100).toFixed(0)}%"></div></div><div class="bv">${qty}×</div></div>
  `).join('');
}
function setAdminPanel(panel){
  document.querySelectorAll('.admin-subnav button').forEach(b=>b.classList.toggle('active', b.dataset.panel===panel));
  document.getElementById('admin-panel-stats').classList.toggle('active', panel==='stats');
  document.getElementById('admin-panel-menu').classList.toggle('active', panel==='menu');
  if(panel==='stats') renderAdminStats(); if(panel==='menu') renderAdminMenuList();
}
function renderAdminAll(){ renderAdminStats(); renderAdminMenuList(); }

/* ============ BADGES + TAB INDICATOR ============ */
function renderBadges(){
  const pendingCount = orders.filter(o=>o.source==='app' && o.paymentStatus==='in_attesa').length;
  const cucinaCount = tickets.filter(t=>t.cat==='cibo' && (t.status==='coda'||t.status==='prep')).length;
  const barCount = tickets.filter(t=>(t.cat==='bevande' && t.status!=='consegnato') || (t.cat==='cibo' && t.status==='pronto')).length;
  const badgeCassa = document.getElementById('badge-cassa');
  const badgeCucina = document.getElementById('badge-cucina');
  const badgeBar = document.getElementById('badge-bar');
  if(badgeCassa) badgeCassa.textContent = pendingCount ? pendingCount+' da incassare' : '';
  if(badgeCucina) badgeCucina.textContent = cucinaCount ? cucinaCount+' attive' : '';
  if(badgeBar) badgeBar.textContent = barCount ? barCount+' attive' : '';
  if(pendingCount > lastPendingCount && isAuthorized('cassa') && currentTab !== 'cassa') toast('Nuovo ordine', 'Un cliente attende di pagare in cassa.', 'var(--cassa)');
  if(cucinaCount > lastCucinaCount && isAuthorized('cucina') && currentTab !== 'cucina') toast('Cucina', 'Nuova comanda ricevuta.', 'var(--cucina)');
  if(barCount > lastBarCount && isAuthorized('bar') && currentTab !== 'bar') toast('Bar', 'Nuova comanda ricevuta.', 'var(--bar)');
  lastPendingCount = pendingCount; lastCucinaCount = cucinaCount; lastBarCount = barCount;
}
function positionIndicator(){
  const tabsEl = document.getElementById('tabs'); const active = tabsEl.querySelector('.tab.active'); const indicator = document.getElementById('tab-indicator');
  if(!active) return;
  const containerRect = tabsEl.getBoundingClientRect(); const rect = active.getBoundingClientRect();
  indicator.style.left = (rect.left - containerRect.left) + 'px'; indicator.style.width = rect.width + 'px';
  const glow = getComputedStyle(active).getPropertyValue('--glow') || '#F0B93E';
  indicator.style.boxShadow = `0 0 0 1px ${glow}55, 0 6px 18px -6px ${glow}88`;
}

/* ============ TABS ============ */
function switchTab(tab){
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  positionIndicator();
  const banner = document.getElementById('install-banner');
  if(tab !== 'cliente') banner.classList.add('hidden');
  else if(deferredInstallPrompt && !installBannerDismissed) banner.classList.remove('hidden');
  if(tab==='admin' && session.admin) renderAdminAll();
  renderAll();
}
/* ============ MASTER RENDER (chiamato dai listener Firestore) ============ */
function ticketsSig(cat){
  return tickets.filter(t=>t.cat===cat && t.status!=='consegnato').map(t=>t.id+':'+t.status).sort().join('|');
}
function barBoardSig(){
  const own = tickets.filter(t=>t.cat==='bevande' && t.status!=='consegnato').map(t=>t.id+':'+t.status);
  const borrowed = tickets.filter(t=>t.cat==='cibo' && t.status==='pronto').map(t=>t.id+':'+t.status);
  return [...own, ...borrowed].sort().join('|');
}
function pendingSig(){
  return orders.filter(o=>o.source==='app' && o.paymentStatus==='in_attesa').map(o=>o.id).sort().join('|');
}
function renderAll(){
  const pSig = pendingSig();
  if(pSig !== lastPendingSig){ lastPendingSig = pSig; renderCassaPending(); }
  const cucinaSig = ticketsSig('cibo');
  if(cucinaSig !== lastCucinaTicketSig){ lastCucinaTicketSig = cucinaSig; renderKanban('kanban-cucina','cibo','cucina'); }
  const barSig = barBoardSig();
  if(barSig !== lastBarTicketSig){ lastBarTicketSig = barSig; renderKanban('kanban-bar','bevande','bar'); }
  renderBadges();
  renderOrderChips();
  if(document.getElementById('status-screen').classList.contains('open')) renderOrderStatus();
  const sig = menu().map(m=>m.id).join(',');
  if(sig !== lastMenuSig){
    lastMenuSig = sig;
    renderMenu('cliente'); renderMenu('cassa');
    updateFab('cliente'); updateFab('cassa');
  }
  if(currentTab==='admin' && session.admin) renderAdminAll();
}

/* ============ INIT: ascolto in tempo reale su Firestore ============ */
function initListeners(){
  onSnapshot(collection(db, 'menu_items'), (snap) => {
    menuItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(menuItems.length === 0) seedMenuIfEmpty();
    renderAll();
  }, (err) => console.error('Errore ascolto menu_items:', err));

  onSnapshot(collection(db, 'orders'), (snap) => {
    orders = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: tsToMillis(data.createdAt) };
    });
    renderAll();
  }, (err) => console.error('Errore ascolto orders:', err));

  onSnapshot(collection(db, 'tickets'), (snap) => {
    tickets = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: tsToMillis(data.createdAt) };
    });
    renderAll();
  }, (err) => console.error('Errore ascolto tickets:', err));
}

/* ============ PWA: registrazione service worker ============
   Necessario perché il browser proponga "Installa app" / "Aggiungi
   a schermata Home". Le notifiche push in background arriveranno
   in un secondo momento, quando collegherai Cloud Functions + FCM. */
function registerServiceWorker(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('Registrazione service worker fallita:', err);
    });
  }
}

/* ============ PWA: banner "Installa app" ============ */
let deferredInstallPrompt = null;
let installBannerDismissed = false; // solo per questa sessione, in memoria — niente cache/localStorage
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function setupInstallBanner(){
  const banner = document.getElementById('install-banner');
  if(isStandalone()) return; // già installata come app
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if(currentTab === 'cliente' && !installBannerDismissed) banner.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    banner.classList.add('hidden');
    deferredInstallPrompt = null;
  });
}
async function installApp(){
  const banner = document.getElementById('install-banner');
  if(!deferredInstallPrompt){ banner.classList.add('hidden'); return; }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  banner.classList.add('hidden');
}
function dismissInstallBanner(){
  installBannerDismissed = true;
  document.getElementById('install-banner').classList.add('hidden');
}

function init(){
  registerServiceWorker();
  setupInstallBanner();
  renderCatTabs('cliente'); renderCatTabs('cassa');
  renderTabsBar();
  refreshAuthUI();
  window.addEventListener('resize', positionIndicator);
  initListeners();
}

/* ============ ESPORTO LE FUNZIONI RICHIAMATE DAGLI onclick= NELL'HTML ============
   Essendo un modulo ES, le funzioni non sono globali di default:
   vanno agganciate esplicitamente a window per essere usabili negli attributi onclick. */
Object.assign(window, {
  switchTab, setFilter, addToCart, decFromCart, openSheet, closeSheet,
  payAtCassa, openCardModal, closeCardModal, submitCardPayment, confirmCassaOrder,
  settlePending, showOrderStatus, closeOrderStatus, dismissChip, openTrackedOrder,
  ensureNotificationPermission, advanceTicket,
  attemptLogin, logout, addMenuItem, removeMenuItem, setAdminPanel,
  installApp, dismissInstallBanner,
  toggleStaffMenu, goToRole
});

init();
