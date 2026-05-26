const Files = {
  async loadFiles(paths) {
    App.setStatus('正在加载文件...');
    try {
      const result = await API.post('/api/files/open', { paths });
      App.state.files = result.files;
      this.renderFileList(result);
      document.getElementById('filterBar').style.display = result.files.length ? '' : 'none';
      App.setStatus(`已加载 ${result.total_files} 个文件, 共 ${result.total_lines.toLocaleString()} 行`);
      showToast(`加载完成: ${result.total_files} 个文件`, 'success');
      if (result.files.length > 0) {
        Search.onFilterChange();
      }
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
    const valid = files.filter(f => f.name && /\.(log|txt)$/i.test(f.name));
    if (!valid.length) {
      showToast('未找到有效的 .log 或 .txt 文件', 'error');
      return;
    }
    this.uploadAndLoad(valid);
  },

  handleFolderPick(event) {
    const allFiles = Array.from(event.target.files || []);
    if (!allFiles.length) return;
    // 只取第一层文件：webkitRelativePath 不含路径分隔符
    const valid = allFiles.filter(f => {
      if (!f.name || !/\.(log|txt)$/i.test(f.name)) return false;
      const rel = f.webkitRelativePath || '';
      // webkitRelativePath 为空（普通文件选择）或仅文件名（第一层）才保留
      return !rel || (!rel.includes('/') && !rel.includes('\\'));
    });
    if (!valid.length) {
      showToast('未找到有效的 .log 或 .txt 文件', 'error');
      return;
    }
    this.uploadAndLoad(valid);
  },

  async uploadAndLoad(files) {
    App.setStatus(`正在上传 ${files.length} 个文件...`);
    try {
      const result = await API.uploadMultiple('/api/files/upload', files);
      App.state.files = result.files;
      this.renderFileList(result);
      document.getElementById('filterBar').style.display = result.files.length ? '' : 'none';
      App.setStatus(`已加载 ${result.total_files} 个文件, 共 ${result.total_lines.toLocaleString()} 行`);
      showToast(`加载完成: ${result.total_files} 个文件`, 'success');
      // 文件加载完成后自动执行默认搜索
      if (result.files.length > 0) {
        Search.onFilterChange();
      }
    } catch (e) {
      App.setStatus('加载失败');
      showToast('加载失败: ' + e.message, 'error');
    }
  },

  handleDrop(event) {
    const dt = event.dataTransfer;
    const files = Array.from(dt.files || []);
    if (!files.length) return;
    const valid = files.filter(f => {
      if (!f.name || !/\.(log|txt)$/i.test(f.name)) return false;
      const rel = f.webkitRelativePath || '';
      return !rel || (!rel.includes('/') && !rel.includes('\\'));
    });
    if (!valid.length) {
      showToast('未找到有效的 .log 或 .txt 文件', 'error');
      return;
    }
    this.uploadAndLoad(valid);
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