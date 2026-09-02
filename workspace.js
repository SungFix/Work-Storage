const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const firebaseConfig=window.WORK_STORAGE_FIREBASE_CONFIG||{};
const SECURITY_ID='__security__';
const COLLECTION='notes';
const THEME_KEY='ws_theme';
const VIEW_KEY='ws_view_mode';
const AUTO_LOCK_MS=15*60*1000;
const MAX_ITEM_BYTES=600000;
const MAX_FILE_BYTES=350000;
const PBKDF2_ITERATIONS=250000;
let db=null,auth=null,unsubscribeCloud=null,saveTimer=null,idleTimer=null;
const state={user:null,key:null,security:null,items:[],folders:[],activeId:null,filter:'home',search:'',viewMode:localStorage.getItem(VIEW_KEY)||'cards',drawerMax:false,syncing:false};

const now=()=>Date.now();
const makeId=(p='i')=>`${p}_${crypto.randomUUID?.()||`${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textEncoder=new TextEncoder(),textDecoder=new TextDecoder();
function bytesToB64(bytes){let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out)}
function b64ToBytes(str){const raw=atob(str),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
function toast(message,tone=''){const el=document.createElement('div');el.className=`toast ${tone}`;el.textContent=message;$('#toastRegion').append(el);setTimeout(()=>el.remove(),2600)}
function formatDate(ts){if(!ts)return'Agora';const d=new Date(ts),today=new Date();return d.toDateString()===today.toDateString()?`Hoje, ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
function iconFor(item){const types=new Set(item.blocks.map(b=>b.type));if(types.has('login'))return'◈';if(types.has('file'))return'▧';if(types.has('checklist'))return'✓';if(types.has('code'))return'</>';if(types.has('link'))return'↗';return'◇'}
function typeLabel(type){return({text:'Texto',login:'Login e senha',link:'Link',file:'Arquivo / imagem',checklist:'Checklist',code:'Código / prompt',fields:'Campos personalizados'})[type]||type}

async function deriveKey(password,salt,iterations=PBKDF2_ITERATIONS){
  const material=await crypto.subtle.importKey('raw',textEncoder.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptValue(value,key=state.key){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=textEncoder.encode(JSON.stringify(value));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);
  return{iv:bytesToB64(iv),data:bytesToB64(new Uint8Array(cipher))};
}
async function decryptValue(record,key=state.key){
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(record.iv)},key,b64ToBytes(record.data));
  return JSON.parse(textDecoder.decode(plain));
}

function blankBlock(type='text'){
  const id=makeId('b');
  if(type==='text')return{id,type,text:''};
  if(type==='login')return{id,type,username:'',password:'',url:''};
  if(type==='link')return{id,type,label:'',url:''};
  if(type==='file')return{id,type,name:'',mime:'',size:0,dataUrl:''};
  if(type==='checklist')return{id,type,items:[{id:makeId('c'),text:'',done:false}]};
  if(type==='code')return{id,type,language:'',code:''};
  if(type==='fields')return{id,type,rows:[{id:makeId('f'),key:'',value:''}]};
  return{id,type:'text',text:''};
}
function templateItem(template='blank'){
  const common={id:makeId('i'),title:'Novo item',folderId:null,tags:[],pinned:false,createdAt:now(),updatedAt:now(),blocks:[]};
  if(template==='note')return{...common,title:'Nova nota',blocks:[blankBlock('text')]};
  if(template==='login')return{...common,title:'Novo acesso',blocks:[blankBlock('login'),blankBlock('text')]};
  if(template==='project')return{...common,title:'Novo projeto',blocks:[blankBlock('text'),blankBlock('checklist'),blankBlock('link')]};
  if(template==='prompt')return{...common,title:'Novo prompt',blocks:[blankBlock('code'),blankBlock('text')]};
  if(template==='checklist')return{...common,title:'Novo checklist',blocks:[blankBlock('checklist')]};
  if(template==='file')return{...common,title:'Novo arquivo',blocks:[blankBlock('file'),blankBlock('text')]};
  if(template==='link')return{...common,title:'Novo link',blocks:[blankBlock('link'),blankBlock('text')]};
  return{...common,blocks:[blankBlock('text')]};
}
function activeItem(){return state.items.find(i=>i.id===state.activeId)||null}
function folderName(id){return state.folders.find(f=>f.id===id)?.name||'Sem pasta'}
function searchable(item){return [item.title,item.tags.join(' '),...item.blocks.flatMap(b=>Object.values(b).flatMap(v=>Array.isArray(v)?v.map(x=>typeof x==='object'?Object.values(x).join(' '):x):typeof v==='object'?'':v))].join(' ').toLowerCase()}

function setSync(mode,label){const el=$('#syncState');if(!el)return;el.className=`sync-state ${mode||''}`;el.querySelector('span').textContent=label}
function setScreen(name){$('#authView').classList.toggle('hidden',name!=='auth');$('#lockView').classList.toggle('hidden',name!=='lock');$('#appView').classList.toggle('hidden',name!=='app')}
function updateAccount(){if(!state.user)return;$('#accountName').textContent=state.user.displayName||'Sua conta';$('#accountEmail').textContent=state.user.email||'';$('#menuBtn').textContent=(state.user.displayName||state.user.email||'WS').split(/\s|@/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()}

async function initFirebase(){
  try{
    firebase.initializeApp(firebaseConfig);auth=firebase.auth();db=firebase.firestore();
    try{await db.clearPersistence()}catch{}
    auth.onAuthStateChanged(async user=>{
      state.user=user||null;
      if(!user){clearWorkspaceMemory();setScreen('auth');return}
      updateAccount();setScreen('lock');await prepareSecurity();
    });
  }catch(err){console.error(err);setScreen('auth');alert('Não foi possível iniciar o Firebase. Recarregue a página.')}
}
function userCollection(){return db.collection(`users/${state.user.uid}/${COLLECTION}`)}
async function prepareSecurity(){
  $('#masterForm').reset();$('#masterError').textContent='';$('#masterSubmit').disabled=false;
  const snap=await userCollection().doc(SECURITY_ID).get();
  state.security=snap.exists?snap.data():null;
  const setup=!state.security||state.security.kind!=='security';
  $('#lockEyebrow').textContent=setup?'Primeira configuração':'Workspace protegido';
  $('#lockTitle').textContent=setup?'Crie sua senha mestra':'Desbloquear Work Storage';
  $('#lockText').textContent=setup?'Ela criptografa seus itens antes de chegarem ao Firebase. Não existe recuperação dessa senha.':'Digite sua senha mestra para descriptografar seus itens neste dispositivo.';
  $('#masterConfirmWrap').classList.toggle('hidden',!setup);
  $('#masterSubmit').textContent=setup?'Criar senha e proteger workspace':'Desbloquear';
  $('#masterPassword').focus();
}
$('#masterForm').addEventListener('submit',async e=>{
  e.preventDefault();const pwd=$('#masterPassword').value,confirmPwd=$('#masterConfirm').value;$('#masterError').textContent='';$('#masterSubmit').disabled=true;
  try{
    if(!state.security||state.security.kind!=='security'){
      if(pwd.length<10)throw new Error('Use pelo menos 10 caracteres na senha mestra.');
      if(pwd!==confirmPwd)throw new Error('As duas senhas não são iguais.');
      const salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveKey(pwd,salt),verifier=await encryptValue({check:'work-storage-v2'},key);
      const security={kind:'security',version:2,salt:bytesToB64(salt),iterations:PBKDF2_ITERATIONS,iv:verifier.iv,data:verifier.data,createdAt:now()};
      await userCollection().doc(SECURITY_ID).set(security);state.security=security;state.key=key;
      await migrateLegacyContent();
    }else{
      const key=await deriveKey(pwd,b64ToBytes(state.security.salt),state.security.iterations||PBKDF2_ITERATIONS);
      const check=await decryptValue({iv:state.security.iv,data:state.security.data},key);
      if(check.check!=='work-storage-v2')throw new Error('Senha mestra incorreta.');
      state.key=key;
    }
    $('#masterForm').reset();await openWorkspace();
  }catch(err){console.error(err);$('#masterError').textContent=err.name==='OperationError'?'Senha mestra incorreta.':(err.message||'Não foi possível desbloquear.');$('#masterSubmit').disabled=false}
});

async function migrateLegacyContent(){
  setSync('saving','Protegendo dados...');
  const col=userCollection(),snap=await col.get();
  const legacy=snap.docs.filter(d=>d.id!==SECURITY_ID&&!d.data().kind);
  const existingEncrypted=snap.docs.some(d=>d.data().kind==='item');
  let source=legacy.map(d=>({id:d.id,...d.data()}));
  if(!source.length&&!existingEncrypted){
    try{const local=JSON.parse(localStorage.getItem('ws_notebook_v1'));if(Array.isArray(local))source=local}catch{}
  }
  for(let i=0;i<source.length;i+=40){
    const batch=db.batch();
    for(const n of source.slice(i,i+40)){
      const item={id:String(n.id||makeId('i')),title:n.title||'Sem título',folderId:null,tags:[],pinned:Boolean(n.pinned),createdAt:Number(n.createdAt)||now(),updatedAt:Number(n.updatedAt)||now(),blocks:[{...blankBlock('text'),text:n.content||''}]};
      const enc=await encryptValue(item);batch.set(col.doc(item.id),{kind:'item',version:2,iv:enc.iv,data:enc.data,updatedAt:item.updatedAt});
    }
    await batch.commit();
  }
  for(const key of ['ws_notebook_v1','ws_items_v2','ws_items'])localStorage.removeItem(key);
}

async function openWorkspace(){
  setScreen('app');updateAccount();setSync('saving','Carregando...');await loadWorkspace();subscribeWorkspace();renderAll();setSync('cloud','Protegido e sincronizado');resetIdleTimer();
}
async function loadWorkspace(){
  const snap=await userCollection().get();state.items=[];state.folders=[];
  for(const d of snap.docs){
    const raw=d.data();if(!raw.iv||!raw.data)continue;
    try{const value=await decryptValue(raw);if(raw.kind==='item')state.items.push({...value,id:d.id});if(raw.kind==='folder')state.folders.push({...value,id:d.id})}catch(err){console.warn('Registro não pôde ser descriptografado',d.id,err)}
  }
  normalizeOrders();
}
function subscribeWorkspace(){
  if(unsubscribeCloud)unsubscribeCloud();unsubscribeCloud=userCollection().onSnapshot(async snap=>{
    if(!state.key||state.syncing)return;
    const items=[],folders=[];
    for(const d of snap.docs){const raw=d.data();if(!raw.iv||!raw.data)continue;try{const value=await decryptValue(raw);if(raw.kind==='item')items.push({...value,id:d.id});if(raw.kind==='folder')folders.push({...value,id:d.id})}catch{}}
    state.items=items;state.folders=folders;normalizeOrders();if(state.activeId&&!state.items.some(i=>i.id===state.activeId))closeDrawer();renderAll();setSync('cloud','Protegido e sincronizado');
  },err=>{console.error(err);setSync('error','Erro de sincronização')})
}
function normalizeOrders(){state.folders.sort((a,b)=>(a.order??9999)-(b.order??9999)||a.name.localeCompare(b.name));state.items.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(b.updatedAt||0)-(a.updatedAt||0))}
function clearWorkspaceMemory(){if(unsubscribeCloud){unsubscribeCloud();unsubscribeCloud=null}clearTimeout(saveTimer);clearTimeout(idleTimer);state.key=null;state.security=null;state.items=[];state.folders=[];state.activeId=null}
function lockWorkspace(){if(!state.user)return;clearWorkspaceMemory();setScreen('lock');prepareSecurity();toast('Workspace bloqueado.')}
function resetIdleTimer(){clearTimeout(idleTimer);if(state.key)idleTimer=setTimeout(lockWorkspace,AUTO_LOCK_MS)}
['pointerdown','keydown','touchstart'].forEach(evt=>document.addEventListener(evt,resetIdleTimer,{passive:true}));

async function saveRecord(kind,obj){
  if(!state.key)return;
  const raw=JSON.stringify(obj);if(kind==='item'&&textEncoder.encode(raw).length>MAX_ITEM_BYTES){toast('Este item ficou grande demais para sincronizar. Remova arquivos ou divida o conteúdo.','error');throw new Error('item-too-large')}
  state.syncing=true;setSync('saving','Criptografando...');
  try{const enc=await encryptValue(obj);await userCollection().doc(obj.id).set({kind,version:2,iv:enc.iv,data:enc.data,updatedAt:obj.updatedAt||now()});setSync('cloud','Protegido e sincronizado')}
  finally{state.syncing=false}
}
function queueSave(item=activeItem()){clearTimeout(saveTimer);if(!item)return;setSync('saving','Salvando...');saveTimer=setTimeout(()=>saveRecord('item',item).catch(console.error),500)}
async function deleteRecord(id){state.syncing=true;try{await userCollection().doc(id).delete()}finally{state.syncing=false}}

function renderAll(){renderSidebar();renderMain();renderDrawer();updateViewButtons()}
function renderSidebar(){
  const nav=$('#folderNav');nav.innerHTML=state.folders.map(f=>`<div class="folder-row" draggable="true" data-folder-id="${esc(f.id)}"><button data-filter="folder:${esc(f.id)}"><span>▱</span><span>${esc(f.name)}</span></button><button class="folder-more" data-folder-menu="${esc(f.id)}" aria-label="Opções da pasta">•••</button></div>`).join('');
  $$('.nav-button').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
  nav.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
}
function filteredItems(){
  let items=[...state.items];const q=state.search.trim().toLowerCase();if(q)items=items.filter(i=>searchable(i).includes(q));
  if(state.filter==='pinned')items=items.filter(i=>i.pinned);else if(state.filter.startsWith('folder:'))items=items.filter(i=>i.folderId===state.filter.slice(7));else if(state.filter.startsWith('tag:'))items=items.filter(i=>i.tags.includes(state.filter.slice(4)));
  return items;
}
function renderMain(){
  const home=state.filter==='home'&&!state.search;$('#homeView').classList.toggle('hidden',!home);$('#libraryView').classList.toggle('hidden',home);
  if(home){renderHome();return}
  const items=filteredItems();let title='Todos os itens';if(state.filter==='pinned')title='Fixados';if(state.filter.startsWith('folder:'))title=folderName(state.filter.slice(7));if(state.filter.startsWith('tag:'))title=`#${state.filter.slice(4)}`;if(state.search)title=`Resultados para “${state.search}”`;
  $('#libraryTitle').textContent=title;$('#libraryCount').textContent=`${items.length} ${items.length===1?'item':'itens'}`;$('#itemGrid').className=`item-grid ${state.viewMode}`;$('#itemGrid').innerHTML=items.length?items.map(itemCard).join(''):`<div class="empty-library"><strong>Nada aqui ainda.</strong><span>Crie um item ou mude os filtros.</span><button class="primary" data-open-create>Criar item</button></div>`;
}
function renderHome(){
  const recent=[...state.items].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,6),pinned=state.items.filter(i=>i.pinned).slice(0,6);
  $('#recentItems').innerHTML=recent.length?recent.map(itemCard).join(''):'<p class="muted-empty">Seus itens recentes aparecerão aqui.</p>';
  $('#pinnedItems').innerHTML=pinned.length?pinned.map(itemCard).join(''):'<p class="muted-empty">Fixe itens importantes para acessá-los rapidamente.</p>';
  $('#homeFolders').innerHTML=state.folders.length?state.folders.slice(0,8).map(f=>`<button class="folder-card" data-filter="folder:${esc(f.id)}"><span>▱</span><strong>${esc(f.name)}</strong><small>${state.items.filter(i=>i.folderId===f.id).length} itens</small></button>`).join(''):'<button class="folder-card dashed" data-new-folder><span>＋</span><strong>Criar primeira pasta</strong></button>';
}
function itemCard(i){const preview=i.blocks.map(b=>b.type==='text'?b.text:b.type==='code'?b.code:b.type==='link'?(b.label||b.url):b.type==='login'?(b.username||b.url):'').filter(Boolean).join(' ').slice(0,160);return`<button class="item-card" data-open-item="${esc(i.id)}"><div class="item-icon">${esc(iconFor(i))}</div><div class="item-card-body"><div class="item-card-title"><strong>${esc(i.title||'Sem título')}</strong>${i.pinned?'<span title="Fixado">★</span>':''}</div><p>${esc(preview||typeLabel(i.blocks[0]?.type||'text'))}</p><div class="item-meta"><span>${esc(folderName(i.folderId))}</span><span>${formatDate(i.updatedAt)}</span>${i.tags.slice(0,2).map(t=>`<em>#${esc(t)}</em>`).join('')}</div></div></button>`}
function updateViewButtons(){$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.viewMode))}

