'use strict';

const $ = (id) => document.getElementById(id);

// ---------- Điều hướng menu ----------
$('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  btn.classList.add('active');
  const isCut = btn.dataset.screen === 'cut';
  $('cutScreen').classList.toggle('hidden', !isCut);
  $('placeholder').classList.toggle('hidden', isCut);
  $('screenTitle').textContent = btn.textContent.trim().replace(/^\S+\s/, '');
});

// ---------- Hướng dẫn collapse ----------
$('guideToggle').addEventListener('click', () => {
  $('guideBody').classList.toggle('hidden');
});

// ---------- Kiểm tra ffmpeg ----------
async function checkHealth() {
  try {
    const h = await fetch('/api/health').then((r) => r.json());
    if (!h.ffmpeg || !h.ffprobe) {
      const b = $('healthBanner');
      b.className = 'banner err';
      b.innerHTML = '⚠️ Chưa cài <b>ffmpeg/ffprobe</b>. Cài bằng: <code>sudo apt install ffmpeg</code> rồi tải lại trang.';
      $('btnRun').disabled = true;
    }
  } catch { /* bỏ qua */ }
}
checkHealth();

// ---------- Format ----------
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

// ---------- Log ----------
function logLine(msg, level) {
  const div = document.createElement('div');
  div.className = 'line' + (level ? ' ' + level : '');
  div.textContent = msg;
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
}

// ---------- Quét thư mục ----------
$('btnScan').addEventListener('click', async () => {
  const folder = $('folder').value.trim();
  if (!folder) return alert('Nhập đường dẫn thư mục video');
  try {
    const res = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    const body = $('previewBody');
    body.innerHTML = '';
    if (!res.videos.length) {
      body.innerHTML = '<tr><td colspan="3" class="empty">Không tìm thấy video</td></tr>';
      return;
    }
    res.videos.forEach((v, i) => {
      const tr = document.createElement('tr');
      const td = (t) => { const c = document.createElement('td'); c.textContent = t; return c; };
      tr.append(td(i + 1), td(v.name), td(fmtSize(v.size)));
      body.appendChild(tr);
    });
    if (!$('outDir').value.trim()) $('outDir').placeholder = folder.replace(/\/+$/, '') + '/output';
    logLine(`Quét xong: ${res.videos.length} video.`, 'ok');
  } catch (e) {
    alert('Lỗi quét: ' + e.message);
  }
});

// ---------- Modal chọn thư mục ----------
let modalCurrent = '';
let modalTargetId = 'folder'; // id ô input sẽ nhận đường dẫn khi bấm "Chọn thư mục này"
async function openModal(startPath) {
  const res = await fetch('/api/browse', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: startPath }),
  }).then((r) => r.json());
  if (res.error) return alert('Lỗi: ' + res.error);
  modalCurrent = res.current;
  $('modalPath').textContent = res.current;
  $('modalUp').dataset.path = res.parent || '';
  $('modalUp').disabled = !res.parent;
  const list = $('modalList');
  list.innerHTML = '';
  res.dirs.forEach((d) => {
    const li = document.createElement('li');
    li.textContent = '📁 ' + d.name;
    li.addEventListener('click', () => openModal(d.path));
    list.appendChild(li);
  });
  $('modal').classList.remove('hidden');
}
$('btnBrowse').addEventListener('click', () => { modalTargetId = 'folder'; openModal($('folder').value.trim()); });
$('btnBrowseOut').addEventListener('click', () => { modalTargetId = 'outDir'; openModal($('outDir').value.trim()); });
$('modalUp').addEventListener('click', () => { if ($('modalUp').dataset.path) openModal($('modalUp').dataset.path); });
$('modalClose').addEventListener('click', () => $('modal').classList.add('hidden'));
$('modalPick').addEventListener('click', () => {
  $(modalTargetId).value = modalCurrent;
  $('modal').classList.add('hidden');
});

// ---------- SSE parser ----------
function parseEvent(chunk) {
  let event = 'message';
  let data = '';
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  try { return { event, data: JSON.parse(data) }; } catch { return { event, data }; }
}

// ---------- Chạy xử lý ----------
let abortCtl = null;
function setTotal(pct) {
  $('totalBar').style.width = pct + '%';
  $('totalPct').textContent = pct + '%';
}

$('btnRun').addEventListener('click', async () => {
  const body = {
    folder: $('folder').value.trim(),
    outDir: $('outDir').value.trim(),
    keepMin: parseFloat($('keepMin').value),
    keepMax: parseFloat($('keepMax').value),
    gapMin: parseFloat($('gapMin').value),
    gapMax: parseFloat($('gapMax').value),
  };
  if (!body.folder) return alert('Nhập đường dẫn thư mục video');

  $('btnRun').disabled = true;
  $('btnStop').classList.remove('hidden');
  $('log').innerHTML = '';
  setTotal(0);
  abortCtl = new AbortController();

  try {
    const resp = await fetch('/api/process', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: abortCtl.signal,
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      throw new Error(j.error || 'Lỗi máy chủ');
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let total = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const { event, data } = parseEvent(chunk);
        if (event === 'log') logLine(data.message, data.level);
        else if (event === 'progress') {
          total = data.total || 1;
          const pct = Math.round(((data.index + data.pct) / total) * 100);
          setTotal(Math.min(100, pct));
        } else if (event === 'file-done') {
          logLine(`✔ Xong ${data.file} (${data.segments} đoạn) → ${data.output}`, 'ok');
        } else if (event === 'done') {
          setTotal(100);
          logLine(`HOÀN TẤT: thành công ${data.ok}, lỗi ${data.fail}. Xuất tại: ${data.outDir}`, 'ok');
        } else if (event === 'error') {
          logLine('LỖI: ' + data.message, 'error');
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') logLine('Đã dừng.', 'warn');
    else logLine('LỖI: ' + e.message, 'error');
  } finally {
    $('btnRun').disabled = false;
    $('btnStop').classList.add('hidden');
    abortCtl = null;
  }
});

$('btnStop').addEventListener('click', () => { if (abortCtl) abortCtl.abort(); });
