const Compare = {
  showCompareView() {
    if (App.state.files.length < 2) {
      showToast('请先加载至少两个日志文件', 'error');
      return;
    }

    document.getElementById('welcome').style.display = 'none';
    document.getElementById('searchResult').style.display = 'none';
    document.getElementById('compareView').style.display = '';
    document.getElementById('filterBar').style.display = 'none';
    App.setStatus('对比模式 - 选择规则后点击"开始对比"');

    this.renderCompareInit();
  },

  hideCompareView() {
    document.getElementById('compareView').style.display = 'none';
    App.showWelcome();
    if (App.state.files.length) {
      document.getElementById('filterBar').style.display = '';
    }
  },

  renderCompareInit() {
    const files = App.state.files;
    const rules = App.state.rules;
    const container = document.getElementById('compareContent');

    const ruleChecks = rules.map(r => `
      <label class="level-check" style="display:flex;gap:4px;margin:2px 0">
        <input type="checkbox" value="${r.id}" checked> ${escapeHtml(r.name)}
      </label>
    `).join('');

    container.innerHTML = `
      <div style="display:flex;gap:24px;margin-bottom:16px">
        <div style="flex:1;padding:12px;background:var(--input-bg);border-radius:6px;border:1px solid var(--border)">
          <div style="font-size:12px;color:var(--accent2);margin-bottom:4px">文件A</div>
          <div style="font-size:13px;font-weight:500">${escapeHtml(files[0].path.split(/[/\\\\]/).pop())}</div>
          <div style="font-size:11px;color:var(--text2)">${files[0].total_lines.toLocaleString()} 行 | ${files[0].time_start} ~ ${files[0].time_end}</div>
        </div>
        <div style="font-size:24px;color:var(--text2);display:flex;align-items:center">VS</div>
        <div style="flex:1;padding:12px;background:var(--input-bg);border-radius:6px;border:1px solid var(--border)">
          <div style="font-size:12px;color:var(--accent2);margin-bottom:4px">文件B</div>
          <div style="font-size:13px;font-weight:500">${escapeHtml(files[1].path.split(/[/\\\\]/).pop())}</div>
          <div style="font-size:11px;color:var(--text2)">${files[1].total_lines.toLocaleString()} 行 | ${files[1].time_start} ~ ${files[1].time_end}</div>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px">选择对比规则:</div>
        <div>${ruleChecks || '<span style="font-size:12px;color:var(--text2)">无规则，请先在左侧创建</span>'}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="Compare.runCompare()">🚀 开始对比</button>
      </div>
      <div id="compareResult" style="margin-top:20px"></div>
    `;
  },

  async runCompare() {
    const container = document.getElementById('compareContent');
    const checks = container.querySelectorAll('input[type="checkbox"]:checked');
    const ruleIds = Array.from(checks).map(cb => parseInt(cb.value));

    const resultDiv = document.getElementById('compareResult');
    resultDiv.innerHTML = '<div style="text-align:center;padding:24px"><span class="loading-spinner"></span> 对比中...</div>';

    try {
      const result = await API.post('/api/compare', { rule_ids: ruleIds, window_minutes: 5 });
      this.renderCompareResult(result);
    } catch (e) {
      resultDiv.innerHTML = `<div style="color:#ef5350;padding:12px">对比失败: ${e.message}</div>`;
    }
  },

  renderCompareResult(result) {
    const resultDiv = document.getElementById('compareResult');
    if (!resultDiv) return;

    const deltaClass = (d) => d > 0 ? 'color:#66bb6a' : d < 0 ? 'color:#ef5350' : 'color:var(--text2)';
    const deltaSign = (d) => d > 0 ? `+${d}` : `${d}`;

    const ruleRows = (result.rules || []).map(r => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.count_a.toLocaleString()}</td>
        <td>${r.count_b.toLocaleString()}</td>
        <td style="${deltaClass(r.delta)}">${deltaSign(r.delta)}</td>
      </tr>
    `).join('');

    const levelRows = 'DIWE'.split('').map(lv => {
      const ca = result.level_dist.a[lv] || 0;
      const cb = result.level_dist.b[lv] || 0;
      const d = cb - ca;
      return `<tr>
        <td><span class="level-badge level-${lv}">${lv}</span></td>
        <td>${ca.toLocaleString()}</td>
        <td>${cb.toLocaleString()}</td>
        <td style="${deltaClass(d)}">${deltaSign(d)}</td>
      </tr>`;
    }).join('');

    const fileA = result.file_a;
    const fileB = result.file_b;

    resultDiv.innerHTML = `
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div style="flex:1;min-width:280px">
          <h4 style="font-size:13px;margin-bottom:8px;color:var(--accent2)">规则命中对比</h4>
          <table class="compare-table">
            <thead>
              <tr><th>规则</th><th>文件A</th><th>文件B</th><th>差异</th></tr>
            </thead>
            <tbody>${ruleRows || '<tr><td colspan="4" style="color:var(--text2)">无数据</td></tr>'}</tbody>
          </table>

          <h4 style="font-size:13px;margin:16px 0 8px;color:var(--accent2)">日志级别分布对比</h4>
          <table class="compare-table">
            <thead>
              <tr><th>级别</th><th>文件A</th><th>文件B</th><th>差异</th></tr>
            </thead>
            <tbody>${levelRows}</tbody>
          </table>
        </div>
      </div>
    `;
  },
};