function openItem(id){state.activeId=id;$('#itemDrawer').classList.remove('hidden');$('#drawerBackdrop').classList.remove('hidden');renderDrawer();requestAnimationFrame(()=>$('#itemTitle').focus())}
function closeDrawer(){state.activeId=null;$('#itemDrawer').classList.add('hidden');$('#drawerBackdrop').classList.add('hidden');state.drawerMax=false;$('#itemDrawer').classList.remove('maximized')}
function renderDrawer(){
  const item=activeItem();if(!item)return;
  $('#itemDrawer').classList.toggle('maximized',state.drawerMax);$('#maximizeBtn').textContent=state.drawerMax?'↘':'↗';$('#maximizeBtn').title=state.drawerMax?'Voltar ao painel lateral':'Maximizar';
  if(document.activeElement!==$('#itemTitle'))$('#itemTitle').value=item.title||'';
  $('#pinItemBtn').textContent=item.pinned?'★ Fixado':'☆ Fixar';$('#itemUpdated').textContent=`Atualizado ${formatDate(item.updatedAt)}`;
  $('#itemFolder').innerHTML=`<option value="">Sem pasta</option>${state.folders.map(f=>`<option value="${esc(f.id)}" ${item.folderId===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}`;
  if(document.activeElement!==$('#itemTags'))$('#itemTags').value=item.tags.join(', ');
  $('#blocks').innerHTML=item.blocks.map(renderBlock).join('');
}
function renderBlock(b){
  const head=`<div class="block-head"><span>${typeLabel(b.type)}</span><button class="ghost danger" data-remove-block="${esc(b.id)}" title="Remover bloco">Remover</button></div>`;
  if(b.type==='text')return`<section class="content-block" data-block-id="${esc(b.id)}">${head}<textarea class="block-textarea" data-block-field="text" placeholder="Escreva aqui...">${esc(b.text)}</textarea></section>`;
  if(b.type==='login')return`<section class="content-block" data-block-id="${esc(b.id)}">${head}<div class="field-grid"><label>Usuário / e-mail<input data-block-field="username" value="${esc(b.username)}" autocomplete="off"></label><label>Senha<div class="password-line"><input type="password" data-block-field="password" value="${esc(b.password)}" autocomplete="new-password"><button class="ghost" data-reveal-password>Mostrar</button><button class="ghost" data-copy-password>Copiar</button></div></label><label class="span-2">Site<input data-block-field="url" value="${esc(b.url)}" placeholder="https://"></label></div></section>`;
  if(b.type==='link')return`<section class="content-block" data-block-id="${esc(b.id)}">${head}<div class="field-grid"><label>Nome<input data-block-field="label" value="${esc(b.label)}" placeholder="Nome do link"></label><label>URL<div class="url-line"><input data-block-field="url" value="${esc(b.url)}" placeholder="https://"><button class="ghost" data-open-link>↗ Abrir</button></div></label></div></section>`;
  if(b.type==='code')return`<section class="content-block" data-block-id="${esc(b.id)}">${head}<label class="compact-label">Linguagem / tipo<input data-block-field="language" value="${esc(b.language)}" placeholder="Prompt, JavaScript, SQL..."></label><textarea class="code-area" data-block-field="code" spellcheck="false" placeholder="Cole seu prompt ou código...">${esc(b.code)}</textarea><button class="ghost block-tool" data-copy-code>Copiar conteúdo</button></section>`;
  if(b.type==='checklist')return`<section class="content-block" data-block-id="${esc(b.id)}">${head}<div class="check-list">${b.items.map(x=>`<div class="check-row" data-check-id="${esc(x.id)}"><input type="checkbox" data-check-done ${x.done?'checked':''}><input data-check-text value="${esc(x.text)}" placeholder="Nova tarefa"><button class="ghost" data-remove-check>×</button></div>`).join('')}</div><button class="ghost block-tool" data-add-check>＋ Adicionar tarefa</button></section>`;
  if(b.type==='fields')return`<section class="content-block" data-block-id="${esc(b.id)}">${head}<div class="custom-fields">${b.rows.map(x=>`<div class="custom-row" data-field-row="${esc(x.id)}"><input data-custom-key value="${esc(x.key)}" placeholder="Campo"><input data-custom-value value="${esc(x.value)}" placeholder="Valor"><button class="ghost" data-remove-field>×</button></div>`).join('')}</div><button class="ghost block-tool" data-add-field>＋ Adicionar campo</button></section>`;
  if(b.type==='file'){const preview=b.dataUrl&&b.mime.startsWith('image/')?`<img class="file-preview" src="${esc(b.dataUrl)}" alt="${esc(b.name)}">`:'';return`<section class="content-block" data-block-id="${esc(b.id)}">${head}${b.dataUrl?`${preview}<div class="file-ready"><div><strong>${esc(b.name)}</strong><span>${Math.ceil(b.size/1024)} KB · protegido dentro deste item</span></div><button class="ghost" data-download-file>Baixar</button><button class="ghost danger" data-clear-file>Remover arquivo</button></div>`:`<label class="file-drop">＋<strong>Adicionar arquivo ou imagem</strong><span>Até ${Math.floor(MAX_FILE_BYTES/1000)} KB por arquivo nesta versão</span><input type="file" data-file-input hidden></label>`}</section>`}
  return'';
}

function createItem(template){const item=templateItem(template);state.items.unshift(item);saveRecord('item',item).then(()=>{renderAll();openItem(item.id)}).catch(console.error);toggleCreateMenu(false)}
function touchItem(item=activeItem()){if(!item)return;item.updatedAt=now();$('#itemUpdated').textContent=`Atualizado ${formatDate(item.updatedAt)}`;queueSave(item)}
function findBlock(id){return activeItem()?.blocks.find(b=>b.id===id)}
function addBlock(type){const item=activeItem();if(!item)return;item.blocks.push(blankBlock(type));touchItem(item);renderDrawer();requestAnimationFrame(()=>$('#blocks .content-block:last-child textarea, #blocks .content-block:last-child input')?.focus())}
function createFolder(){const name=prompt('Nome da nova pasta:')?.trim();if(!name)return;const folder={id:makeId('folder'),name,order:state.folders.length,createdAt:now(),updatedAt:now()};state.folders.push(folder);saveRecord('folder',folder).then(()=>{state.filter=`folder:${folder.id}`;renderAll()});}
async function renameFolder(id){const f=state.folders.find(x=>x.id===id);if(!f)return;const name=prompt('Novo nome da pasta:',f.name)?.trim();if(!name)return;f.name=name;f.updatedAt=now();await saveRecord('folder',f);renderAll()}
async function removeFolder(id){const f=state.folders.find(x=>x.id===id);if(!f||!confirm(`Excluir a pasta “${f.name}”? Os itens serão movidos para “Sem pasta”.`))return;const affected=state.items.filter(i=>i.folderId===id);for(const item of affected){item.folderId=null;item.updatedAt=now();await saveRecord('item',item)}state.folders=state.folders.filter(x=>x.id!==id);await deleteRecord(id);state.filter='home';renderAll()}

function toggleCreateMenu(force){const menu=$('#createMenu'),show=typeof force==='boolean'?force:menu.classList.contains('hidden');menu.classList.toggle('hidden',!show)}
function toggleAccountMenu(force){const menu=$('#accountMenu'),show=typeof force==='boolean'?force:menu.classList.contains('hidden');menu.classList.toggle('hidden',!show);$('#menuBtn').setAttribute('aria-expanded',String(show))}
function toggleTheme(){const light=document.body.classList.toggle('light');localStorage.setItem(THEME_KEY,light?'light':'dark')}

async function exportBackup(){
  const snap=await userCollection().get(),records=snap.docs.map(d=>({id:d.id,data:d.data()}));const blob=new Blob([JSON.stringify({product:'Work Storage',version:2,encrypted:true,exportedAt:new Date().toISOString(),records},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`work-storage-encrypted-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast('Backup criptografado exportado.')
}
async function importBackup(file){
  try{const backup=JSON.parse(await file.text());if(backup.version!==2||!backup.encrypted||!Array.isArray(backup.records))throw new Error('Formato incompatível');if(!confirm('Restaurar este backup? Os dados atuais na nuvem serão substituídos e você precisará usar a senha mestra do backup.'))return;state.syncing=true;const col=userCollection(),current=await col.get();for(let i=0;i<current.docs.length;i+=400){const batch=db.batch();current.docs.slice(i,i+400).forEach(d=>batch.delete(d.ref));await batch.commit()}for(let i=0;i<backup.records.length;i+=400){const batch=db.batch();backup.records.slice(i,i+400).forEach(r=>batch.set(col.doc(r.id),r.data));await batch.commit()}state.syncing=false;toast('Backup restaurado. Desbloqueie novamente.');lockWorkspace()}catch(err){console.error(err);state.syncing=false;toast('Backup inválido ou incompatível.','error')}
}

