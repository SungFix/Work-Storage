// Camada visual complementar: mobile, tags, métricas e contexto da navegação.
(function(){
  const sidebar=document.querySelector('.sidebar');
  const topbar=document.querySelector('.topbar');
  const folderNav=document.getElementById('folderNav');
  if(!sidebar||!topbar||!folderNav)return;

  // Busca textual sem varrer o conteúdo base64 de anexos.
  if(typeof searchable==='function'){
    searchable=function(item){
      const parts=[item.title,(item.tags||[]).join(' ')];
      (item.blocks||[]).forEach(block=>{
        if(block.type==='file'){parts.push(block.name||'',block.mime||'');return}
        if(block.type==='checklist'){parts.push(...(block.items||[]).map(x=>x.text||''));return}
        if(block.type==='fields'){parts.push(...(block.rows||[]).flatMap(x=>[x.key||'',x.value||'']));return}
        ['text','username','url','label','language','code'].forEach(key=>parts.push(block[key]||''));
      });
      return parts.join(' ').toLowerCase();
    };
  }

  // Menu móvel.
  const mobileButton=document.createElement('button');
  mobileButton.id='mobileNavBtn';
  mobileButton.className='icon-button mobile-nav-button';
  mobileButton.type='button';
  mobileButton.setAttribute('aria-label','Abrir navegação');
  mobileButton.setAttribute('aria-expanded','false');
  mobileButton.textContent='☰';
  topbar.prepend(mobileButton);

  const backdrop=document.createElement('div');
  backdrop.className='mobile-nav-backdrop hidden';
  backdrop.id='mobileNavBackdrop';
  document.body.append(backdrop);

  function setMobileNav(open){
    sidebar.classList.toggle('open',open);
    backdrop.classList.toggle('hidden',!open);
    mobileButton.setAttribute('aria-expanded',String(open));
  }
  mobileButton.addEventListener('click',()=>setMobileNav(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click',()=>setMobileNav(false));
  sidebar.addEventListener('click',e=>{if(e.target.closest('[data-filter]')&&innerWidth<=800)setMobileNav(false)});
  window.addEventListener('resize',()=>{if(innerWidth>800)setMobileNav(false)});

  // Tags dentro da sidebar.
  const tagHead=document.createElement('div');
  tagHead.className='sidebar-section-head tag-section-head';
  tagHead.innerHTML='<span>Tags</span>';
  const tagNav=document.createElement('div');
  tagNav.id='tagNav';
  tagNav.className='tag-nav';
  const foot=sidebar.querySelector('.sidebar-foot');
  sidebar.insertBefore(tagHead,foot);
  sidebar.insertBefore(tagNav,foot);

  function renderTags(){
    if(typeof state==='undefined')return;
    const counts=new Map();
    state.items.forEach(item=>(item.tags||[]).forEach(tag=>counts.set(tag,(counts.get(tag)||0)+1)));
    const tags=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,12);
    tagHead.classList.toggle('hidden',!tags.length);
    tagNav.classList.toggle('hidden',!tags.length);
    tagNav.innerHTML=tags.map(([tag,count])=>`<button data-filter="tag:${esc(tag)}" class="${state.filter===`tag:${tag}`?'active':''}"><span>#</span><span>${esc(tag)}</span><small>${count}</small></button>`).join('');
  }

  function updateOverview(){
    if(typeof state==='undefined')return;
    const items=document.getElementById('statItems');
    const pinned=document.getElementById('statPinned');
    const folders=document.getElementById('statFolders');
    if(items)items.textContent=String(state.items.length);
    if(pinned)pinned.textContent=String(state.items.filter(item=>item.pinned).length);
    if(folders)folders.textContent=String(state.folders.length);
  }

  function updateContext(){
    if(typeof state==='undefined')return;
    const target=document.getElementById('topbarContext');
    if(!target)return;
    let label='Início';
    if(state.search)label='Busca';
    else if(state.filter==='all')label='Biblioteca';
    else if(state.filter==='pinned')label='Fixados';
    else if(state.filter.startsWith('folder:'))label=typeof folderName==='function'?folderName(state.filter.slice(7)):'Pasta';
    else if(state.filter.startsWith('tag:'))label=`#${state.filter.slice(4)}`;
    target.textContent=label;
  }

  if(typeof renderSidebar==='function'){
    const baseRenderSidebar=renderSidebar;
    renderSidebar=function(){baseRenderSidebar();renderTags()};
  }

  if(typeof renderHome==='function'){
    const baseRenderHome=renderHome;
    renderHome=function(){baseRenderHome();updateOverview()};
  }

  if(typeof renderMain==='function'){
    const baseRenderMain=renderMain;
    renderMain=function(){baseRenderMain();updateContext();updateOverview()};
  }

  renderTags();
  updateOverview();
  updateContext();
})();
