const Table = {
  currentPattern: '',

  render(items, pattern) {
    this.currentPattern = pattern || '';
    const tbody = document.getElementById('logTableBody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text2)">无匹配结果</td></tr>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of items) {
      const tr = document.createElement('tr');
      tr.innerHTML = [
        `<td>${item.line_no}</td>`,
        `<td>${escapeHtml(item.date)}</td>`,
        `<td>${escapeHtml(item.time)}</td>`,
        `<td><span class="level-badge level-${item.level}">${item.level}</span></td>`,
        `<td>${item.pid}</td>`,
        `<td>${item.tid}</td>`,
        `<td>${escapeHtml(item.tag)}</td>`,
        `<td>${this._highlight(item.message, item.raw)}</td>`,
        `<td class="col-actions">
          <span class="action-btn" onclick="Table.copyRow(this)">复制</span>
          <span class="action-btn" onclick="Table.showTrace(this)">跟踪</span>
        </td>`,
      ].join('');
      // 保存 item 数据供复制和跟踪使用
      tr.dataset.item = JSON.stringify(item);
      frag.appendChild(tr);
    }

    tbody.innerHTML = '';
    tbody.appendChild(frag);
  },

  copyRow(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const item = JSON.parse(tr.dataset.item || '{}');
    const text = [
      `行号: ${item.line_no}`,
      `日期: ${item.date}`,
      `时间: ${item.time}`,
      `级别: ${item.level}`,
      `PID: ${item.pid}`,
      `TID: ${item.tid}`,
      `Tag: ${item.tag}`,
      `消息: ${item.message}`,
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = '复制'; }, 1500);
    }).catch(() => {
      // 降级方案
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = '复制'; }, 1500);
    });
  },

  async showTrace(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const item = JSON.parse(tr.dataset.item || '{}');
    if (!item.file_path) {
      showToast('无法获取文件路径', 'error');
      return;
    }
    try {
      btn.textContent = '加载中...';
      const result = await API.get('/api/files/context', {
        path: item.file_path,
        line_no: item.line_no,
        before: 200,
        after: 200,
      });
      btn.textContent = '跟踪';
      this._showTraceModal(result);
    } catch (e) {
      btn.textContent = '跟踪';
      showToast('跟踪失败: ' + e.message, 'error');
    }
  },

  _showTraceModal(result) {
    const overlay = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    const center = result.center_line;

    const rows = result.lines.map(line => {
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

    box.innerHTML = `
      <div class="trace-modal">
        <div class="trace-header">
          <h3>日志跟踪 - 行 ${center}</h3>
          <span class="trace-file">${escapeHtml(result.file_path)}</span>
          <span class="trace-count">显示 ${result.lines.length} 行 / 共 ${result.total_lines.toLocaleString()} 行</span>
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
            <tbody>${rows}</tbody>
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

    // 滚动到中心行
    setTimeout(() => {
      const tbody = box.querySelector('.trace-table tbody');
      const centerRow = tbody.querySelector('.trace-center');
      if (centerRow) centerRow.scrollIntoView({ block: 'center' });
    }, 50);
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