// Navegação e criação
document.addEventListener('click',e=>{
  const filter=e.target.closest('[data-filter]');if(filter){state.filter=filter.dataset.filter;state.search='';$('#searchInput').value='';renderAll();return}
  const open=e.target.closest('[data-open-item]');if(open){openItem(open.dataset.openItem);return}
  if(e.target.closest('[data-open-create]')){toggleCreateMenu(true);return}
  if(e.target.closest('[data-new-folder]')){createFolder();return}
  const template=e.target.closest('[data-template]');if(template){createItem(template.dataset.template);return}
  const folderMenu=e.target.closest('[data-folder-menu]');if(folderMenu){const id=folderMenu.dataset.folderMenu;if(confirm('OK = renomear pasta. Cancelar = abrir opções de exclusão.'))renameFolder(id);else if(confirm('Excluir esta pasta?'))removeFolder(id);return}
  if(!e.target.closest('#createMenu')&&!e.target.closest('[data-open-create]'))toggleCreateMenu(false);
  if(!e.target.closest('#accountMenu')&&!e.target.closest('#menuBtn'))toggleAccountMenu(false);
});
$('#newItemBtn').onclick=()=>toggleCreateMenu();$('#quickNewBtn').onclick=()=>toggleCreateMenu(true);$('#newFolderBtn').onclick=createFolder;
$('#searchInput').addEventListener('input',e=>{state.search=e.target.value;state.filter=state.search?'all':state.filter;renderMain()});
$$('[data-view]').forEach(b=>b.onclick=()=>{state.viewMode=b.dataset.view;localStorage.setItem(VIEW_KEY,state.viewMode);renderMain();updateViewButtons()});
$('#themeBtn').onclick=toggleTheme;$('#menuBtn').onclick=e=>{e.stopPropagation();toggleAccountMenu()};
$('#lockBtn').onclick=()=>{toggleAccountMenu(false);lockWorkspace()};$('#signOutBtn').onclick=()=>auth.signOut();$('#exportBtn').onclick=exportBackup;$('#importBtn').onclick=()=>$('#importInput').click();$('#importInput').addEventListener('change',async e=>{if(e.target.files?.[0])await importBackup(e.target.files[0]);e.target.value=''});

