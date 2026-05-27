function _extractError(err) {
  if (!err) return '未知错误';
  if (typeof err.detail === 'string') return err.detail;
  if (Array.isArray(err.detail) && err.detail.length > 0) {
    return err.detail.map(e => e.msg || JSON.stringify(e)).join('; ');
  }
  return err.detail || err.message || err.statusText || '未知错误';
}

const API = {
  base: '',

  async get(url, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const fullUrl = qs ? `${url}?${qs}` : url;
    const res = await fetch(fullUrl);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(_extractError(err));
    }
    return res.json();
  },

  async post(url, data = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(_extractError(err));
    }
    return res.json();
  },

  async put(url, data = {}) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(_extractError(err));
    }
    return res.json();
  },

  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(_extractError(err));
    }
    return res.json();
  },

  async upload(url, file, extraParams = {}) {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(extraParams)) {
      form.append(k, v);
    }
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(_extractError(err));
    }
    return res.json();
  },

  async uploadMultiple(url, files) {
    const form = new FormData();
    for (const f of files) {
      form.append('files', f);
    }
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(_extractError(err));
    }
    return res.json();
  },

  async download(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('下载失败');
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?(.+?)"?$/);
    const filename = match ? match[1] : 'download';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};