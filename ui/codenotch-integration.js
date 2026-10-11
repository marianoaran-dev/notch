/* V-Notch Piggy prototype interaction, with Codenotch spring motion.
   The layout, icons and sample data belong to this prototype. Motion uses
   the MIT-licensed Codenotch source adaptations in codenotch-motion.js. */
(function () {
'use strict';
const M=window.CodenotchMotion;
if(!M)throw new Error('codenotch-motion.js must load first');
const $=id=>document.getElementById(id);
const I=window.AukalenLucide;
if(!I)throw new Error('Missing self-contained Lucide icons');
I.mount(document);
const defaults=[
{name:'Mariano',five:74,week:38,fiveReset:'2h 14m',weekReset:'Friday, 9:00 am',weekShort:'Fri, 9:00 am',weekTime:'4 days 8 hours',shortRemaining:'4d 8h remaining',days:4,banked:['15 Oct · 7:00 pm','20 Oct · 5:30 pm']},
{name:'OzNano',five:18,week:86,fiveReset:'48m',weekReset:'Monday, 10:00 am',weekShort:'Mon, 10:00 am',weekTime:'2 days 6 hours',shortRemaining:'2d 6h remaining',days:2,banked:['12 Oct · 8:20 pm']},
{name:'Claude',five:61,week:54,fiveReset:'3h 5m',weekReset:'Sunday, 8:00 pm',weekShort:'Sun, 8:00 pm',weekTime:'5 days 1 hour',shortRemaining:'5d 1h remaining',days:5,banked:[]}
];
let accounts=defaults.map(a=>({...a})),account=0,mode='redesign',view='expanded',mainScreen='piggy';
let first=true,previousView=null,previousAccount=null,previousMode=null,previousScreen=null;
let bankedKey=null,noticeTimer=null,displayPanelOpen=false,displayOpen=false,displayToken=0;
let settingsPinned=false,settingsOpen=false,settingsToken=0,audioOpen=false,audioMuted=false;
let settingsHover=false,settingsLeaveTimer=null,settingsGooFrame=null;
const settingsDelays=[];
let taskOpen=false,showCompleted=false,nextTaskId=4;
const tasks=[
{id:1,text:'Review the Piggy Bank layout',done:false},
{id:2,text:'Try the Display shortcuts',done:false},
{id:3,text:'Check the notch glance',done:true}
];
const iconClock=I.svg('clock-3');
const iconCalendar=I.svg('calendar-days');
function clamp(n,a,b){return Math.min(b,Math.max(a,n))}
function colour(n){return n<=20?'#ff6c63':n<=40?'#ffb340':'#30d158'}
function shades(el,p,updateValue=true){
 if(updateValue)el.style.setProperty('--v',p);
 el.style.setProperty('--meter',colour(p));
 el.style.setProperty('--light',p<=20?'#ffc1b9':p<=40?'#ffe4a1':'#8ceea5');
 el.style.setProperty('--dark',p<=20?'#b73538':p<=40?'#a46c13':'#178436');
 el.style.setProperty('--glow',p<=20?'#ff6c6366':p<=40?'#ffb34066':'#30d15866');
}
function rowBlocks(element,count){
 if(element.children.length!==7){element.replaceChildren();for(let i=0;i<7;i++)element.appendChild(document.createElement(element.id==='originalDayBlocks'?'i':'span'))}
 for(let i=0;i<7;i++)element.children[i].classList.toggle(element.id==='originalDayBlocks'?'on':'active',i<count);
}
function percentPaint(kind,value){
 const safe=clamp(value,0,100),rounded=Math.round(safe);
 document.querySelectorAll('[data-number="'+kind+'"]').forEach(e=>e.textContent=rounded+'%');
 document.querySelectorAll('[data-fill="'+kind+'"]').forEach(e=>e.style.setProperty('--v',safe));
 const selected=$('idleShell').children[account];
 if(selected){
  const item=selected.querySelectorAll('.idle-item')[kind==='five'?0:1];
  if(item){
   item.firstElementChild.style.setProperty('--v',safe);
   item.querySelector('.idle-number').textContent=rounded+'%';
  }
 }
}
function readings(){
 const a=accounts[account];
 for(const kind of ['five','week']){
  const key='reading-'+kind,target=a[kind],paint=v=>percentPaint(kind,v);
  if(first)M.snap(key,target,paint);
  else M.to(key,target,'reading',paint);
 }
}
const SCREEN_PANEL={audio:'audioPreview',display:'displayPreview',tasks:'tasksPreview',settings:'settingsPreview'};
// Natural width of the compact notch: the visible account pairs plus padding (615 for three).
// Measured on screen, then divided by the scales applied to the row, so it is in the row's own units.
function idleWidth(){
 const pairs=[...document.querySelectorAll('#idleShell > .idle-pair')].filter(p=>p.offsetParent!==null);
 if(!pairs.length)return 615;
 const root=getComputedStyle(document.documentElement);
 const cs=parseFloat(root.getPropertyValue('--compact-scale'))||1,ui=parseFloat(root.getPropertyValue('--ui-scale'))||1;
 const total=pairs.reduce((sum,p)=>sum+p.getBoundingClientRect().width,0)/(cs*ui);
 return Math.max(170,Math.round(total+24));
}
function notchShape(){
 const n=$('notch');
 const cs=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--compact-scale'))||1;
 const width=view==='idle'?idleWidth()*cs:mainScreen==='audio'?860:mainScreen==='display'?660:mainScreen==='settings'?900:mainScreen==='tasks'?((window.NotchSettings&&window.NotchSettings.get('tasksWidth'))||650):650;
 let height=view==='idle'?60*cs:((accounts[account].banked&&accounts[account].banked.length)?362:314);
 if(view!=='idle'&&mainScreen!=='piggy'){
  const panel=$(SCREEN_PANEL[mainScreen]);
  height=Math.max(mainScreen==='tasks'?335:220,Math.ceil(panel.scrollHeight)+2);
 }
 const corner=view==='idle'?26*cs:30;
 const activePanel=view==='idle'?null:
  mainScreen==='piggy'?n.querySelector('.notch-expanded'):
  $(SCREEN_PANEL[mainScreen]);
 for(const [part,value,paint] of [
  ['width',width,v=>n.style.width=v+'px'],
  ['height',height,v=>{
   n.style.height=v+'px';
   // The content is revealed only as the notch's lower edge moves down.
   // Clip the CONTENT rather than the shell, keeping the side bubbles visible.
   if(activePanel){
    const clipped=Math.max(0,height-v);
    activePanel.style.clipPath='inset(0px 0px '+clipped+'px 0px)';
   }
  }],
  ['corner',corner,v=>{n.style.borderBottomLeftRadius=v+'px';n.style.borderBottomRightRadius=v+'px'}]
 ]){
  if(first)M.snap('notch-'+part,value,paint);
  else M.to('notch-'+part,value,'unfold',paint);
 }
}
let entrySerial=0;
function enter(el,index,distance=9){
 if(!M.enabled()||!el)return;
 const key='entry-'+(++entrySerial);
 el.style.opacity='0';el.style.translate='0 '+distance+'px';
 setTimeout(()=>{
  if(!el.isConnected)return;
  M.to(key+'-y',0,'contents',v=>el.style.translate='0 '+v+'px',{from:distance});
  M.to(key+'-alpha',1,'contents',v=>el.style.opacity=clamp(v,0,1),{from:0});
 },M.stagger(index));
}
function showContents(){
 if(view==='idle'){
  [...$('idleShell').children].forEach((el,i)=>enter(el,i,6));
 }else if(mainScreen==='piggy'){
  [document.querySelector('.piggy-header'),...document.querySelectorAll('.quota-section'),$('banked')]
   .filter(el=>el.getClientRects().length).forEach((el,i)=>enter(el,i));
 }else{
  const panel=$(SCREEN_PANEL[mainScreen]);
  if(M.enabled())M.to('screen-content-opacity',1,'contents',v=>panel.style.opacity=String(clamp(v,0,1)),{from:0});
  else panel.style.opacity='1';
 }
}
function drawGlance(){
 const root=$('idleShell'),rebuild=root.dataset.mode!==mode||root.children.length!==accounts.length;
 if(rebuild){
  root.replaceChildren();
  accounts.forEach((a,i)=>{
   const group=document.createElement('div');group.className='idle-pair';
   const five=document.createElement('button');five.type='button';five.className='idle-item';
   const f=document.createElement('span');f.className='idle-ring';f.innerHTML=iconClock;
   const fval=document.createElement('span');fval.className='idle-number';five.append(f,fval);
   const week=document.createElement('button');week.type='button';week.className='idle-item';
   const w=document.createElement('span');w.className=mode==='redesign'?'idle-week-bar':'idle-ring';
   w.innerHTML=mode==='redesign'?'<b></b>':iconCalendar;
   const wval=document.createElement('span');wval.className='idle-number';week.append(w,wval);
   const tip=document.createElement('div');tip.className='idle-popup';tip.textContent=a.name;
   const tipSpring=show=>M.to('tooltip-'+i,show?0:-7,'glide',y=>tip.style.setProperty('--tooltip-y',y+'px'),{from:show?-7:0});
   group.addEventListener('pointerenter',()=>tipSpring(true));
   group.addEventListener('pointerleave',()=>tipSpring(false));
   for(const button of [five,week])button.addEventListener('click',()=>{account=i;expandNotch()});
   group.append(five,week,tip);root.append(group);
  });
  root.dataset.mode=mode;
 }
 accounts.forEach((a,i)=>{
  const group=root.children[i],items=group.querySelectorAll('.idle-item');
  items[0].setAttribute('aria-label',a.name+' five-hour quota, '+a.five+'% available');
  items[1].setAttribute('aria-label',a.name+' weekly quota, '+a.week+'% available');
  shades(items[0].firstElementChild,a.five,i!==account);
  shades(items[1].firstElementChild,a.week,i!==account);
  const numbers=group.querySelectorAll('.idle-number');
  numbers[0].textContent=(i===account?Math.round(M.get('reading-five')??a.five):a.five)+'%';
  numbers[1].textContent=(i===account?Math.round(M.get('reading-week')??a.week):a.week)+'%';
 });
}
function banked(items){
 const key=account+':'+items.join('|');if(key===bankedKey)return;bankedKey=key;
 const parent=$('bankedChips');parent.replaceChildren();
 if(!items.length){const empty=document.createElement('div');empty.className='banked-empty';empty.textContent='No banked resets';parent.append(empty);return}
 items.forEach((date,i)=>{
  const chip=document.createElement('div');chip.className='banked-chip';
  const icon=document.createElement('img');icon.src='./piggy-panel-pink.png';icon.alt='';
  const words=document.createElement('span'),label=document.createElement('small'),text=document.createElement('strong');
  label.textContent='EXPIRES';text.textContent=date;words.append(label,text);chip.append(icon,words);parent.append(chip);
  if(!first)enter(chip,i,6);
 });
}
function hint(message){
 const el=$('hoverhint');clearTimeout(hint.timer);el.textContent=message;
 hint.timer=setTimeout(()=>{el.textContent=view==='idle'?'Hover over a quota pair for the account name. Click a quota to expand.':'Interactive comparison. Choose an account or adjust the quotas below.'},3000);
}
function message(value){
 $('status').textContent=value;clearTimeout(noticeTimer);
 noticeTimer=setTimeout(()=>{$('status').textContent='Updated just now'},2200);
}
const displayButtons=['displayDay','displayNight','displayOff'],gooCircles=['gooDay','gooNight','gooOff'];
const offsets=[111,74,37],gooTargets=[30,67,104];
const delays=[];
function updateGoo(){
 const positions=offsets.map((defaultValue,i)=>M.get('display-item-'+i)??defaultValue);
 positions.forEach((shift,i)=>$(gooCircles[i]).setAttribute('cx',String(gooTargets[i]+shift)));
 const stillMoving=positions.some((shift,i)=>Math.abs(shift-(displayOpen?0:offsets[i]))>.6);
 $('displayGoo').style.opacity=(M.enabled()&&stillMoving)?'.92':'0';
}
function setDisplayOpen(open){
 if(displayOpen===open)return;
 displayOpen=open;
 const token=++displayToken;
 while(delays.length)clearTimeout(delays.pop());
 $('displayRail').classList.toggle('is-open',open);
 displayButtons.forEach((id,i)=>{
  const button=$(id);button.tabIndex=open?0:-1;
  const target=open?0:offsets[i];
  const run=()=>{
   if(token!==displayToken)return;
   M.to('display-item-'+i,target,'contents',shift=>{
    const visible=clamp(1-shift/offsets[i],0,1);
    button.style.translate=shift+'px 0';
    button.style.opacity=String(visible);
    button.style.visibility=visible<.02?'hidden':'visible';
    updateGoo();
   },{complete:updateGoo});
  };
  const delay=M.enabled()?M.stagger(open?i:2-i):0;
  if(delay)delays.push(setTimeout(run,delay));else run();
 });
}
function syncDisplay(){
 const host=$('displayCompanion');
 // Hover reveals Day/Night/Off; clicking the main icon opens Display itself.
 setDisplayOpen((window.NotchOptions&&window.NotchOptions.displayAlwaysOpen)||host.matches(':hover')||host.matches(':focus-within'));
 $('displayMain').setAttribute('aria-expanded',String(displayPanelOpen));
}

/* Browser-only Display utility. Reproduces the production control types;
   deliberately never calls Win32, DDC/CI or monitor-power APIs. */
const sampleMonitors=[
 {name:'LG ULTRAFINE',description:'Example external display',brightness:72,contrast:68,link:true},
 {name:'Second display',description:'Example additional monitor',brightness:58,contrast:54,link:true}
];
const monitorState=sampleMonitors.map(m=>({...m}));
const displayPresetValues={
 day:sampleMonitors.map(({brightness,contrast})=>({brightness,contrast})),
 night:sampleMonitors.map(()=>({brightness:26,contrast:48}))
};
let selectedPreset=null;
function updateDisplayControls(){
 for(const [i,section] of [...$('displayMonitors').children].entries()){
  const model=monitorState[i];if(!model)continue;
  section.querySelector('.display-monitor-link input').checked=model.link;
  for(const name of ['brightness','contrast']){
   const slide=section.querySelector('[data-display-control="'+name+'"]');
   slide.value=model[name];
   slide.style.setProperty('--level',model[name]+'%');
   section.querySelector('[data-display-output="'+name+'"]').textContent=model[name]+'%';
  }
 }
}
function updatePresetButtons(){
 for(const chip of document.querySelectorAll('[data-display-preset]')){
  const key=chip.dataset.displayPreset;
  chip.setAttribute('aria-pressed',String(key===selectedPreset));
  chip.title=displayPresetValues[key]?'Apply '+chip.textContent+' sample preset':'Select then Save current to fill this sample slot';
  chip.style.opacity=displayPresetValues[key]||key===selectedPreset?'1':'.65';
 }
 $('displaySave').disabled=!selectedPreset;
}
function choosePreset(key){
 selectedPreset=key;
 const values=displayPresetValues[key];
 if(values){
  values.forEach((v,i)=>{if(monitorState[i]){monitorState[i].brightness=v.brightness;monitorState[i].contrast=v.contrast}});
  updateDisplayControls();
  hint('Sample '+key+' preset applied in this browser only.');
 }else hint('Sample '+key+' preset is empty. Select Save current to fill it.');
 updatePresetButtons();
}
function initDisplayMenu(){
 const target=$('displayMonitors');
 const monitorSvg=I.svg('monitor');
 monitorState.forEach((m,i)=>{
  const row=document.createElement('section');row.className='display-monitor';
  const head=document.createElement('div');head.className='display-monitor-header';
  const title=document.createElement('div');title.className='display-monitor-heading';title.innerHTML=monitorSvg;
  const name=document.createElement('strong');name.textContent=(i+1)+' · '+m.name;
  const desc=document.createElement('span');desc.textContent=m.description;
  title.append(name,desc);
  const link=document.createElement('label');link.className='display-monitor-link';
  const linked=document.createElement('input');linked.type='checkbox';linked.checked=m.link;
  link.append(linked,document.createTextNode(' Link'));head.append(title,link);
  linked.addEventListener('change',()=>{m.link=linked.checked});
  row.append(head);
  for(const kind of ['brightness','contrast']){
   const item=document.createElement('div');item.className='display-control';
   const label=document.createElement('label');label.textContent=kind[0].toUpperCase()+kind.slice(1);
   const slide=document.createElement('input');slide.type='range';slide.min='0';slide.max='100';
   slide.setAttribute('data-display-control',kind);
   slide.setAttribute('aria-label',m.name+' '+kind);
   const output=document.createElement('output');output.setAttribute('data-display-output',kind);
   item.append(label,slide,output);row.append(item);
   slide.addEventListener('input',()=>{
    const value=Number(slide.value);
    if($('displayLinkAll').checked){monitorState.forEach(m=>{if(m.link)m[kind]=value})}
    else m[kind]=value;
    updateDisplayControls();
   });
  }
  target.append(row);
 });
 document.querySelectorAll('[data-display-preset]').forEach(button=>{
  button.addEventListener('click',()=>choosePreset(button.dataset.displayPreset));
 });
 $('displaySave').addEventListener('click',()=>{
  if(!selectedPreset)return;
  displayPresetValues[selectedPreset]=monitorState.map(m=>({brightness:m.brightness,contrast:m.contrast}));
  updatePresetButtons();hint('Saved sample '+selectedPreset+' preset for this page only.');
 });
 $('displayLinkAll').addEventListener('change',event=>{
  if(event.target.checked)monitorState.forEach(m=>m.link=true);
  updateDisplayControls();
 });
 $('displaySleep').addEventListener('click',()=>hint('Monitor sleep disabled in the prototype. No monitor power change.'));
 $('displayRefresh').addEventListener('click',()=>{
  updateDisplayControls();
  M.press($('displayRefresh'));
  hint('Demonstration monitor list refreshed without querying hardware.');
 });
 updateDisplayControls();updatePresetButtons();
}

/* Settings shortcuts share Codenotch's spring and transient goo separator.
   The Settings rail unfolds to the RIGHT, beyond Tasks, to avoid overlap. */
const settingsButtons=['settingsQuit','settingsPiggy','settingsSound'];
const settingsCircles=['gooQuit','gooPiggy','gooSound'];
const settingsOffsets=[-37,-74,-111],settingsGooTargets=[62,99,136];
function updateSettingsGoo(){
 // All active springs request an update on every frame. Paint the goo once,
 // rather than repainting the blur/alpha-threshold filter three times per frame.
 if(settingsGooFrame!==null)return;
 settingsGooFrame=requestAnimationFrame(()=>{
  settingsGooFrame=null;
  const shifts=settingsOffsets.map((initial,i)=>M.get('settings-item-'+i)??initial);
  shifts.forEach((shift,i)=>$(settingsCircles[i]).setAttribute('cx',String(settingsGooTargets[i]+shift)));
  // Codenotch's goo merges only while separating/rejoining. A continuous
  // zero-velocity envelope avoids the previous hard 0/.92 visibility flip,
  // which could flicker or shudder around the spring settling threshold.
  const strength=Math.max(...shifts.map((shift,i)=>{
   const progress=clamp(1-Math.abs(shift/settingsOffsets[i]),0,1);
   return Math.sin(progress*Math.PI)**2;
  }));
  $('settingsGoo').style.opacity=String(M.enabled()?strength*.75:0);
 });
}
function setSettingsOpen(open){
 if(settingsOpen===open)return;
 settingsOpen=open;
 const token=++settingsToken;
 while(settingsDelays.length)clearTimeout(settingsDelays.pop());
 $('settingsRail').classList.toggle('is-open',open);
 settingsButtons.forEach((id,i)=>{
  const button=$(id);button.tabIndex=open?0:-1;
  const target=open?0:settingsOffsets[i];
  const run=()=>{
   if(token!==settingsToken)return;
   M.to('settings-item-'+i,target,'contents',shift=>{
    const proportion=clamp(1-Math.abs(shift)/Math.abs(settingsOffsets[i]),0,1);
    button.style.translate=shift+'px 0';
    button.style.opacity=String(proportion);
    button.style.visibility=proportion<.02?'hidden':'visible';
    updateSettingsGoo();
   },{complete:updateSettingsGoo});
  };
  const delay=M.enabled()?M.stagger(open?i:2-i):0;
  if(delay)settingsDelays.push(setTimeout(run,delay));else run();
 });
}
function syncSettings(){
 const host=$('settingsCompanion');host.classList.toggle('pinned',settingsPinned);
 // Hold the hover state through transient visibility/hit-testing changes
 // while the three spring-animated shortcuts unfold.
 const open=settingsPinned||settingsHover||host.contains(document.activeElement);
 $('settingsMain').setAttribute('aria-expanded',String(open));
 setSettingsOpen(open);
}
function openMainScreen(screen){
 if(!['piggy','audio','display','tasks','settings'].includes(screen))throw Error('Invalid screen');
 mainScreen=screen;view='expanded';render();
}
function collapseNotch(){
 if(view==='idle')return;
 view='idle';render();
}
function expandNotch(){
 // Normal notch activation always opens Piggy, regardless of the last
 // explicitly selected utility screen. Dedicated buttons still open theirs.
 mainScreen='piggy';
 view='expanded';
 render();
}
function setAudioOpen(open){
 if(open)openMainScreen('audio');
 else if(view==='expanded'&&mainScreen==='audio')collapseNotch();
}
function setDisplayPanelOpen(open){
 if(open)openMainScreen('display');
 else if(view==='expanded'&&mainScreen==='display')collapseNotch();
}
function initAudioMixer(){
 // Illustrative channels from the current V-Notch Audio mixer.
 // Real devices, enumerated applications and routing remain production-owned.
 const appSamples=[
  {id:'steam',name:'Steam',initial:'S',volume:100},
  {id:'dock',name:'dock',initial:'d',volume:100},
  {id:'vnotch',name:'V-Notch',initial:'V',volume:100},
  {id:'claude',name:'Claude',initial:'C',volume:100}
 ];
 const volumeSVG=I.svg('volume-2');
 const apps=$('audioAppRows');
 for(const app of appSamples){
  const row=document.createElement('div');row.className='audio-channel';row.dataset.channel=app.id;
  const source=document.createElement('div');source.className='audio-source';
  const icon=document.createElement('span');icon.className='audio-source-icon audio-app-icon '+app.id;icon.textContent=app.initial;icon.setAttribute('aria-hidden','true');
  const sourceText=document.createElement('span');sourceText.className='audio-source-text';
  const title=document.createElement('strong');title.textContent=app.name;
  sourceText.append(title);source.append(icon,sourceText);
  const volume=document.createElement('div');volume.className='audio-volume-controls';
  const mute=document.createElement('button');mute.className='audio-mute-btn';mute.type='button';
  mute.setAttribute('aria-label','Mute '+app.name);mute.setAttribute('aria-pressed','false');mute.innerHTML=volumeSVG;
  const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='100';slider.value=String(app.volume);slider.setAttribute('aria-label',app.name+' volume');
  const output=document.createElement('output');output.textContent=app.volume+'%';
  volume.append(mute,slider,output);
  const routeWrap=document.createElement('div');routeWrap.className='audio-route-wrap';
  const select=document.createElement('select');select.setAttribute('aria-label','Redirect '+app.name+' audio to');
  for(const [value,label] of [
   ['default','No redirect'],
   ['lg','1 - LG ULTRAFINE'],
   ['headset','Headset (UE MEGABOOM)'],
   ['speakers','Speakers (Realtek Audio)']
  ]){
   const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
  }
  routeWrap.append(select);row.append(source,volume,routeWrap);apps.append(row);
 }
 // The same control behaviour applies to both system and application rows.
 for(const row of document.querySelectorAll('.audio-channel')){
  const slider=row.querySelector('input[type="range"]');
  const mute=row.querySelector('.audio-mute-btn');
  const output=row.querySelector('output');
  const select=row.querySelector('select');
  let muted=false;
  const paint=()=>{
   const amount=Number(slider.value);
   slider.style.setProperty('--level',(muted?0:amount)+'%');
   output.textContent=muted?'Muted':amount+'%';
   output.classList.toggle('muted',muted);
   mute.setAttribute('aria-pressed',String(muted));
   mute.setAttribute('aria-label',(muted?'Unmute ':'Mute ')+row.dataset.channel);
   mute.innerHTML=I.svg(row.dataset.channel==='input'?'mic':muted?'volume-x':'volume-2',{size:16});
  };
  slider.addEventListener('input',()=>{muted=false;paint()});
  mute.addEventListener('click',()=>{muted=!muted;paint();M.press(mute)});
  select.addEventListener('change',()=>{
   const label=row.querySelector('.audio-source-text strong')?.textContent||row.dataset.channel;
   hint('Sample '+label+' device selection changed. No Windows audio settings were modified.');
  });
  paint();
 }
}

function setTasksOpen(open){
 if(open)openMainScreen('tasks');
 else if(view==='expanded'&&mainScreen==='tasks')collapseNotch();
}
function resizeTasksToContent(){
 if(mainScreen==='tasks'&&view==='expanded')requestAnimationFrame(notchShape);
}
function renderTasks(){
 const pending=tasks.filter(t=>!t.done),done=tasks.filter(t=>t.done);
 $('taskCount').textContent=pending.length+' to do';
 $('taskCompletedCount').textContent=String(done.length);
 const active=$('taskItems'),completed=$('completedItems');
 active.replaceChildren();completed.replaceChildren();
 const flagIcon=I.svg('flag');
 const deleteIcon=I.svg('trash');
 function appendTask(task,parent){
  const row=document.createElement('div');row.className='task-row'+(task.done?' done':'');
  const check=document.createElement('button');check.type='button';check.innerHTML=task.done?I.svg('check',{size:14}):'';
  check.setAttribute('aria-label',(task.done?'Restore task: ':'Complete task: ')+task.text);
  check.addEventListener('click',()=>{task.done=!task.done;renderTasks()});
  const label=document.createElement('span');label.className='task-text';label.textContent=task.text;
  label.title='Double-click to edit';label.tabIndex=0;
  function edit(){
   if(row.querySelector('.task-edit'))return;
   const editor=document.createElement('textarea');editor.className='task-edit';editor.rows=2;
   editor.maxLength=220;editor.value=task.text;editor.setAttribute('aria-label','Edit task');
   label.replaceWith(editor);
   let committed=false;
   const commit=save=>{
    if(committed)return;
    committed=true;
    const next=editor.value.trim();
    if(save&&next)task.text=next;
    renderTasks();
   };
   editor.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();commit(false)}
    else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();commit(true)}
   });
   editor.addEventListener('blur',()=>commit(true));
   editor.focus();editor.select();
  }
  label.addEventListener('dblclick',edit);
  label.addEventListener('keydown',event=>{
   if(event.key==='Enter'||event.key==='F2'){event.preventDefault();edit()}
  });
  const flag=document.createElement('button');flag.className='task-flag';flag.type='button';
  flag.innerHTML=flagIcon;flag.setAttribute('aria-pressed',String(!!task.flag));
  flag.setAttribute('aria-label',(task.flag?'Unflag ':'Flag ')+task.text);
  flag.addEventListener('click',()=>{task.flag=!task.flag;renderTasks()});
  const remove=document.createElement('button');remove.className='task-delete';remove.type='button';
  remove.innerHTML=deleteIcon;remove.setAttribute('aria-label','Delete '+task.text);
  remove.addEventListener('click',()=>{
   const index=tasks.indexOf(task);
   if(index>=0)tasks.splice(index,1);
   renderTasks();
  });
  row.append(check,label,flag,remove);parent.append(row);
 }
 pending.forEach(t=>appendTask(t,active));
 done.forEach(t=>appendTask(t,completed));
 $('tasksCompleted').setAttribute('aria-expanded',String(showCompleted));
 completed.hidden=!showCompleted;
 completed.style.height=showCompleted?'auto':'0px';
 completed.style.opacity=showCompleted?'1':'0';
 resizeTasksToContent();
 if(tasksListener)tasksListener();
}
let tasksListener=null;
function completedToggle(){
 showCompleted=!showCompleted;
 const expanded=showCompleted,panel=$('completedItems');
 $('tasksCompleted').setAttribute('aria-expanded',String(expanded));
 panel.hidden=false;
 panel.style.overflowY='hidden';
 const fullHeight=panel.scrollHeight,start=expanded?0:fullHeight;
 M.snap('completed-height',start,value=>{panel.style.height=Math.max(0,value)+'px'});
 M.to('completed-height',expanded?fullHeight:0,'contents',value=>{
  panel.style.height=Math.max(0,value)+'px';
  panel.style.opacity=String(fullHeight?clamp(value/fullHeight,0,1):0);
  resizeTasksToContent();
 },{complete:()=>{
  panel.style.overflowY='auto';
  if(!showCompleted){panel.hidden=true;panel.style.height='0px'}
  else panel.style.height='auto';
  resizeTasksToContent();
 }});
}
function render(){
 const oldView=previousView,oldAccount=previousAccount,oldMode=previousMode,oldScreen=previousScreen;
 const a=accounts[account],n=$('notch'),expanded=view==='expanded';
 audioOpen=expanded&&mainScreen==='audio';
 displayPanelOpen=expanded&&mainScreen==='display';
 taskOpen=expanded&&mainScreen==='tasks';
 n.className='notch '+mode+(view==='idle'?' idle':'')+((a.banked&&a.banked.length)?'':' claude')+(taskOpen?' tasks-open':'')+(expanded?' screen-'+mainScreen:'');
 $('audioPreview').hidden=!audioOpen;
 $('displayPreview').hidden=!displayPanelOpen;
 $('tasksPreview').hidden=!taskOpen;
 $('settingsPreview').hidden=!(expanded&&mainScreen==='settings');
 document.querySelector('.stage').classList.toggle('audio-open',audioOpen);
 document.querySelector('.stage').classList.toggle('display-open',displayPanelOpen);
 document.querySelector('.stage').classList.toggle('tasks-open',taskOpen);
 $('tasksMain').setAttribute('aria-expanded',String(taskOpen));
 $('tasksMain').setAttribute('aria-label',taskOpen?'Collapse Tasks':'Open Tasks');
 $('settingsSound').setAttribute('aria-expanded',String(audioOpen));
 $('displayMain').setAttribute('aria-expanded',String(displayPanelOpen));
 notchShape();
 document.querySelectorAll('[data-account]').forEach(button=>{
  const selected=Number(button.dataset.account)===account;
  button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
 });
 document.querySelectorAll('[data-fill="five"]').forEach(e=>shades(e,a.five,false));
 document.querySelectorAll('[data-fill="week"]').forEach(e=>shades(e,a.week,false));
 $('weekProgress').setAttribute('aria-valuenow',a.week);
 document.querySelectorAll('[data-reset="five"]').forEach(e=>e.textContent='Resets in '+a.fiveReset);
 $('originalDays').textContent=a.shortRemaining;
 $('originalReset').textContent='Resets '+a.weekReset;
 $('weekTime').textContent=a.weekTime;$('resetDay').textContent=a.weekShort;
 rowBlocks($('dayStrip'),a.days);rowBlocks($('originalDayBlocks'),a.days);
 $('fiveRange').value=a.five;$('weekRange').value=a.week;
 $('fiveValue').textContent=a.five+'%';$('weekValue').textContent=a.week+'%';
 $('fiveCaption').textContent=mode==='redesign'?'available':'';
 banked(a.banked);drawGlance();readings();
 for(const setting of ['current','redesign']){
  $(setting).classList.toggle('active',setting===mode);
  $(setting).setAttribute('aria-pressed',String(setting===mode));
 }
 for(const setting of ['expanded','idle']){
  $(setting).classList.toggle('active',setting===view);
  $(setting).setAttribute('aria-pressed',String(setting===view));
 }
 $('hoverhint').textContent=view==='idle'?'Hover over a quota pair for the account name. Click a quota to expand.':'Interactive comparison. Choose an account or adjust the quotas below.';
 syncDisplay();
 if(!first&&(oldView!==view||oldAccount!==account||oldMode!==mode||oldScreen!==mainScreen))showContents();
 previousView=view;previousAccount=account;previousMode=mode;previousScreen=mainScreen;first=false;
}
document.querySelectorAll('[data-account]').forEach(button=>button.addEventListener('click',()=>{account=Number(button.dataset.account);render()}));
for(const d of ['current','redesign'])$(d).addEventListener('click',()=>{mode=d;render()});
for(const v of ['expanded','idle'])$(v).addEventListener('click',()=>{
 if(v==='expanded')expandNotch();
 else collapseNotch();
});
$('fiveRange').addEventListener('input',e=>{accounts[account].five=Number(e.target.value);render()});
$('weekRange').addEventListener('input',e=>{accounts[account].week=Number(e.target.value);render()});
function reset(){accounts=defaults.map(a=>({...a}));account=0;render()}
$('resetAll').addEventListener('click',reset);
$('refresh').addEventListener('click',()=>{
 reset();message('Sample data restored');
 const svg=$('refresh').querySelector('svg');
 if(M.enabled()&&svg)svg.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],
  {duration:950,easing:'cubic-bezier(.32,0,.14,1)'});
});
$('alerts').addEventListener('click',()=>message('Alerts are not connected in this prototype'));
const displayHost=$('displayCompanion');
displayHost.addEventListener('pointerenter',syncDisplay);
displayHost.addEventListener('pointerleave',syncDisplay);
displayHost.addEventListener('focusin',syncDisplay);
displayHost.addEventListener('focusout',()=>queueMicrotask(syncDisplay));
$('displayMain').addEventListener('click',()=>{
 if(view==='expanded'&&mainScreen==='display')collapseNotch();
 else openMainScreen('display');
});
$('displayDay').addEventListener('click',()=>{
 for(const id of ['displayDay','displayNight'])$(id).classList.toggle('selected',id==='displayDay');
 hint('Day preset preview selected. No monitor settings changed.');
});
$('displayNight').addEventListener('click',()=>{
 for(const id of ['displayDay','displayNight'])$(id).classList.toggle('selected',id==='displayNight');
 hint('Night preset preview selected. No monitor settings changed.');
});
$('displayOff').addEventListener('click',()=>hint('Display Off is disabled in this prototype. No hardware action taken.'));

