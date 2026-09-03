// Work Storage sem senha mestra.
// Mantém o workspace atual, mas salva os registros diretamente no Firestore da conta autenticada.
(function(){
  const PLAIN_VERSION=3;

  const decodePlain=doc=>{
    const raw=doc.data();
    if(raw&&raw.version===PLAIN_VERSION&&raw.plain===true&&raw.value&&typeof raw.value==='object'){
      return{kind:raw.kind,value:{...raw.value,id:doc.id}};
    }
    if(raw&&!raw.kind&&!raw.iv&&!raw.data&&(raw.title!==undefined||raw.content!==undefined)){
      return{kind:'legacy-note',value:{id:doc.id,title:raw.title||'Sem título',content:raw.content||'',pinned:Boolean(raw.pinned),createdAt:Number(raw.createdAt)||now(),updatedAt:Number(raw.updatedAt)||now()}};
    }
    if(raw&&(raw.iv&&raw.data||raw.kind==='security'))return{kind:'encrypted'};
    return null;
  };

  const showMigrationWarning=()=>{
    if(document.getElementById('wsMigrationWarning'))return;
    const el=document.createElement('div');
    el.id='wsMigrationWarning';
    el.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:170;width:min(720px,calc(100% - 28px));padding:13px 15px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);display:grid;gap:4px';
    el.innerHTML='<strong>Falta concluir a migração da versão com senha mestra.</strong><span style="color:var(--muted);font-size:11px;line-height:1.5">Não edite nada nesta aba. Use a aba antiga que ainda estava desbloqueada para remover a senha sem perder os dados.</span>';
    document.body.append(el);
  };

  setScreen=function(name){
    $('#authView')?.classList.toggle('hidden',name!=='auth');
    $('#appView')?.classList.toggle('hidden',name==='auth');
  };

  prepareSecurity=async function(){
    state.key=true;
    await openWorkspace();
  };

  openWorkspace=async function(){
    state.key=true;
    setScreen('app');updateAccount();setSync('saving','Carregando...');
    await loadWorkspace();subscribeWorkspace();renderAll();
    if(state.hasEncryptedLegacy){setSync('error','Migração necessária');showMigrationWarning()}
    else setSync('cloud','Sincronizado');
  };

  loadWorkspace=async function(){
    const snap=await userCollection().get();
    state.items=[];state.folders=[];state.hasEncryptedLegacy=false;
    const legacy=[];
    for(const d of snap.docs){
      const decoded=decodePlain(d);if(!decoded)continue;
      if(decoded.kind==='item')state.items.push(decoded.value);
      else if(decoded.kind==='folder')state.folders.push(decoded.value);
      else if(decoded.kind==='legacy-note')legacy.push(decoded.value);
      else if(decoded.kind==='encrypted')state.hasEncryptedLegacy=true;
    }
    if(legacy.length&&!state.hasEncryptedLegacy){
      for(const n of legacy){
        const item={id:n.id,title:n.title,folderId:null,tags:[],pinned:n.pinned,createdAt:n.createdAt,updatedAt:n.updatedAt,blocks:[{...blankBlock('text'),text:n.content}]};
        state.items.push(item);
        await saveRecord('item',item);
      }
    }
    normalizeOrders();
  };

  subscribeWorkspace=function(){
    if(unsubscribeCloud)unsubscribeCloud();
    unsubscribeCloud=userCollection().onSnapshot(snap=>{
      if(state.syncing)return;
      const items=[],folders=[];let encrypted=false;
      for(const d of snap.docs){
        const decoded=decodePlain(d);if(!decoded)continue;
        if(decoded.kind==='item')items.push(decoded.value);
        else if(decoded.kind==='folder')folders.push(decoded.value);
        else if(decoded.kind==='encrypted')encrypted=true;
      }
      state.items=items;state.folders=folders;state.hasEncryptedLegacy=encrypted;normalizeOrders();
      if(state.activeId&&!state.items.some(i=>i.id===state.activeId))closeDrawer();
      renderAll();
      if(encrypted){setSync('error','Migração necessária');showMigrationWarning()}
      else setSync('cloud','Sincronizado');
    },err=>{console.error(err);setSync('error','Erro de sincronização')});
  };

  clearWorkspaceMemory=function(){
    if(unsubscribeCloud){unsubscribeCloud();unsubscribeCloud=null}
    clearTimeout(saveTimer);clearTimeout(idleTimer);
    state.key=null;state.security=null;state.items=[];state.folders=[];state.activeId=null;state.hasEncryptedLegacy=false;
  };

  lockWorkspace=function(){};
  resetIdleTimer=function(){};

  saveRecord=async function(kind,obj){
    if(!state.user)return;
    if(state.hasEncryptedLegacy){toast('Conclua a migração da versão antiga antes de editar.','error');return}
    const raw=JSON.stringify(obj);
    if(kind==='item'&&textEncoder.encode(raw).length>MAX_ITEM_BYTES){toast('Este item ficou grande demais para sincronizar. Remova arquivos ou divida o conteúdo.','error');throw new Error('item-too-large')}
    state.syncing=true;setSync('saving','Salvando...');
    try{
      await userCollection().doc(obj.id).set({kind,version:PLAIN_VERSION,plain:true,value:obj,updatedAt:obj.updatedAt||now()});
      setSync('cloud','Sincronizado');
    }finally{state.syncing=false}
  };

  queueSave=function(item=activeItem()){
    clearTimeout(saveTimer);if(!item)return;
    setSync('saving','Salvando...');
    saveTimer=setTimeout(()=>saveRecord('item',item).catch(console.error),500);
  };

  exportBackup=async function(){
    const backup={product:'Work Storage',version:PLAIN_VERSION,encrypted:false,exportedAt:new Date().toISOString(),items:state.items,folders:state.folders};
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`work-storage-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast('Backup exportado.');
  };

  importBackup=async function(file){
    try{
      const backup=JSON.parse(await file.text());
      if(backup.version!==PLAIN_VERSION||backup.encrypted!==false||!Array.isArray(backup.items)||!Array.isArray(backup.folders))throw new Error('Formato incompatível');
      if(!confirm('Restaurar este backup? Os dados atuais na nuvem serão substituídos.'))return;
      state.syncing=true;
      const col=userCollection(),current=await col.get();
      for(let i=0;i<current.docs.length;i+=400){const batch=db.batch();current.docs.slice(i,i+400).forEach(d=>batch.delete(d.ref));await batch.commit()}
      const records=[...backup.items.map(value=>({kind:'item',value})),...backup.folders.map(value=>({kind:'folder',value}))];
      for(let i=0;i<records.length;i+=400){
        const batch=db.batch();
        for(const r of records.slice(i,i+400))batch.set(col.doc(String(r.value.id)),{kind:r.kind,version:PLAIN_VERSION,plain:true,value:r.value,updatedAt:r.value.updatedAt||now()});
        await batch.commit();
      }
      state.syncing=false;state.hasEncryptedLegacy=false;document.getElementById('wsMigrationWarning')?.remove();
      await loadWorkspace();renderAll();toast('Backup restaurado.');
    }catch(err){console.error(err);state.syncing=false;toast('Backup inválido ou incompatível.','error')}
  };

  const lockView=document.getElementById('lockView');if(lockView)lockView.remove();
  const lockBtn=document.getElementById('lockBtn');if(lockBtn)lockBtn.remove();
  const authSmall=document.querySelector('#authView small');if(authSmall)authSmall.textContent='Seus dados ficam vinculados à sua conta Google e às regras de acesso do Firebase.';
  const status=$('.item-status span:last-child');if(status)status.textContent='Sincronizado com Firebase';
  const exportBtn=$('#exportBtn');if(exportBtn){exportBtn.textContent='Exportar backup';exportBtn.onclick=exportBackup}
  const originalRenderBlock=renderBlock;
  renderBlock=function(block){return originalRenderBlock(block).replace('protegido dentro deste item','salvo neste item')};

  state.hasEncryptedLegacy=false;
})();