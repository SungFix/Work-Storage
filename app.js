const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const STORAGE_KEY='ws_notebook_v1';
const THEME_KEY='ws_theme';
const ACTIVE_KEY='ws_active_note';
const firebaseConfig=window.WORK_STORAGE_FIREBASE_CONFIG||{};
const firebaseReady=Boolean(firebaseConfig.apiKey&&firebaseConfig.projectId&&firebaseConfig.authDomain);
let db=null,auth=null,unsubscribeCloud=null,saveTimer=null,ignoreCloud=false;
const state={notes:[],activeId:null,user:null,cloud:firebaseReady,query:'',saving:false};

const uid=()=>state.user?.uid||null;
const now=()=>Date.now();
const makeId=()=>crypto.randomUUID?.()||`n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const noteTemplate=(title='Nova nota',content='')=>({id:makeId(),title,content,pinned:false,createdAt:now(),updatedAt:now()});
const escapeHtml=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function readLocal(){
  try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));if(Array.isArray(saved))return saved}catch{}
  const migrated=migrateOldData();
  if(migrated.length)return migrated;
  return [noteTemplate('Bem-vindo ao Work Storage','Este é seu bloco de notas em abas.\n\n• Use Ctrl+N para criar uma nota.\n• Use Ctrl+K para pesquisar.\n• Tudo é salvo automaticamente.\n\nQuando o Firebase estiver conectado, suas notas também aparecerão em outros computadores.')];
}
function migrateOldData(){
  for(const key of ['ws_items_v2','ws_items']){
    try{
      const items=JSON.parse(localStorage.getItem(key));
      if(!Array.isArray(items))continue;
      const notes=items.filter(i=>!i.deletedAt).map(i=>({
        id:String(i.id||makeId()),title:i.title||'Sem título',content:[i.content,i.fields?.username&&`Usuário: ${i.fields.username}`,i.fields?.url&&`Link: ${i.fields.url}`].filter(Boolean).join('\n\n'),pinned:Boolean(i.favorite),createdAt:Number(i.createdAt)||now(),updatedAt:Number(i.updatedAt)||now()
      }));
      if(notes.length)return notes;
    }catch{}
  }
  return [];
}
function persistLocal(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state.notes));if(state.activeId)localStorage.setItem(ACTIVE_KEY,state.activeId)}
function activeNote(){return state.notes.find(n=>n.id===state.activeId)||null}
function sortNotes(notes=[...state.notes]){return notes.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(b.updatedAt||0)-(a.updatedAt||0))}
function formatTime(ts){if(!ts)return'Agora';const d=new Date(ts),today=new Date();const same=d.toDateString()===today.toDateString();return same?`Hoje, ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
function wordCount(text=''){const t=text.trim();return t?t.split(/\s+/).length:0}
function toast(message,tone=''){const el=document.createElement('div');el.className=`toast ${tone}`;el.textContent=message;$('#toastRegion').append(el);setTimeout(()=>el.remove(),2200)}

