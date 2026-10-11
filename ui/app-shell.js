/* App shell: turns the prototype page into the real overlay.
   - Inside Tauri (or with ?app in a browser) it switches on the transparent "app" layout.
   - Inside Tauri it also tells Rust which rectangles are clickable, so clicks anywhere
     else fall through to whatever is underneath the transparent window. */
(()=>{
 const tauri=window.__TAURI__;
 const preview=new URLSearchParams(location.search).has('app');
 if(!tauri&&!preview)return;
 document.documentElement.classList.add('app');

 // Start as the compact notch; the prototype's "Notch glance" button collapses it.
 const glance=document.getElementById('idle');
 if(glance)glance.click();

 if(!tauri)return;
 const invoke=tauri.core.invoke;

 // Elements whose on-screen area should capture the mouse.
 const SOLID='#notch,.companion-bubble,.tasks-preview,.display-preview,.audio-preview,.appearance-card';
 const shown=el=>{
  const style=getComputedStyle(el);
  return style.display!=='none'&&style.visibility!=='hidden'&&parseFloat(style.opacity)>0.05;
 };
 let previous='';
 const report=()=>{
  const rects=[];
  for(const el of document.querySelectorAll(SOLID)){
   if(!shown(el))continue;
   const r=el.getBoundingClientRect();
   if(r.width<1||r.height<1)continue;
   rects.push([Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]);
  }
  const key=JSON.stringify(rects);
  if(key===previous)return;
  previous=key;
  invoke('set_hit_rects',{rects}).catch(()=>{});
 };
 setInterval(report,30);

 // Tell Rust how many real pixels one CSS pixel is, so the window is sized and the
 // click-through rectangles are converted using the scale the page actually renders at.
 const sendScale=()=>invoke('set_page_scale',{scale:window.devicePixelRatio}).catch(()=>{});
 sendScale();
 window.addEventListener('resize',sendScale);

 // Clicking another app moves focus away from the overlay: collapse like click-away did in the browser.
 window.addEventListener('blur',()=>{
  if(window.NotchUI&&window.NotchUI.holdOpen)return;   // the Appearance card is open
  const setting=window.NotchSettings&&window.NotchSettings.get('collapseOnClickAway');
  if(glance&&setting!==false)glance.click();
 });

 // Settings > Quit really quits now.
 const quit=document.getElementById('settingsQuit');
 if(quit)quit.addEventListener('click',()=>invoke('quit'),{capture:true});
})();
