// Ferramentas de segurança para trocar a senha mestra enquanto o workspace está desbloqueado.
(function(){
  if(window.__wsMasterToolsLoaded){
    if(document.currentScript?.src?.includes('recover=1')&&window.WSOpenMasterPasswordDialog)window.WSOpenMasterPasswordDialog();
    return;
  }
  window.__wsMasterToolsLoaded=true;

  const canUse=()=>typeof state!=='undefined'&&state&&state.key&&state.user&&typeof db!=='undefined'&&db&&typeof userCollection==='function';

  const style=document.createElement('style');
  style.textContent=`
    .master-tools-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.58);z-index:180;display:grid;place-items:center;padding:18px;backdrop-filter:blur(5px)}
    .master-tools-dialog{width:min(460px,100%);background:var(--panel,var(--surface,#17191c));border:1px solid var(--line,#2b3036);border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.38);padding:22px;color:var(--text,#fff)}
    .master-tools-dialog h2{margin:0 0 7px;font-size:21px}.master-tools-dialog>p{margin:0 0 18px;color:var(--muted,#9098a1);font-size:12px;line-height:1.55}
    .master-tools-dialog label{display:grid;gap:6px;margin:11px 0;font-size:11px;color:var(--muted,#9098a1)}
    .master-tools-dialog input{width:100%;height:42px;border:1px solid var(--line,#2b3036);border-radius:9px;background:var(--panel-2,var(--surface-2,#1d2024));color:var(--text,#fff);padding:0 11px;outline:none}
    .master-tools-dialog input:focus{border-color:var(--text,#fff)}
    .master-tools-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:17px}.master-tools-error{min-height:16px;color:#ff8585;font-size:11px;margin:8px 0 0}
    .master-tools-warning{padding:10px 11px;border:1px solid var(--line,#2b3036);border-radius:9px;background:var(--panel-2,var(--surface-2,#1d2024));font-size:10px;line-height:1.5;color:var(--muted,#9098a1)}
  `;
  document.head.append(style);

  const backdrop=document.createElement('div');
  backdrop.className='master-tools-backdrop hidden';
  backdrop.id='masterToolsBackdrop';
  backdrop.innerHTML=`<div class="master-tools-dialog" role="dialog" aria-modal="true" aria-labelledby="masterToolsTitle">
    <h2 id="masterToolsTitle">Trocar senha mestra</h2>
    <p>Como este dispositivo já está desbloqueado, não é necessário informar a senha antiga. Todos os itens serão recriptografados com a nova senha antes da troca ser concluída.</p>
    <div class="master-tools-warning">Não feche nem recarregue esta aba durante a troca. Depois de concluir, a senha anterior deixa de funcionar.</div>
    <form id="masterToolsForm">
      <label>Nova senha mestra<input id="masterToolsPassword" type="password" autocomplete="new-password" minlength="10" required></label>
      <label>Confirmar nova senha<input id="masterToolsConfirm" type="password" autocomplete="new-password" minlength="10" required></label>
      <div id="masterToolsError" class="master-tools-error" role="alert"></div>
      <div class="master-tools-actions"><button id="masterToolsCancel" type="button" class="ghost">Cancelar</button><button id="masterToolsSubmit" type="submit" class="primary">Trocar senha</button></div>
    </form>
  </div>`;
  document.body.append(backdrop);

  const openDialog=()=>{
    const error=document.getElementById('masterToolsError');
    if(error)error.textContent='';
    document.getElementById('masterToolsForm')?.reset();
    backdrop.classList.remove('hidden');
    setTimeout(()=>document.getElementById('masterToolsPassword')?.focus(),30);
  };
  const closeDialog=()=>backdrop.classList.add('hidden');
  window.WSOpenMasterPasswordDialog=openDialog;

  const accountMenu=document.getElementById('accountMenu');
  const lockBtn=document.getElementById('lockBtn');
  if(accountMenu&&!document.getElementById('changeMasterPasswordBtn')){
    const button=document.createElement('button');
    button.id='changeMasterPasswordBtn';button.type='button';button.textContent='Trocar senha mestra';
    button.addEventListener('click',()=>{accountMenu.classList.add('hidden');openDialog()});
    lockBtn?.insertAdjacentElement('afterend',button);
  }

  document.getElementById('masterToolsCancel').addEventListener('click',closeDialog);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeDialog()});

  document.getElementById('masterToolsForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const password=document.getElementById('masterToolsPassword').value;
    const confirmPassword=document.getElementById('masterToolsConfirm').value;
    const error=document.getElementById('masterToolsError');
    const submit=document.getElementById('masterToolsSubmit');
    error.textContent='';
    if(!canUse()){error.textContent='O workspace precisa continuar desbloqueado nesta aba.';return}
    if(password.length<10){error.textContent='Use pelo menos 10 caracteres.';return}
    if(password!==confirmPassword){error.textContent='As duas senhas não são iguais.';return}

    submit.disabled=true;submit.textContent='Recriptografando...';
    const oldKey=state.key;
    const oldSecurity=state.security;
    try{
      clearTimeout(typeof saveTimer!=='undefined'?saveTimer:null);
      clearTimeout(typeof idleTimer!=='undefined'?idleTimer:null);
      const records=[...state.items.map(value=>({kind:'item',value})),...state.folders.map(value=>({kind:'folder',value}))];
      if(records.length>450)throw new Error('Há itens demais para uma troca atômica segura. Não fiz nenhuma alteração.');

      const snap=await userCollection().get();
      const cloudCount=snap.docs.filter(d=>['item','folder'].includes(d.data().kind)).length;
      if(cloudCount!==records.length)throw new Error('A sincronização ainda não terminou. Aguarde alguns segundos e tente novamente.');

      const salt=crypto.getRandomValues(new Uint8Array(16));
      const newKey=await deriveKey(password,salt,PBKDF2_ITERATIONS);
      const verifier=await encryptValue({check:'work-storage-v2'},newKey);
      const security={kind:'security',version:2,salt:bytesToB64(salt),iterations:PBKDF2_ITERATIONS,iv:verifier.iv,data:verifier.data,createdAt:oldSecurity?.createdAt||now(),rotatedAt:now()};
      const batch=db.batch();
      for(const record of records){
        const enc=await encryptValue(record.value,newKey);
        batch.set(userCollection().doc(record.value.id),{kind:record.kind,version:2,iv:enc.iv,data:enc.data,updatedAt:record.value.updatedAt||now()});
      }
      batch.set(userCollection().doc(SECURITY_ID),security);

      state.syncing=true;
      await batch.commit();
      state.key=newKey;state.security=security;state.syncing=false;
      await loadWorkspace();renderAll();setSync('cloud','Protegido e sincronizado');resetIdleTimer();
      closeDialog();toast('Senha mestra trocada com sucesso.');
      alert('Senha mestra alterada com sucesso. Anote a nova senha antes de recarregar a página.');
    }catch(err){
      console.error(err);state.key=oldKey;state.security=oldSecurity;state.syncing=false;resetIdleTimer();
      error.textContent=err.message||'Não foi possível trocar a senha. Nenhuma alteração foi confirmada.';
    }finally{submit.disabled=false;submit.textContent='Trocar senha'}
  });

  if(document.currentScript?.src?.includes('recover=1'))setTimeout(openDialog,0);
})();
