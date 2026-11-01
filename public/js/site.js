// Chez Moi Karaköy — navigation, the live open/closed line, and the collage motion.
(() => {
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const live = !!(window.gsap && window.ScrollTrigger && window.Stage);
  const body = document.body;

  // ---------- Live status: Istanbul time against 12:00 – 05:00 ----------
  const statusEl = document.querySelector('[data-status]');
  function istanbulMinutes() {
    const parts = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour').value);
    const m = Number(parts.find((p) => p.type === 'minute').value);
    return { h, m, total: h * 60 + m };
  }
  const span = (min) => (Math.floor(min / 60) ? `${Math.floor(min / 60)} sa ${min % 60} dk` : `${min % 60} dk`);
  function renderStatus() {
    if (!statusEl) return;
    const { h, m, total } = istanbulMinutes();
    const OPEN = 12 * 60;
    const CLOSE = 5 * 60;
    const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (total >= OPEN || total < CLOSE) {
      const left = total >= OPEN ? 24 * 60 - total + CLOSE : CLOSE - total;
      statusEl.innerHTML = `Karaköy'de saat ${clock}. <strong>Şu an açığız</strong>, kapanışa ${span(left)} var.`;
    } else {
      statusEl.innerHTML = `Karaköy'de saat ${clock}. Kapalıyız, <strong>12:00'de açılıyoruz</strong> (${span(OPEN - total)} sonra).`;
    }
  }
  renderStatus();
  setInterval(renderStatus, 30000);

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();

  // ---------- Footer wordmark: fit the SVG box to the word ----------
  function fitMark() {
    const svg = document.querySelector('.footer-mark svg');
    const text = svg && svg.querySelector('text');
    if (!text) return;
    const box = text.getBBox();
    if (box.width) svg.setAttribute('viewBox', `${box.x} ${box.y + box.height * 0.12} ${box.width} ${box.height * 0.88}`);
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(fitMark);

  // ---------- Header: solid once the page moves; phone menu ----------
  const header = document.querySelector('[data-header]');
  const toggle = document.querySelector('.nav-toggle');
  const onScroll = () => header && header.classList.toggle('is-solid', window.scrollY > 40);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  function setNav(open) {
    body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (window.Stage && Stage.lenis) open ? Stage.lenis.stop() : Stage.lenis.start();
  }
  if (toggle) {
    toggle.addEventListener('click', () => setNav(!body.classList.contains('nav-open')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && body.classList.contains('nav-open')) { setNav(false); toggle.focus(); } });
    document.querySelectorAll('.site-nav a').forEach((a) => a.addEventListener('click', () => setNav(false)));
  }

  // ---------- Gallery lightbox ----------
  const lightbox = document.getElementById('lightbox');
  if (lightbox) {
    const media = document.getElementById('lightbox-media');
    const caption = document.getElementById('lightbox-caption');
    document.querySelectorAll('.pin[data-full]').forEach((pin) => {
      pin.addEventListener('click', () => {
        const alt = pin.querySelector('img')?.alt || '';
        const img = new Image();
        img.src = pin.dataset.full;
        img.alt = alt;
        media.replaceChildren(img);
        caption.textContent = alt;
        lightbox.showModal();
      });
    });
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
  }

  if (!live) return;
  gsap.registerPlugin(ScrollTrigger);
  Stage.smooth();

  // Menu category links: scroll under the sticky bar, and mark the category in view
  const menuNav = document.querySelector('.menu-nav');
  if (menuNav) {
    menuNav.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', (e) => {
        const target = document.querySelector(a.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        const stuck = getComputedStyle(menuNav).position === 'sticky';
        const offset = -((header ? header.offsetHeight : 0) + (stuck ? menuNav.offsetHeight : 0) + 24);
        if (Stage.lenis) Stage.lenis.scrollTo(target, { offset });
        else window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY + offset, behavior: reduced() ? 'auto' : 'smooth' });
        history.replaceState(null, '', a.getAttribute('href'));
      });
    });
    const chips = menuNav.querySelector('ul');
    document.querySelectorAll('.cat').forEach((cat) => {
      const link = menuNav.querySelector(`a[href="#${cat.id}"]`);
      ScrollTrigger.create({
        trigger: cat, start: 'top 40%', end: 'bottom 40%',
        onToggle: (self) => {
          if (!link) return;
          link.classList.toggle('is-current', self.isActive);
          // Bring the chip into view inside the bar only. scrollIntoView would also scroll the page,
          // and on phones (where the bar is not sticky) it pulled the reader back up to the bar.
          if (self.isActive && chips.scrollWidth > chips.clientWidth) {
            chips.scrollTo({ left: link.offsetLeft - (chips.clientWidth - link.offsetWidth) / 2, behavior: 'smooth' });
          }
        },
      });
    });
  }

  // ---------- Marquee band: speeds up with the scroll, turns with it ----------
  const tracks = [...document.querySelectorAll('[data-marquee]')];
  if (tracks.length) {
    let x = 0, copyWidth = 0, direction = 1, boost = 0, paused = false;
    const measure = () => { copyWidth = tracks[0].firstElementChild.getBoundingClientRect().width; };
    measure();
    window.addEventListener('resize', measure);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(measure);
    const band = document.querySelector('.band');
    band.addEventListener('pointerenter', () => { paused = true; });
    band.addEventListener('pointerleave', () => { paused = false; });
    ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate(self) {
        const v = self.getVelocity();
        if (Math.abs(v) > 20) direction = v > 0 ? 1 : -1;
        boost = Math.min(Math.abs(v) / 40, 28);
      },
    });
    gsap.ticker.add((_t, delta) => {
      if (!copyWidth || reduced()) return;
      const speed = paused ? 0 : 40 + boost * 14;
      boost *= 0.92;
      x -= direction * speed * (delta / 1000);
      if (x <= -copyWidth) x += copyWidth;
      if (x > 0) x -= copyWidth;
      tracks.forEach((t) => { t.style.transform = `translate3d(${x}px,0,0)`; });
    });
  }

  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // Hero: photo settles and sinks; the collage pieces drop onto the page on load
    if (document.querySelector('.hero')) {
      gsap.fromTo('[data-hero-img]', { scale: 1.15 }, { scale: 1, duration: 1.6, ease: 'power3.out' });
      gsap.to('.hero-media img', { yPercent: 16, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      gsap.to('.hero-content', { yPercent: -18, autoAlpha: 0.3, ease: 'none', scrollTrigger: { trigger: '.hero', start: '35% top', end: 'bottom top', scrub: true } });
      gsap.from('.hero-title, .hero-lede, .hero-actions, .status', { y: 40, autoAlpha: 0, duration: 1, stagger: 0.08, ease: 'power3.out', delay: 0.1 });
    }
    // (yPercent and scale only: y and rotation belong to the scroll drift below)
    gsap.from('.hero > .cut, .hero > .print, .page-collage > *', {
      yPercent: -45, scale: 0.7, autoAlpha: 0,
      duration: 1.1, stagger: 0.09, ease: 'back.out(1.4)', delay: 0.25,
    });
    gsap.from('.page-title, .page-lede', { y: 40, autoAlpha: 0, duration: 1, stagger: 0.08, ease: 'power3.out' });

    // Every collage piece drifts at its own speed and turns a little while the page scrolls
    document.querySelectorAll('[data-speed]').forEach((el) => {
      const speed = Number(el.dataset.speed) || 0;
      const spin = Number(el.dataset.spin) || 0;
      gsap.fromTo(el, { y: () => speed * window.innerHeight * 0.6, rotation: -spin / 2 }, {
        y: () => -speed * window.innerHeight * 0.6,
        rotation: spin / 2,
        ease: 'none',
        scrollTrigger: { trigger: el.closest('section, footer') || el, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true },
      });
    });

    // Entrances: heading, then text, then the rest, staggered per section
    document.querySelectorAll('main > section, .footer').forEach((section) => {
      const parts = section.querySelectorAll('[data-reveal]');
      if (!parts.length || section.classList.contains('menu-body')) return;
      gsap.from(parts, { y: 28, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, scrollTrigger: { trigger: section, start: 'top 80%', once: true } });
    });
    document.querySelectorAll('.cat').forEach((cat) => {
      gsap.from(cat.querySelectorAll('[data-reveal]'), { y: 22, autoAlpha: 0, duration: 0.7, ease: 'power3.out', stagger: 0.04, scrollTrigger: { trigger: cat, start: 'top 85%', once: true } });
    });

    // Statements light up word by word as they are read
    document.querySelectorAll('[data-words]').forEach((p) => {
      const words = [];
      const walk = (node) => {
        [...node.childNodes].forEach((child) => {
          if (child.nodeType === 3) {
            const frag = document.createDocumentFragment();
            child.textContent.split(/(\s+)/).forEach((piece) => {
              if (!piece) return;
              if (/^\s+$/.test(piece)) { frag.append(piece); return; }
              const s = document.createElement('span');
              s.textContent = piece;
              words.push(s);
              frag.append(s);
            });
            child.replaceWith(frag);
          } else if (child.nodeType === 1) walk(child);
        });
      };
      walk(p);
      gsap.fromTo(words, { opacity: 0.16 }, { opacity: 1, stagger: 0.05, ease: 'none', scrollTrigger: { trigger: p, start: 'top 80%', end: 'bottom 50%', scrub: true } });
    });

    // Before / after stickers swing in towards each other
    if (document.querySelector('.then-now')) {
      gsap.from('.tn--then', { xPercent: -60, rotation: -20, ease: 'none', scrollTrigger: { trigger: '.then-now', start: 'top bottom', end: 'center center', scrub: true } });
      gsap.from('.tn--now', { xPercent: 60, rotation: 20, ease: 'none', scrollTrigger: { trigger: '.then-now', start: 'top bottom', end: 'center center', scrub: true } });
    }

    // Contact rows slide in one after another
    if (document.querySelector('.contact')) {
      gsap.from('.contact .row', { xPercent: 6, ease: 'none', stagger: 0.1, scrollTrigger: { trigger: '.contact', start: 'top bottom', end: 'center center', scrub: true } });
    }

    // Footer contents trail the page as it comes up
    gsap.fromTo(['.footer-cols', '.footer-mark'], { yPercent: -40 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true } });
  });

  // ---------- Scene (about page): the façade is restored floor by floor ----------
  Scenes.restore = (root, opts = {}) => Stage.scene(root, {
    hold: opts.hold ?? 2,
    beats: 2,
    build(tl, { q, phone }) {
      const [before] = q('.restore-before');
      const [after] = q('.restore-after');
      const [aside] = q('.restore-aside');
      tl.fromTo(before, { scale: 1.12 }, { scale: 1, duration: 1 }, 0)
        .fromTo(after, { clipPath: 'inset(100% 0% 0% 0%)', scale: 1.12 }, { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 0.62, ease: 'power1.inOut' }, 0.2);
      if (aside && !phone) tl.fromTo(aside, { yPercent: 60, rotation: -20 }, { yPercent: -60, rotation: 15, duration: 1 }, 0);
    },
  });

  Stage.init();
  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
