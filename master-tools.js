// Modo sem senha mestra do Work Storage.
// Mantém a interface nova e usa apenas Google Auth + regras do Firestore.
(function(){
  const PLAIN_VERSION=3;

  function plainRecord(kind,value){
    return {kind,version:PLAIN_VERSION,plain:true,value,updatedAt:value.updatedAt||Date.now()};
  }

  function legacyToItem(doc){
    const raw=doc.data();
    return {
      id:doc.id,
      title:raw.title||'Sem título',
      folderId:null,
      tags:[],
      pinned:Boolean(raw.pinned),
      createdAt:Number(raw.createdAt)||Date.now(),
      updatedAt:Number(raw.updatedAt)||Date.now(),
      blocks:[{id:makeId('b'),type:'text',text:raw.content||''}]
    };
  }

  async function migrateLegacyPlain(snapshot){
    const legacy=snapshot.docs.filter(d=>d.id!==SECURITY_ID&&!d.data().kind);
    if(!legacy.length)return false;
    setSync('saving','Atualizando dados...');
    for(let i=0;i<legacy.length;i+=400){
      const batch=db.batch();
      for(const doc of legacy.slice(i,i+400)){
        const item=legacyToItem(doc);
        batch.set(doc.ref,plainRecord('item',item));
      }
      await batch.commit();
    }
    return true;
  }

  async function plainLoadWorkspace(){
    let snap=await userCollection().get();
    if(await migrateLegacyPlain(snap))snap=await userCollection().get();
    state.items=[];
    state.folders=[];
    for(const d of snap.docs){
      if(d.id===SECURITY_ID)continue;
      const raw=d.data();
      if(raw.plain&&raw.value&&raw.kind==='item')state.items.push({...raw.value,id:d.id});
      if(raw.plain&&raw.value&&raw.kind==='folder')state.folders.push({...raw.value,id:d.id});
    }
    normalizeOrders();
  }

  function plainSubscribeWorkspace(){
    if(unsubscribeCloud)unsubscribeCloud();
    unsubscribeCloud=userCollection().onSnapshot(snap=>{
      if(state.syncing)return;
      const items=[],folders=[];
      for(const d of snap.docs){
        if(d.id===SECURITY_ID)continue;
        const raw=d.data();
        if(raw.plain&&raw.value&&raw.kind==='item')items.push({...raw.value,id:d.id});
        if(raw.plain&&raw.value&&raw.kind==='folder')folders.push({...raw.value,id:d.id});
      }
      state.items=items;
      state.folders=folders;
      normalizeOrders();
      if(state.activeId&&!state.items.some(i=>i.id===state.activeId))closeDrawer();
      renderAll();
      setSync('cloud','Sincronizado');
    },err=>{
      console.error(err);
      setSync('error','Erro de sincronização');
    });
  }

  async function plainSaveRecord(kind,obj){
    if(!state.user)return;
    const raw=JSON.stringify(obj);
    if(kind==='item'&&new TextEncoder().encode(raw).length>MAX_ITEM_BYTES){
      toast('Este item ficou grande demais para sincronizar. Remova arquivos ou divida o conteúdo.','error');
      throw new Error('item-too-large');
    }
    state.syncing=true;
    setSync('saving','Salvando...');
    try{
      await userCollection().doc(obj.id).set(plainRecord(kind,obj));
      setSync('cloud','Sincronizado');
    }finally{
      state.syncing=false;
    }
  }

  async function plainOpenWorkspace(){
    state.key={mode:'plain'};
    state.security=null;
    setScreen('app');
    updateAccount();
    setSync('saving','Carregando...');
    await plainLoadWorkspace();
    plainSubscribeWorkspace();
    renderAll();
    setSync('cloud','Sincronizado');
  }

  async function plainPrepareSecurity(){
    try{
      const securityRef=userCollection().doc(SECURITY_ID);
      const security=await securityRef.get();
      if(security.exists){
        const all=await userCollection().get();
        const encrypted=all.docs.some(d=>d.id!==SECURITY_ID&&d.data().iv&&d.data().data);
        if(!encrypted)await securityRef.delete();
      }
      await plainOpenWorkspace();
    }catch(err){
      console.error(err);
      setSync('error','Erro ao carregar');
      alert('Não foi possível carregar seus dados. Recarregue a página e tente novamente.');
    }
  }

  function plainClearWorkspaceMemory(){
    if(unsubscribeCloud){unsubscribeCloud();unsubscribeCloud=null}
    clearTimeout(saveTimer);
    if(typeof idleTimer!=='undefined')clearTimeout(idleTimer);
    state.key=null;
    state.security=null;
    state.items=[];
    state.folders=[];
    state.activeId=null;
  }

  function plainLockWorkspace(){
    toast('O Work Storage não usa mais senha mestra. Para proteger o acesso, saia da sua conta Google.');
  }

  function plainResetIdleTimer(){
    if(typeof idleTimer!=='undefined')clearTimeout(idleTimer);
  }

  async function plainExportBackup(){
    const backup={
      product:'Work Storage',
      version:PLAIN_VERSION,
      encrypted:false,
      exportedAt:new Date().toISOString(),
      items:state.items,
      folders:state.folders
    };
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`work-storage-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup exportado.');
  }

  async function plainImportBackup(file){
    try{
      const backup=JSON.parse(await file.text());
      if(backup.version!==PLAIN_VERSION||backup.encrypted!==false||!Array.isArray(backup.items)||!Array.isArray(backup.folders))throw new Error('Formato incompatível');
      if(!confirm('Restaurar este backup? Os itens atuais serão substituídos.'))return;
      state.syncing=true;
      const col=userCollection();
      const current=await col.get();
      for(let i=0;i<current.docs.length;i+=400){
        const batch=db.batch();
        current.docs.slice(i,i+400).forEach(d=>batch.delete(d.ref));
        await batch.commit();
      }
      const records=[...backup.items.map(value=>({kind:'item',value})),...backup.folders.map(value=>({kind:'folder',value}))];
      for(let i=0;i<records.length;i+=400){
        const batch=db.batch();
        records.slice(i,i+400).forEach(record=>batch.set(col.doc(record.value.id),plainRecord(record.kind,record.value)));
        await batch.commit();
      }
      state.syncing=false;
      await plainLoadWorkspace();
      renderAll();
      toast('Backup restaurado.');
    }catch(err){
      console.error(err);
      state.syncing=false;
      toast('Backup inválido ou incompatível.','error');
    }
  }

  // Substitui as rotinas criptografadas antes do callback de autenticação executar.
  prepareSecurity=plainPrepareSecurity;
  openWorkspace=plainOpenWorkspace;
  loadWorkspace=plainLoadWorkspace;
  subscribeWorkspace=plainSubscribeWorkspace;
  saveRecord=plainSaveRecord;
  clearWorkspaceMemory=plainClearWorkspaceMemory;
  lockWorkspace=plainLockWorkspace;
  resetIdleTimer=plainResetIdleTimer;
  exportBackup=plainExportBackup;
  importBackup=plainImportBackup;

  // Ajustes visuais: nenhuma referência a senha mestra/criptografia fica visível.
  const authSmall=document.querySelector('#authView small');
  if(authSmall)authSmall.textContent='Seus dados ficam vinculados à sua conta Google e sincronizados entre seus dispositivos.';
  const lockView=document.getElementById('lockView');
  if(lockView)lockView.classList.add('hidden');
  const lockBtn=document.getElementById('lockBtn');
  if(lockBtn)lockBtn.classList.add('hidden');
  const exportBtn=document.getElementById('exportBtn');
  if(exportBtn){exportBtn.textContent='Exportar backup';exportBtn.onclick=plainExportBackup}
  const importBtn=document.getElementById('importBtn');
  const oldInput=document.getElementById('importInput');
  if(importBtn&&oldInput){
    const freshInput=oldInput.cloneNode(true);
    oldInput.replaceWith(freshInput);
    importBtn.onclick=()=>freshInput.click();
    freshInput.addEventListener('change',async e=>{
      if(e.target.files?.[0])await plainImportBackup(e.target.files[0]);
      e.target.value='';
    });
  }

  const baseRenderDrawer=renderDrawer;
  renderDrawer=function(){
    baseRenderDrawer();
    const status=document.querySelector('#itemDrawer .item-status');
    if(status){
      const spans=status.querySelectorAll('span');
      if(spans[2])spans[2].textContent='Sincronizado';
    }
    document.querySelectorAll('#itemDrawer .file-ready span').forEach(el=>{
      el.textContent=el.textContent.replace('protegido dentro deste item','salvo neste item');
    });
  };

  // Se o callback antigo já tiver colocado a tela de senha na frente, corrige imediatamente.
  setTimeout(()=>{
    const currentUser=state.user||(typeof auth!=='undefined'&&auth&&auth.currentUser);
    if(currentUser){state.user=currentUser;plainPrepareSecurity()}
  },0);
})();