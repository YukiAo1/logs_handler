const RULE_COLORS = [
  { bg: '#fff3cd', border: '#ffc107', text: '#856404' },
  { bg: '#d4edda', border: '#28a745', text: '#155724' },
  { bg: '#d6eaf8', border: '#3498db', text: '#1a5276' },
  { bg: '#f8d7da', border: '#e74c3c', text: '#721c24' },
  { bg: '#e8daef', border: '#9b59b6', text: '#5b2c6f' },
];

const Rules = {
  _groups: [],

  _isPlaceholder(r) {
    return r.name && r.name.startsWith('__group_placeholder__');
  },

  _getRuleColorIndex(ruleId) {
    const ids = App.state.activeRuleIds;
    const idx = ids.indexOf(ruleId);
    return idx >= 0 ? idx : -1;
  },

  _flatten(groups) {
    this._groups = groups;
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
        const expanded = this._isGroupExpanded(group.group_name);
        if (kw && filtered.length === 0) continue;
        html += `<div class="rule-group" data-group="${escapeHtml(group.group_name)}">
          <div class="rule-group-header" draggable="true">
            <span class="rule-group-toggle">${expanded ? '▼' : '▶'}</span>
            <span class="rule-group-name">${escapeHtml(group.group_name)}</span>
            <span class="rule-group-count">${filtered.length}</span>
            <button class="btn btn-sm btn-danger rule-group-del" title="删除此目录及其所有规则">✕</button>
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
    const colorIdx = this._getRuleColorIndex(r.id);
    const isActive = colorIdx >= 0;
    const color = RULE_COLORS[colorIdx];
    const activeStyle = isActive
      ? ` style="background:${color.bg};border-left-color:${color.border};"`
      : '';
    const badgeHtml = isActive
      ? `<span class="rule-color-badge" style="background:${color.border};color:#fff;font-size:9px;padding:0 5px;border-radius:8px;margin-left:4px;flex-shrink:0;">${colorIdx + 1}</span>`
      : '';

    return `<div class="rule-item${isActive ? ' active' : ''}"
           draggable="true" data-id="${r.id}" data-group="${escapeHtml(r.group_name || '')}"${activeStyle}>
        <div class="rule-name">${escapeHtml(r.name || '')}${badgeHtml}</div>
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
    list.querySelectorAll('.rule-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        const id = parseInt(el.dataset.id);
        this._toggleRule(id);
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
        if (e.target.closest('.rule-group-del')) return;
        const group = hdr.closest('.rule-group');
        const body = group.querySelector('.rule-group-body');
        const toggle = hdr.querySelector('.rule-group-toggle');
        const expanded = body.style.display !== 'none';
        body.style.display = expanded ? 'none' : '';
        toggle.textContent = expanded ? '▶' : '▼';
        Rules._toggleGroup(group.dataset.group, !expanded);
      });
    });

    list.querySelectorAll('.rule-group-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const group = btn.closest('.rule-group');
        const name = group?.dataset?.group || '';
        if (!name) return;
        if (!confirm(`确定删除目录「${name}」及其所有规则吗？`)) return;
        try {
          await API.del('/api/rules/group?group_name=' + encodeURIComponent(name));
          showToast(`目录「${name}」已删除`, 'success');
          await this.loadRules();
        } catch (err) {
          showToast('删除目录失败: ' + (err.message || JSON.stringify(err)), 'error');
        }
      });
    });
  },

  _toggleRule(id) {
    const ids = App.state.activeRuleIds;
    const idx = ids.indexOf(id);
    if (idx >= 0) {
      ids.splice(idx, 1);
    } else {
      if (ids.length >= 5) {
        showToast('最多同时选中 5 个规则', 'error');
        return;
      }
      ids.push(id);
    }
    this.render();
    Search.onFilterChange();
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

        const srcIsGroup = src.matches('.rule-group-header');
        const tgtIsGroup = el.matches('.rule-group-header');

        if (srcIsGroup && tgtIsGroup) {
          const srcGroup = src.closest('.rule-group')?.dataset?.group || '';
          const tgtGroup = el.closest('.rule-group')?.dataset?.group || '';
          if (!srcGroup || !tgtGroup) return;
          try {
            await API.put('/api/rules/move_group', { src_group: srcGroup, tgt_group: tgtGroup });
            showToast('目录已换位', 'success');
            await this.loadRules();
          } catch (err) {
            showToast('移动目录失败: ' + (err.message || JSON.stringify(err)), 'error');
          }
          return;
        }

        const srcId = parseInt(src.dataset.id, 10);
        if (isNaN(srcId)) return;

        const srcRule = App.state.rules.find(r => r.id === srcId);
        if (!srcRule) return;

        let targetGroup;
        let targetOrder;

        if (tgtIsGroup) {
          targetGroup = el.closest('.rule-group')?.dataset?.group || '';
          targetOrder = -1;
        } else {
          const tgtId = parseInt(el.dataset.id, 10);
          if (isNaN(tgtId)) return;
          const tgtRule = App.state.rules.find(r => r.id === tgtId);
          if (!tgtRule) return;
          targetGroup = el.dataset.group || '';
          targetOrder = Number(tgtRule.sort_order) || 0;
        }

        try {
          await API.put('/api/rules/move', {
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
    const groupOpts = groups.map(g =>
      `<option value="${escapeHtml(g)}"${g === rule.group_name ? ' selected' : ''}>${escapeHtml(g)}</option>`
    ).join('');

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
        <input id="ruleDesc" value="${escapeHtml(rule.description || '')}" maxlength="200">
      </div>`;

    showModal('编辑规则', bodyHtml, async (box) => {
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
      const idx = App.state.activeRuleIds.indexOf(id);
      if (idx >= 0) App.state.activeRuleIds.splice(idx, 1);
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