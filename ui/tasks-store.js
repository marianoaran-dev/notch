/* Tasks storage: loads the saved tasks into the Tasks screen and saves every change.
   The first time the app runs it copies the tasks from the old V-Notch app (read-only). */
(()=>{
 const tauri=window.__TAURI__;
 const hook=window.PiggyData&&window.PiggyData.tasks;
 if(!tauri||!hook)return;
 const invoke=tauri.core.invoke;

 // The prototype ships three sample tasks; a real app starts from what is saved.
 hook.set([]);
 const foot=document.querySelector('.task-foot');
 if(foot)foot.textContent='Double-click a task to edit. Tasks are saved on this computer.';

 let ready=false,timer=null;
 const save=()=>{
  clearTimeout(timer);
  timer=setTimeout(()=>invoke('tasks_save',{tasks:hook.get()}).catch(()=>{}),300);
 };
 hook.onChange(()=>{if(ready)save()});

 (async()=>{
  let list=[],firstRun=false;
  try{
   const saved=await invoke('tasks_load');
   list=saved.tasks||[];
   firstRun=!saved.exists;
  }catch{ /* unreadable file: leave it alone and start empty without overwriting */ return }
  if(firstRun){
   try{list=await invoke('tasks_import_old')}catch{list=[]}
  }
  hook.set(list);
  ready=true;
  if(firstRun&&list.length)save();
 })();

 window.TasksStore={
  // Copies tasks from the old app that are not already here (matched by id), adds them at the end.
  async importOld(){
   const old=await invoke('tasks_import_old');
   const have=new Set(hook.get().map(t=>String(t.id)));
   const fresh=old.filter(t=>!have.has(String(t.id)));
   if(fresh.length){hook.set([...hook.get(),...fresh]);save()}
   return fresh.length;
  }
 };
})();
