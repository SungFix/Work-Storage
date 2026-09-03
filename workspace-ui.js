// Complementos de navegação responsiva e exploração por tags.
(function(){
  const sidebar=document.querySelector('.sidebar');
  const topbar=document.querySelector('.topbar');
  const folderNav=document.getElementById('folderNav');
  if(!sidebar||!topbar||!folderNav)return;

  const mobileButton=document.createElement('button');
  mobileButton.id='mobileNavBtn';
  mobileButton.className='icon-button mobile-nav-button';
  mobileButton.type='button';
  mobileButton.setAttribute('aria-label','Abrir navegação');
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
