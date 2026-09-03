// Migração única: remove a senha mestra usando a chave que já está carregada na aba desbloqueada.
(function(){
  if(window.__wsRemoveMasterLoaded)return;
  window.__wsRemoveMasterLoaded=true;

  const canMigrate=()=>typeof state!=='undefined'&&state&&state.key&&state.user&&typeof db!=='undefined'&&db&&typeof userCollection==='function'&&typeof SECURITY_ID!=='undefined';

  async function runMigration(){
    if(!canMigrate()){
      alert('Não consigo remover a senha nesta aba porque a chave já não está carregada. Use a aba do Work Storage que ainda está desbloqueada e não foi recarregada.');
      return;
    }

    if(!confirm('Remover a senha mestra agora? Seus itens continuarão na sua conta Firebase, mas deixarão de ter criptografia por senha mestra.'))return;

    const items=[...state.items];
    const folders=[...state.folders];
    const records=[...items.map(value=>({kind:'item',value})),...folders.map(value=>({kind:'folder',value}))];

    if(records.length>399){
      alert('Há itens demais para fazer esta migração em uma única operação segura. Não alterei nada.');
      return;
    }

    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:#0f1113;color:#f4f5f6;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif';
    overlay.innerHTML='<div style="max-width:520px;text-align:center"><h2 style="margin:0 0 10px">Removendo senha mestra...</h2><p style="color:#9aa1a9;line-height:1.6">Não feche nem recarregue esta aba. Seus itens estão sendo convertidos para o modo sem senha.</p></div>';
    document.body.appendChild(overlay);

    const oldSyncing=state.syncing;
    try{
      if(typeof saveTimer!=='undefined')clearTimeout(saveTimer);
      if(typeof idleTimer!=='undefined')clearTimeout(idleTimer);

      const snap=await userCollection().get();
      const encrypted=snap.docs.filter(d=>{
        const raw=d.data();
        return d.id!==SECURITY_ID&&(raw.kind==='item'||raw.kind==='folder')&&raw.iv&&raw.data;
      });

      if(encrypted.length!==records.length){
        throw new Error('A sincronização ainda não terminou ou a quantidade de itens mudou. Aguarde alguns segundos e tente novamente sem editar nada.');
      }

      state.syncing=true;
      const batch=db.batch();
      for(const record of records){
        batch.set(userCollection().doc(record.value.id),{
          kind:record.kind,
          version:3,
          plain:true,
          value:record.value,
          updatedAt:record.value.updatedAt||Date.now()
        });
      }
      batch.delete(userCollection().doc(SECURITY_ID));
      await batch.commit();

      overlay.innerHTML='<div style="max-width:520px;text-align:center"><h2 style="margin:0 0 10px">Senha mestra removida</h2><p style="color:#9aa1a9;line-height:1.6">Seus dados foram convertidos com sucesso. A nova versão do Work Storage será carregada agora.</p></div>';
      setTimeout(()=>location.reload(),1300);
    }catch(err){
      console.error(err);
      state.syncing=oldSyncing;
      overlay.innerHTML=`<div style="max-width:560px;text-align:center"><h2 style="margin:0 0 10px">A migração não foi concluída</h2><p style="color:#ff8d8d;line-height:1.6">${String(err.message||err)}</p><p style="color:#9aa1a9">Não recarregue esta aba. Feche esta mensagem e tente novamente.</p><button id="wsRemoveMasterClose" style="margin-top:12px;padding:10px 14px;border:0;border-radius:8px">Fechar</button></div>`;
      document.getElementById('wsRemoveMasterClose').onclick=()=>overlay.remove();
    }
  }

  window.WSRemoveMasterPassword=runMigration;
  if(document.currentScript?.src?.includes('run=1'))setTimeout(runMigration,0);
})();