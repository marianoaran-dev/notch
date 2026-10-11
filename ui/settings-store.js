/* Settings store: loads the saved settings, applies them to the page, and saves changes.
   Inside the app they live in settings.json (written by Rust). In a browser preview they
   are kept in localStorage so the screen can still be tried out. */
(()=>{
 const tauri=window.__TAURI__;
 const invoke=tauri?tauri.core.invoke:null;
 const DEFAULTS={
  uiScale:100,              // % size of the whole notch interface
  compactHeight:60,         // px height of the small (compact) notch, 35 to 70
  collapseOnClickAway:true, // collapse the notch when another app is clicked
  notchOpacity:100,         // % opacity of the black notch body
  displayAlwaysOpen:true,   // keep Day / Night / Off visible beside Display
  monitor:'',               // "x,y" of the monitor to show on; empty = built-in default
  names:['Account 1','Account 2','Claude'],
  tasksWidth:650,           // px width of the open Tasks screen (drag its corner grip)
  tasksListHeight:340,      // px: tallest the task list may grow before it scrolls
  tasksListMin:0,           // px: shortest the list may be (0 = fit the tasks; set by dragging the handle)
  tasksScroll:0,            // how far the list was scrolled when last left
  tasksCompletedOpen:false, // whether the Completed section was open
  displayPresets:{},        // Day / Night / Custom 1-3: { key: { name, monitors: { id: {brightness, contrast} } } }
  displayLinked:[],         // monitor ids whose brightness and contrast move together
  accountsEnabled:[true,true,true], // show each account in Piggy Bank and the small notch
  // Browser used for each Codex account's sign-in page. Like the old app, Account 1 uses
  // Chrome and Account 2 uses Edge, because one browser can only be signed in to one account.
  browsers:['Chrome','Edge','Default']
 };
 let values={...DEFAULTS,names:[...DEFAULTS.names],browsers:[...DEFAULTS.browsers]};
 const listeners=new Set();
 let saveTimer=null,loaded=false;

 const clamp=(n,a,b)=>Math.min(b,Math.max(a,Number(n)||0));
 function sanitise(raw){
  const v={...DEFAULTS,...raw};
  v.uiScale=clamp(v.uiScale,80,130);
  v.compactHeight=clamp(v.compactHeight,35,70);
  v.tasksWidth=clamp(v.tasksWidth,420,1000);
  v.tasksListHeight=clamp(v.tasksListHeight,120,560);
  v.tasksListMin=v.tasksListMin?clamp(v.tasksListMin,75,560):0;
  v.tasksScroll=clamp(v.tasksScroll,0,100000);
  v.tasksCompletedOpen=!!v.tasksCompletedOpen;
  v.collapseOnClickAway=v.collapseOnClickAway!==false;
  v.notchOpacity=clamp(v.notchOpacity,50,100);
  v.displayAlwaysOpen=!!v.displayAlwaysOpen;
  v.monitor=typeof v.monitor==='string'?v.monitor:'';
  // Display presets: only the known slots, only numbers 0-100, bounded size.
  const slots=['day','night','custom1','custom2','custom3'];
  const presets={};
  const rawPresets=raw&&raw.displayPresets&&typeof raw.displayPresets==='object'?raw.displayPresets:{};
  for(const key of slots){
   const p=rawPresets[key];
   if(!p||typeof p!=='object'||!p.monitors||typeof p.monitors!=='object')continue;
   const monitors={};
   for(const [id,val] of Object.entries(p.monitors).slice(0,16)){
    if(typeof id!=='string'||id.length>80||!val)continue;
    monitors[id]={brightness:clamp(val.brightness,0,100),contrast:clamp(val.contrast,0,100)};
   }
   if(Object.keys(monitors).length)presets[key]={name:String(p.name||key).slice(0,24),monitors};
  }
  v.displayPresets=presets;
  v.displayLinked=Array.isArray(raw&&raw.displayLinked)?raw.displayLinked.filter(x=>typeof x==='string'&&x.length<=80).slice(0,16):[];
  v.names=DEFAULTS.names.map((d,i)=>String((raw&&raw.names&&raw.names[i])??d).trim().slice(0,24)||d);
  const allowed=['Default','Chrome','Chrome (private)','Edge','Edge (private)','DuckDuckGo'];
  v.accountsEnabled=DEFAULTS.accountsEnabled.map((d,i)=>raw&&raw.accountsEnabled&&typeof raw.accountsEnabled[i]==='boolean'?raw.accountsEnabled[i]:d);
  // At least one account must stay visible.
  if(!v.accountsEnabled.some(Boolean))v.accountsEnabled[0]=true;
  v.browsers=DEFAULTS.browsers.map((d,i)=>allowed.includes(raw&&raw.browsers&&raw.browsers[i])?raw.browsers[i]:d);
  return v;
 }

 function apply(changed){
  const root=document.documentElement;
  root.style.setProperty('--ui-scale',String(values.uiScale/100));
  root.style.setProperty('--notch-alpha',String(values.notchOpacity/100));
  root.style.setProperty('--tasks-list-h',values.tasksListHeight+'px');
  root.style.setProperty('--tasks-list-min',(values.tasksListMin||75)+'px');
  // The compact notch is 60px tall at scale 1. Its on-screen height should be exactly
  // compactHeight whatever the interface size, so cancel the interface zoom out of it.
  root.style.setProperty('--compact-scale',String((values.compactHeight/60)/(values.uiScale/100)));
  if(window.NotchOptions)window.NotchOptions.displayAlwaysOpen=values.displayAlwaysOpen;
  if(!changed||changed==='accountsEnabled'){
   const hidden=values.accountsEnabled.map((on,i)=>on?null:i).filter(i=>i!==null);
   root.setAttribute('data-hidden-accounts',hidden.join(' '));
   if(window.PiggyData){
    const sel=window.PiggyData.selected();
    if(hidden.includes(sel))window.PiggyData.select(values.accountsEnabled.findIndex(Boolean));
   }
  }
  if(!changed||changed==='displayAlwaysOpen'){
   if(window.PiggyData)window.PiggyData.syncDisplay();
  }
  if(!changed||changed==='names'){
   values.names.forEach((name,i)=>{
    const tab=document.querySelector('[data-account="'+i+'"]');
    if(tab)tab.textContent=name;
    const tip=document.querySelectorAll('#idleShell > *')[i];
    const label=tip&&tip.querySelector('.idle-popup');
    if(label)label.textContent=name;
    if(window.PiggyData)window.PiggyData.update(i,{name});
   });
  }
  // A new size or look can change what is clickable; the reporter in app-shell.js sees it.
  if(window.PiggyData)window.PiggyData.reshape();
 }

 function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
   if(invoke)invoke('settings_save',{value:values}).catch(()=>{});
   else try{localStorage.setItem('vnotch-settings',JSON.stringify(values))}catch{}
  },400);
 }

 const store={
  get:key=>values[key],
  all:()=>JSON.parse(JSON.stringify(values)),
  set(key,value){
   values=sanitise({...values,[key]:value});
   apply(key);
   if(key==='monitor'&&invoke)invoke('set_monitor',{id:values.monitor||null}).catch(()=>{});
   scheduleSave();
   listeners.forEach(fn=>fn(key));
  },
  setIndexed(key,index,value){
   const next=[...values[key]];next[index]=value;store.set(key,next);
  },
  onChange(fn){listeners.add(fn);return()=>listeners.delete(fn)},
  defaults:()=>JSON.parse(JSON.stringify(DEFAULTS)),
  isLoaded:()=>loaded
 };
 window.NotchSettings=store;

 (async()=>{
  let raw={};
  try{
   if(invoke)raw=await invoke('settings_load');
   else raw=JSON.parse(localStorage.getItem('vnotch-settings')||'{}');
  }catch{}
  values=sanitise(raw||{});
  loaded=true;
  apply(null);
  listeners.forEach(fn=>fn('*'));
 })();
})();
