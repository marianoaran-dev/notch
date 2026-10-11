/* Settings screen: a vertical menu on the left, one page of options on the right.
   Pages: Accounts (Piggy Bank), Appearance, Behavior. More pages are easy to add:
   build a page with makePage() and add it to PAGES.
   All text from settings or Codex goes in through textContent, never innerHTML. */
(()=>{
 const panel=document.getElementById('settingsPreview');
 const store=window.NotchSettings;
 const hook=window.PiggyData;
 const I=window.AukalenLucide;
 if(!panel||!store||!hook)return;
 const tauri=window.__TAURI__;
 const live=window.LiveData||null;     // only inside the app

 const el=(tag,props={},...kids)=>{
  const node=document.createElement(tag);
  for(const [k,v] of Object.entries(props)){
   if(k==='class')node.className=v;
   else if(k==='text')node.textContent=v;
   else if(k.startsWith('on'))node.addEventListener(k.slice(2),v);
   else if(v===true)node.setAttribute(k,'');
   else if(v!==false&&v!=null)node.setAttribute(k,v);
  }
  node.append(...kids.filter(Boolean));
  return node;
 };
 const reshape=()=>hook.reshape();
 const syncers=[];   // functions that refresh a control from the saved settings

 /* ---------- reusable rows ---------- */
 function slider(key,min,max,step,label,hint,unit='%'){
  const value=el('span',{class:'set-value'});
  const input=el('input',{class:'set-range',type:'range',min,max,step,'aria-label':label,
   oninput:e=>{store.set(key,Number(e.target.value));value.textContent=e.target.value+unit}});
  syncers.push(()=>{input.value=store.get(key);value.textContent=store.get(key)+unit});
  return el('div',{class:'set-row'},
   el('div',{},el('div',{class:'set-label',text:label}),el('div',{class:'set-hint',text:hint})),
   el('div',{style:'display:flex;align-items:center;gap:10px'},input,value));
 }
 function toggle(key,label,hint){
  const sw=el('button',{class:'set-switch',type:'button',role:'switch','aria-label':label,
   onclick:()=>store.set(key,!store.get(key))});
  syncers.push(()=>sw.setAttribute('aria-checked',String(!!store.get(key))));
  return el('div',{class:'set-row'},
   el('div',{},el('div',{class:'set-label',text:label}),el('div',{class:'set-hint',text:hint})),sw);
 }
 const section=(title,...kids)=>el('div',{class:'set-section'},el('div',{class:'set-title',text:title}),...kids);

 /* ---------- Accounts page ---------- */
 const BROWSERS=['Default','Chrome','Chrome (private)','Edge','Edge (private)','DuckDuckGo'];
 const accountViews=[];
 function accountCard(index,kind='codex'){
  const isClaude=kind==='claude';
  const name=el('input',{class:'set-input',type:'text',maxlength:'24','aria-label':'Account '+(index+1)+' name',
   onchange:e=>store.setIndexed('names',index,e.target.value),
   onkeydown:e=>{if(e.key==='Enter')e.target.blur()}});
  const dot=el('span',{class:'acct-dot'});
  const text=el('span',{});
  const status=el('div',{class:'acct-status'},dot,text);
  const select=el('select',{class:'set-select','aria-label':'Sign-in browser for account '+(index+1),
   onchange:e=>store.setIndexed('browsers',index,e.target.value)},
   ...BROWSERS.map(b=>el('option',{value:b,text:b==='Default'?'Default browser':b})));
  const connect=el('button',{class:'set-btn primary',type:'button',text:'Connect',onclick:()=>live&&live.signIn(index)});
  const copy=el('button',{class:'set-btn',type:'button',text:'Copy code',onclick:async()=>{
   if(!live)return;
   if(await live.copyCode(index)){copy.textContent='Copied';setTimeout(()=>paint(),1200)}
  }});
  const disconnect=el('button',{class:'set-btn danger',type:'button',text:'Disconnect',onclick:()=>live&&live.disconnect(index)});
  const showSwitch=el('button',{class:'set-switch',type:'button',role:'switch','aria-label':'Show account '+(index+1)+' in Piggy Bank',
   onclick:()=>{
    const list=store.get('accountsEnabled');
    if(list[index]&&list.filter(Boolean).length<=1)return;   // keep at least one account visible
    store.setIndexed('accountsEnabled',index,!list[index]);
   }});
  syncers.push(()=>{
   const list=store.get('accountsEnabled');
   showSwitch.setAttribute('aria-checked',String(!!list[index]));
   showSwitch.disabled=list[index]&&list.filter(Boolean).length<=1;
   showSwitch.title=showSwitch.disabled?'At least one account must stay visible':'';
  });
  const card=el('div',{class:'set-card'},
   el('div',{class:'acct-top'},
    el('div',{},el('div',{class:'set-label',text:isClaude?'Piggy Bank · Claude':'Piggy Bank · Account '+(index+1)}),
    el('div',{class:'set-hint',text:isClaude?'Claude account shown on tab 3':'Codex account shown on tab '+(index+1)})),
    name),
   status,
   el('div',{class:'set-row acct-show'},
    el('div',{},el('div',{class:'set-label',text:'Show in Piggy Bank'}),el('div',{class:'set-hint',text:'Hides this account from the tabs and the small notch. Its sign-in is kept.'})),
    showSwitch),
   el('div',{class:'acct-bottom'},
    isClaude
     ? el('div',{class:'set-hint',text:'Signs in inside a private window of its own.'})
     : el('label',{class:'acct-browser'},'Sign-in browser',select),
    el('div',{class:'set-actions'},connect,isClaude?null:copy,disconnect)));
  if(isClaude)card.classList.add('acct-wide');

  function paint(){
   const s=live?live.state(index):{kind:'idle'};
   const info=s.info||{};
   dot.className='acct-dot';
   text.replaceChildren();
   copy.textContent='Copy code';
   let busy=false;
   switch(s.kind){
    case 'live':
     dot.classList.add('live');
     text.textContent='Connected'+(info.email?' · '+info.email:'')+(info.plan?' · '+info.plan:'');
     break;
    case 'code':
     busy=true;dot.classList.add('warn');
     text.append('Enter code ',el('span',{class:'acct-code',text:s.code||''}),' in the browser that opened');
     break;
    case 'busy':busy=true;dot.classList.add('warn');text.textContent=s.text;break;
    case 'signin':dot.classList.add('bad');text.textContent='Not connected';break;
    case 'error':dot.classList.add('bad');text.textContent=s.text||'Something went wrong';break;
    default:text.textContent=live?'Checking account…':'Available in the app';
   }
   connect.textContent=s.kind==='live'?'Reconnect':'Connect';
   connect.disabled=!live||busy;
   copy.disabled=s.kind!=='code';
   disconnect.disabled=!live||!(s.kind==='live'||s.kind==='code');
  }
  accountViews.push({paint});
  syncers.push(()=>{
   if(document.activeElement!==name)name.value=store.get('names')[index];
   if(!isClaude)select.value=store.get('browsers')[index];
  });
  return card;
 }
 const accountsPage=()=>el('div',{},
  section('PIGGY BANK ACCOUNTS',el('div',{class:'acct-grid'},accountCard(0),accountCard(1),accountCard(2,'claude'))));

 /* ---------- Appearance page ---------- */
 const monitorSelect=el('select',{class:'set-select','aria-label':'Show the notch on monitor',
  onchange:e=>store.set('monitor',e.target.value)},
  el('option',{value:'',text:'Automatic'}));
 async function loadMonitors(){
  if(!tauri)return;
  try{
   const list=await tauri.core.invoke('list_monitors');
   for(const m of list)monitorSelect.append(el('option',{value:m.id,text:m.label}));
   monitorSelect.value=store.get('monitor');
   if(monitorSelect.value!==store.get('monitor'))monitorSelect.value='';   // saved monitor no longer connected
  }catch{}
 }
 syncers.push(()=>{if(monitorSelect.options.length>1)monitorSelect.value=store.get('monitor')});
 const appearancePage=()=>el('div',{},
  section('APPEARANCE',el('div',{class:'set-card'},
   el('div',{class:'set-row'},
    el('div',{},el('div',{class:'set-label',text:'Show on monitor'}),el('div',{class:'set-hint',text:'Where the notch sits. Automatic picks the second monitor if there is one.'})),
    monitorSelect),
   slider('uiScale',80,130,5,'Interface size','Scales the open screens and their text.'),
   slider('compactHeight',35,70,1,'Small notch height','Height of the collapsed notch. The default is 60 px.',' px'),
   slider('notchOpacity',50,100,5,'Notch opacity','How solid the black notch is. Text and icons stay sharp.'),
   toggle('displayAlwaysOpen','Display shortcuts always visible','Show Day, Night and Off beside Display without hovering.'))));

 /* ---------- Behavior page ---------- */
 const behaviorPage=()=>el('div',{},
  section('BEHAVIOR',el('div',{class:'set-card'},
   toggle('collapseOnClickAway','Collapse when I click elsewhere','Close the open screen as soon as you click another app.')),
   el('p',{class:'set-foot',text:'More options will appear here as they are added.'})));

 /* ---------- Appearance: a floating card under the notch ----------
    The notch stays collapsed while the card is open, so every change to the small notch
    (height, size, opacity) shows up live. "Preview open screen" expands the notch instead,
    to see Interface size on the full panel. */
 const ui=window.NotchUI=window.NotchUI||{};
 let previewOpen=false,placeFrame=0;
 const previewSwitch=el('button',{class:'set-switch',type:'button',role:'switch','aria-checked':'false','aria-label':'Preview the open screen',
  onclick:()=>setPreview(!previewOpen)});
 const card=el('div',{class:'appearance-card',role:'dialog','aria-label':'Appearance',hidden:true},
  appearancePage(),
  el('div',{class:'set-card',style:'margin-top:10px'},
   el('div',{class:'set-row'},
    el('div',{},el('div',{class:'set-label',text:'Preview open screen'}),
     el('div',{class:'set-hint',text:'Expand the notch while you adjust, to see Interface size on the full panel.'})),
    previewSwitch)),
  el('div',{class:'appearance-actions'},el('button',{class:'set-btn primary',type:'button',text:'Done',onclick:()=>closeAppearance()})));
 document.body.append(card);
 function place(){
  if(card.hidden)return;
  const rect=document.getElementById('notch').getBoundingClientRect();
  card.style.top=Math.round(Math.max(72,rect.bottom+16))+'px';
  placeFrame=requestAnimationFrame(place);
 }
 function setPreview(on){
  previewOpen=on;
  previewSwitch.setAttribute('aria-checked',String(on));
  if(on)hook.expand();else hook.collapse();
 }
 function openAppearance(){
  ui.holdOpen=true;
  card.hidden=false;
  setPreview(false);
  cancelAnimationFrame(placeFrame);
  place();
 }
 function closeAppearance(){
  card.hidden=true;
  cancelAnimationFrame(placeFrame);
  previewOpen=false;
  ui.holdOpen=false;
  hook.collapse();
 }
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!card.hidden){e.stopPropagation();closeAppearance()}
 },true);

 const PAGES=[
  {id:'accounts',label:'Accounts',icon:'link-2',build:accountsPage},
  {id:'appearance',label:'Appearance',icon:'sliders-horizontal',popout:true},
  {id:'behavior',label:'Behavior',icon:'settings-2',build:behaviorPage}
 ];

 /* ---------- header, menu, pages ---------- */
 const mark=el('div',{class:'set-mark'});
 if(I)mark.innerHTML=I.svg('settings',{size:18});
 const head=el('div',{class:'set-head'},mark,
  el('div',{},el('strong',{text:'SETTINGS'}),el('small',{text:'Changes are saved automatically'})));

 const nav=el('nav',{class:'set-nav','aria-label':'Settings sections'});
 const body=el('div',{class:'set-body'});
 const pageNodes=new Map();
 let current='accounts';
 function show(id){
  current=id;
  for(const [pid,node] of pageNodes)node.hidden=pid!==id;
  for(const b of nav.children){
   if(b.dataset.page===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  }
  reshape();
 }
 for(const page of PAGES){
  const icon=el('span',{style:'display:inline-flex'});
  if(I)icon.innerHTML=I.svg(page.icon,{size:16});
  const cue=el('span',{class:'popout',title:'Opens beside the notch'});
  if(page.popout&&I)cue.innerHTML=I.svg('chevron-right',{size:13});
  nav.append(el('button',{class:'set-nav-item',type:'button','data-page':page.id,
   onclick:page.popout?()=>openAppearance():()=>show(page.id)},icon,page.label,page.popout?cue:null));
  if(page.popout)continue;
  const node=el('div',{class:'set-page',hidden:true},page.build());
  pageNodes.set(page.id,node);
  body.append(node);
 }
 panel.replaceChildren(head,el('div',{class:'set-layout'},nav,body));

 /* ---------- keep everything in step ---------- */
 function syncAll(){syncers.forEach(fn=>fn());reshape()}
 // The notch measures this screen when it opens, while it is still widening. Measure again
 // whenever the content changes size so the notch always fits it with no scrolling.
 new ResizeObserver(()=>reshape()).observe(body);
 store.onChange(syncAll);
 if(live)live.onChange(index=>{if(accountViews[index]){accountViews[index].paint();reshape()}});
 accountViews.forEach(v=>v.paint());
 syncAll();
 show(current);
 loadMonitors();
})();
