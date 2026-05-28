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
      top:${rect.bottom + 4}px;left:${Math.max(0, Math.min(rect.left, window.innerWidth - 340))}px;
      background:#2a2a40;border:1px solid #555;border-radius:8px;
      padding:12px 16px;box-shadow:0 4px 16px rgba(0,0,0,0.5);
      display:flex;flex-direction:column;gap:10px;
    `;

    const mVal = parts ? parts[1] : '';
    const dVal = parts ? parts[2] : '';
    const hVal = parts ? parts[3] : '';
    const minVal = parts ? parts[4] : '';
    const sVal = parts ? parts[5] : '';
    const msVal = parts ? parts[6] : '';

    const dateRow = document.createElement('div');
    dateRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    dateRow.innerHTML = `
      <span style="color:#aaa;font-size:12px;margin-right:2px;">日期</span>
      <select id="tpMonth" style="background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:13px;width:70px;">
        <option value="">月</option>
        ${Array.from({length:12}, (_,i) => `<option value="${String(i+1).padStart(2,'0')}"${mVal === String(i+1).padStart(2,'0') ? ' selected' : ''}>${i+1}月</option>`).join('')}
      </select>
      <span style="color:#888;">-</span>
      <select id="tpDay" style="background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:13px;width:65px;">
        <option value="">日</option>
        ${Array.from({length:31}, (_,i) => `<option value="${String(i+1).padStart(2,'0')}"${dVal === String(i+1).padStart(2,'0') ? ' selected' : ''}>${i+1}日</option>`).join('')}
      </select>
    `;

    const timeRow = document.createElement('div');
    timeRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    timeRow.innerHTML = `
      <span style="color:#aaa;font-size:12px;margin-right:2px;">时间</span>
      <input type="text" id="tpHour" value="${hVal}" placeholder="00" maxlength="2" style="width:36px;text-align:center;background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 2px;font-size:13px;">
      <span style="color:#888;">:</span>
      <input type="text" id="tpMin" value="${minVal}" placeholder="00" maxlength="2" style="width:36px;text-align:center;background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 2px;font-size:13px;">
      <span style="color:#888;">:</span>
      <input type="text" id="tpSec" value="${sVal}" placeholder="00" maxlength="2" style="width:36px;text-align:center;background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 2px;font-size:13px;">
      <span style="color:#888;">.</span>
      <input type="text" id="tpMs" value="${msVal}" placeholder="000" maxlength="3" style="width:48px;text-align:center;background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 2px;font-size:13px;">
      <span style="color:#666;font-size:11px;">毫秒</span>
    `;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    btnRow.innerHTML = `
      <button class="btn btn-sm" id="tpNowBtn">🕐 现在</button>
      <button class="btn btn-sm btn-primary" id="tpOkBtn">确定</button>
    `;

    popup.appendChild(dateRow);
    popup.appendChild(timeRow);
    popup.appendChild(btnRow);
    document.body.appendChild(popup);

    document.getElementById('tpNowBtn').onclick = () => {
      const d = new Date();
      const pad2 = n => String(n).padStart(2, '0');
      const pad3 = n => String(n).padStart(3, '0');
      input.value = `${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
      this._hideTimePicker();
      Search.onFilterChange();
    };

    document.getElementById('tpOkBtn').onclick = () => {
      const m = document.getElementById('tpMonth').value;
      const d = document.getElementById('tpDay').value;
      const h = document.getElementById('tpHour').value.padStart(2, '0');
      const min = document.getElementById('tpMin').value.padStart(2, '0');
      const s = document.getElementById('tpSec').value.padStart(2, '0');
      const ms = document.getElementById('tpMs').value.padStart(3, '0');
      if (m && d) {
        input.value = `${m}-${d} ${h}:${min}:${s}.${ms}`;
      }
      this._hideTimePicker();
      Search.onFilterChange();
    };

    const closeOnClickOutside = (e) => {
      if (!popup.contains(e.target) && e.target !== input) {
        this._hideTimePicker();
        document.removeEventListener('mousedown', closeOnClickOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnClickOutside), 0);
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