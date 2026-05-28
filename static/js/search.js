const Search = {
  state: {
    offset: 0,
    limit: 500,
    total: 0,
    currentPattern: '',
    searching: false,
  },

  _initTimePickers() {
    ['filterTimeStart', 'filterTimeEnd'].forEach(id => {
      const input = document.getElementById(id);
      if (!input || input._pickerReady) return;
      input._pickerReady = true;

      input.addEventListener('focus', () => {
        Search._showTimePicker(input);
      });
      input.addEventListener('click', () => {
        Search._showTimePicker(input);
      });
    });
  },

  _hideTimePicker() {
    const existing = document.getElementById('timePickerPopup');
    if (existing) existing.remove();
  },

  _showTimePicker(input) {
    this._hideTimePicker();
    const rect = input.getBoundingClientRect();
    const current = input.value || '';
    const parts = current.match(/^(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);

    const popup = document.createElement('div');
    popup.id = 'timePickerPopup';
    popup.style.cssText = `
      position:fixed;z-index:9999;
      top:${rect.bottom + 4}px;left:${rect.left}px;
      background:#2a2a40;border:1px solid #555;border-radius:8px;
      padding:12px;box-shadow:0 4px 16px rgba(0,0,0,0.5);
      display:flex;flex-direction:column;gap:8px;min-width:280px;
    `;

    const segs = [
      { label: '月', name: 'mm', max: 12, val: parts ? parts[1] : '' },
      { label: '日', name: 'dd', max: 31, val: parts ? parts[2] : '' },
      { label: '时', name: 'hh', max: 23, val: parts ? parts[3] : '' },
      { label: '分', name: 'min', max: 59, val: parts ? parts[4] : '' },
      { label: '秒', name: 'ss', max: 59, val: parts ? parts[5] : '' },
      { label: '毫秒', name: 'ms', max: 999, val: parts ? parts[6] : '' },
    ];

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    segs.forEach(s => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';
      const label = document.createElement('span');
      label.textContent = s.label;
      label.style.cssText = 'color:#aaa;font-size:10px;';
      const inputField = document.createElement('input');
      inputField.type = 'text';
      inputField.inputMode = 'numeric';
      inputField.maxLength = s.name === 'ms' ? 3 : 2;
      inputField.placeholder = s.val || '00';
      inputField.value = s.val;
      inputField.dataset.segName = s.name;
      inputField.dataset.max = s.max;
      inputField.style.cssText = `
        width:${s.name === 'ms' ? '48px' : '36px'};text-align:center;
        background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:4px;
        padding:4px 2px;font-size:13px;
      `;
      inputField.addEventListener('input', () => {
        let v = inputField.value.replace(/\D/g, '').slice(0, inputField.maxLength);
        const max = parseInt(inputField.dataset.max);
        if (v && parseInt(v) > max) v = String(max);
        inputField.value = v;
        Search._updateTimeInput(input);
      });
      inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') Search._hideTimePicker();
      });
      wrap.appendChild(label);
      wrap.appendChild(inputField);
      row.appendChild(wrap);
    });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const nowBtn = document.createElement('button');
    nowBtn.textContent = '🕐 现在';
    nowBtn.className = 'btn btn-sm';
    nowBtn.onclick = () => {
      const d = new Date();
      const pad2 = n => String(n).padStart(2, '0');
      const pad3 = n => String(n).padStart(3, '0');
      const m = pad2(d.getMonth() + 1);
      const day = pad2(d.getDate());
      const h = pad2(d.getHours());
      const min = pad2(d.getMinutes());
      const s = pad2(d.getSeconds());
      const ms = pad3(d.getMilliseconds());
      input.value = `${m}-${day} ${h}:${min}:${s}.${ms}`;
      this._hideTimePicker();
      Search.onFilterChange();
    };
    const okBtn = document.createElement('button');
    okBtn.textContent = '确定';
    okBtn.className = 'btn btn-sm btn-primary';
    okBtn.onclick = () => { this._hideTimePicker(); Search.onFilterChange(); };
    btnRow.appendChild(nowBtn);
    btnRow.appendChild(okBtn);

    popup.appendChild(row);
    popup.appendChild(btnRow);
    document.body.appendChild(popup);

    const closeOnClickOutside = (e) => {
      if (!popup.contains(e.target) && e.target !== input) {
        this._hideTimePicker();
        document.removeEventListener('mousedown', closeOnClickOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnClickOutside), 0);
  },

  _updateTimeInput(input) {
    const popup = document.getElementById('timePickerPopup');
    if (!popup) return;
    const fields = popup.querySelectorAll('input[data-seg-name]');
    const vals = {};
    fields.forEach(f => { vals[f.dataset.segName] = f.value.padStart(f.dataset.segName === 'ms' ? 3 : 2, '0'); });
    const { mm, dd, hh, min, ss, ms } = vals;
    if (mm && dd && hh && min && ss && ms) {
      input.value = `${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
    }
  },

  getFilters() {
    const levels = [];
    document.querySelectorAll('#filterBar .level-check input:checked').forEach(cb => {
      levels.push(cb.value);
    });

    const pidVal = document.getElementById('filterPid').value.trim();
    const tidVal = document.getElementById('filterTid').value.trim();
    const tagVal = document.getElementById('filterTag').value.trim();
    const timeStart = document.getElementById('filterTimeStart').value.trim();
    const timeEnd = document.getElementById('filterTimeEnd').value.trim();
    const keyword = document.getElementById('filterKeyword').value.trim();

    return {
      level: levels.length > 0 ? levels.join(',') : null,
      pid: pidVal ? parseInt(pidVal) || null : null,
      tid: tidVal ? parseInt(tidVal) || null : null,
      tag: tagVal || null,
      time_start: timeStart || null,
      time_end: timeEnd || null,
      keyword: keyword || null,
    };
  },

  onFilterChange() {
    this.state.offset = 0;
    this.doSearch();
  },

  goPage(offset) {
    this.state.offset = offset;
    this.doSearch();
  },

  changePageSize(limit) {
    this.state.limit = parseInt(limit);
    this.state.offset = 0;
    this.doSearch();
  },

  clearFilters() {
    document.querySelectorAll('#filterBar .level-check input').forEach(cb => {
      cb.checked = ['D', 'I', 'W', 'E'].includes(cb.value);
    });
    document.getElementById('filterTimeStart').value = '';
    document.getElementById('filterTimeEnd').value = '';
    document.getElementById('filterPid').value = '';
    document.getElementById('filterTid').value = '';
    document.getElementById('filterTag').value = '';
    document.getElementById('filterKeyword').value = '';
    this.state.offset = 0;
    this.state.currentPattern = '';
    if (App.state.activeRuleIds.length > 0) {
      Search.doSearch();
    }
  },

  async doSearch() {
    if (this.state.searching) return;
    this.state.searching = true;

    const filters = this.getFilters();
    const hasFilters = filters.level || filters.pid || filters.tid || filters.tag
      || filters.time_start || filters.time_end || filters.keyword
      || App.state.activeRuleIds.length > 0;

    if (!hasFilters) {
      this.state.searching = false;
      return;
    }

    const params = {
      offset: this.state.offset,
      limit: this.state.limit,
    };

    if (App.state.activeRuleIds.length > 0) {
      params.rule_ids = App.state.activeRuleIds.join(',');
    }
    if (filters.level) params.level = filters.level;
    if (filters.pid) params.pid = filters.pid;
    if (filters.tid) params.tid = filters.tid;
    if (filters.tag) params.tag = filters.tag;
    if (filters.time_start) params.time_start = filters.time_start;
    if (filters.time_end) params.time_end = filters.time_end;
    if (filters.keyword) params.keyword = filters.keyword;

    App.showResults();
    App.setStatus('搜索中...');

    try {
      const result = await API.get('/api/search', params);

      let patterns = [];
      if (App.state.activeRuleIds.length > 0) {
        patterns = App.state.activeRuleIds.map(rid => {
          const rule = App.state.rules.find(r => r.id === rid);
          return rule ? { ruleId: rid, pattern: rule.pattern } : null;
        }).filter(Boolean);
      } else if (filters.keyword) {
        patterns = [{ ruleId: null, pattern: filters.keyword }];
      }
      this.state.currentPattern = patterns;
      this.state.total = result.total_matches;

      Table.render(result.items, patterns);
      Table.renderPagination(result.offset, result.limit, result.total_matches);

      const stats = document.getElementById('resultStats');
      stats.textContent = `匹配: ${result.total_matches.toLocaleString()} 条`;
      App.setStatus(`匹配 ${result.total_matches.toLocaleString()} 条`);
    } catch (e) {
      if (e.message && e.message.includes('请先加载日志文件')) {
        App.showWelcome();
        App.setStatus('请先加载日志文件');
      } else {
        showToast('搜索失败: ' + e.message, 'error');
        App.setStatus('搜索失败');
      }
    } finally {
      this.state.searching = false;
    }
  },
};