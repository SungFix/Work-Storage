// Atalhos que não conflitam com comandos reservados do navegador.
(function () {
  function updateShortcutLabels() {
    const newTabBtn = document.getElementById('newTabBtn');
    if (newTabBtn) newTabBtn.title = 'Nova nota (Alt+N)';

    const menuButton = document.querySelector('[data-menu-action="new"]');
    if (menuButton) {
      const kbd = menuButton.querySelector('kbd');
      if (kbd) kbd.textContent = 'Alt N';
    }

    // Corrige a nota de boas-vindas criada por versões anteriores.
    if (typeof state !== 'undefined' && Array.isArray(state.notes)) {
      let changed = false;
      for (const note of state.notes) {
        if (note && note.title === 'Bem-vindo ao Work Storage' && typeof note.content === 'string' && note.content.includes('Ctrl+N')) {
          note.content = note.content.replace(/Ctrl\+N/g, 'Alt+N');
          changed = true;
        }
      }
      if (changed) {
        if (typeof persistLocal === 'function') persistLocal();
        if (typeof render === 'function') render();
        if (state.user && typeof queueCloudSave === 'function') {
          const welcome = state.notes.find(n => n && n.title === 'Bem-vindo ao Work Storage');
          if (welcome) queueCloudSave(welcome);
        }
      }
    }
  }

  document.addEventListener('keydown', function (event) {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      if (typeof createNote === 'function') createNote();
    }
  }, true);

  updateShortcutLabels();
  setTimeout(updateShortcutLabels, 800);
  setTimeout(updateShortcutLabels, 2000);
})();
