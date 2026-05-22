const App = {
  state: {
    rules: [],
    activeRuleId: null,
    files: [],
  },

  init() {
    Rules.loadRules();
  },

  showWelcome() {
    document.getElementById('welcome').style.display = '';
    document.getElementById('searchResult').style.display = 'none';
  },

  showResults() {
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('searchResult').style.display = '';
  },

  setStatus(text) {
    document.getElementById('statusText').textContent = text;
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