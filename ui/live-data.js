/* Live data: replaces the prototype's sample readings with real ones from Rust.
   Tabs 0 and 1 are Codex accounts. Tab 2 is the Claude account. */
(()=>{
 const tauri=window.__TAURI__;
 const hook=window.PiggyData;
 if(!tauri||!hook)return;
 const invoke=tauri.core.invoke;
 const $=id=>document.getElementById(id);
 const REFRESH_MS=2*60*1000;

 /* ---- formatting (same wording the prototype and the WPF app use) ---- */
 const DAY=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 const MONTH=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const clock=d=>{let h=d.getHours();const m=String(d.getMinutes()).padStart(2,'0'),ap=h<12?'am':'pm';h=h%12||12;return h+':'+m+' '+ap};
 const plural=(n,w)=>n+' '+w+(n===1?'':'s');
 const left=(unix,now)=>unix==null?null:unix*1000-now;
 function fiveReset(unix,now){
  const ms=left(unix,now);if(ms==null)return 'unavailable';if(ms<=0)return 'now';
  const h=ms/3600000;
  if(h>=24)return Math.floor(h/24)+'d '+Math.floor(h%24)+'h';
  if(h>=1)return Math.floor(h)+'h '+Math.floor(ms/60000%60)+'m';
  return Math.max(1,Math.ceil(ms/60000))+'m';
 }
 function weekTime(unix,now){
  const ms=left(unix,now);if(ms==null)return '—';if(ms<=0)return 'Resetting';
  const days=Math.floor(ms/86400000),hours=Math.floor(ms/3600000%24);
  return days>0?plural(days,'day')+' '+plural(hours,'hour'):hours>0?plural(hours,'hour'):'Less than 1 hour';
 }
 function weekShortRemaining(unix,now){
  const ms=left(unix,now);if(ms==null)return 'Time remaining unavailable';if(ms<=0)return 'Reset due now';
  const days=Math.floor(ms/86400000),hours=Math.floor(ms/3600000%24);
  return days>0?days+'d '+hours+'h remaining':hours>0?hours+'h remaining':Math.max(1,Math.ceil(ms/60000))+'m remaining';
 }
 const weekDays=(unix,now)=>{const ms=left(unix,now);return ms==null||ms<=0?0:Math.min(7,Math.max(1,Math.ceil(ms/86400000)))};
 const bankedText=unix=>{const d=new Date(unix*1000);return d.getDate()+' '+MONTH[d.getMonth()]+' · '+clock(d)};

 function toAccount(reading){
  const now=Date.now(),patch={};
  if(reading.five){patch.five=reading.five.remaining;patch.fiveReset=fiveReset(reading.five.resetsAt,now)}
  if(reading.week){
   const at=reading.week.resetsAt,d=at==null?null:new Date(at*1000);
   patch.week=reading.week.remaining;
   patch.weekReset=d?DAY[d.getDay()]+', '+clock(d):'Reset time unavailable';
   patch.weekShort=d?DAY[d.getDay()].slice(0,3)+', '+clock(d):'—';
   patch.weekTime=weekTime(at,now);
   patch.shortRemaining=weekShortRemaining(at,now);
   patch.days=weekDays(at,now);
  }
  // Banked resets are only replaced when Codex actually reported that data.
  if(reading.bankedKnown)patch.banked=reading.banked.filter(b=>b.expiresAt!=null).map(b=>bankedText(b.expiresAt));
  return patch;
 }

 /* ---- per-account state shown in the header ---- */
 // What an account shows until it has a real reading: nothing made up.
 const BLANK={five:0,week:0,fiveReset:'—',weekReset:'—',weekShort:'—',weekTime:'—',shortRemaining:'—',days:0,banked:[]};
 for(let i=0;i<3;i++)hook.update(i,BLANK);
 const state=[{kind:'idle',text:'Connecting…'},{kind:'idle',text:'Connecting…'},{kind:'idle',text:'Connecting…'}];
 const status=$('status');
 function paintStatus(){
  const index=hook.selected(),s=state[index]||state[0];
  status.textContent=s.text;
  status.classList.toggle('action',s.kind==='signin'||s.kind==='code');
  status.classList.toggle('code',s.kind==='code');
  status.title=s.kind==='signin'?'Click to sign in':s.kind==='code'?'Click to copy the code':'';
  const notch=$('notch');
  if(notch)notch.dataset.unconnected=(s.kind==='signin'||s.kind==='busy'||s.kind==='code')?'1':'';
 }
 const info=[{},{},{}];            // last known email / plan per Codex account
 const listeners=new Set();
 function setState(index,kind,text){
  state[index]={kind,text};
  if(hook.selected()===index)paintStatus();
  listeners.forEach(fn=>fn(index));
 }
 const errorParts=e=>{const s=String(e);const i=s.indexOf('|');return i>0?[s.slice(0,i),s.slice(i+1)]:['error',s]};

 let signInSlot=null,signInCode=null;
 async function refresh(index){
  // Never overwrite the sign-in prompt of an account that is being connected.
  if(index>2||index===signInSlot)return;
  try{
   const reading=index===2?await invoke('claude_refresh'):await invoke('codex_quota',{slot:index});
   hook.update(index,toAccount(reading));
   info[index]={email:reading.email||null,plan:reading.planType||null};
   const d=new Date();
   setState(index,'live','Updated '+clock(d));
  }catch(e){
   const [code,text]=errorParts(e);
   if(code==='busy')return;   // a sign-in window is open; leave the status alone
   if(code==='not_connected'){hook.update(index,BLANK);setState(index,'signin','Not connected · click to sign in')}
   else if(code==='no_codex')setState(index,'error',text);
   else setState(index,'error',text.length>46?text.slice(0,44)+'…':text);
  }
 }
 const enabled=i=>!window.NotchSettings||window.NotchSettings.get('accountsEnabled')[i]!==false;
 const refreshAll=()=>Promise.all([0,1,2].filter(enabled).map(refresh));

 /* ---- sign in: Codex shows a code, the person enters it in their own browser ---- */
 let signingIn=false;
 async function signInClaude(){
  if(signingIn)return;
  signingIn=true;signInSlot=2;
  setState(2,'busy','Finish signing in to Claude in the window that opened');
  try{
   const reading=await invoke('claude_connect');
   hook.update(2,toAccount(reading));
   info[2]={};
   setState(2,'live','Updated '+clock(new Date()));
  }catch(e){
   const [code,text]=errorParts(e);
   if(code==='cancelled')setState(2,'signin','Not connected · click to sign in');
   else setState(2,'error',text.length>46?text.slice(0,44)+'…':text);
  }finally{signingIn=false;signInSlot=null}
 }
 async function signIn(index){
  if(index===2)return signInClaude();
  if(signingIn||index>1)return;
  signingIn=true;signInSlot=index;
  setState(index,'busy','Starting sign-in…');
  try{
   const browser=window.NotchSettings?window.NotchSettings.get('browsers')[index]:'Default';
   const prompt=await invoke('codex_login',{slot:index,browser});
   signInCode=prompt.code;
   invoke('copy_text',{text:prompt.code}).catch(()=>{});
   setState(index,'code','Code '+prompt.code+' · copied · click to copy again');
   // Wait (up to 10 minutes) for the person to finish; Codex then saves the account itself.
   for(let i=0;i<300;i++){
    await new Promise(r=>setTimeout(r,2000));
    if(await invoke('codex_login_finished'))break;
   }
   await refresh(index);
  }catch(e){
   const [,text]=errorParts(e);
   setState(index,'error',text.length>46?text.slice(0,44)+'…':text);
  }finally{signingIn=false;signInSlot=null;signInCode=null}
 }

 function copyCode(index){
  if(!signInCode||index!==signInSlot)return Promise.resolve(false);
  return invoke('copy_text',{text:signInCode}).then(()=>true).catch(()=>false);
 }
 async function disconnect(index){
  if(index>2)return;
  if(index===signInSlot)await invoke('codex_login_cancel').catch(()=>{});
  try{
   if(index===2)await invoke('claude_disconnect');
   else await invoke('codex_logout',{slot:index});
   info[index]={};
   setState(index,'signin','Not connected · click to sign in');
  }catch(e){
   const [,text]=errorParts(e);
   setState(index,'error',text.length>46?text.slice(0,44)+'…':text);
  }
 }

 status.addEventListener('click',()=>{
  const index=hook.selected();
  const kind=state[index]?.kind;
  if(kind==='signin')signIn(index);
  else if(kind==='code')copyCode(index).then(ok=>{
   if(!ok)return;
   status.textContent='Copied';
   setTimeout(()=>{if(state[index]?.kind==='code')paintStatus()},1200);
  });
 });

 // Used by the Settings screen.
 window.LiveData={
  state:index=>({...(state[index]||{}),info:info[index]||{},code:index===signInSlot?signInCode:null}),
  signIn,disconnect,copyCode,refresh,
  onChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}
 };
 // The refresh button now refreshes real data instead of restoring the samples.
 $('refresh').addEventListener('click',e=>{e.stopImmediatePropagation();refreshAll()},{capture:true});
 for(const tab of document.querySelectorAll('[data-account]'))tab.addEventListener('click',()=>queueMicrotask(paintStatus));

 refreshAll();
 setInterval(refreshAll,REFRESH_MS);
})();
