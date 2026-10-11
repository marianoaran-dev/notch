/* Tasks screen: resizable, and it remembers where you left it.
   - A slim grabber on the bottom edge resizes the list up and down; the corner grip resizes both ways.
     Double-click either one to reset.
   - The size, how far the list was scrolled, and whether Completed was open are saved and restored. */
(()=>{
 const store=window.NotchSettings,hook=window.PiggyData;
 const notch=document.getElementById('notch'),panel=document.getElementById('tasksPreview'),list=document.getElementById('taskItems');
 if(!store||!hook||!notch||!panel||!list)return;
 const DEFAULT_W=650,DEFAULT_H=340;

 /* ---- resize handles (children of the notch, so they sit on its real bottom edge) ---- */
 function handle(className,label,title,width,height){
  const node=document.createElement('div');
  node.className='tasks-handle '+className;
  node.title=title;
  node.setAttribute('role','separator');
  node.setAttribute('aria-label',label);
  notch.append(node);
  let drag=null;
  node.addEventListener('pointerdown',e=>{
   e.preventDefault();e.stopPropagation();
   node.setPointerCapture(e.pointerId);
   node.classList.add('dragging');
   const zoom=store.get('uiScale')/100;
   drag={x:e.clientX,y:e.clientY,zoom,w:store.get('tasksWidth'),
    // start from how tall the list really is now, not from the saved limit
    h:Math.round(list.getBoundingClientRect().height/zoom)};
  });
  node.addEventListener('pointermove',e=>{
   if(!drag)return;
   // If the button was let go somewhere we never heard about, stop instead of following the pointer.
   if(e.buttons===0){drag=null;node.classList.remove('dragging');return}
   // pointer movement is in screen pixels; the interface zoom scales what is drawn
   const dx=(e.clientX-drag.x)/drag.zoom,dy=(e.clientY-drag.y)/drag.zoom;
   if(height){
    const h=Math.round(drag.h+dy);
    store.set('tasksListHeight',h);       // also the ceiling, so a taller list can fill
    store.set('tasksListMin',h);          // and the floor: the screen grows even with few tasks
   }
   // the notch grows from its centre, so a corner moving dx outward adds 2*dx to the width
   if(width)store.set('tasksWidth',Math.round(drag.w+2*dx*width));
  });
  const end=e=>{
   if(!drag)return;
   drag=null;node.classList.remove('dragging');
   try{node.releasePointerCapture(e.pointerId)}catch{}
  };
  node.addEventListener('pointerup',end);
  node.addEventListener('pointercancel',end);
  node.addEventListener('dblclick',()=>{
   store.set('tasksListMin',0);store.set('tasksListHeight',DEFAULT_H);
   if(width)store.set('tasksWidth',DEFAULT_W);
  });
  return node;
 }
 const rim=document.createElement('div');rim.className='tasks-rim';notch.append(rim);
 handle('tasks-grab','Resize Tasks height','Drag to make Tasks taller or shorter. Double-click to reset.',0,true);
 // width: +1 for the right corner (dragging right widens), -1 for the left corner (dragging left widens)
 handle('tasks-corner-left','Resize Tasks','Drag to resize. Double-click to reset.',-1,true);
 handle('tasks-corner-right','Resize Tasks','Drag to resize. Double-click to reset.',1,true);

 /* ---- remember the scroll position ---- */
 let scrollTimer=null;
 list.addEventListener('scroll',()=>{
  clearTimeout(scrollTimer);
  scrollTimer=setTimeout(()=>store.set('tasksScroll',Math.round(list.scrollTop)),400);
 });
 const restoreScroll=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{list.scrollTop=store.get('tasksScroll')}));
 new MutationObserver(()=>{if(!panel.hidden)restoreScroll()}).observe(panel,{attributes:true,attributeFilter:['hidden']});

 /* ---- remember whether Completed is open ---- */
 const completed=document.getElementById('tasksCompleted');
 const isOpen=()=>completed.getAttribute('aria-expanded')==='true';
 completed.addEventListener('click',()=>setTimeout(()=>store.set('tasksCompletedOpen',isOpen()),60));
 // Reopen it once the saved tasks have loaded.
 setTimeout(()=>{if(store.get('tasksCompletedOpen')&&!isOpen())completed.click()},1800);
})();
