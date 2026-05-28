const App = {
  state: {
    rules: [],
    activeRuleIds: [],
    activeRuleColors: {},
    files: [],
  },

  init() {
    Rules.loadRules();
    this.setupDropZone();
    Table.initColumnResize();
    Search.initClearButtons();
    Search._initIssueTracker();
    this._initSkin();
  },

  setupDropZone() {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
      Files.handleDrop(e);
    });

    document.body.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    document.body.addEventListener('drop', (e) => {
      e.preventDefault();
    });
  },

  showWelcome() {
    document.getElementById('welcome').style.display = '';
    document.getElementById('searchResult').style.display = 'none';
    document.getElementById('filterBar').style.display = App.state.files.length ? '' : 'none';
  },

  showResults() {
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('searchResult').style.display = '';
    document.getElementById('filterBar').style.display = App.state.files.length ? '' : 'none';

    // 表格可见后确保初始化列宽拖拽
    setTimeout(() => Table.initColumnResize(), 0);
  },

  setStatus(text) {
    document.getElementById('statusText').textContent = text;
  },

  _initSkin() {
    this._loadSkin();
    const btn = document.getElementById('skinBtn');
    if (!btn || btn._skinReady) return;
    btn._skinReady = true;
    btn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target.result;
          try { localStorage.setItem('h_logs_skin', dataUrl); } catch {}
          App._applySkin(dataUrl);
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      try { localStorage.removeItem('h_logs_skin'); } catch {}
      App._applySkin('');
      showToast('背景已清除', 'success');
    });
  },

  _applySkin(dataUrl) {
    const el = document.getElementById('mainLayout');
    if (!el) return;
    if (dataUrl) {
      el.style.backgroundImage = `url(${dataUrl})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundRepeat = 'no-repeat';
      el.classList.add('has-skin');
    } else {
      el.style.backgroundImage = '';
      el.classList.remove('has-skin');
    }
  },

  _loadSkin() {
    try {
      const saved = localStorage.getItem('h_logs_skin');
      if (saved) this._applySkin(saved);
    } catch {}
  },
};

function showModal(title, bodyHtml, onConfirm) {
  const overlay = document.getElementById('modalOverlay');
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <h3>${title}</h3>
    <div class="modal-body">${bodyHtml}</div>
    <div class="form-actions">
      <button class="btn" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalConfirm">确定</button>
    </div>`;
  overlay.style.display = '';

  document.getElementById('modalCancel').onclick = () => {
    overlay.style.display = 'none';
  };
  document.getElementById('modalConfirm').onclick = async () => {
    try {
      await onConfirm(box);
      overlay.style.display = 'none';
    } catch (e) {
      // onConfirm 内部处理 toast，这里不重复
    }
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  };
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => App.init());