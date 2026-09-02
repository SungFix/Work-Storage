// Complemento de autenticação para GitHub Pages.
// Mostra erros reais do Firebase e usa redirecionamento se o navegador bloquear popups.
(function () {
  const button = document.getElementById('googleSignIn');
  if (!button || typeof firebase === 'undefined') return;

  const messages = {
    'auth/unauthorized-domain': 'Este domínio ainda não está autorizado no Firebase. Adicione sungfix.github.io em Authentication > Configurações > Domínios autorizados.',
    'auth/operation-not-allowed': 'O login com Google ainda não está ativado. Vá em Authentication > Método de login > Google e ative.',
    'auth/popup-blocked': 'O navegador bloqueou a janela de login. Vou abrir o login por redirecionamento.',
    'auth/popup-closed-by-user': 'A janela de login foi fechada antes de concluir. Se ela fechou sozinha, confira os Domínios autorizados no Firebase.',
    'auth/network-request-failed': 'Falha de rede ao falar com o Firebase. Confira sua conexão e tente novamente.'
  };

  button.onclick = async function () {
    if (!auth) {
      alert('O Firebase Auth ainda não iniciou. Recarregue a página e tente novamente.');
      return;
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Abrindo Google...';

    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      console.error('Firebase Auth:', err);
      const code = err && err.code ? err.code : 'erro-desconhecido';

      if (code === 'auth/popup-blocked') {
        try {
          await auth.signInWithRedirect(provider);
          return;
        } catch (redirectErr) {
          console.error('Firebase Auth redirect:', redirectErr);
        }
      }

      const message = messages[code] || `Falha no login do Firebase: ${code}`;
      alert(message);
      if (typeof toast === 'function') toast(message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };
})();
