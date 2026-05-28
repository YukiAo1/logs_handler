const RULE_COLORS = [
  { bg: '#ffee58', border: '#f9a825', text: '#3e2723' },
  { bg: '#66bb6a', border: '#2e7d32', text: '#1b5e20' },
  { bg: '#42a5f5', border: '#1565c0', text: '#0d47a1' },
  { bg: '#ef5350', border: '#c62828', text: '#b71c1c' },
  { bg: '#ab47bc', border: '#6a1b9a', text: '#4a148c' },
];

const Table = {
  currentPattern: [],
  _items: [],

  render(items, patterns) {
    this.currentPattern = patterns || [];
    const tbody = document.getElementById('logTableBody');
    this._items = items;

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text2)">无匹配结果</td></tr>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const tr = document.createElement('tr');
      tr.innerHTML = [
        `<td>${item.line_no}</td>`,
        `<td>${escapeHtml(item.date)}</td>`,
        `<td>${escapeHtml(item.time)}</td>`,
        `<td><span class="level-badge level-${item.level}">${item.level}</span></td>`,
        `<td>${item.pid}</td>`,
        `<td>${item.tid}</td>`,
        `<td>${escapeHtml(item.tag)}</td>`,
        `<td class="col-msg-cell">${this._highlight(item.message, item.matched_rule_id)}</td>`,
        `<td class="col-actions">
          <div class="action-wrap">
            <span class="action-btn act-copy" title="复制原始行">📋</span>
            <span class="action-btn act-trace" title="跟踪上下文">🔍</span>
            <span class="action-btn act-save" title="记录经典场景">💾</span>
          </div>
        </td>`,
      ].join('');
      tr.dataset.rowIdx = i;
      frag.appendChild(tr);
    }

    tbody.innerHTML = '';
    tbody.appendChild(frag);

    if (!tbody._delegationReady) {
      tbody._delegationReady = true;
      tbody.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('scenario-indicator')) {
          const idsStr = target.dataset.scenarioIds;
          if (idsStr) {
            const ids = idsStr.split(',').map(Number).filter(Boolean);
            if (ids.length) Scenarios.showNoteDialog(ids);
          }
          return;
        }
        const btn = target.closest('.action-btn');
        if (!btn) return;
        const tr = btn.closest('tr');
        if (!tr) return;
        const idx = parseInt(tr.dataset.rowIdx);
        if (isNaN(idx) || !Table._items[idx]) return;
        e.preventDefault();
        if (btn.classList.contains('act-copy')) {
          Table._handleCopy(idx);
        } else if (btn.classList.contains('act-trace')) {
          Table._handleTrace(idx);
        } else if (btn.classList.contains('act-save')) {
          Table._handleSaveScenario(idx);
        }
      });
    }

    this._matchScenariosAsync();
  },

  _handleCopy(idx) {
    const item = this._items[idx];
    if (!item) return;
    const text = item.raw || item.message;
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制到剪贴板', 'success');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('已复制到剪贴板', 'success');
    });
  },

  async _handleTrace(idx) {
    const item = this._items[idx];
    if (!item || !item.file_path) {
      showToast('无法获取文件路径', 'error');
      return;
    }
    try {
      const result = await API.get('/api/files/context', {
        path: item.file_path,
        line_no: item.line_no,
        before: 200,
        after: 200,
      });
      this._showTraceModal(result);
    } catch (e) {
      showToast('跟踪失败: ' + e.message, 'error');
    }
  },

  _handleSaveScenario(idx) {
    const item = this._items[idx];
    if (!item) return;
    Scenarios.showCreateDialog(item.message);
  },

  async _matchScenariosAsync() {
    if (!Scenarios._scenarios.length) return;
    const messages = this._items.map(item => item.message).filter(Boolean);
    if (!messages.length) return;
    try {
      const result = await API.post('/api/scenarios/match', messages);
      const matches = result.matches || {};
      const tbody = document.getElementById('logTableBody');
      if (!tbody) return;
      const rows = tbody.querySelectorAll('tr');
      for (let i = 0; i < this._items.length && i < rows.length; i++) {
        const item = this._items[i];
        const matchedIds = matches[item.message];
        if (matchedIds && matchedIds.length) {
          const msgCell = rows[i].querySelector('.col-msg-cell');
          if (msgCell) {
            const ids = matchedIds.join(',');
            msgCell.insertAdjacentHTML('beforeend',
              `<span class="scenario-indicator" data-scenario-ids="${ids}" title="查看经典场景">💡</span>`
            );
          }
        }
      }
    } catch {
    }
  },

  _showTraceModal(result) {
    this._traceData = result;
    const overlay = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    const center = result.center_line;

    box.innerHTML = `
      <div class="trace-modal">
        <div class="trace-header">
          <h3>日志跟踪 - 行 ${center}</h3>
          <span class="trace-file">${escapeHtml(result.file_path)}</span>
          <span class="trace-filter">
            <input type="text" id="traceFilter" placeholder="正则过滤" oninput="Table._filterTraceRows()">
          </span>
          <span class="trace-count" id="traceCount">${result.lines.length} 行 / ${result.total_lines.toLocaleString()} 行</span>
        </div>
        <div class="trace-body">
          <table class="trace-table">
            <thead>
              <tr>
                <th class="trace-lno">行号</th>
                <th>时间</th>
                <th>级别</th>
                <th>PID</th>
                <th>TID</th>
                <th>Tag</th>
                <th>消息</th>
              </tr>
            </thead>
            <tbody id="traceTbody">${this._buildTraceRows(result.lines, center)}</tbody>
          </table>
        </div>
        <div class="trace-footer">
          <button class="btn" id="modalCancel">关闭</button>
        </div>
      </div>
    `;

    overlay.style.display = '';
    document.getElementById('modalCancel').onclick = () => { overlay.style.display = 'none'; };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };

    setTimeout(() => {
      const tbody = document.getElementById('traceTbody');
      const centerRow = tbody.querySelector('.trace-center');
      if (centerRow) centerRow.scrollIntoView({ block: 'center' });
    }, 50);
  },

  _buildTraceRows(lines, center) {
    return lines.map(line => {
      const cls = line.line_no === center ? 'trace-row trace-center' : 'trace-row';
      return `<tr class="${cls}">
        <td class="trace-lno">${line.line_no}</td>
        <td>${escapeHtml(line.date)} ${escapeHtml(line.time)}</td>
        <td><span class="level-badge level-${line.level}">${line.level}</span></td>
        <td>${line.pid}</td>
        <td>${line.tid}</td>
        <td>${escapeHtml(line.tag)}</td>
        <td>${escapeHtml(line.message)}</td>
      </tr>`;
    }).join('');
  },

  _filterTraceRows() {
    const input = document.getElementById('traceFilter');
    const tbody = document.getElementById('traceTbody');
    const countEl = document.getElementById('traceCount');
    if (!input || !tbody || !this._traceData) return;

    const raw = input.value;
    let re;
    try {
      re = raw ? new RegExp(raw, 'i') : null;
    } catch {
      return;
    }

    const center = this._traceData.center_line;
    const allLines = this._traceData.lines;
    const filtered = re ? allLines.filter(l => re.test(l.raw || l.message)) : allLines;
    tbody.innerHTML = this._buildTraceRows(filtered, center);
    countEl.textContent = `${filtered.length}/${allLines.length} 行 / ${this._traceData.total_lines.toLocaleString()} 行`;

    if (filtered.length > 0) {
      const centerRow = tbody.querySelector('.trace-center');
      if (centerRow) centerRow.scrollIntoView({ block: 'center' });
    }
  },

  _highlight(message, matchedRuleId) {
    const escaped = escapeHtml(message);
    const patterns = this.currentPattern;
    if (!patterns || patterns.length === 0) return escaped;

    if (patterns.length === 1) {
      const pat = patterns[0];
      if (!pat.pattern) return escaped;
      let re;
      try {
        re = new RegExp(pat.pattern, 'gi');
      } catch {
        return escaped;
      }
      return escaped.replace(re, m => `<span class="match-highlight">${m}</span>`);
    }

    let result = escaped;
    for (let i = 0; i < patterns.length; i++) {
      const pat = patterns[i];
      if (!pat.pattern) continue;
      let re;
      try {
        re = new RegExp(pat.pattern, 'gi');
      } catch {
        continue;
      }
      const color = RULE_COLORS[i] || RULE_COLORS[0];
      const isMatched = matchedRuleId != null && pat.ruleId != null && matchedRuleId === pat.ruleId;
      if (isMatched) {
        result = result.replace(re, m =>
          `<span class="match-highlight match-c${i}" style="background:${color.bg};color:${color.text};">${m}</span>`
        );
      } else {
        result = result.replace(re, m =>
          `<span class="match-highlight">${m}</span>`
        );
      }
    }
    return result;
  },

  renderPagination(offset, limit, total) {
    const el = document.getElementById('pagination');
    if (total === 0) {
      el.innerHTML = '';
      return;
    }
    const currentPage = Math.floor(offset / limit) + 1;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const sizes = [500, 1000, 2000];

    el.innerHTML = `
      <div class="pagination-inner">
        <span class="page-size-select">
          <label>每页</label>
          <select onchange="Search.changePageSize(this.value)">
            ${sizes.map(s => `<option value="${s}"${s === limit ? ' selected' : ''}>${s.toLocaleString()}</option>`).join('')}
          </select>
          <label>条</label>
        </span>
        <span class="page-nav">
          <button class="btn btn-sm" ${offset === 0 ? 'disabled' : ''} onclick="Search.goPage(0)">◀◀</button>
          <button class="btn btn-sm" ${offset === 0 ? 'disabled' : ''} onclick="Search.goPage(${Math.max(0, offset - limit)})">◀</button>
          <span>第 ${currentPage}/${totalPages} 页 (共 ${total.toLocaleString()} 条)</span>
          <button class="btn btn-sm" ${offset + limit >= total ? 'disabled' : ''} onclick="Search.goPage(${offset + limit})">▶</button>
          <button class="btn btn-sm" ${offset + limit >= total ? 'disabled' : ''} onclick="Search.goPage(${Math.floor((totalPages - 1) * limit)})">▶▶</button>
        </span>
      </div>
    `;
  },

  initColumnResize() {
    const table = document.getElementById('logTable');
    if (!table) return;
    if (table._resizeReady) return;

    const cols = table.querySelectorAll('colgroup col');
    if (cols.length === 0) return;

    const headers = table.querySelectorAll('thead th');
    if (headers.length === 0) return;

    table._resizeReady = true;

    headers.forEach((th, idx) => {
      if (th.querySelector('.resize-handle')) return;
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      th.appendChild(handle);
      handle.style.position = 'absolute';
      handle.style.right = '0';
      handle.style.top = '0';
      handle.style.bottom = '0';
      handle.style.width = '4px';
      handle.style.cursor = 'col-resize';
      handle.style.zIndex = '1';

      let startX, startWidth;

      handle.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        const col = cols[idx];
        startWidth = col.style.width ? parseInt(col.style.width) : th.offsetWidth;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
      });

      function onMouseMove(e) {
        const diff = e.clientX - startX;
        const newWidth = Math.max(30, startWidth + diff);
        if (cols[idx]) cols[idx].style.width = newWidth + 'px';
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
    });
  },
};