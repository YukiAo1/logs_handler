const Files = {
  async loadFiles(paths) {
    App.setStatus('正在加载文件...');
    try {
      const result = await API.post('/api/files/open', { paths });
      App.state.files = result.files;
      this.renderFileList(result);
      App.setStatus(`已加载 ${result.total_files} 个文件, 共 ${result.total_lines.toLocaleString()} 行`);
      showToast(`加载完成: ${result.total_files} 个文件`, 'success');
      return result;
    } catch (e) {
      App.setStatus('加载失败');
      showToast('加载失败: ' + e.message, 'error');
      throw e;
    }
  },

  async refreshInfo() {
    try {
      const result = await API.get('/api/files/info');
      App.state.files = result.files;
      this.renderFileList(result);
    } catch (e) {
      // ignore
    }
  },

  async unloadAll() {
    try {
      await API.post('/api/files/close');
      App.state.files = [];
      this.renderFileList({ files: [] });
      App.setStatus('已卸载全部文件');
      App.showWelcome();
      showToast('已卸载全部文件', 'info');
    } catch (e) {
      showToast('卸载失败: ' + e.message, 'error');
    }
  },

  showFilePicker() {
    const input = document.getElementById('filePickerInput');
    input.value = '';
    input.click();
  },

  showFolderPicker() {
    const input = document.getElementById('folderPickerInput');
    input.value = '';
    input.click();
  },

  handleFilePick(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const paths = files.map(f => f.path).filter(p => p && /\.(log|txt)$/i.test(p));
    if (!paths.length) {
      showToast('未找到有效的 .log 或 .txt 文件', 'error');
      return;
    }
    this.loadFiles(paths);
  },

  handleDrop(event) {
    const dt = event.dataTransfer;
    const items = Array.from(dt.items || []);
    const entries = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }

    if (!entries.length && dt.files && dt.files.length) {
      const paths = Array.from(dt.files)
        .map(f => f.path)
        .filter(p => p && /\.(log|txt)$/i.test(p));
      if (paths.length) {
        this.loadFiles(paths);
      }
      return;
    }

    const filePaths = [];
    const processEntry = (entry) => {
      if (entry.isFile && /\.(log|txt)$/i.test(entry.name)) {
        filePaths.push(entry.fullPath);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        return new Promise((resolve) => {
          const readAll = () => {
            reader.readEntries((subEntries) => {
              if (!subEntries.length) { resolve(); return; }
              const promises = subEntries.map(e => processEntry(e));
              Promise.all(promises).then(() => readAll());
            });
          };
          readAll();
        });
      }
      return Promise.resolve();
    };

    const promises = entries.map(e => processEntry(e));
    Promise.all(promises).then(() => {
      if (filePaths.length) {
        this.loadFiles(filePaths);
      }
    });
  },

  renderFileList(result) {
    const list = document.getElementById('fileList');
    const files = result.files || App.state.files || [];

    if (!files.length) {
      list.innerHTML = '';
      return;
    }

    const sizeStr = (bytes) => {
      if (bytes >= 1024 * 1024 * 1024) return (bytes / 1073741824).toFixed(1) + ' GB';
      if (bytes >= 1024 * 1024) return (bytes / 1048576).toFixed(1) + ' MB';
      if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
      return bytes + ' B';
    };

    list.innerHTML = files.map((f, i) => `
      <div class="file-item">
        <span class="file-icon">📄</span>
        <div class="file-info">
          <div class="file-name" title="${escapeHtml(f.path)}">${escapeHtml(f.path.split(/[/\\]/).pop())}</div>
          <div class="file-meta">
            ${sizeStr(f.file_size)} | ${f.total_lines.toLocaleString()} 行
            ${f.time_start ? ` | ${f.time_start} ~ ${f.time_end}` : ''}
          </div>
        </div>
        <div class="file-actions">
          <button class="btn btn-sm" onclick="Files.showPreview('${escapeHtml(f.path).replace(/'/g, "\\'")}', 0)" title="预览前20行">👁</button>
        </div>
      </div>
    `).join('');
  },

  async showPreview(path, offset) {
    try {
      const result = await API.get('/api/files/sample', { path, offset, limit: 20 });
      App.showResults();
      this._renderPreviewTable(result);
    } catch (e) {
      showToast('预览失败: ' + e.message, 'error');
    }
  },

  _renderPreviewTable(result) {
    const tbody = document.getElementById('logTableBody');
    const stats = document.getElementById('resultStats');
    stats.textContent = `文件预览 (共 ${result.total_lines.toLocaleString()} 行)`;

    tbody.innerHTML = result.lines.map(l => `
      <tr>
        <td>${l.line_no}</td>
        <td>${escapeHtml(l.date)}</td>
        <td>${escapeHtml(l.time)}</td>
        <td><span class="level-badge level-${l.level}">${l.level}</span></td>
        <td>${l.pid}</td>
        <td>${l.tid}</td>
        <td title="${escapeHtml(l.tag)}">${escapeHtml(l.tag)}</td>
        <td title="${escapeHtml(l.message)}">${escapeHtml(l.message)}</td>
      </tr>
    `).join('');

    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';
  },
};