function setSync(mode,label){const el=$('#syncState');el.className=`sync-state ${mode||''}`;el.querySelector('span').textContent=label;$('#saveLabel').textContent=label}
function updateAccountUI(){
  if(state.user){$('#accountName').textContent=state.user.displayName||'Sua conta';$('#accountEmail').textContent=state.user.email||'';$('#menuBtn').textContent=(state.user.displayName||state.user.email||'WS').split(/\s|@/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();$('#signOutBtn').classList.remove('hidden');$('#firebaseHint').classList.add('hidden')}
  else{$('#accountName').textContent='Work Storage';$('#accountEmail').textContent=firebaseReady?'Não conectado':'Modo local';$('#menuBtn').textContent='WS';$('#signOutBtn').classList.add('hidden');$('#firebaseHint').classList.toggle('hidden',firebaseReady)}
}
function renderTabs(){
  const q=state.query.trim().toLowerCase();
  let notes=sortNotes();
  if(q)notes=notes.filter(n=>`${n.title} ${n.content}`.toLowerCase().includes(q));
  $('#tabs').innerHTML=notes.map(n=>`<button class="note-tab ${n.id===state.activeId?'active':''}" role="tab" aria-selected="${n.id===state.activeId}" data-note-id="${escapeHtml(n.id)}" draggable="true"><span class="tab-pin">${n.pinned?'★':''}</span><span class="tab-title">${escapeHtml(n.title||'Sem título')}</span><span class="tab-close" data-close-note="${escapeHtml(n.id)}" title="Excluir nota">×</span></button>`).join('');
  if(q&&!notes.length)$('#tabs').innerHTML='<div style="padding:10px 12px;color:var(--muted);font-size:11px">Nenhuma nota encontrada</div>';
}
function renderEditor(){
  const n=activeNote();
  $('#emptyState').classList.toggle('hidden',Boolean(n));
  $('#editorView').classList.toggle('hidden',!n);
  if(!n)return;
  if(document.activeElement!==$('#noteTitle'))$('#noteTitle').value=n.title||'';
  if(document.activeElement!==$('#noteContent'))$('#noteContent').value=n.content||'';
  $('#pinBtn').textContent=n.pinned?'★ Fixada':'☆ Fixar';
  $('#noteUpdated').textContent=formatTime(n.updatedAt);
  $('#noteWords').textContent=`${wordCount(n.content)} ${wordCount(n.content)===1?'palavra':'palavras'}`;
  autoGrow();
}
function render(){renderTabs();renderEditor();updateAccountUI();if(!state.notes.length){state.activeId=null;renderTabs();renderEditor()}}

function createNote(title='Nova nota',content=''){
  const n=noteTemplate(title,content);state.notes.unshift(n);state.activeId=n.id;persistLocal();render();queueCloudSave(n);requestAnimationFrame(()=>{$('#noteTitle').focus();$('#noteTitle').select()});return n
}
function updateCurrent(patch){const n=activeNote();if(!n)return;Object.assign(n,patch,{updatedAt:now()});persistLocal();state.saving=true;setSync('saving',state.user?'Salvando...':'Salvando local...');renderTabs();$('#noteUpdated').textContent=formatTime(n.updatedAt);$('#noteWords').textContent=`${wordCount(n.content)} ${wordCount(n.content)===1?'palavra':'palavras'}`;queueCloudSave(n)}
function deleteNote(id=state.activeId){const n=state.notes.find(x=>x.id===id);if(!n)return;if(!confirm(`Excluir “${n.title||'Sem título'}”?`))return;state.notes=state.notes.filter(x=>x.id!==id);if(state.activeId===id)state.activeId=sortNotes()[0]?.id||null;persistLocal();render();if(state.user&&db)db.doc(`users/${uid()}/notes/${id}`).delete().catch(()=>toast('Não foi possível excluir na nuvem.','error'));toast('Nota excluída.')}
function duplicateNote(){const n=activeNote();if(!n)return;createNote(`${n.title||'Sem título'} — cópia`,n.content||'')}
function togglePin(){const n=activeNote();if(!n)return;n.pinned=!n.pinned;updateCurrent({pinned:n.pinned});render()}

function queueCloudSave(note){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    if(!state.user||!db){state.saving=false;setSync('',firebaseReady?'Aguardando login':'Salvo local');return}
    try{
      await db.doc(`users/${uid()}/notes/${note.id}`).set({...note,userId:uid()}, {merge:true});
      state.saving=false;setSync('cloud','Sincronizado');
    }catch(err){console.error(err);state.saving=false;setSync('error','Erro ao sincronizar')}
  },550)
}

async function initFirebase(){
  if(!firebaseReady){state.cloud=false;$('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');setSync('','Salvo local');updateAccountUI();return}
  try{
    firebase.initializeApp(firebaseConfig);auth=firebase.auth();db=firebase.firestore();
    db.enablePersistence({synchronizeTabs:true}).catch(()=>{});
    auth.onAuthStateChanged(async user=>{
      state.user=user||null;updateAccountUI();
      if(user){$('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');setSync('saving','Carregando...');await startCloudSync()}
      else{if(unsubscribeCloud){unsubscribeCloud();unsubscribeCloud=null}$('#appView').classList.add('hidden');$('#authView').classList.remove('hidden')}
    });
  }catch(err){console.error(err);state.cloud=false;$('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');setSync('error','Firebase indisponível');toast('Firebase não iniciou. Usando salvamento local.','error')}
}
async function startCloudSync(){
  const col=db.collection(`users/${uid()}/notes`);
  const first=await col.get();
  if(first.empty&&state.notes.length){
    const batch=db.batch();state.notes.forEach(n=>batch.set(col.doc(n.id),{...n,userId:uid()}));await batch.commit();
  }
  if(unsubscribeCloud)unsubscribeCloud();
  unsubscribeCloud=col.onSnapshot(snapshot=>{
    if(ignoreCloud)return;
    const incoming=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    if(incoming.length||snapshot.empty){state.notes=incoming;const saved=localStorage.getItem(ACTIVE_KEY);if(!state.notes.some(n=>n.id===state.activeId))state.activeId=state.notes.find(n=>n.id===saved)?.id||sortNotes()[0]?.id||null;persistLocal();render();setSync('cloud','Sincronizado')}
  },err=>{console.error(err);setSync('error','Erro de sincronização')});
}
async function signInGoogle(){try{const provider=new firebase.auth.GoogleAuthProvider();await auth.signInWithPopup(provider)}catch(err){console.error(err);toast('Não foi possível entrar com Google.','error')}}
async function signOut(){if(auth)await auth.signOut()}

