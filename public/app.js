const $ = (selector) => document.querySelector(selector);

/* =========================================================
 * API layer
 * ========================================================= */
const api = {
  async request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(path, {
        ...options,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      throw new Error(
        err.name === 'AbortError'
          ? 'The request timed out.'
          : 'Network error. Check your connection.'
      );
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }

    if (!res.ok) {
      throw new Error((data && data.error) || `Server error (${res.status}).`);
    }
    return data;
  },

  getBooks: () => api.request('/api/books'),
  setRead: (id, read) =>
    api.request(`/api/books/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ read }),
    }),
  getProgress: () => api.request('/api/video-progress'),
  putProgress: (timestamp) =>
    api.request('/api/video-progress', {
      method: 'PUT',
      body: JSON.stringify({ timestamp }),
    }),
};

/* =========================================================
 * Toasts
 * ========================================================= */
const toasts = (() => {
  const container = $('#toasts');

  function show(message, { duration = 6000 } = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'alert');

    const text = document.createElement('p');
    text.textContent = message;

    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';

    const remove = () => el.remove();
    close.addEventListener('click', remove);
    setTimeout(remove, duration);

    el.append(text, close);
    container.append(el);
  }

  return { show };
})();

/* =========================================================
 * Welcome video + saved position
 * ========================================================= */
const video = (() => {
  const el = $('#welcome-video');
  const pill = $('#video-status');
  const banner = $('#video-error');
  const bannerText = $('#video-error-text');
  const retryBtn = $('#video-error-retry');

  let saving = false;
  let dirty = false;

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function setStatus(state, text) {
    if (!state) {
      pill.hidden = true;
      return;
    }
    pill.dataset.state = state;
    pill.textContent = text;
    pill.hidden = false;
  }

  function showError(message, canRetry) {
    bannerText.textContent = message;
    retryBtn.hidden = !canRetry;
    banner.hidden = false;
  }

  function hideError() {
    banner.hidden = true;
  }

  function metadataReady() {
    if (el.readyState >= 1) return Promise.resolve();
    return new Promise((resolve) =>
      el.addEventListener('loadedmetadata', resolve, { once: true })
    );
  }

  async function restore() {
    try {
      // Wait for BOTH the saved value and the video metadata before seeking.
      const [{ timestamp }] = await Promise.all([api.getProgress(), metadataReady()]);

      // Don’t yank the playhead if the viewer already started watching.
      if (el.currentTime > 0 || !el.paused) return;

      let target = Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0;
      if (Number.isFinite(el.duration)) target = Math.min(target, el.duration);

      if (target > 0) {
        el.currentTime = target;
        setStatus('saved', `Resumed from ${formatTime(target)}`);
      }
    } catch (err) {
      showError(`Couldn’t load your saved video position: ${err.message}`, false);
    }
  }

  async function save() {
    if (saving) {
      dirty = true; // a newer pause happened mid-request; save again afterwards
      return;
    }
    saving = true;
    try {
      do {
        dirty = false;
        const timestamp = el.currentTime;
        setStatus('saving', 'Saving…');
        try {
          await api.putProgress(timestamp);
          hideError();
          setStatus('saved', `Saved at ${formatTime(timestamp)}`);
        } catch (err) {
          setStatus(null);
          showError(`Couldn’t save your video position: ${err.message}`, true);
        }
      } while (dirty);
    } finally {
      saving = false;
    }
  }

  function init() {
    el.addEventListener('pause', save);
    retryBtn.addEventListener('click', save);
    el.addEventListener('error', () => {
      showError('The welcome video couldn’t be loaded.', false);
    });
    restore();
  }

  return { init };
})();

/* =========================================================
 * Reading lists
 * State only ever holds SERVER-CONFIRMED values. The UI never
 * shows a toggled state until the server returns 200 OK.
 * ========================================================= */
const books = (() => {
  const grid = $('#books-grid');
  const errorBox = $('#books-error');
  const errorText = $('#books-error-text');
  const retryBtn = $('#books-retry');

  const categories = {
    fiction: { list: $('#fiction-list'), badge: $('#fiction-count') },
    nonfiction: { list: $('#nonfiction-list'), badge: $('#nonfiction-count') },
  };

  const confirmed = new Map(); // id -> last server-confirmed book
  const rows = new Map();      // id -> { li, input }
  const pending = new Set();   // ids with a PATCH in flight

  /* ----- loading / error states ----- */
  function showLoading() {
    errorBox.hidden = true;
    grid.hidden = false;
    grid.setAttribute('aria-busy', 'true');
    for (const { list, badge } of Object.values(categories)) {
      badge.textContent = '– of – read';
      badge.classList.remove('is-complete');
      list.replaceChildren(
        ...[1, 2, 3].map(() => {
          const li = document.createElement('li');
          li.className = 'skeleton';
          li.setAttribute('aria-hidden', 'true');
          return li;
        })
      );
    }
  }

  function showLoadError(message) {
    grid.hidden = true;
    grid.setAttribute('aria-busy', 'false');
    errorText.textContent = `Couldn’t load your books: ${message}`;
    errorBox.hidden = false;
  }

  /* ----- rendering ----- */
  function createRow(book) {
    const li = document.createElement('li');
    li.className = 'book';

    const label = document.createElement('label');

    const input = document.createElement('input');
    input.type = 'checkbox';

    const text = document.createElement('span');
    text.className = 'book-text';
    const title = document.createElement('span');
    title.className = 'book-title';
    title.textContent = book.title;
    const author = document.createElement('span');
    author.className = 'book-author';
    author.textContent = book.author;
    text.append(title, author);

    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');

    label.append(input, text, spinner);
    li.append(label);

    input.addEventListener('change', () => onToggle(book.id, input));
    rows.set(book.id, { li, input });
    return li;
  }

  function updateRow(id) {
    const { li, input } = rows.get(id);
    const book = confirmed.get(id);
    const isPending = pending.has(id);

    input.checked = book.read;      // always the confirmed value
    input.disabled = isPending;
    li.classList.toggle('is-read', book.read);
    li.classList.toggle('is-pending', isPending);
    li.setAttribute('aria-busy', String(isPending));
  }

  function updateBadge(category) {
    const items = [...confirmed.values()].filter((b) => b.category === category);
    const done = items.filter((b) => b.read).length;
    const { badge } = categories[category];
    badge.textContent = `${done} of ${items.length} read`;
    badge.classList.toggle('is-complete', items.length > 0 && done === items.length);
  }

  function render(data) {
    confirmed.clear();
    rows.clear();
    for (const category of Object.keys(categories)) {
      const items = data[category] || [];
      for (const book of items) confirmed.set(book.id, { ...book });
      categories[category].list.replaceChildren(...items.map(createRow));
      items.forEach((b) => updateRow(b.id));
      updateBadge(category);
    }
    grid.setAttribute('aria-busy', 'false');
  }

  /* ----- toggle: server first, UI second ----- */
  async function onToggle(id, input) {
    const book = confirmed.get(id);
    const desired = input.checked;
    const hadFocus = document.activeElement === input;

    // Undo the browser’s instant flip; show confirmed state until the server answers.
    input.checked = book.read;
    if (pending.has(id)) return;

    pending.add(id);
    updateRow(id);

    try {
      const updated = await api.setRead(id, desired);
      if (!updated || typeof updated.read !== 'boolean') {
        throw new Error('Unexpected response from the server.');
      }
      book.read = updated.read; // only now does the UI change
    } catch (err) {
      // book.read is untouched => UI stays on the last confirmed server value
      toasts.show(
        `Couldn’t update “${book.title}”: ${err.message} It’s still marked ${book.read ? 'read' : 'unread'}.`
      );
    } finally {
      pending.delete(id);
      updateRow(id);
      updateBadge(book.category);
      if (hadFocus) rows.get(id).input.focus();
    }
  }

  /* ----- initial load ----- */
  async function load() {
    showLoading();
    try {
      render(await api.getBooks());
    } catch (err) {
      showLoadError(err.message);
    }
  }

  function init() {
    retryBtn.addEventListener('click', load);
    load();
  }

  return { init };
})();

/* =========================================================
 * Boot
 * ========================================================= */
video.init();
books.init();
