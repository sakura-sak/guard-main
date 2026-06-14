(function () {
  const modal = document.getElementById('loginModal');
  const openBtn = document.getElementById('loginBtn');

  const open = (e) => {
    if (e) e.preventDefault();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const input = modal.querySelector('input');
    if (input) setTimeout(() => input.focus(), 50);
  };
  const close = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  // Open via main login button + every #login link
  document.querySelectorAll('a[href="#login"]').forEach((a) => a.addEventListener('click', open));
  if (openBtn) openBtn.addEventListener('click', open);

  modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
  });

  // Smooth-scroll for in-page anchors (excluding #login)
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href === '#login' || href === '#') return;
    a.addEventListener('click', (e) => {
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
})();
