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
    const headers = table.querySelectorAll('th');
    headers.forEach(th => {
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      th.appendChild(handle);
      let startX = 0, startWidth = 0;
      const onMouseDown = (e) => {
        startX = e.clientX;
        startWidth = th.offsetWidth;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
      };
      const onMouseMove = (e) => {
        const diff = e.clientX - startX;
        const newWidth = Math.max(30, startWidth + diff);
        th.style.width = `${newWidth}px`;
        th.style.maxWidth = `${newWidth}px`;
        const cols = table.querySelectorAll(`colgroup col:nth-child(${[...headers].indexOf(th) + 1})`);
        if (cols.length) cols[0].style.width = `${newWidth}px`;
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      handle.addEventListener('mousedown', onMouseDown);
    });
  },
};