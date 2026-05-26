const Scenarios = {
  _scenarios: [],
  _matchCache: {},

  async load() {
    try {
      this._scenarios = await API.get('/api/scenarios');
    } catch {
      this._scenarios = [];
    }
  },

  async showCreateDialog(initialMessage) {
    const overlay = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    box.innerHTML = `
      <h3>记录经典场景</h3>
      <div class="form-group">
        <label>核心日志 <span style="color:var(--error)">*</span></label>
        <input type="text" id="scenarioTitle" class="form-input" value="${escapeHtml(initialMessage || '')}" placeholder="输入核心日志内容">
      </div>
      <div class="form-group">
        <label>备注（可能原因）<span style="color:var(--error)">*</span></label>
        <textarea id="scenarioNote" class="form-textarea" rows="4" placeholder="记录这个报错可能的原因"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn" id="modalCancel">取消</button>
        <button class="btn btn-primary" id="scenarioSaveBtn">保存</button>
      </div>
    `;
    overlay.style.display = '';
    document.getElementById('modalCancel').onclick = () => { overlay.style.display = 'none'; };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
    document.getElementById('scenarioSaveBtn').onclick = async () => {
      const title = document.getElementById('scenarioTitle').value.trim();
      const note = document.getElementById('scenarioNote').value.trim();
      if (!title) { showToast('请输入核心日志', 'error'); return; }
      if (!note) { showToast('请输入备注', 'error'); return; }
      try {
        await API.post('/api/scenarios', { title, note });
        await this.load();
        overlay.style.display = 'none';
        showToast('场景已保存', 'success');
      } catch (e) {
        showToast('保存失败: ' + e.message, 'error');
      }
    };
  },

  async showManageDialog() {
    await this.load();
    const overlay = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    const items = this._scenarios.map(s => `
      <div class="scenario-item" data-id="${s.id}">
        <div class="scenario-item-title">${escapeHtml(s.title)}</div>
        <div class="scenario-item-note">${escapeHtml(s.note)}</div>
        <div class="scenario-item-actions">
          <button class="btn btn-sm" onclick="Scenarios._deleteScenario(${s.id})">删除</button>
        </div>
      </div>
    `).join('') || '<p class="placeholder">暂无场景</p>';
    box.innerHTML = `
      <div class="scenario-manage">
        <div class="scenario-manage-header">
          <h3>经典场景管理</h3>
        </div>
        <div class="scenario-manage-body">${items}</div>
        <div class="scenario-manage-footer">
          <button class="btn" onclick="Scenarios._exportScenarios()">📤 导出</button>
          <button class="btn" onclick="Scenarios._showImportDialog()">📥 导入</button>
          <button class="btn" id="modalCancel">关闭</button>
        </div>
      </div>
    `;
    overlay.style.display = '';
    document.getElementById('modalCancel').onclick = () => { overlay.style.display = 'none'; };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
  },

  async _deleteScenario(id) {
    if (!confirm('确定删除此场景？')) return;
    try {
      await API.del(`/api/scenarios/${id}`);
      await this.load();
      showToast('已删除', 'info');
      this.showManageDialog();
    } catch (e) {
      showToast('删除失败: ' + e.message, 'error');
    }
  },

  async _exportScenarios() {
    try {
      const data = await API.get('/api/scenarios/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `经典场景_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('导出成功', 'success');
    } catch (e) {
      showToast('导出失败: ' + e.message, 'error');
    }
  },

  _showImportDialog() {
    const input = document.getElementById('scenarioImportInput');
    if (!input) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.id = 'scenarioImportInput';
      inp.accept = '.json';
      inp.style.display = 'none';
      inp.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/scenarios/import?mode=merge', { method: 'POST', body: form });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || res.statusText);
          }
          const result = await res.json();
          await this.load();
          showToast(`导入成功: ${result.imported} 条, 跳过: ${result.skipped} 条`, 'success');
          this.showManageDialog();
        } catch (e) {
          showToast('导入失败: ' + e.message, 'error');
        }
      };
      document.body.appendChild(inp);
      inp.value = '';
      inp.click();
    } else {
      input.value = '';
      input.click();
    }
  },

  async matchMessages(messages) {
    if (!messages.length || !this._scenarios.length) return {};
    try {
      const result = await API.post('/api/scenarios/match', messages);
      this._matchCache = result.matches || {};
    } catch {
      this._matchCache = {};
    }
    return this._matchCache;
  },

  showNoteDialog(scenarioIds) {
    const ids = Array.isArray(scenarioIds) ? scenarioIds : [scenarioIds];
    const matched = this._scenarios.filter(s => ids.includes(s.id));
    if (!matched.length) return;
    const overlay = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    const items = matched.map(s => `
      <div class="scenario-note-item">
        <div class="scenario-note-title">场景：${escapeHtml(s.title)}</div>
        <div class="scenario-note-body">往期记录：${escapeHtml(s.note)}</div>
      </div>
    `).join('');
    box.innerHTML = `
      <div class="scenario-note-dialog">
        <h3>经典场景</h3>
        ${items}
        <div class="scenario-note-tips">Tips：往期记录结论仅做参考！</div>
        <div class="form-actions">
          <button class="btn" id="modalCancel">关闭</button>
        </div>
      </div>
    `;
    overlay.style.display = '';
    document.getElementById('modalCancel').onclick = () => { overlay.style.display = 'none'; };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
  },
};