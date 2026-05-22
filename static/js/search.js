const Search = {
  state: {
    offset: 0,
    limit: 500,
    total: 0,
    currentPattern: '',
    searching: false,
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
      level: levels.length > 0 && levels.length < 6 ? levels.join(',') : null,
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

  clearFilters() {
    document.querySelectorAll('#filterBar .level-check input').forEach(cb => {
      cb.checked = true;
    });
    document.getElementById('filterTimeStart').value = '';
    document.getElementById('filterTimeEnd').value = '';
    document.getElementById('filterPid').value = '';
    document.getElementById('filterTid').value = '';
    document.getElementById('filterTag').value = '';
    document.getElementById('filterKeyword').value = '';
    App.state.activeRuleId = null;
    Rules.render();
    this.state.offset = 0;
    this.state.currentPattern = '';
    App.showWelcome();
  },

  async doSearch() {
    if (this.state.searching) return;
    this.state.searching = true;

    const filters = this.getFilters();
    const hasFilters = filters.level || filters.pid || filters.tid || filters.tag
      || filters.time_start || filters.time_end || filters.keyword
      || App.state.activeRuleId;

    if (!hasFilters) {
      this.state.searching = false;
      return;
    }

    const params = {
      offset: this.state.offset,
      limit: this.state.limit,
    };

    if (App.state.activeRuleId) params.rule_id = App.state.activeRuleId;
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

      let pattern = filters.keyword || '';
      if (!pattern && App.state.activeRuleId) {
        const rule = App.state.rules.find(r => r.id === App.state.activeRuleId);
        if (rule) pattern = rule.pattern;
      }
      this.state.currentPattern = pattern;
      this.state.total = result.total_matches;

      Table.render(result.items, pattern);
      Table.renderPagination(result.offset, result.limit, result.total_matches);

      const stats = document.getElementById('resultStats');
      stats.textContent = `匹配: ${result.total_matches.toLocaleString()} 条`;
      App.setStatus(`匹配 ${result.total_matches.toLocaleString()} 条`);
    } catch (e) {
      showToast('搜索失败: ' + e.message, 'error');
      App.setStatus('搜索失败');
    } finally {
      this.state.searching = false;
    }
  },
};