const Table = {
  currentPattern: '',
  _items: [],

  render(items, pattern) {
    this.currentPattern = pattern || '';
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
        `<td class="col-msg-cell">${this._highlight(item.message, item.raw)}</td>`,
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
        // 场景指示器点击
        if (target.classList.contains('scenario-indicator')) {
          const sid = parseInt(target.dataset.scenarioId);
          if (sid) Scenarios.showNoteDialog(sid);
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

    // 异步匹配场景
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
            const indicators = matchedIds.map(sid =>
              `<span class="scenario-indicator" data-scenario-id="${sid}" title="查看往期结论">?</span>`
            ).join('');
            msgCell.insertAdjacentHTML('beforeend', indicators);
          }
        }
      }
    } catch {
      // 匹配失败不影响主流程
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

  _highlight(message, raw) {
    const escaped = escapeHtml(message);
    if (!this.currentPattern) return escaped;

    let pattern;
    try {
      pattern = new RegExp(this.currentPattern, 'gi');
    } catch {
      return escaped;
    }

    return escaped.replace(pattern, m => `<span class="match-highlight">${m}</span>`);
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

    // 如果已经初始化过，直接返回
    if (table._resizeReady) return;

    const cols = table.querySelectorAll('colgroup col');
    if (cols.length === 0) return;

    const headers = table.querySelectorAll('thead th');
    if (headers.length === 0) return;

    table._resizeReady = true;

    headers.forEach((th, idx) => {
      // 避免重复添加手柄
      if (th.querySelector('.resize-handle')) return;

      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      handle.title = '拖拽调整列宽';
      th.appendChild(handle);

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;

        // col.offsetWidth 在 display:none 时为 0，用 th 的实际渲染宽度作为备用
        const col = cols[idx];
        const startWidth = col.offsetWidth > 0 ? col.offsetWidth : th.offsetWidth;
        if (startWidth <= 0) return;

        const onMove = (ev) => {
          const newW = Math.max(40, startWidth + (ev.clientX - startX));
          col.style.width = newW + 'px';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  },
};