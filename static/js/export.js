const Export = {
  showExportDialog() {
    if (!App.state.files.length) {
      showToast('请先加载日志文件', 'error');
      return;
    }

    const rules = App.state.rules;
    const ruleOptions = rules.map(r =>
      `<option value="${r.id}">${escapeHtml(r.name)}</option>`
    ).join('');

    const bodyHtml = `
      <div class="form-group">
        <label>导出格式</label>
        <select id="exportFormat">
          <option value="txt">原始日志 (txt)</option>
          <option value="json">结构化数据 (json)</option>
        </select>
      </div>
      <div class="form-group">
        <label>使用已保存规则（可选，选"无"则导出当前筛选结果）</label>
        <select id="exportRule">
          <option value="">无 (当前筛选条件)</option>
          ${ruleOptions}
        </select>
      </div>
      <div class="form-group" style="font-size:11px;color:var(--text2)">
        导出将使用当前筛选条件（级别/时间/PID/Tag/关键字）与选定规则的组合结果
      </div>`;

    showModal('导出筛选结果', bodyHtml, async (box) => {
      const format = box.querySelector('#exportFormat').value;
      const ruleId = box.querySelector('#exportRule').value;

      const filters = Search.getFilters();
      const body = {
        format,
        rule_id: ruleId ? parseInt(ruleId) : App.state.activeRuleId || undefined,
        level: filters.level || undefined,
        pid: filters.pid || undefined,
        tid: filters.tid || undefined,
        tag: filters.tag || undefined,
        time_start: filters.time_start || undefined,
        time_end: filters.time_end || undefined,
        keyword: filters.keyword || undefined,
      };

      try {
        const result = await API.post('/api/export', body);
        showToast(`导出完成: ${result.total_matches.toLocaleString()} 条 → ${result.filename}`, 'success');

        const a = document.createElement('a');
        a.href = `/api/export/download?filename=${encodeURIComponent(result.filename)}`;
        a.download = result.filename;
        a.click();
      } catch (e) {
        showToast('导出失败: ' + e.message, 'error');
        throw e;
      }
    });
  },
};