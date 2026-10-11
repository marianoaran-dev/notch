/* Display screen: real monitors instead of the prototype's samples.
   Brightness and contrast are read from and written to each physical monitor by Rust (DDC/CI).
   Ported from the old app: per-monitor Link, all-monitor link, five presets (Day, Night, Custom 1-3),
   Sleep and the Day / Night / Off shortcuts. */
(()=>{
 const tauri=window.__TAURI__;
 const hook=window.PiggyData,store=window.NotchSettings,M=window.CodenotchMotion,I=window.AukalenLucide;
 const host=document.getElementById('displayMonitors');
 if(!tauri||!hook||!store||!host)return;
 const invoke=tauri.core.invoke;
 const $=id=>document.getElementById(id);
 const clamp=n=>Math.min(100,Math.max(0,Number.isFinite(n)?n:0));
 const KINDS=['brightness','contrast'];
 const PRESETS={day:'Day',night:'Night',custom1:'Custom 1',custom2:'Custom 2',custom3:'Custom 3'};

 let monitors=[];            // from Rust: {id,name,device,primary,brightness:{supported,percent,max},contrast:{...}}
 let selectedPreset=null;
 let allLinked=false;        // the "Link monitors" switch: transient, like the old app
 let loading=false;

 /* ---------- take over the prototype's sample controls ---------- */
 // Capture-phase listeners that stop the prototype's own (sample-data) handlers from running.
 function takeOver(el,type,handler){
  if(!el)return;
  el.addEventListener(type,e=>{e.stopImmediatePropagation();handler(e,el)},{capture:true});
 }
 host.replaceChildren();
 const kicker=document.querySelector('#displayPreview .audio-kicker');
 if(kicker)kicker.textContent='DISPLAY';
 const foot=document.querySelector('.display-foot');
 const setNote=text=>{if(foot)foot.textContent=text};
 const defaultNote='Brightness and contrast are sent to each monitor over its display cable (DDC/CI). Some monitors do not support one or both.';
 setNote(defaultNote);
 let noteTimer=null;
 const flash=text=>{setNote(text);clearTimeout(noteTimer);noteTimer=setTimeout(()=>setNote(defaultNote),3500)};

 /* ---------- linking ---------- */
 const linkedIds=()=>new Set(store.get('displayLinked')||[]);
 const isLinked=id=>linkedIds().has(id);
 function setLinked(id,on){
  const set=linkedIds();on?set.add(id):set.delete(id);
  store.set('displayLinked',[...set]);
 }
 const pair=k=>k==='brightness'?'contrast':'brightness';
 const value=(m,k)=>m[k].percent;
 const supported=(m,k)=>m[k].supported;

 // A user change moves the whole linked group by the same number of points, never
 // clamping each member separately (which would slowly destroy their relationship).
 function plan(sourceId,kind,requested){
  const source=monitors.find(m=>m.id===sourceId);
  if(!source||!supported(source,kind))return [];
  const group=[[source,kind]];
  if(isLinked(source.id)&&supported(source,pair(kind)))group.push([source,pair(kind)]);
  if(allLinked){
   for(const m of monitors){
    if(m.id===source.id||!supported(m,kind))continue;
    group.push([m,kind]);
    if(isLinked(m.id)&&supported(m,pair(kind)))group.push([m,pair(kind)]);
   }
  }
  const wanted=clamp(requested)-value(source,kind);
  if(Math.abs(wanted)<=1e-4)return [];
  const lowest=Math.max(...group.map(([m,k])=>-value(m,k)));
  const highest=Math.min(...group.map(([m,k])=>100-value(m,k)));
  const delta=Math.min(Math.max(wanted,lowest),highest);
  return group.map(([m,k])=>({id:m.id,kind:k,value:clamp(value(m,k)+delta)}));
 }

 /* ---------- writing to the monitors ---------- */
 // Latest value wins: while a write is in flight, only the newest request for that control is kept.
 const pending=new Map(),inflight=new Set(),timers=new Map();
 function queueWrite(id,kind,percent){
  const key=id+'|'+kind;
  pending.set(key,percent);
  clearTimeout(timers.get(key));
  timers.set(key,setTimeout(()=>flush(id,kind),70));
 }
 async function flush(id,kind){
  const key=id+'|'+kind;
  if(inflight.has(key)||!pending.has(key))return;
  const percent=pending.get(key);pending.delete(key);
  inflight.add(key);
  try{await invoke('monitor_set',{id,control:kind,percent})}
  catch(e){const m=monitors.find(x=>x.id===id);flash('Could not change '+kind+(m?' on '+m.name:'')+'. The monitor may be busy.')}
  finally{
   inflight.delete(key);
   if(pending.has(key))flush(id,kind);
  }
 }
 function apply(updates){
  for(const u of updates){
   const m=monitors.find(x=>x.id===u.id);if(!m)continue;
   m[u.kind].percent=u.value;
   queueWrite(u.id,u.kind,u.value);
  }
  paint();
 }

 /* ---------- drawing the monitor rows ---------- */
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
 function paint(){
  for(const [i,section] of [...host.querySelectorAll('.display-monitor')].entries()){
   const m=monitors[i];if(!m)continue;
   section.querySelector('.display-monitor-link input').checked=isLinked(m.id);
   for(const kind of KINDS){
    const slide=section.querySelector('[data-display-control="'+kind+'"]');
    const out=section.querySelector('[data-display-output="'+kind+'"]');
    if(!supported(m,kind)){slide.disabled=true;slide.value=0;slide.style.setProperty('--level','0%');out.textContent='n/a';continue}
    slide.disabled=false;
    if(document.activeElement!==slide||true){slide.value=m[kind].percent}
    slide.style.setProperty('--level',m[kind].percent+'%');
    out.textContent=Math.round(m[kind].percent)+'%';
   }
  }
  paintPresets();
 }
 function build(){
  host.replaceChildren();
  if(loading&&!monitors.length){host.append(el('p','display-foot','Reading monitors…'));hook.reshape();return}
  if(!monitors.length){
   host.append(el('p','display-foot','No monitors that accept brightness control were found. Check that DDC/CI is turned on in each monitor\'s own menu.'));
   hook.reshape();return;
  }
  monitors.forEach((m,i)=>{
   const row=el('section','display-monitor');
   const head=el('div','display-monitor-header');
   const title=el('div','display-monitor-heading');
   if(I)title.innerHTML=I.svg('monitor');
   // Windows reports most monitors as 'Generic PnP Monitor', which says nothing: number them instead.
   const generic=/generic pnp monitor|physical monitor/i.test(m.name);
   title.append(el('strong',null,generic?('Display '+(i+1)+(m.primary?' · primary':'')):((i+1)+' · '+m.name+(m.primary?' · primary':''))),el('span',null,generic?m.device:m.device));
   const link=el('label','display-monitor-link');
   const box=document.createElement('input');box.type='checkbox';box.checked=isLinked(m.id);
   box.addEventListener('change',()=>setLinked(m.id,box.checked));
   link.append(box,document.createTextNode(' Link'));
   head.append(title,link);row.append(head);
   for(const kind of KINDS){
    const item=el('div','display-control');
    const label=el('label',null,kind[0].toUpperCase()+kind.slice(1));
    const slide=document.createElement('input');slide.type='range';slide.min='0';slide.max='100';
    slide.setAttribute('data-display-control',kind);slide.setAttribute('aria-label',m.name+' '+kind);
    const out=document.createElement('output');out.setAttribute('data-display-output',kind);
    slide.addEventListener('input',()=>apply(plan(m.id,kind,Number(slide.value))));
    item.append(label,slide,out);row.append(item);
   }
   host.append(row);
  });
  paint();hook.reshape();
 }

 /* ---------- presets ---------- */
 const presets=()=>store.get('displayPresets')||{};
 const hasPreset=key=>{const p=presets()[key];return !!p&&Object.keys(p.monitors||{}).length>0};
 function paintPresets(){
  for(const chip of document.querySelectorAll('[data-display-preset]')){
   const key=chip.dataset.displayPreset,saved=hasPreset(key);
   chip.setAttribute('aria-pressed',String(key===selectedPreset));
   chip.style.opacity=saved||key===selectedPreset?'1':'.65';
   chip.title=saved?'Apply '+PRESETS[key]:PRESETS[key]+' is empty. Select it, then choose Save current.';
  }
  const save=$('displaySave');if(save)save.disabled=!(selectedPreset&&monitors.length);
  for(const id of ['displayDay','displayNight']){
   const button=$(id);if(button)button.classList.toggle('no-preset',!hasPreset(id==='displayDay'?'day':'night'));
  }
 }
 function applyPreset(key){
  const preset=presets()[key];if(!preset)return false;
  const updates=[];
  for(const [id,v] of Object.entries(preset.monitors||{})){
   const m=monitors.find(x=>x.id===id);if(!m)continue;
   for(const kind of KINDS)if(supported(m,kind)&&Number.isFinite(v[kind]))updates.push({id,kind,value:clamp(v[kind])});
  }
  if(!updates.length){flash('That preset was saved for monitors that are not connected now.');return false}
  apply(updates);return true;
 }
 function saveCurrent(){
  if(!selectedPreset||!monitors.length)return;
  const saved={};
  for(const m of monitors){
   if(!supported(m,'brightness')&&!supported(m,'contrast'))continue;
   saved[m.id]={brightness:Math.round(m.brightness.percent),contrast:Math.round(m.contrast.percent)};
  }
  store.set('displayPresets',{...presets(),[selectedPreset]:{name:PRESETS[selectedPreset],monitors:saved}});
  flash('Saved '+PRESETS[selectedPreset]+'.');paintPresets();
 }

 /* ---------- reading the monitors ---------- */
 let refreshing=null;
 async function refresh(){
  if(refreshing)return refreshing;
  loading=true;if(!monitors.length)build();
  refreshing=(async()=>{
   try{
    const list=await invoke('monitors_list');
    // keep only what can actually be controlled
    monitors=list.filter(m=>m.brightness.supported||m.contrast.supported);
   }catch{monitors=[]}
   finally{loading=false;refreshing=null}
   build();
  })();
  return refreshing;
 }

 /* ---------- wire the controls ---------- */
 for(const chip of document.querySelectorAll('[data-display-preset]')){
  takeOver(chip,'click',()=>{
   selectedPreset=chip.dataset.displayPreset;
   if(hasPreset(selectedPreset))applyPreset(selectedPreset);
   else flash(PRESETS[selectedPreset]+' is empty. Set the sliders, then choose Save current.');
   paint();
  });
 }
 takeOver($('displaySave'),'click',saveCurrent);
 takeOver($('displayLinkAll'),'change',(e,box)=>{allLinked=box.checked});
 takeOver($('displaySleep'),'click',(e,btn)=>{M&&M.press(btn);invoke('monitors_off').catch(()=>{})});
 takeOver($('displayRefresh'),'click',(e,btn)=>{M&&M.press(btn);refresh()});
 // Day / Night / Off beside the Display button.
 for(const [id,key] of [['displayDay','day'],['displayNight','night']]){
  takeOver($(id),'click',async(e,btn)=>{
   M&&M.press(btn);
   await refresh();
   if(hasPreset(key)){applyPreset(key);selectedPreset=key;paint()}
   else hook.open('display');   // nothing saved yet: open Display so it can be set up
  });
 }
 takeOver($('displayOff'),'click',(e,btn)=>{M&&M.press(btn);invoke('monitors_off').catch(()=>{})});

 // Read the monitors whenever the Display screen opens, and once at start.
 const panel=$('displayPreview');
 if(panel)new MutationObserver(()=>{if(!panel.hidden)refresh()}).observe(panel,{attributes:true,attributeFilter:['hidden']});
 store.onChange(key=>{if(key==='displayPresets'||key==='displayLinked'||key==='*')paint()});
 refresh();
})();
