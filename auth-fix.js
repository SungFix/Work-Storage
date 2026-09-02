// Complemento de autenticação para GitHub Pages.
// Mostra erros reais do Firebase e usa redirecionamento quando o popup não funciona.
(function () {
  const button = document.getElementById('googleSignIn');
  if (!button || typeof firebase === 'undefined') return;

  const messages = {
    'auth/unauthorized-domain': 'Este domínio ainda não está autorizado no Firebase. Adicione sungfix.github.io em Authentication > Configurações > Domínios autorizados.',
    'auth/operation-not-allowed': 'O login com Google ainda não está ativado. Vá em Authentication > Método de login > Google e ative.',
    'auth/network-request-failed': 'Falha de rede ao falar com o Firebase. Confira sua conexão e tente novamente.',
    'auth/web-storage-unsupported': 'O navegador está bloqueando o armazenamento necessário para o login. Permita cookies/dados do site para Firebase e Google e tente novamente.'
  };

  function showAuthError(err) {
    console.error('Firebase Auth:', err);
    const code = err && err.code ? err.code : 'erro-desconhecido';
    const message = messages[code] || `Falha no login do Firebase: ${code}`;
    alert(message);
  }

  async function redirectToGoogle(provider) {
    button.disabled = true;
    button.textContent = 'Redirecionando para o Google...';
    try {
      await auth.signInWithRedirect(provider);
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Entrar com Google';
      showAuthError(err);
    }
  }

  // Se voltarmos de um redirecionamento com erro, mostre o motivo.
  const checkRedirect = setInterval(async () => {
    if (!auth) return;
    clearInterval(checkRedirect);
    try {
      await auth.getRedirectResult();
    } catch (err) {
      showAuthError(err);
    }
  }, 50);

  button.onclick = async function () {
    if (!auth) {
      alert('O Firebase Auth ainda não iniciou. Recarregue a página e tente novamente.');
      return;
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    button.disabled = true;
    button.textContent = 'Abrindo Google...';

    const startedAt = Date.now();
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      const code = err && err.code ? err.code : '';
      const popupFailed = code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
      const closedImmediately = code === 'auth/popup-closed-by-user' && Date.now() - startedAt < 5000;

      if (popupFailed || closedImmediately) {
        await redirectToGoogle(provider);
        return;
      }

      showAuthError(err);
    } finally {
      // signInWithRedirect navega para outra página; se não navegou, restaura o botão.
      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          button.disabled = false;
          button.textContent = 'Entrar com Google';
        }
      }, 1200);
    }
  };
})();