// Drawer / item
$('#drawerClose').onclick=closeDrawer;$('#drawerBackdrop').onclick=closeDrawer;$('#maximizeBtn').onclick=()=>{state.drawerMax=!state.drawerMax;renderDrawer()};
$('#itemTitle').addEventListener('input',e=>{const item=activeItem();if(!item)return;item.title=e.target.value;touchItem(item)});$('#itemTitle').addEventListener('blur',()=>renderMain());
$('#pinItemBtn').onclick=()=>{const item=activeItem();if(!item)return;item.pinned=!item.pinned;touchItem(item);renderAll()};
$('#deleteItemBtn').onclick=async()=>{const item=activeItem();if(!item||!confirm(`Excluir “${item.title||'Sem título'}”?`))return;state.items=state.items.filter(i=>i.id!==item.id);await deleteRecord(item.id);closeDrawer();renderAll();toast('Item excluído.')};
$('#itemFolder').addEventListener('change',e=>{const item=activeItem();if(!item)return;item.folderId=e.target.value||null;touchItem(item);renderMain()});
$('#itemTags').addEventListener('change',e=>{const item=activeItem();if(!item)return;item.tags=[...new Set(e.target.value.split(',').map(x=>x.trim().replace(/^#/,'')).filter(Boolean))].slice(0,12);e.target.value=item.tags.join(', ');touchItem(item);renderMain()});
$('#addBlockBtn').onclick=()=>addBlock($('#blockType').value);
$('#blocks').addEventListener('input',e=>{
  const box=e.target.closest('[data-block-id]'),block=box&&findBlock(box.dataset.blockId);if(!block)return;
  if(e.target.dataset.blockField)block[e.target.dataset.blockField]=e.target.value;
  const check=e.target.closest('[data-check-id]');if(check){const row=block.items.find(x=>x.id===check.dataset.checkId);if(row){if(e.target.matches('[data-check-text]'))row.text=e.target.value;if(e.target.matches('[data-check-done]'))row.done=e.target.checked}}
  const custom=e.target.closest('[data-field-row]');if(custom){const row=block.rows.find(x=>x.id===custom.dataset.fieldRow);if(row){if(e.target.matches('[data-custom-key]'))row.key=e.target.value;if(e.target.matches('[data-custom-value]'))row.value=e.target.value}}
  touchItem();
});
$('#blocks').addEventListener('change',e=>{if(e.target.matches('[data-check-done]'))e.target.dispatchEvent(new Event('input',{bubbles:true}))});
$('#blocks').addEventListener('click',async e=>{
  e.preventDefault();const box=e.target.closest('[data-block-id]'),block=box&&findBlock(box.dataset.blockId),item=activeItem();if(!block||!item)return;
  if(e.target.closest('[data-remove-block]')){item.blocks=item.blocks.filter(b=>b.id!==block.id);touchItem(item);renderDrawer();return}
  if(e.target.closest('[data-reveal-password]')){const input=box.querySelector('[data-block-field="password"]');input.type=input.type==='password'?'text':'password';e.target.textContent=input.type==='password'?'Mostrar':'Ocultar';return}
  if(e.target.closest('[data-copy-password]')){await navigator.clipboard.writeText(block.password||'');toast('Senha copiada.');return}
  if(e.target.closest('[data-open-link]')){if(block.url)window.open(/^https?:\/\//i.test(block.url)?block.url:`https://${block.url}`,'_blank','noopener');return}
  if(e.target.closest('[data-copy-code]')){await navigator.clipboard.writeText(block.code||'');toast('Conteúdo copiado.');return}
  const check=e.target.closest('[data-check-id]');if(check&&e.target.closest('[data-remove-check]')){block.items=block.items.filter(x=>x.id!==check.dataset.checkId);touchItem(item);renderDrawer();return}
  if(e.target.closest('[data-add-check]')){block.items.push({id:makeId('c'),text:'',done:false});touchItem(item);renderDrawer();return}
  const custom=e.target.closest('[data-field-row]');if(custom&&e.target.closest('[data-remove-field]')){block.rows=block.rows.filter(x=>x.id!==custom.dataset.fieldRow);touchItem(item);renderDrawer();return}
  if(e.target.closest('[data-add-field]')){block.rows.push({id:makeId('f'),key:'',value:''});touchItem(item);renderDrawer();return}
  if(e.target.closest('[data-download-file]')){const a=document.createElement('a');a.href=block.dataUrl;a.download=block.name||'arquivo';a.click();return}
  if(e.target.closest('[data-clear-file]')){Object.assign(block,{name:'',mime:'',size:0,dataUrl:''});touchItem(item);renderDrawer();return}
});
$('#blocks').addEventListener('change',async e=>{
  if(!e.target.matches('[data-file-input]'))return;const file=e.target.files?.[0],box=e.target.closest('[data-block-id]'),block=box&&findBlock(box.dataset.blockId);if(!file||!block)return;if(file.size>MAX_FILE_BYTES){toast(`Arquivo muito grande. Use até ${Math.floor(MAX_FILE_BYTES/1000)} KB nesta versão.`, 'error');return}const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});Object.assign(block,{name:file.name,mime:file.type||'application/octet-stream',size:file.size,dataUrl});touchItem();renderDrawer();
});

// Reordenação de pastas
let draggedFolder=null;$('#folderNav').addEventListener('dragstart',e=>{const row=e.target.closest('[data-folder-id]');if(row)draggedFolder=row.dataset.folderId});$('#folderNav').addEventListener('dragover',e=>e.preventDefault());$('#folderNav').addEventListener('drop',async e=>{e.preventDefault();const target=e.target.closest('[data-folder-id]')?.dataset.folderId;if(!draggedFolder||!target||target===draggedFolder)return;const from=state.folders.findIndex(f=>f.id===draggedFolder),to=state.folders.findIndex(f=>f.id===target),[moved]=state.folders.splice(from,1);state.folders.splice(to,0,moved);state.folders.forEach((f,i)=>f.order=i);renderSidebar();for(const f of state.folders)await saveRecord('folder',f);draggedFolder=null});

// Atalhos seguros
document.addEventListener('keydown',e=>{
  const mod=e.ctrlKey||e.metaKey;
  if(e.altKey&&!e.ctrlKey&&!e.metaKey&&e.key.toLowerCase()==='n'&&state.key){e.preventDefault();createItem('blank')}
  if(mod&&e.key.toLowerCase()==='k'&&state.key){e.preventDefault();$('#searchInput').focus();$('#searchInput').select()}
  if(mod&&e.key.toLowerCase()==='s'&&state.key){e.preventDefault();const item=activeItem();if(item)saveRecord('item',item).then(()=>toast('Item sincronizado.'));}
  if(e.key==='Escape'){toggleCreateMenu(false);toggleAccountMenu(false);if(state.activeId)closeDrawer()}
});

if(localStorage.getItem(THEME_KEY)==='light')document.body.classList.add('light');
initFirebase();