function exportBackup(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),notes:state.notes},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`work-storage-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast('Backup exportado.')}
async function importBackup(file){try{const data=JSON.parse(await file.text()),notes=Array.isArray(data)?data:data.notes;if(!Array.isArray(notes))throw new Error();if(!confirm(`Importar ${notes.length} nota(s) e substituir as atuais?`))return;state.notes=notes.map(n=>({...noteTemplate(),...n,id:String(n.id||makeId()),updatedAt:Number(n.updatedAt)||now()}));state.activeId=sortNotes()[0]?.id||null;persistLocal();render();if(state.user&&db){const col=db.collection(`users/${uid()}/notes`);const current=await col.get();let batch=db.batch();current.docs.forEach(d=>batch.delete(d.ref));state.notes.forEach(n=>batch.set(col.doc(n.id),{...n,userId:uid()}));await batch.commit()}toast('Backup importado.')}catch{toast('Arquivo de backup inválido.','error')}}
function toggleTheme(){const light=document.body.classList.toggle('light');localStorage.setItem(THEME_KEY,light?'light':'dark')}
function toggleMenu(force){const menu=$('#accountMenu'),show=typeof force==='boolean'?force:menu.classList.contains('hidden');menu.classList.toggle('hidden',!show);$('#menuBtn').setAttribute('aria-expanded',String(show))}
function autoGrow(){const t=$('#noteContent');t.style.height='auto';t.style.height=Math.max(460,t.scrollHeight)+'px'}

$('#tabs').addEventListener('click',e=>{const close=e.target.closest('[data-close-note]');if(close){e.stopPropagation();deleteNote(close.dataset.closeNote);return}const tab=e.target.closest('[data-note-id]');if(tab){state.activeId=tab.dataset.noteId;localStorage.setItem(ACTIVE_KEY,state.activeId);render()}});
$('#newTabBtn').onclick=()=>createNote();$('#emptyCreateBtn').onclick=()=>createNote();
$('#noteTitle').addEventListener('input',e=>updateCurrent({title:e.target.value}));
$('#noteContent').addEventListener('input',e=>{updateCurrent({content:e.target.value});autoGrow()});
$('#pinBtn').onclick=togglePin;$('#duplicateBtn').onclick=duplicateNote;$('#deleteBtn').onclick=()=>deleteNote();
$('#searchInput').addEventListener('input',e=>{state.query=e.target.value;renderTabs()});
$('#themeBtn').onclick=toggleTheme;$('#menuBtn').onclick=e=>{e.stopPropagation();toggleMenu()};
$('#googleSignIn').onclick=signInGoogle;$('#signOutBtn').onclick=signOut;
$('#accountMenu').addEventListener('click',e=>{const b=e.target.closest('[data-menu-action]');if(!b)return;const a=b.dataset.menuAction;if(a==='new')createNote();if(a==='export')exportBackup();if(a==='import')$('#importInput').click();if(a==='theme')toggleTheme();if(a==='signout')signOut();toggleMenu(false)});
$('#importInput').addEventListener('change',async e=>{const f=e.target.files?.[0];if(f)await importBackup(f);e.target.value=''});
$('#scrollTabsLeft').onclick=()=>$('#tabs').scrollBy({left:-260,behavior:'smooth'});$('#scrollTabsRight').onclick=()=>$('#tabs').scrollBy({left:260,behavior:'smooth'});
document.addEventListener('click',e=>{if(!e.target.closest('#accountMenu')&&!e.target.closest('#menuBtn'))toggleMenu(false)});
document.addEventListener('keydown',e=>{
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key.toLowerCase()==='n'){e.preventDefault();createNote()}
  if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();$('#searchInput').focus();$('#searchInput').select()}
  if(mod&&e.key.toLowerCase()==='s'){e.preventDefault();const n=activeNote();if(n)queueCloudSave(n);toast(state.user?'Sincronização solicitada.':'Nota salva localmente.')}
  if(mod&&e.key==='Tab'){e.preventDefault();const sorted=sortNotes();const i=sorted.findIndex(n=>n.id===state.activeId);const next=e.shiftKey?(i-1+sorted.length)%sorted.length:(i+1)%sorted.length;if(sorted[next]){state.activeId=sorted[next].id;render()}}
  if(e.key==='Escape'){state.query='';$('#searchInput').value='';renderTabs();toggleMenu(false)}
});

if(localStorage.getItem(THEME_KEY)==='light')document.body.classList.add('light');
state.notes=readLocal();
state.activeId=state.notes.find(n=>n.id===localStorage.getItem(ACTIVE_KEY))?.id||sortNotes()[0]?.id||null;
persistLocal();render();initFirebase();
