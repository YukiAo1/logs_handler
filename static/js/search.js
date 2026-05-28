const Search = {
  state: {
    offset: 0,
    limit: 500,
    total: 0,
    currentPattern: '',
    searching: false,
  },

  initClearButtons() {
    document.querySelectorAll('.filter-clear').forEach(el => {
      el.addEventListener('click', () => {
        const targetId = el.dataset.target;
        if (targetId) {
          document.getElementById(targetId).value = '';
          Search.onFilterChange();
        }
      });
    });
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

  _initIssueTracker() {
    const upBtn = document.getElementById('issueUp');
    const downBtn = document.getElementById('issueDown');
    const mInput = document.getElementById('issueM');
    if (!upBtn || upBtn._trackerReady) return;
    upBtn._trackerReady = true;

    upBtn.addEventListener('click', () => {
      const m = parseInt(mInput.value) || 0;
      const n = Table._scenarioRowIndices.length;
      if (n === 0) return;
      const newM = Math.min(n, m + 1);
      mInput.value = newM;
      this._navigateIssue(newM);
    });

    downBtn.addEventListener('click', () => {
      const m = parseInt(mInput.value) || 0;
      if (m <= 0) return;
      const newM = Math.max(0, m - 1);
      mInput.value = newM;
      this._navigateIssue(newM);
    });

    mInput.addEventListener('change', () => {
      const n = Table._scenarioRowIndices.length;
      let v = parseInt(mInput.value);
      if (isNaN(v) || v < 0) v = 0;
      if (v > n) v = n;
      mInput.value = v;
      this._navigateIssue(v);
    });
  },

  _updateIssueTracker() {
    const el = document.getElementById('issueTracker');
    const nEl = document.getElementById('issueN');
    const mInput = document.getElementById('issueM');
    if (!el || !nEl || !mInput) return;
    const n = Table._scenarioRowIndices.length;
    if (n === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'inline-flex';
    nEl.textContent = n;
    const m = parseInt(mInput.value) || 0;
    if (m > n) {
      mInput.value = n;
    }
  },

  _navigateIssue(m) {
    const n = Table._scenarioRowIndices.length;
    if (n === 0 || m < 0 || m > n) return;
    const idx = m === 0 ? -1 : Table._scenarioRowIndices[m - 1];
    if (idx >= 0) {
      Table.scrollToIdx(idx);
    }
  },
};