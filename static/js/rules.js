const Rules = {
  _groups: [],

  _isPlaceholder(r) {
    return r.name && r.name.startsWith('__group_placeholder__');
  },

  _flatten(groups) {
    this._groups = groups;
    // 过滤掉占位规则
    for (const g of groups) {
      g.rules = g.rules.filter(r => !this._isPlaceholder(r));
    }
    const flat = [];
    for (const g of groups) {
      for (const r of g.rules) {
        r.group_name = g.group_name;
        flat.push(r);
      }
    }
    return flat;
  },

  async loadRules() {
    try {
      const data = await API.get('/api/rules');
      App.state.rules = this._flatten(data);
      this.render();
    } catch (e) {
      showToast('加载规则失败: ' + e.message, 'error');
    }
  },

  render() {
    const list = document.getElementById('ruleList');

    if (this._groups.length === 0) {
      list.innerHTML = '<p class="placeholder">暂无规则，点击下方按钮新建</p>';
      return;
    }

    const searchVal = (document.getElementById('ruleSearchInput') || {}).value || '';
    const kw = searchVal.trim().toLowerCase();

    let html = '';
    for (const group of this._groups) {
      const rules = group.rules;
      let filtered = rules;
      if (kw) {
        filtered = rules.filter(r => r.name.toLowerCase().includes(kw));
      }

      if (group.group_name) {
        // 有名字的目录始终显示（即使空目录）
        const expanded = this._isGroupExpanded(group.group_name);
        if (kw && filtered.length === 0) continue;
        html += `<div class="rule-group" data-group="${escapeHtml(group.group_name)}">
          <div class="rule-group-header" draggable="true">
            <span class="rule-group-toggle">${expanded ? '▼' : '▶'}</span>
            <span class="rule-group-name">${escapeHtml(group.group_name)}</span>
            <span class="rule-group-count">${filtered.length}</span>
          </div>
          <div class="rule-group-body" style="display:${expanded ? '' : 'none'}">
            ${filtered.length ? filtered.map(r => this._renderRuleItem(r)).join('') : ''}
          </div>
        </div>`;
      } else {
        if (filtered.length === 0) continue;
        for (const r of filtered) {
          html += this._renderRuleItem(r);
        }
      }
    }

    list.innerHTML = html;
    this._bindEvents(list);
    this._initDragDrop(list);
  },

  _renderRuleItem(r) {
    return `<div class="rule-item${App.state.activeRuleId === r.id ? ' active' : ''}"
           draggable="true" data-id="${r.id}" data-group="${escapeHtml(r.group_name || '')}">
        <div class="rule-name">${escapeHtml(r.name || '')}</div>
        <div class="rule-pattern">${escapeHtml(r.pattern || '')}</div>
        <div class="rule-actions">
          <button class="btn btn-sm" data-action="edit" data-id="${r.id}">编辑</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${r.id}">删除</button>
        </div>
      </div>`;
  },

  _isGroupExpanded(name) {
    const stored = localStorage.getItem('rule_group_expanded_' + name);
    return stored !== '0';
  },

  _toggleGroup(name, expand) {
    localStorage.setItem('rule_group_expanded_' + name, expand ? '1' : '0');
  },

  _bindEvents(list) {
    const activeId = () => App.state.activeRuleId;

    list.querySelectorAll('.rule-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        const id = parseInt(el.dataset.id);
        App.state.activeRuleId = (activeId() === id) ? null : id;
        Rules.loadRules();
        if (App.state.activeRuleId) {
          Search.onFilterChange();
        }
      });
    });

    list.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const rule = App.state.rules.find(r => r.id === id);
        if (rule) Rules.showEditDialog(rule);
      });
    });

    list.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        await Rules.deleteRule(id);
      });
    });

    list.querySelectorAll('.rule-group-header').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        const group = hdr.closest('.rule-group');
        const body = group.querySelector('.rule-group-body');
        const toggle = hdr.querySelector('.rule-group-toggle');
        const expanded = body.style.display !== 'none';
        body.style.display = expanded ? 'none' : '';
        toggle.textContent = expanded ? '▶' : '▼';
        Rules._toggleGroup(group.dataset.group, !expanded);
      });
    });
  },

  _dragSrc: null,

  _initDragDrop(list) {
    list.querySelectorAll('[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        this._dragSrc = el;
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        list.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over');
      });
      el.addEventListener('drop', async (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const src = this._dragSrc;
        if (!src || src === el) return;

        const srcId = parseInt(src.dataset.id);
        if (isNaN(srcId)) return;

        const isGroupHeader = el.matches('.rule-group-header');
        const tgtId = isGroupHeader ? null : parseInt(el.dataset.id);

        const srcRule = App.state.rules.find(r => r.id === srcId);
        if (!srcRule) return;

        let targetGroup;
        let targetOrder;

        if (isGroupHeader) {
          // 拖到目录头 → 进入该目录
          targetGroup = el.closest('.rule-group')?.dataset?.group || '';
          targetOrder = 0;
        } else if (!isNaN(tgtId)) {
          // 拖到另一个规则 → 交换位置
          const tgtRule = App.state.rules.find(r => r.id === tgtId);
          if (!tgtRule) return;
          targetGroup = el.dataset.group || '';
          targetOrder = tgtRule.sort_order;
        } else {
          return;
        }

        try {
          const result = await API.put('/api/rules/move', {
            rule_id: srcId,
            target_group: targetGroup,
            target_order: targetOrder,
          });
          showToast('规则已移动', 'success');
          await this.loadRules();
        } catch (err) {
          showToast('移动失败: ' + (err.message || JSON.stringify(err)), 'error');
        }
      });
    });
  },

  showCreateDialog() {
    const groups = [...new Set(this._groups.map(g => g.group_name).filter(Boolean))];
    const groupOpts = groups.map(g =>
      `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`
    ).join('');

    const bodyHtml = `
      <div class="form-group">
        <label>规则名称 <span style="color:var(--error)">*</span></label>
        <input id="ruleName" placeholder="例如: 开卡日志" maxlength="50">
      </div>
      <div class="form-group">
        <label>正则表达式 <span style="color:var(--error)">*</span></label>
        <textarea id="rulePattern" placeholder="例如: abc|def|aaaabcs"></textarea>
      </div>
      <div class="form-group">
        <label>所属目录</label>
        <select id="ruleGroup">
          <option value="">（不分组，平铺显示）</option>
          ${groupOpts}
          <option value="__new__">新建目录...</option>
        </select>
      </div>
      <div id="ruleNewGroupWrap" class="form-group" style="display:none">
        <label>新目录名称</label>
        <input id="ruleNewGroup" placeholder="输入目录名称" maxlength="30">
      </div>
      <div class="form-group">
        <label>备注（可选）</label>
        <input id="ruleDesc" placeholder="简要描述" maxlength="200">
      </div>`;

    showModal('新建规则', bodyHtml, async (box) => {
      const name = box.querySelector('#ruleName').value.trim();
      const pattern = box.querySelector('#rulePattern').value.trim();
      const description = box.querySelector('#ruleDesc').value.trim();
      let group_name = box.querySelector('#ruleGroup').value;
      if (group_name === '__new__') {
        group_name = box.querySelector('#ruleNewGroup').value.trim();
      }
      if (!name) throw new Error('请输入规则名称');
      if (!pattern) throw new Error('请输入正则表达式');
      try {
        await API.post('/api/rules', { name, pattern, description, group_name });
        showToast('规则创建成功', 'success');
        const input = document.getElementById('ruleSearchInput');
        if (input) input.value = '';
        if (group_name) {
          this._toggleGroup(group_name, true);
        }
        await this.loadRules();
      } catch (e) {
        showToast('创建失败: ' + e.message, 'error');
        throw e;
      }
    });

    setTimeout(() => {
      const sel = document.getElementById('ruleGroup');
      const wrap = document.getElementById('ruleNewGroupWrap');
      if (sel && wrap) {
        sel.addEventListener('change', () => {
          wrap.style.display = sel.value === '__new__' ? '' : 'none';
        });
      }
    }, 50);
  },

  showEditDialog(rule) {
    const groups = [...new Set(this._groups.map(g => g.group_name).filter(Boolean))];

    const bodyHtml = `
      <div class="form-group">
        <label>规则名称 <span style="color:var(--error)">*</span></label>
        <input id="ruleName" value="${escapeHtml(rule.name)}" maxlength="50">
      </div>
      <div class="form-group">
        <label>正则表达式 <span style="color:var(--error)">*</span></label>
        <textarea id="rulePattern">${escapeHtml(rule.pattern)}</textarea>
      </div>
      <div class="form-group">
        <label>所属目录</label>
        <input id="ruleGroupName" value="${escapeHtml(rule.group_name || '')}" placeholder="留空则不分组，输入目录名称" maxlength="30">
      </div>
      <div class="form-group">
        <label>备注（可选）</label>
        <input id="ruleDesc" value="${escapeHtml(rule.description || '')}" maxlength="200">
      </div>`;

    showModal('编辑规则', bodyHtml, async (box) => {
      const name = box.querySelector('#ruleName').value.trim();
      const pattern = box.querySelector('#rulePattern').value.trim();
      const description = box.querySelector('#ruleDesc').value.trim();
      const group_name = box.querySelector('#ruleGroupName').value.trim();
      if (!name) throw new Error('请输入规则名称');
      if (!pattern) throw new Error('请输入正则表达式');
      try {
        await API.put(`/api/rules/${rule.id}`, { name, pattern, description, group_name });
        showToast('规则更新成功', 'success');
        const input = document.getElementById('ruleSearchInput');
        if (input) input.value = '';
        if (group_name) {
          this._toggleGroup(group_name, true);
        }
        await this.loadRules();
      } catch (e) {
        showToast('更新失败: ' + e.message, 'error');
        throw e;
      }
    });
  },

  async showCreateGroupDialog() {
    const bodyHtml = `
      <div class="form-group">
        <label>目录名称 <span style="color:var(--error)">*</span></label>
        <input id="groupName" placeholder="输入目录名称" maxlength="30">
      </div>`;

    showModal('新建目录', bodyHtml, async (box) => {
      const group_name = box.querySelector('#groupName').value.trim();
      if (!group_name) throw new Error('请输入目录名称');

      try {
        await API.post('/api/rules', {
          name: `__group_placeholder__${group_name}`,
          pattern: '.^',
          description: '',
          group_name,
        });
        showToast(`目录「${group_name}」已创建`, 'success');
        const input = document.getElementById('ruleSearchInput');
        if (input) input.value = '';
        this._toggleGroup(group_name, true);
        await this.loadRules();
      } catch (e) {
        showToast('创建失败: ' + e.message, 'error');
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

/* 搜索功能放在顶部 + 新建目录按钮 */
(function initRulePanel() {
  const panel = document.getElementById('rulePanel');
  if (!panel) return;

  const header = panel.querySelector('.panel-header');
  const body = panel.querySelector('.panel-body');

  if (!document.getElementById('ruleSearchInput') && header && body) {
    const searchBar = document.createElement('div');
    searchBar.className = 'rule-search';
    searchBar.innerHTML = '<input type="text" id="ruleSearchInput" placeholder="搜索规则..." oninput="Rules.render()">';
    header.parentNode.insertBefore(searchBar, body);
  }

  const panelFooter = panel.querySelector('.panel-footer');
  if (!document.getElementById('createGroupBtn') && panelFooter) {
    const btn = document.createElement('button');
    btn.id = 'createGroupBtn';
    btn.className = 'btn';
    btn.textContent = '📁 新建目录';
    btn.onclick = () => Rules.showCreateGroupDialog();
    panelFooter.appendChild(btn);
  }
})();