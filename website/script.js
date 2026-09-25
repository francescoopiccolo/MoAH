const button = document.querySelector('.copy-button');

if (button) {
  button.addEventListener('click', async () => {
    const text = button.dataset.copy;
    const status = document.querySelector('.copy-status');

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }

    button.querySelector('span').textContent = 'COPIED';
    button.classList.add('is-copied');
    status.textContent = 'Install command copied.';

    window.setTimeout(() => {
      button.querySelector('span').textContent = 'COPY';
      button.classList.remove('is-copied');
      status.textContent = '';
    }, 1800);
  });
}
