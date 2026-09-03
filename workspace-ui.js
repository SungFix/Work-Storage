// Complementos de navegação responsiva e exploração por tags.
(function(){
  const sidebar=document.querySelector('.sidebar');
  const topbar=document.querySelector('.topbar');
  const folderNav=document.getElementById('folderNav');
  if(!sidebar||!topbar||!folderNav)return;

  const style=document.createElement('style');
  style.textContent=`
    .mobile-nav-button{display:none}.mobile-nav-backdrop{display:none}
    .tag-nav{display:grid;gap:2px;max-height:170px;overflow:auto}
    .tag-nav button{height:32px;border:0;background:transparent;color:var(--muted);border-radius:8px;display:grid;grid-template-columns:16px 1fr auto;gap:7px;align-items:center;text-align:left;padding:0 10px;font-size:11px}
    .tag-nav button:hover,.tag-nav button.active{background:var(--panel-2);color:var(--text)}
    .tag-nav button span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tag-nav small{font-size:8px;color:var(--muted)}
    @media(max-width:800px){.mobile-nav-button{display:inline-grid;place-items:center;flex:0 0 36px}.sidebar.open{transform:translateX(0)}.mobile-nav-backdrop{display:block;position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:89}}
  `;
  document.head.append(style);

  const mobileButton=document.createElement('button');
  mobileButton.id='mobileNavBtn';
  mobileButton.className='icon-button mobile-nav-button';
  mobileButton.type='button';
  mobileButton.setAttribute('aria-label','Abrir navegação');
  mobileButton.setAttribute('aria-expanded','false');
  mobileButton.textContent='☰';
  topbar.prepend(mobileButton);

  const tagHead=document.createElement('div');
  tagHead.className='sidebar-section-head tag-section-head';
  tagHead.innerHTML='<span>Tags</span>';
  const tagNav=document.createElement('div');
  tagNav.id='tagNav';
  tagNav.className='tag-nav';
  const foot=sidebar.querySelector('.sidebar-foot');
  sidebar.insertBefore(tagHead,foot);
  sidebar.insertBefore(tagNav,foot);

  const backdrop=document.createElement('div');
  backdrop.className='mobile-nav-backdrop hidden';
  backdrop.id='mobileNavBackdrop';
  document.body.append(backdrop);

  function setMobileNav(open){sidebar.classList.toggle('open',open);backdrop.classList.toggle('hidden',!open);mobileButton.setAttribute('aria-expanded',String(open))}
  mobileButton.addEventListener('click',()=>setMobileNav(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click',()=>setMobileNav(false));
  sidebar.addEventListener('click',e=>{if(e.target.closest('[data-filter]')&&innerWidth<=800)setMobileNav(false)});
  window.addEventListener('resize',()=>{if(innerWidth>800)setMobileNav(false)});

  function renderTags(){
    if(typeof state==='undefined')return;
    const counts=new Map();
    state.items.forEach(item=>(item.tags||[]).forEach(tag=>counts.set(tag,(counts.get(tag)||0)+1)));
    const tags=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,12);
    tagHead.classList.toggle('hidden',!tags.length);
    tagNav.classList.toggle('hidden',!tags.length);
    tagNav.innerHTML=tags.map(([tag,count])=>`<button data-filter="tag:${esc(tag)}" class="${state.filter===`tag:${tag}`?'active':''}"><span>#</span><span>${esc(tag)}</span><small>${count}</small></button>`).join('');
  }

  if(typeof renderSidebar==='function'){
    const baseRenderSidebar=renderSidebar;
    renderSidebar=function(){baseRenderSidebar();renderTags()};
  }
  renderTags();
})();
