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
    // 只取第一层文件：按 webkitRelativePath 深度判断
    const valid = [];
    const skipped = [];
    for (const f of allFiles) {
      if (!f.name || !/\.(log|txt)$/i.test(f.name)) continue;
      const rel = f.webkitRelativePath || '';
      // 深度 = 路径分隔符数量（/ 或 \）
      const depth = (rel.match(/[/\\]/g) || []).length;
      // 文件夹选择器：根文件 depth=1（格式：文件夹名/file.log），子文件夹 depth>=2
      if (depth === 1) {
        valid.push(f);
      } else {
        skipped.push(`${f.name} (depth=${depth})`);
      }
    }
    if (!valid.length) {
      const msg = skipped.length
        ? `发现 ${skipped.length} 个子文件夹文件被过滤: ${skipped.slice(0, 3).join(', ')}`
        : '未找到有效的 .log 或 .txt 文件';
      showToast(msg, 'error');
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
    // 优先使用 items + webkitGetAsEntry 处理文件夹拖入
    const items = Array.from(dt.items || []);
    if (items.length > 0 && items[0].webkitGetAsEntry) {
      this._handleDropWithEntry(items);
      return;
    }
    // 降级：直接从 files 读取
    const files = Array.from(dt.files || []);
    if (!files.length) return;
    const valid = files.filter(f => f.name && /\.(log|txt)$/i.test(f.name));
    if (!valid.length) {
      showToast('未找到有效的 .log 或 .txt 文件', 'error');
      return;
    }
    this.uploadAndLoad(valid);
  },

  async _handleDropWithEntry(items) {
    const allFiles = [];
    const entries = [];

    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      if (!entry) continue;
      entries.push(entry);
    }

    // 遍历所有拖入项，只读文件夹第一层
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise(resolve => entry.file(resolve));
        if (file && file.name && /\.(log|txt)$/i.test(file.name)) {
          allFiles.push(file);
        }
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const subEntries = await new Promise(resolve => {
          reader.readEntries(resolve);
        });
        for (const sub of subEntries) {
          if (sub.isFile && sub.name && /\.(log|txt)$/i.test(sub.name)) {
            const file = await new Promise(resolve => sub.file(resolve));
            if (file) allFiles.push(file);
          }
        }
      }
    }

    if (!allFiles.length) {
      showToast('未找到有效的 .log 或 .txt 文件', 'error');
      return;
    }
    this.uploadAndLoad(allFiles);
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