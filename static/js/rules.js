const Rules = {
  async loadRules() {
    try {
      const data = await API.get('/api/rules');
      App.state.rules = data;
      this.render();
    } catch (e) {
      showToast('加载规则失败: ' + e.message, 'error');
    }
  },

  render() {
    const list = document.getElementById('ruleList');
    const rules = App.state.rules;

    if (rules.length === 0) {
      list.innerHTML = '<p class="placeholder">暂无规则，点击下方按钮新建</p>';
      return;
    }

    list.innerHTML = rules.map(r => `
      <div class="rule-item${App.state.activeRuleId === r.id ? ' active' : ''}"
           data-id="${r.id}">
        <div class="rule-name">${escapeHtml(r.name || '')}</div>
        <div class="rule-pattern">${escapeHtml(r.pattern || '')}</div>
        <div class="rule-actions">
          <button class="btn btn-sm" data-action="edit" data-id="${r.id}">编辑</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${r.id}">删除</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.rule-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        const id = parseInt(el.dataset.id);
        App.state.activeRuleId = (App.state.activeRuleId === id) ? null : id;
        this.render();
        if (App.state.activeRuleId) {
          Search.onFilterChange();
        }
      });
    });

    list.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const rule = rules.find(r => r.id === id);
        if (rule) this.showEditDialog(rule);
      });
    });

    list.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        await this.deleteRule(id);
      });
    });
  },

  showCreateDialog() {
    const bodyHtml = `
      <div class="form-group">
        <label>规则名称</label>
        <input id="ruleName" placeholder="例如: 开卡日志" maxlength="50">
      </div>
      <div class="form-group">
        <label>正则表达式</label>
        <textarea id="rulePattern" placeholder="例如: abc|def|aaaabcs"></textarea>
      </div>
      <div class="form-group">
        <label>备注（可选）</label>
        <input id="ruleDesc" placeholder="简要描述这条规则的用途" maxlength="200">
      </div>`;

    showModal('新建规则', bodyHtml, async (box) => {
      const name = box.querySelector('#ruleName').value.trim();
      const pattern = box.querySelector('#rulePattern').value.trim();
      const description = box.querySelector('#ruleDesc').value.trim();
      if (!name) throw new Error('请输入规则名称');

      try {
        await API.post('/api/rules', { name, pattern, description });
        showToast('规则创建成功', 'success');
        await this.loadRules();
      } catch (e) {
        showToast('创建失败: ' + e.message, 'error');
        throw e;
      }
    });
  },

  showEditDialog(rule) {
    const bodyHtml = `
      <div class="form-group">
        <label>规则名称</label>
        <input id="ruleName" value="${escapeHtml(rule.name)}" maxlength="50">
      </div>
      <div class="form-group">
        <label>正则表达式</label>
        <textarea id="rulePattern">${escapeHtml(rule.pattern)}</textarea>
      </div>
      <div class="form-group">
        <label>备注（可选）</label>
        <input id="ruleDesc" value="${escapeHtml(rule.description || '')}" maxlength="200">
      </div>`;

    showModal('编辑规则', bodyHtml, async (box) => {
      const name = box.querySelector('#ruleName').value.trim();
      const pattern = box.querySelector('#rulePattern').value.trim();
      const description = box.querySelector('#ruleDesc').value.trim();
      if (!name) throw new Error('请输入规则名称');

      try {
        await API.put(`/api/rules/${rule.id}`, { name, pattern, description });
        showToast('规则更新成功', 'success');
        await this.loadRules();
      } catch (e) {
        showToast('更新失败: ' + e.message, 'error');
        throw e;
      }
    });
  },

  async deleteRule(id) {
    if (!confirm('确定删除这条规则吗？')) return;
    try {
      await API.del(`/api/rules/${id}`);
      if (App.state.activeRuleId === id) App.state.activeRuleId = null;
      showToast('规则已删除', 'success');
      await this.loadRules();
    } catch (e) {
      showToast('删除失败: ' + e.message, 'error');
    }
  },

  async exportRules() {
    try {
      const data = await API.get('/api/rules/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `logs_handler_rules_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('规则已导出', 'success');
    } catch (e) {
      showToast('导出失败: ' + e.message, 'error');
    }
  },

  showImportDialog() {
    const bodyHtml = `
      <div class="form-group">
        <label>选择导入模式</label>
        <select id="importMode">
          <option value="merge">合并导入（保留现有，追加新规则）</option>
          <option value="replace">覆盖导入（清空现有，使用导入规则）</option>
        </select>
      </div>
      <div class="form-group">
        <label>选择 JSON 文件</label>
        <input type="file" id="importFile" accept=".json">
      </div>`;

    showModal('导入规则', bodyHtml, async (box) => {
      const fileInput = box.querySelector('#importFile');
      const mode = box.querySelector('#importMode').value;
      if (!fileInput.files || fileInput.files.length === 0) {
        throw new Error('请选择文件');
      }

      try {
        const result = await API.upload(
          '/api/rules/import/upload',
          fileInput.files[0],
          { mode }
        );
        showToast(`导入完成: ${result.imported} 条成功, ${result.skipped} 条跳过`, 'success');
        await this.loadRules();
      } catch (e) {
        showToast('导入失败: ' + e.message, 'error');
        throw e;
      }
    });
  },
};