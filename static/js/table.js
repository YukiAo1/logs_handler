const Table = {
  currentPattern: '',

  render(items, pattern) {
    this.currentPattern = pattern || '';
    const tbody = document.getElementById('logTableBody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text2)">无匹配结果</td></tr>';
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
      ].join('');
      frag.appendChild(tr);
    }

    tbody.innerHTML = '';
    tbody.appendChild(frag);
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

    el.innerHTML = `
      <button class="btn btn-sm" ${offset === 0 ? 'disabled' : ''} onclick="Search.goPage(0)">◀◀</button>
      <button class="btn btn-sm" ${offset === 0 ? 'disabled' : ''} onclick="Search.goPage(${Math.max(0, offset - limit)})">◀</button>
      <span>第 ${currentPage}/${totalPages} 页 (共 ${total.toLocaleString()} 条)</span>
      <button class="btn btn-sm" ${offset + limit >= total ? 'disabled' : ''} onclick="Search.goPage(${offset + limit})">▶</button>
      <button class="btn btn-sm" ${offset + limit >= total ? 'disabled' : ''} onclick="Search.goPage(${Math.floor((totalPages - 1) * limit)})">▶▶</button>
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