const settingsHost=$('settingsCompanion');
settingsHost.addEventListener('pointerenter',()=>{
 clearTimeout(settingsLeaveTimer);
 settingsHover=true;
 syncSettings();
});
settingsHost.addEventListener('pointerleave',()=>{
 clearTimeout(settingsLeaveTimer);
 // A short hover grace stops the rail snapping shut when a moving child
 // briefly changes the browser's pointer hit target mid-animation.
 settingsLeaveTimer=setTimeout(()=>{settingsHover=false;syncSettings()},140);
});
settingsHost.addEventListener('focusin',syncSettings);
settingsHost.addEventListener('focusout',()=>queueMicrotask(syncSettings));
$('settingsMain').addEventListener('click',()=>{
 if(view==='expanded'&&mainScreen==='settings')collapseNotch();
 else openMainScreen('settings');
 // Release focus so the Quit / Piggy / Sound shortcuts close again when the pointer leaves.
 $('settingsMain').blur();
 syncSettings();
});
$('settingsQuit').addEventListener('click',()=>{
 hint('Quit is demonstration-only. The prototype stays open.');
});
$('settingsPiggy').addEventListener('click',()=>{
 openMainScreen('piggy');
 hint('Piggy Bank opened.');
});
$('settingsSound').addEventListener('click',()=>{
 setAudioOpen(!(view==='expanded'&&mainScreen==='audio'));
 if(audioOpen)hint('Audio opened inside the notch. No Windows settings changed.');
});
initAudioMixer();
initDisplayMenu();
document.querySelectorAll('.audio-section').forEach(section=>section.addEventListener('toggle',()=>{if(audioOpen)requestAnimationFrame(notchShape)}));
$('tasksMain').addEventListener('click',()=>{
 setTasksOpen(!(view==='expanded'&&mainScreen==='tasks'));
 if(taskOpen)$('taskInput').focus();
});

$('taskInput').addEventListener('keydown',e=>{
 if(e.key!=='Enter')return;const value=e.currentTarget.value.trim();if(!value)return;
 tasks.unshift({id:nextTaskId++,text:value,done:false,flag:false});e.currentTarget.value='';renderTasks();
});
$('tasksCompleted').addEventListener('click',completedToggle);
for(const button of document.querySelectorAll('.companion-bubble,.circle-btn,.tab,.seg button,.small-btn,.task-close')){
 button.addEventListener('click',()=>M.press(button));
}

/* Preserve the existing V-Notch top-edge toggle, plus click-away collapse.
   Run click-away on pointerdown, BEFORE the clicked prototype control handles
   click, so the explicit Expanded/Glance buttons still select the requested state. */
$('notch').addEventListener('click',event=>{
 const target=event.target;
 if(target.closest('button, input, select, summary, a, label, .companion-display, .companion-tasks, .companion-settings'))return;
 if(view==='idle'){expandNotch();return}
 const rect=$('notch').getBoundingClientRect();
 if(event.clientY>=rect.top&&event.clientY<=rect.top+34)collapseNotch();
});
document.addEventListener('pointerdown',event=>{
 if($('notch').contains(event.target))return;
 if(event.target.closest('.appearance-card'))return;
 if(event.target.closest('.modebar button, .panel-bottom input, .panel-bottom button'))return;
 collapseNotch();settingsPinned=false;syncSettings();
},{capture:true});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
  
  collapseNotch();
  if(settingsPinned){settingsPinned=false;syncSettings()}
 }
});
renderTasks();
for(let i=0;i<displayButtons.length;i++){
 const id=displayButtons[i],button=$(id);
 M.snap('display-item-'+i,offsets[i],shift=>{
  button.style.translate=shift+'px 0';button.style.opacity='0';button.style.visibility='hidden';
  $(gooCircles[i]).setAttribute('cx',String(gooTargets[i]+shift));
 });
 button.tabIndex=-1;
}
for(let i=0;i<settingsButtons.length;i++){
 const id=settingsButtons[i],button=$(id);
 M.snap('settings-item-'+i,settingsOffsets[i],shift=>{
  button.style.translate=shift+'px 0';button.style.opacity='0';button.style.visibility='hidden';
  $(settingsCircles[i]).setAttribute('cx',String(settingsGooTargets[i]+shift));
 });
 button.tabIndex=-1;
}
render();
/* Hook for live data (live-data.js): replaces one account's sample readings with real ones. */
window.PiggyData={
 count:()=>accounts.length,
 update(index,patch){
  if(!accounts[index])return;
  Object.assign(accounts[index],patch);
  render();
 },
 selected:()=>account,
 syncDisplay:()=>syncDisplay(),
 reshape:()=>requestAnimationFrame(notchShape),
 collapse:()=>collapseNotch(),
 expand:()=>expandNotch(),
 select:i=>{account=i;render()},
 open:screen=>openMainScreen(screen)
};
/* Hook for tasks-store.js: read, replace and watch the task list. */
window.PiggyData.tasks={
 get:()=>tasks.map(t=>({id:t.id,text:t.text,done:!!t.done,flag:!!t.flag})),
 set(list){
  tasks.splice(0,tasks.length,...list.map(t=>({id:t.id,text:t.text,done:!!t.done,flag:!!t.flag})));
  const numbers=tasks.map(t=>Number(t.id)).filter(Number.isFinite);
  nextTaskId=Math.max(nextTaskId,0,...numbers)+1;
  renderTasks();
 },
 onChange:fn=>{tasksListener=fn}
};
})();