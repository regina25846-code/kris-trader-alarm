let data = { folders: [], memos: [], schedules: [] };
let config = {};
let activeTab = 'memo';
let calDate = new Date();
let openMemoIds = new Set();
let mgrSelectedFolder = null;
let mgrCheckedMemos = new Set();
let mgrSelectedMemoId = null;
let editingScheduleId = null;

// ── 사이드바 테마 ─────────────────────────────────────────────────────────────

const SIDEBAR_THEMES = {
  fluent:   { '--bg':'#202020','--bg2':'#2B2B2B','--bg3':'#333333','--bg4':'#3F3F3F','--border':'rgba(255,255,255,0.08)','--text':'#FFFFFF','--text2':'#CCCCCC','--text3':'#999999','--accent':'#60CDFF','--hover':'rgba(255,255,255,0.06)','--active':'rgba(255,255,255,0.09)','--todo-bg':'#272727','--todo-text':'#E0E0E0' },
  vscode:   { '--bg':'#1E1E1E','--bg2':'#252526','--bg3':'#2D2D30','--bg4':'#3E3E42','--border':'#333333','--text':'#ECECEC','--text2':'#C0AE90','--text3':'#8A7A60','--accent':'#E8A040','--hover':'rgba(255,255,255,0.07)','--active':'rgba(232,160,64,0.2)','--todo-bg':'#1E1E1E','--todo-text':'#D4B882' },
  paper:    { '--bg':'#FDF6E3','--bg2':'#EEE8D5','--bg3':'#E7E1CC','--bg4':'#DED8C3','--border':'#D1CBB5','--text':'#073642','--text2':'#586E75','--text3':'#93A1A1','--accent':'#B58900','--hover':'rgba(0,0,0,0.04)','--active':'rgba(0,0,0,0.08)','--todo-bg':'#FCF4CD','--todo-text':'#CB4B16' },
  frost:    { '--bg':'#F4F7FA','--bg2':'#FFFFFF','--bg3':'#EAF0F6','--bg4':'#DEE7F0','--border':'#C5D4E3','--text':'#1E293B','--text2':'#475569','--text3':'#94A3B8','--accent':'#2563EB','--hover':'rgba(37,99,235,0.06)','--active':'rgba(37,99,235,0.12)','--todo-bg':'#FFFFFF','--todo-text':'#0F172A' },
};
// backward compat
SIDEBAR_THEMES.darkgray = SIDEBAR_THEMES.fluent;
SIDEBAR_THEMES.dark     = SIDEBAR_THEMES.fluent;
SIDEBAR_THEMES.black    = SIDEBAR_THEMES.fluent;
SIDEBAR_THEMES.light    = SIDEBAR_THEMES.paper;

function applyTheme(name) {
  const theme = SIDEBAR_THEMES[name] || SIDEBAR_THEMES.fluent;
  const root = document.documentElement;
  Object.entries(theme).forEach(([k, v]) => root.style.setProperty(k, v));
}

// ── 음력 계산 (근사값, ±1일 오차 가능) ─────────────────────────────────────────
const LUNAR_NY = [
  [2015,2,19],[2016,2,8],[2017,1,28],[2018,2,16],[2019,2,5],
  [2020,1,25],[2021,2,12],[2022,2,1],[2023,1,22],[2024,2,10],
  [2025,1,29],[2026,2,17],[2027,2,6],[2028,1,26],[2029,2,13],[2030,2,3]
];
function solarToLunar(y, m, d) {
  const t = new Date(y, m-1, d);
  for (let i = 0; i < LUNAR_NY.length - 1; i++) {
    const s = new Date(LUNAR_NY[i][0], LUNAR_NY[i][1]-1, LUNAR_NY[i][2]);
    const n = new Date(LUNAR_NY[i+1][0], LUNAR_NY[i+1][1]-1, LUNAR_NY[i+1][2]);
    if (t >= s && t < n) {
      const days = Math.round((t - s) / 86400000);
      const SYNODIC = 29.530588853;
      const mIdx = Math.floor(days / SYNODIC);
      const dNum = days - Math.round(mIdx * SYNODIC) + 1;
      return { month: mIdx + 1, day: dNum };
    }
  }
  return null;
}

async function refresh() {
  data = await window.api.getData();
  if (!data.schedules) data.schedules = [];
  config = await window.api.getConfig();
  applyTheme(config.sidebarTheme);
  if (config.fontSidebar) {
    const parts = config.fontSidebar.split(',').map(f => `'${f.trim()}'`).join(',');
    document.body.style.fontFamily = `${parts},'맑은 고딕',sans-serif`;
  }
  if (config.fontSidebarSize) document.documentElement.style.setProperty('--fs', config.fontSidebarSize + 'px');
  document.body.classList.add('side-' + (config.sidebarSide || 'right'));
  if (config.todoBgColor) document.documentElement.style.setProperty('--todo-bg', config.todoBgColor);
  if (config.todoTextColor) document.documentElement.style.setProperty('--todo-text', config.todoTextColor);
  for (const m of data.memos) {
    const open = await window.api.memoIsOpen(m.id);
    if (open) openMemoIds.add(m.id);
    else openMemoIds.delete(m.id);
  }
  renderList();
  renderAllMemoList();
  renderScheduleList();
  renderFavorites();
  renderCalendar();
  renderDailyTodo();
}

// ── Daily Todo ────────────────────────────────────────────────────────────────

let _todoSaveTimer = null;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderDailyTodo() {
  const key = todayKey();
  const d = new Date();
  const days = ['일','월','화','수','목','금','토'];
  document.getElementById('daily-todo-datestr').textContent =
    `${d.getMonth()+1}/${d.getDate()}(${days[d.getDay()]})`;

  // 오늘 스케쥴 표시
  const schedContainer = document.getElementById('daily-sched-items');
  schedContainer.innerHTML = '';
  const todayScheds = (data.schedules || [])
    .filter(s => s.date === key && !s.done)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  todayScheds.forEach(s => {
    const el = document.createElement('div');
    el.className = 'daily-sched-item';
    el.textContent = s.time ? `${s.time} ${s.title}` : s.title;
    schedContainer.appendChild(el);
  });

  // 저장된 텍스트 로드
  const ta = document.getElementById('daily-todo-text');
  const saved = config.dailyTodo || '';
  ta.value = saved;
  autoResizeTodo(ta);
}

function autoResizeTodo(ta) {
  ta.style.height = 'auto';
  const lineH = 20.8; // 13px * 1.6
  const minH = lineH * 5 + 10;
  ta.style.height = Math.max(minH, ta.scrollHeight) + 'px';
}

function saveDailyTodo() {
  const val = document.getElementById('daily-todo-text').value;
  config.dailyTodo = val;
  window.api.saveConfig(config);
}

// 이벤트 연결은 DOMContentLoaded 이후 하단에서 처리

// ── Helpers ───────────────────────────────────────────────────────────────────

function folderColor(folder) {
  const colors = { basic:'#4a90d9', coin:'#e8893a' };
  return folder?.color || colors[folder?.id] || '#888';
}
function memoColor(memo) { return memo.color || '#fffde7'; }
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = ['일','월','화','수','목','금','토'];
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}(${days[d.getDay()]}) ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── Memo list ─────────────────────────────────────────────────────────────────

let collapsedFolders = new Set();

function renderList() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const container = document.getElementById('list-area');
  container.innerHTML = '';
  const allFolders = [...(data.folders || [])].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const folders = allFolders.filter(f => !f.parentId);
  const memos = data.memos || [];

  folders.forEach(folder => {
    const folderMemos = memos.filter(m => {
      if (m.folderId !== folder.id) return false;
      if (q) return (m.title + m.content).toLowerCase().includes(q);
      return true;
    });
    if (config.starredFirst) folderMemos.sort((a,b) => (b.starred ? 1:0) - (a.starred ? 1:0));
    const isCollapsed = collapsedFolders.has(folder.id);
    const isLocked = !!folder.passwordHash && !unlockedFolderIds.has(folder.id);
    const lockIcon = folder.passwordHash ? (isLocked ? '<svg class="folder-lock-icon" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : '<svg class="folder-lock-icon" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>') : '';
    const fh = document.createElement('div');
    fh.className = 'folder-header' + (isCollapsed ? ' folder-collapsed' : '');
    fh.innerHTML = `<div class="folder-icon" style="background:${folderColor(folder)}"><svg viewBox="0 0 24 24" width="10" height="10" fill="white" stroke="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><span class="folder-name">${folder.name}</span>${lockIcon}<span class="folder-count">(${isLocked ? '?' : folderMemos.length})</span><span class="folder-chevron">▼</span>`;
    fh.onclick = () => {
      if (isLocked) { openFlockModal(folder); return; }
      if (isCollapsed) collapsedFolders.delete(folder.id); else collapsedFolders.add(folder.id); renderList();
    };
    fh.ondblclick = (e) => { if (isLocked) return; e.stopPropagation(); openFolderRename(folder); };
    fh.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showFolderCtx(e, folder); };

    // 폴더 헤더 드래그 (순서 변경)
    fh.draggable = true;
    fh.ondragstart = (e) => {
      dragFolderId = folder.id;
      dragMemoId = null;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { fh.style.opacity = '0.5'; }, 0);
    };
    fh.ondragend = () => {
      dragFolderId = null;
      fh.style.opacity = '';
      fh.style.borderTop = '';
      fh.style.background = '';
    };

    // 폴더 헤더 드롭 (메모 이동 or 폴더 순서 변경)
    fh.ondragover = (e) => {
      e.preventDefault();
      if (dragMemoId) {
        fh.style.background = 'rgba(90,159,212,0.15)';
        fh.style.borderTop = '';
      } else if (dragFolderId && dragFolderId !== folder.id) {
        fh.style.borderTop = '2px solid var(--accent)';
        fh.style.background = '';
      }
    };
    fh.ondragleave = () => {
      fh.style.background = '';
      fh.style.borderTop = '';
    };
    fh.ondrop = async (e) => {
      e.preventDefault();
      fh.style.background = '';
      fh.style.borderTop = '';
      if (dragMemoId) {
        await window.api.moveMemo({ memoId: dragMemoId, folderId: folder.id });
        dragMemoId = null;
        refresh();
      } else if (dragFolderId && dragFolderId !== folder.id) {
        const fi = folders.findIndex(f => f.id === dragFolderId);
        const ti = folders.findIndex(f => f.id === folder.id);
        if (fi < 0 || ti < 0) return;
        const arr = [...folders];
        const [moved] = arr.splice(fi, 1);
        arr.splice(ti, 0, moved);
        for (let i = 0; i < arr.length; i++) await window.api.saveFolder({ ...arr[i], order: i });
        dragFolderId = null;
        refresh();
      }
    };

    container.appendChild(fh);

    const ml = document.createElement('div');
    if (isCollapsed || isLocked) ml.style.display = 'none';
    folderMemos.forEach(memo => addMemoItem(ml, memo));
    // 폴더 하단 여백 드롭 존 (마지막 폴더에 메모 드롭 가능하도록)
    const dz = document.createElement('div');
    dz.style.cssText = 'min-height:14px;';
    dz.ondragover = (e) => {
      if (!dragMemoId) return;
      e.preventDefault();
      dz.style.background = 'rgba(90,159,212,0.08)';
    };
    dz.ondragleave = () => { dz.style.background = ''; };
    dz.ondrop = async (e) => {
      e.preventDefault();
      dz.style.background = '';
      if (!dragMemoId) return;
      await window.api.moveMemo({ memoId: dragMemoId, folderId: folder.id });
      dragMemoId = null;
      refresh();
    };
    ml.appendChild(dz);
    container.appendChild(ml);

    // 하위 폴더 렌더링
    const subFolders = allFolders.filter(f => f.parentId === folder.id);
    subFolders.forEach(sub => {
      const subMemos = memos.filter(m => {
        if (m.folderId !== sub.id) return false;
        if (q) return (m.title + m.content).toLowerCase().includes(q);
        return true;
      });
      if (config.starredFirst) subMemos.sort((a,b) => (b.starred ? 1:0) - (a.starred ? 1:0));
      const isSubCollapsed = collapsedFolders.has(sub.id);
      const sfh = document.createElement('div');
      sfh.className = 'folder-header subfolder' + (isSubCollapsed ? ' folder-collapsed' : '') + (isCollapsed ? ' after-collapsed' : '');
      sfh.innerHTML = `<span style="color:var(--text3);font-size:11px;margin-right:2px;flex-shrink:0;">└</span><div class="folder-icon" style="background:${folderColor(sub)}"><svg viewBox="0 0 24 24" width="10" height="10" fill="white" stroke="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><span class="folder-name">${sub.name}</span><span class="folder-count">(${subMemos.length})</span><span class="folder-chevron">▼</span>`;
      sfh.onclick = () => {
        if (isSubCollapsed) collapsedFolders.delete(sub.id); else collapsedFolders.add(sub.id);
        renderList();
      };
      sfh.ondblclick = (e) => { e.stopPropagation(); openFolderRename(sub); };
      sfh.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showFolderCtx(e, sub); };

      // 드래그앤드롭
      sfh.draggable = true;
      sfh.ondragstart = (e) => {
        dragFolderId = sub.id;
        dragMemoId = null;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => { sfh.style.opacity = '0.5'; }, 0);
      };
      sfh.ondragend = () => { dragFolderId = null; sfh.style.opacity = ''; sfh.style.borderTop = ''; sfh.style.background = ''; };
      sfh.ondragover = (e) => {
        e.preventDefault();
        if (dragMemoId) { sfh.style.background = 'rgba(90,159,212,0.15)'; sfh.style.borderTop = ''; }
        else if (dragFolderId && dragFolderId !== sub.id) { sfh.style.borderTop = '2px solid var(--accent)'; sfh.style.background = ''; }
      };
      sfh.ondragleave = () => { sfh.style.background = ''; sfh.style.borderTop = ''; };
      sfh.ondrop = async (e) => {
        e.preventDefault();
        sfh.style.background = ''; sfh.style.borderTop = '';
        if (dragMemoId) {
          await window.api.moveMemo({ memoId: dragMemoId, folderId: sub.id });
          dragMemoId = null; refresh();
        } else if (dragFolderId && dragFolderId !== sub.id) {
          const siblings = allFolders.filter(f => f.parentId === folder.id).sort((a,b) => (a.order??999)-(b.order??999));
          const fi = siblings.findIndex(f => f.id === dragFolderId);
          const ti = siblings.findIndex(f => f.id === sub.id);
          if (fi < 0 || ti < 0) return;
          const arr = [...siblings];
          const [moved] = arr.splice(fi, 1);
          arr.splice(ti, 0, moved);
          for (let i = 0; i < arr.length; i++) await window.api.saveFolder({ ...arr[i], order: i });
          dragFolderId = null; refresh();
        }
      };
      container.appendChild(sfh);
      const sml = document.createElement('div');
      if (isSubCollapsed) sml.style.display = 'none';
      subMemos.forEach(memo => addMemoItem(sml, memo, true));
      container.appendChild(sml);
    });
  });

  const uncatMemos = memos.filter(m => {
    if (allFolders.map(f => f.id).includes(m.folderId)) return false;
    if (q) return (m.title + m.content).toLowerCase().includes(q);
    return true;
  });
  if (uncatMemos.length > 0) {
    if (config.starredFirst) uncatMemos.sort((a,b) => (b.starred ? 1:0) - (a.starred ? 1:0));
    const fh = document.createElement('div');
    fh.className = 'folder-header';
    fh.innerHTML = `<div class="folder-icon" style="background:#888"><svg viewBox="0 0 24 24" width="10" height="10" fill="white" stroke="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><span class="folder-name">기타</span><span class="folder-count">(${uncatMemos.length})</span>`;
    container.appendChild(fh);
    uncatMemos.forEach(memo => addMemoItem(container, memo));
  }
}

let dragMemoId = null;
let dragFolderId = null;
const unlockedFolderIds = new Set();

function getMemoFolder(memo) {
  return (data.folders || []).find(f => f.id === memo.folderId) || null;
}
function isMemoLocked(memo) {
  const folder = getMemoFolder(memo);
  return !!folder?.passwordHash && !unlockedFolderIds.has(folder.id);
}

// 비밀번호 필드 유틸
function toggleEye(inputId, btn) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  btn.style.opacity = show ? '1' : '0.45';
}
function blockKorean(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener('input', () => {
    const cleaned = el.value.replace(/[^\x20-\x7E]/g, '');
    if (cleaned !== el.value) el.value = cleaned;
  });
}
// 모든 비밀번호 필드에 한글 차단 적용
['flock-pw','flock-new-pw1','flock-new-pw2',
 'setpw-current','setpw-new1','setpw-new2','rmpw-pw'].forEach(blockKorean);

function addMemoItem(container, memo, isSubfolder) {
  const item = document.createElement('div');
  item.className = 'memo-item' + (openMemoIds.has(memo.id) ? ' open' : '') + (isSubfolder ? ' subfolder-memo' : '');
  item.draggable = true;
  item.dataset.id = memo.id;
  item.innerHTML = `<div class="memo-dot" style="background:${memoColor(memo)}"></div><span class="memo-title">${memo.title || '(제목 없음)'}</span>${memo.starred ? '<svg class="memo-star" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : ''}`;
  item.onclick = () => openMemo(memo);
  item.ondblclick = (e) => { e.stopPropagation(); openMemo(memo); };
  item.oncontextmenu = (e) => { e.preventDefault(); showMemoCtx(e, memo); };

  item.ondragstart = (e) => {
    dragMemoId = memo.id;
    item.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
  };
  item.ondragend = () => { item.style.opacity = ''; };
  item.ondragover = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    item.style.borderTop = '2px solid var(--accent)';
  };
  item.ondragleave = () => { item.style.borderTop = ''; };
  item.ondrop = async (e) => {
    e.preventDefault();
    item.style.borderTop = '';
    if (!dragMemoId || dragMemoId === memo.id) return;
    const d = await window.api.getData();
    const fromIdx = d.memos.findIndex(m => m.id === dragMemoId);
    const toIdx = d.memos.findIndex(m => m.id === memo.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = d.memos.splice(fromIdx, 1);
    moved.folderId = memo.folderId;
    d.memos.splice(toIdx, 0, moved);
    for (const m of d.memos) await window.api.saveMemo(m);
    dragMemoId = null;
    refresh();
  };
  container.appendChild(item);
}

async function openMemo(memo) {
  if (isMemoLocked(memo)) {
    const folder = getMemoFolder(memo);
    if (folder) openFlockModal(folder, memo);
    return;
  }
  await window.api.openMemo(memo);
  openMemoIds.add(memo.id);
  renderList();
}

// ── All memo list ─────────────────────────────────────────────────────────────

function renderAllMemoList() {
  const container = document.getElementById('all-memo-list');
  container.innerHTML = '';
  const memos = [...(data.memos || [])].sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  memos.forEach(memo => {
    const locked = isMemoLocked(memo);
    const item = document.createElement('div');
    item.className = 'all-memo-item';
    item.innerHTML = locked
      ? `<span style="font-size:10px;margin-right:4px;">🔒</span><span class="mi-title" style="color:var(--text3)">잠긴 메모</span>`
      : `<span class="mi-title">${memo.title || '(제목 없음)'}</span>`;
    item.onclick = () => openMemo(memo);
    container.appendChild(item);
  });
}

// ── Favorites ─────────────────────────────────────────────────────────────────

function renderFavorites() {
  const container = document.getElementById('fav-list');
  container.innerHTML = '';
  const starred = (data.memos || []).filter(m => m.starred);
  if (!starred.length) {
    container.innerHTML = '<div class="fav-empty">★ 즐겨찾기한 메모가 없습니다<br><br>메모 우클릭 → 즐겨찾기 추가</div>';
    return;
  }
  starred.forEach(memo => {
    const locked = isMemoLocked(memo);
    const item = document.createElement('div');
    item.className = 'fav-item';
    item.innerHTML = locked
      ? `<div class="fav-dot" style="background:var(--text3)"></div><span class="fav-title" style="color:var(--text3)">🔒 잠긴 메모</span><svg class="memo-star" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
      : `<div class="fav-dot" style="background:${memoColor(memo)}"></div><span class="fav-title">${memo.title || '(제목 없음)'}</span><svg class="memo-star" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    item.onclick = () => openMemo(memo);
    if (!locked) item.oncontextmenu = (e) => { e.preventDefault(); showMemoCtx(e, memo); };
    container.appendChild(item);
  });
}

// ── Schedule list ─────────────────────────────────────────────────────────────

function renderScheduleList() {
  const container = document.getElementById('sched-list');
  container.innerHTML = '';
  const schedules = [...(data.schedules || [])].sort((a,b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (a.date + a.time) < (b.date + b.time) ? -1 : 1;
  });
  if (!schedules.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;font-size:11px;color:var(--text3)">일정이 없습니다</div>';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  schedules.forEach(s => {
    const overdue = !s.done && s.date < today;
    const item = document.createElement('div');
    item.className = 'sched-item' + (s.done ? ' done-item' : '');
    const typeLabel = s.scheduleType === 'allday' ? '하루종일' : s.scheduleType === 'duration' ? `${s.time||''}~${s.endTime||''}` : s.time || '';
    const hasAlarm = s.alarmType ? s.alarmType !== 'none' : !!s.alarm;
    const ddayDiff = s.dday && s.date ? Math.ceil((new Date(s.date+'T00:00:00') - new Date(today+'T00:00:00')) / 86400000) : null;
    const ddayStr = ddayDiff !== null ? (ddayDiff === 0 ? ' <span style="color:#e0a040">D-day</span>' : ddayDiff > 0 ? ` <span style="color:#7090e0">D-${ddayDiff}</span>` : ` <span style="color:var(--text3)">D+${-ddayDiff}</span>`) : '';
    item.innerHTML = `
      <input type="checkbox" class="sched-check" ${s.done ? 'checked' : ''}>
      <div class="sched-body">
        <div class="sched-title ${overdue ? 'sched-overdue' : ''}">${s.title}${ddayStr}</div>
        <div class="sched-time">${s.date}${typeLabel ? ' '+typeLabel : ''} ${hasAlarm ? '<span class="sched-alarm">🔔</span>' : ''}</div>
        ${s.content ? `<div class="sched-time" style="margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">${s.content}</div>` : ''}
      </div>
      <button class="sched-del">✕</button>
    `;
    item.querySelector('.sched-check').onchange = async (e) => {
      e.stopPropagation();
      await window.api.saveSchedule({ ...s, done: e.target.checked });
      refresh();
    };
    item.querySelector('.sched-del').onclick = async (e) => {
      e.stopPropagation();
      await window.api.deleteSchedule(s.id);
      refresh();
    };
    item.ondblclick = () => openScheduleModal(s);
    container.appendChild(item);
  });
}

// Schedule modal
const ALARM_LABELS = { none:'없음', '0m':'시작 시간', '5m':'5분 전', '10m':'10분 전', '30m':'30분 전', '1h':'1시간 전', '1d':'1일 전' };
const REPEAT_LABELS = { once:'반복 안 함', daily:'매일', weekly:'매주', monthly:'매월', yearly:'매년' };

function updateSchedTypeUI() {
  const isAllday = document.getElementById('sf-allday-check').checked;
  const row = document.getElementById('ns-datetime-row');
  if (row) row.classList.toggle('ns-dt-with-time', !isAllday);
  document.querySelectorAll('.ns-dt-time').forEach(el => el.style.display = isAllday ? 'none' : '');
  document.getElementById('sf-type').value = isAllday ? 'allday' : 'specific';
}

function setAlarmUI(val) {
  document.getElementById('sf-reminder').value = val;
  document.getElementById('ns-alarm-label').textContent = ALARM_LABELS[val] || '없음';
  const radio = document.querySelector(`input[name="ns-alarm"][value="${val}"]`);
  if (radio) radio.checked = true;
  else { const none = document.getElementById('ns-al-none'); if (none) none.checked = true; }
}

function setRepeatUI(val) {
  document.getElementById('sf-repeat').value = val;
  document.getElementById('ns-repeat-label').textContent = REPEAT_LABELS[val] || '반복 안 함';
  const radio = document.querySelector(`input[name="ns-repeat"][value="${val}"]`);
  if (radio) radio.checked = true;
  else { const once = document.getElementById('ns-rp-once'); if (once) once.checked = true; }
}

function openScheduleModal(schedule, prefilledDate) {
  editingScheduleId = schedule?.id || null;
  const dateStr = schedule?.date || prefilledDate || new Date().toISOString().slice(0,10);
  document.getElementById('sched-hd-date').textContent = schedule ? '일정 수정' : '새 일정';
  document.getElementById('sf-save').textContent = schedule ? '저장' : '추가';
  document.getElementById('sf-title').value = schedule?.title || '';
  document.getElementById('sf-date').value = dateStr;
  document.getElementById('sf-end-date').value = schedule?.endDate || dateStr;
  document.getElementById('sf-time').value = schedule?.time || '09:00';
  document.getElementById('sf-end-time').value = schedule?.endTime || '';
  loadDtFromInputs();
  document.getElementById('sf-location').value = schedule?.location || '';
  document.getElementById('sf-content').value = schedule?.content || '';
  document.getElementById('sf-done').checked = !!schedule?.done;
  document.getElementById('sf-auto-delete').checked = !!schedule?.autoDelete;
  document.getElementById('sf-dday').checked = !!schedule?.dday;
  const isAllday = schedule?.scheduleType === 'allday';
  document.getElementById('sf-allday-check').checked = isAllday;
  updateSchedTypeUI();
  setAlarmUI(schedule?.reminder || 'none');
  setRepeatUI(schedule?.repeat || 'once');
  customAlarms = schedule?.customReminders ? [...schedule.customReminders] : [];
  document.getElementById('ns-drum-wrap').style.display = 'none';
  renderCustomAlarmList();
  document.querySelectorAll('.ns-sub-panel').forEach(p => p.classList.remove('show'));
  document.getElementById('sched-modal').classList.add('show');
  setTimeout(() => document.getElementById('sf-title').focus(), 50);
}

// ── DateTime drum picker ───────────────────────────────────────────────────────
let dtStart = { y: 2026, mo: 1, d: 1, h: 9, mi: 0 };
let dtEnd   = { y: 2026, mo: 1, d: 1, h: 10, mi: 0 };

function getDaysInMonth(y, mo) { return new Date(y, mo, 0).getDate(); }

function updateDtDisplay(which) {
  const obj = which === 's' ? dtStart : dtEnd;
  const pad = n => String(n).padStart(2, '0');
  const dmax = getDaysInMonth(obj.y, obj.mo);
  const fields = {
    y:  { min: 2020, max: 2040, fmt: n => String(n) },
    mo: { min: 1, max: 12, fmt: pad },
    d:  { min: 1, max: dmax, fmt: pad },
    h:  { min: 0, max: 23, fmt: pad },
    mi: { min: 0, max: 59, fmt: pad },
  };
  Object.entries(fields).forEach(([f, { min, max, fmt }]) => {
    const v = obj[f];
    const pv = v > min ? v - 1 : max;
    const nv = v < max ? v + 1 : min;
    const ep = document.getElementById(`dt-${which}-${f}-prev`);
    const ec = document.getElementById(`dt-${which}-${f}-cur`);
    const en = document.getElementById(`dt-${which}-${f}-next`);
    if (ep) ep.textContent = fmt(pv);
    if (ec) ec.textContent = fmt(v);
    if (en) en.textContent = fmt(nv);
  });
  document.getElementById(which === 's' ? 'sf-date' : 'sf-end-date').value = `${obj.y}-${pad(obj.mo)}-${pad(obj.d)}`;
  document.getElementById(which === 's' ? 'sf-time' : 'sf-end-time').value = `${pad(obj.h)}:${pad(obj.mi)}`;
}

function animateDrumEl(elId, dir) {
  const el = document.getElementById(elId);
  if (!el) return;
  const cls = dir > 0 ? 'ns-anim-up' : 'ns-anim-down';
  el.classList.remove('ns-anim-up', 'ns-anim-down');
  void el.offsetWidth;
  el.classList.add(cls);
}

function dtChange(which, field, delta) {
  const obj = which === 's' ? dtStart : dtEnd;
  const mins = { y: 2020, mo: 1, d: 1, h: 0, mi: 0 };
  const maxs = { y: 2040, mo: 12, d: getDaysInMonth(obj.y, obj.mo), h: 23, mi: 59 };
  let v = obj[field] + delta;
  if (v > maxs[field]) v = mins[field];
  if (v < mins[field]) v = maxs[field];
  obj[field] = v;
  if (field === 'y' || field === 'mo') {
    const dmax = getDaysInMonth(obj.y, obj.mo);
    if (obj.d > dmax) obj.d = dmax;
  }
  updateDtDisplay(which);
  animateDrumEl(`dt-${which}-${field}-cur`, delta);
}

function loadDtFromInputs() {
  const sDate = document.getElementById('sf-date').value || new Date().toISOString().slice(0, 10);
  const sTime = document.getElementById('sf-time').value || '09:00';
  const eDate = document.getElementById('sf-end-date').value || sDate;
  const eTime = document.getElementById('sf-end-time').value;
  const pd = s => { const [y, mo, d] = s.split('-').map(Number); return { y, mo, d }; };
  const pt = s => { if (!s) return null; const [h, mi] = s.split(':').map(Number); return { h, mi }; };
  dtStart = { ...pd(sDate), ...(pt(sTime) || { h: 9, mi: 0 }) };
  const et = pt(eTime) || { h: Math.min(dtStart.h + 1, 23), mi: dtStart.mi };
  dtEnd = { ...pd(eDate), ...et };
  updateDtDisplay('s');
  updateDtDisplay('e');
}

function makeDtDrumCol(which, field, isTime) {
  const col = document.createElement('div');
  col.className = 'ns-dt-col' + (field === 'y' ? ' ns-dt-col-y' : '') + (isTime ? ' ns-dt-time' : '');
  col.innerHTML = `
    <div class="ns-dt-ghost" id="dt-${which}-${field}-prev"></div>
    <div class="ns-dt-cur" id="dt-${which}-${field}-cur"></div>
    <div class="ns-dt-ghost" id="dt-${which}-${field}-next"></div>
    <div class="ns-dt-up"></div>
    <div class="ns-dt-down"></div>`;
  col.querySelector('.ns-dt-up').onclick = () => dtChange(which, field, 1);
  col.querySelector('.ns-dt-down').onclick = () => dtChange(which, field, -1);
  col.addEventListener('wheel', e => { e.preventDefault(); dtChange(which, field, e.deltaY < 0 ? 1 : -1); }, { passive: false });
  return col;
}

function makeDtSep(text, isTime) {
  const s = document.createElement('span');
  s.className = 'ns-dt-sep' + (isTime ? ' ns-dt-time' : '');
  if (text) s.textContent = text;
  return s;
}

function buildDtGroup(which, container) {
  const wrap = document.createElement('div');
  wrap.className = 'ns-dt-group';
  wrap.appendChild(makeDtDrumCol(which, 'y', false));
  wrap.appendChild(makeDtSep('.'));
  wrap.appendChild(makeDtDrumCol(which, 'mo', false));
  wrap.appendChild(makeDtSep('.'));
  wrap.appendChild(makeDtDrumCol(which, 'd', false));
  const spacer = makeDtSep('', true);
  spacer.style.width = '8px';
  wrap.appendChild(spacer);
  wrap.appendChild(makeDtDrumCol(which, 'h', true));
  wrap.appendChild(makeDtSep(':', true));
  wrap.appendChild(makeDtDrumCol(which, 'mi', true));
  container.appendChild(wrap);
}

function initDtDrums() {
  buildDtGroup('s', document.getElementById('ns-dt-start'));
  buildDtGroup('e', document.getElementById('ns-dt-end'));
}

// ── 드럼 피커 ─────────────────────────────────────────────────────────────────
let drumNum = 10, drumUnitIdx = 0;
const DRUM_UNITS = ['분', '시간', '일', '주'];
const DRUM_MAX   = [999, 999, 999, 999];
let customAlarms = [];

function updateDrum() {
  const prev = drumNum > 1 ? drumNum - 1 : DRUM_MAX[drumUnitIdx];
  const next = drumNum < DRUM_MAX[drumUnitIdx] ? drumNum + 1 : 1;
  document.getElementById('drum-num-prev').textContent = prev;
  document.getElementById('drum-num-cur').textContent = drumNum;
  document.getElementById('drum-num-next').textContent = next;
  document.getElementById('drum-unit-prev').textContent = DRUM_UNITS[(drumUnitIdx - 1 + 4) % 4];
  document.getElementById('drum-unit-cur').textContent = DRUM_UNITS[drumUnitIdx];
  document.getElementById('drum-unit-next').textContent = DRUM_UNITS[(drumUnitIdx + 1) % 4];
}
function drumNumUp() { drumNum = drumNum > 1 ? drumNum - 1 : DRUM_MAX[drumUnitIdx]; updateDrum(); animateDrumEl('drum-num-cur', -1); }
function drumNumDown() { drumNum = drumNum < DRUM_MAX[drumUnitIdx] ? drumNum + 1 : 1; updateDrum(); animateDrumEl('drum-num-cur', 1); }
function drumUnitUp() { drumUnitIdx = (drumUnitIdx - 1 + 4) % 4; updateDrum(); animateDrumEl('drum-unit-cur', -1); }
function drumUnitDown() { drumUnitIdx = (drumUnitIdx + 1) % 4; updateDrum(); animateDrumEl('drum-unit-cur', 1); }

function customAlarmLabel(a) {
  return `${a.num}${a.unit} 전`;
}

function renderCustomAlarmList() {
  const wrap = document.getElementById('ns-custom-alarm-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  customAlarms.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'ns-section';
    row.style.marginBottom = '8px';
    row.innerHTML = `<div class="ns-custom-alarm-row"><span>${customAlarmLabel(a)}</span><button class="ns-custom-alarm-del"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`;
    row.querySelector('.ns-custom-alarm-del').onclick = () => {
      customAlarms.splice(i, 1);
      renderCustomAlarmList();
    };
    wrap.appendChild(row);
  });
  const addBtn = document.getElementById('ns-add-custom-alarm-btn');
  if (addBtn) addBtn.style.display = customAlarms.length >= 10 ? 'none' : '';
}

// 알람 드럼 휠 + 직접 입력
document.getElementById('drum-num-col').addEventListener('wheel', e => {
  e.preventDefault();
  e.deltaY < 0 ? drumNumUp() : drumNumDown();
}, { passive: false });
document.getElementById('drum-unit-col').addEventListener('wheel', e => {
  e.preventDefault();
  e.deltaY < 0 ? drumUnitUp() : drumUnitDown();
}, { passive: false });

function openDrumNumEdit() {
  const cur = document.getElementById('drum-num-cur');
  if (cur.querySelector('input')) return;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.min = '1';
  inp.max = '999';
  inp.value = drumNum;
  inp.style.cssText = 'width:70px;font-size:26px;font-weight:800;text-align:center;background:transparent;border:none;border-bottom:2px solid var(--accent);color:var(--text);font-family:inherit;outline:none;height:36px;padding:0;pointer-events:auto;';
  cur.textContent = '';
  cur.appendChild(inp);
  inp.focus();
  inp.select();
  const commit = () => {
    const v = parseInt(inp.value);
    if (!isNaN(v) && v >= 1 && v <= DRUM_MAX[drumUnitIdx]) drumNum = v;
    updateDrum();
  };
  inp.onblur = commit;
  inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
}

document.getElementById('ns-add-custom-alarm-btn').onclick = () => {
  document.getElementById('ns-drum-wrap').style.display = '';
  updateDrum();
};
document.getElementById('ns-drum-cancel').onclick = () => {
  document.getElementById('ns-drum-wrap').style.display = 'none';
};
document.getElementById('ns-drum-add').onclick = () => {
  if (customAlarms.length >= 10) return;
  customAlarms.push({ num: drumNum, unit: DRUM_UNITS[drumUnitIdx] });
  renderCustomAlarmList();
  document.getElementById('ns-drum-wrap').style.display = 'none';
};

document.getElementById('sf-allday-check').onchange = () => updateSchedTypeUI();
initDtDrums();

// ── 카카오 장소 검색 ───────────────────────────────────────────────────────────
const KAKAO_KEY = 'eac6c1beab3dcc8c3cf32fd993073e2e';
let locTimer = null;

async function kakaoSearchPlaces(q) {
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=7`, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` }
    });
    const data = await res.json();
    return data.documents || [];
  } catch { return []; }
}

function showLocDropdown(places) {
  const dd = document.getElementById('sf-location-dropdown');
  if (!dd) return;
  if (!places.length) { dd.style.display = 'none'; return; }
  dd.innerHTML = '';
  places.forEach(p => {
    const item = document.createElement('div');
    item.className = 'sf-loc-item';
    item.innerHTML = `<div class="sf-loc-name">${p.place_name}</div><div class="sf-loc-addr">${p.road_address_name || p.address_name || ''}</div>`;
    item.onmousedown = () => {
      document.getElementById('sf-location').value = p.place_name;
      dd.style.display = 'none';
    };
    dd.appendChild(item);
  });
  dd.style.display = 'block';
}

document.getElementById('sf-location').oninput = function() {
  clearTimeout(locTimer);
  const q = this.value.trim();
  const dd = document.getElementById('sf-location-dropdown');
  if (!q) { if (dd) dd.style.display = 'none'; return; }
  locTimer = setTimeout(async () => {
    const places = await kakaoSearchPlaces(q);
    showLocDropdown(places);
  }, 350);
};

document.getElementById('sf-location').onblur = () => {
  setTimeout(() => { const dd = document.getElementById('sf-location-dropdown'); if (dd) dd.style.display = 'none'; }, 150);
};
document.getElementById('btn-add-sched').onclick = () => openScheduleModal(null, null);
document.getElementById('sf-cancel').onclick = () => document.getElementById('sched-modal').classList.remove('show');

// 서브패널
document.getElementById('ns-alarm-row').onclick = () => document.getElementById('ns-alarm-panel').classList.add('show');
document.getElementById('ns-repeat-row').onclick = () => document.getElementById('ns-repeat-panel').classList.add('show');
document.getElementById('ns-alarm-back').onclick = () => document.getElementById('ns-alarm-panel').classList.remove('show');
document.getElementById('ns-repeat-back').onclick = () => document.getElementById('ns-repeat-panel').classList.remove('show');
document.querySelectorAll('input[name="ns-alarm"]').forEach(r => {
  r.onchange = () => setAlarmUI(r.value);
});
document.querySelectorAll('input[name="ns-repeat"]').forEach(r => {
  r.onchange = () => setRepeatUI(r.value);
});

document.getElementById('sf-save').onclick = async () => {
  const title = document.getElementById('sf-title').value.trim();
  if (!title) { document.getElementById('sf-title').focus(); return; }
  const isAllday = document.getElementById('sf-allday-check').checked;
  const reminder = document.getElementById('sf-reminder').value;
  await window.api.saveSchedule({
    id: editingScheduleId || Date.now().toString(),
    title,
    scheduleType: isAllday ? 'allday' : 'specific',
    date: document.getElementById('sf-date').value,
    endDate: document.getElementById('sf-end-date').value,
    time: isAllday ? '' : document.getElementById('sf-time').value,
    endTime: isAllday ? '' : document.getElementById('sf-end-time').value,
    location: document.getElementById('sf-location').value,
    reminder,
    repeat: document.getElementById('sf-repeat').value,
    alarmType: reminder !== 'none' ? 'popup' : 'none',
    alarm: reminder !== 'none' || customAlarms.length > 0,
    customReminders: [...customAlarms],
    content: document.getElementById('sf-content').value,
    done: document.getElementById('sf-done').checked,
    autoDelete: document.getElementById('sf-auto-delete').checked,
    dday: document.getElementById('sf-dday').checked,
  });
  document.getElementById('sched-modal').classList.remove('show');
  refresh();
};

// ── Clock ─────────────────────────────────────────────────────────────────────

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  const s = String(now.getSeconds()).padStart(2,'0');
  document.getElementById('clock').textContent = `${h}:${m}:${s}`;
  const days = ['일','월','화','수','목','금','토'];
  document.getElementById('clock-date').textContent = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} (${days[now.getDay()]})`;
}

// ── Calendar ──────────────────────────────────────────────────────────────────

const calTooltip = document.getElementById('cal-tooltip');

function showCalTooltip(e, year, month, d, ds) {
  const lunar = solarToLunar(year, month+1, d);
  const dayScheds = (data.schedules || []).filter(s => s.date === ds && !s.done);
  let html = '';
  if (lunar) html += `<div class="cal-tt-lunar">음력 ${lunar.month}월 ${lunar.day}일</div>`;
  if (dayScheds.length) {
    html += '<div class="cal-tt-list">';
    dayScheds.slice(0, 4).forEach(s => {
      const time = s.scheduleType === 'allday' ? '하루종일' : s.time || '';
      html += `<div class="cal-tt-item">• ${s.title}${time ? ' <span style="color:var(--text3)">'+time+'</span>' : ''}</div>`;
    });
    if (dayScheds.length > 4) html += `<div class="cal-tt-item" style="color:var(--text3)">+${dayScheds.length-4}개 더</div>`;
    html += '</div>';
  } else if (!lunar) {
    html = '<div class="cal-tt-empty">클릭하여 일정 추가</div>';
  }
  calTooltip.innerHTML = html;
  calTooltip.style.display = 'block';
  const rect = e.target.getBoundingClientRect();
  let x = rect.left, y = rect.bottom + 3;
  if (x + 190 > window.innerWidth) x = window.innerWidth - 194;
  if (y + 100 > window.innerHeight) y = rect.top - 104;
  calTooltip.style.left = x + 'px';
  calTooltip.style.top = y + 'px';
}

function renderCalendar() {
  const year = calDate.getFullYear(), month = calDate.getMonth();
  document.getElementById('cal-title').textContent = `${year}년 ${month+1}월`;
  const schedCountMap = {};
  (data.schedules || []).filter(s => !s.done).forEach(s => { schedCountMap[s.date] = (schedCountMap[s.date] || 0) + 1; });
  const schedDates = new Set(Object.keys(schedCountMap));
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  ['일','월','화','수','목','금','토'].forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'cal-day-name' + (i===0?' sun':i===6?' sat':'');
    el.textContent = d; grid.appendChild(el);
  });
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month+1, 0).getDate();
  const today = new Date();
  const isToday = d => d.getFullYear()===today.getFullYear() && d.getMonth()===today.getMonth() && d.getDate()===today.getDate();
  const prevLast = new Date(year, month, 0).getDate();
  for (let i = firstDay-1; i >= 0; i--) {
    const el = document.createElement('div');
    el.className = 'cal-cell other-month';
    el.textContent = prevLast - i; grid.appendChild(el);
  }
  for (let d = 1; d <= lastDate; d++) {
    const date = new Date(year, month, d), dow = date.getDay();
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const el = document.createElement('div');
    let cls = 'cal-cell cur';
    if (isToday(date)) cls += ' today';
    else if (dow===0) cls += ' sun';
    else if (dow===6) cls += ' sat';
    if (schedDates.has(ds)) cls += ' has-schedule';
    el.className = cls; el.textContent = d;
    el.addEventListener('mouseenter', (e) => showCalTooltip(e, year, month, d, ds));
    el.addEventListener('mouseleave', () => { calTooltip.style.display = 'none'; });
    el.addEventListener('click', () => { calTooltip.style.display = 'none'; openDayPopup(ds, year, month, d); });
    grid.appendChild(el);
  }
  const remaining = (7 - ((firstDay + lastDate) % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const el = document.createElement('div');
    el.className = 'cal-cell other-month';
    el.textContent = d; grid.appendChild(el);
  }
}

document.getElementById('cal-prev').onclick = () => { calDate.setMonth(calDate.getMonth()-1); renderCalendar(); };
document.getElementById('cal-next').onclick = () => { calDate.setMonth(calDate.getMonth()+1); renderCalendar(); };

// ── Calendar Day Popup ────────────────────────────────────────────────────────
let cdpDate = null;

function openDayPopup(ds, year, month, d) {
  cdpDate = ds;
  const date = new Date(year, month, d);
  const dow = date.getDay();
  const days = ['일','월','화','수','목','금','토'];
  const badge = document.getElementById('cdp-date-badge');
  badge.textContent = d;
  badge.style.background = dow === 0 ? '#e53935' : dow === 6 ? '#2563EB' : 'var(--accent)';
  document.getElementById('cdp-weekday').textContent = `${days[dow]}요일`;
  const lunar = solarToLunar(year, month + 1, d);
  document.getElementById('cdp-lunar').textContent = lunar ? `음력 ${lunar.month}월 ${lunar.day}일` : '';
  document.getElementById('cdp-input').value = '';
  renderDayPopupList();
  document.getElementById('cal-day-popup').classList.add('show');
  setTimeout(() => document.getElementById('cdp-input').focus(), 80);
}

function renderDayPopupList() {
  const list = document.getElementById('cdp-list');
  list.innerHTML = '';
  const dayScheds = (data.schedules || []).filter(s => s.date === cdpDate);
  if (!dayScheds.length) {
    const empty = document.createElement('div');
    empty.className = 'cdp-empty';
    empty.textContent = '일정 없음';
    list.appendChild(empty);
    return;
  }
  dayScheds.forEach(s => {
    const item = document.createElement('div');
    item.className = 'cdp-item';
    const color = s.color || 'var(--accent)';
    const timeText = s.scheduleType === 'allday' ? '하루 종일' : s.time || '';
    item.innerHTML = `<div class="cdp-item-dot" style="background:${color}"></div><div class="cdp-item-body"><div class="cdp-item-title">${s.title || '(제목 없음)'}</div>${timeText ? `<div class="cdp-item-time">${timeText}</div>` : ''}</div><button class="cdp-item-del" title="삭제"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    item.querySelector('.cdp-item-body').onclick = () => {
      document.getElementById('cal-day-popup').classList.remove('show');
      openScheduleModal(s);
    };
    item.querySelector('.cdp-item-del').onclick = async (e) => {
      e.stopPropagation();
      await window.api.deleteSchedule(s.id);
      data = await window.api.getData();
      renderDayPopupList();
      renderCalendar();
      renderScheduleList();
    };
    list.appendChild(item);
  });
}

document.getElementById('cdp-close').onclick = () => document.getElementById('cal-day-popup').classList.remove('show');
document.getElementById('cal-day-popup').onclick = (e) => {
  if (e.target === document.getElementById('cal-day-popup'))
    document.getElementById('cal-day-popup').classList.remove('show');
};
document.getElementById('cdp-add-btn').onclick = () => {
  document.getElementById('cal-day-popup').classList.remove('show');
  openScheduleModal(null, cdpDate);
};
document.getElementById('cdp-input').onkeydown = async (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const title = e.target.value.trim();
  if (!title) return;
  const newSched = { id: Date.now().toString(), title, date: cdpDate, scheduleType: 'allday', time: '', reminder: 'none', repeat: 'once', done: false };
  await window.api.saveSchedule(newSched);
  data = await window.api.getData();
  e.target.value = '';
  renderDayPopupList();
  renderCalendar();
  renderScheduleList();
};

// ── Toolbox ───────────────────────────────────────────────────────────────────

function toolMsg(msg, color) {
  const el = document.getElementById('tool-msg');
  el.textContent = msg;
  el.style.color = color || '#7cb87a';
  setTimeout(() => { el.textContent = ''; }, 2000);
}

document.getElementById('tool-shutdown').onclick = () => {
  showConfirm('5초 후 시스템을 종료합니다. 계속할까요?', async () => {
    await window.api.systemShutdown();
    toolMsg('5초 후 시스템 종료...');
  });
};

document.getElementById('tool-lock').onclick = async () => {
  await window.api.systemLock();
};

document.getElementById('tool-colorpick').onclick = () => {
  window.api.colorPickStart();
};
window.api.on('colorpick-result', (hex) => {
  if (hex) toolMsg(`복사됨: ${hex}`, '#7cb87a');
});

// ── Password Manager ──────────────────────────────────────────────────────────


// ── Links ─────────────────────────────────────────────────────────────────────

const DEFAULT_LINKS = [
  { name: 'Naver', url: 'https://www.naver.com' },
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'YouTube', url: 'https://www.youtube.com' },
];

function getLinkList() {
  try { return JSON.parse(localStorage.getItem('krismemo_links') || JSON.stringify(DEFAULT_LINKS)); } catch(e) { return DEFAULT_LINKS; }
}
function saveLinkList(list) { localStorage.setItem('krismemo_links', JSON.stringify(list)); }

function renderLinkList() {
  const list = getLinkList();
  const el = document.getElementById('links-list');
  el.innerHTML = '';
  list.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'link-item';
    row.innerHTML = `<span class="link-name">${item.name}</span><button class="link-del" data-del="${i}">✕</button>`;
    row.querySelector('.link-name').onclick = () => window.api.openUrl(item.url);
    row.querySelector('[data-del]').onclick = () => { list.splice(i, 1); saveLinkList(list); renderLinkList(); };
    el.appendChild(row);
  });
}

document.getElementById('tool-links').onclick = () => {
  renderLinkList();
  document.getElementById('links-overlay').classList.add('show');
};
document.getElementById('links-close').onclick = () => document.getElementById('links-overlay').classList.remove('show');
document.getElementById('link-add-btn').onclick = () => {
  const name = document.getElementById('link-name-input').value.trim();
  const url = document.getElementById('link-url-input').value.trim();
  if (!name || !url) return;
  const list = getLinkList();
  list.push({ name, url });
  saveLinkList(list);
  document.getElementById('link-name-input').value = '';
  document.getElementById('link-url-input').value = '';
  renderLinkList();
};


// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    document.getElementById('tab-' + activeTab).classList.add('active');
  };
});

// ── Backup dropdown ───────────────────────────────────────────────────────────

const backupDropdown = document.getElementById('backup-dropdown');
document.getElementById('btn-backup').onclick = (e) => {
  e.stopPropagation();
  dropdown.classList.remove('show');
  const r = e.target.getBoundingClientRect();
  backupDropdown.style.left = 'auto';
  backupDropdown.style.right = (window.innerWidth - r.right) + 'px';
  backupDropdown.style.top = (r.bottom + 4) + 'px';
  backupDropdown.style.display = backupDropdown.style.display === 'block' ? 'none' : 'block';
};
document.getElementById('bdd-save').onclick = async (e) => {
  if (e.target.id === 'bdd-open-folder') return;
  backupDropdown.style.display = 'none';
  const filename = await window.api.backupData();
  toolMsg(filename ? `백업 완료: ${filename}` : '백업 실패', filename ? '#7cb87a' : '#e88a3a');
};
document.getElementById('bdd-open-folder').onclick = (e) => {
  e.stopPropagation();
  backupDropdown.style.display = 'none';
  window.api.openBackupFolder();
};
document.getElementById('bdd-restore').onclick = async () => {
  backupDropdown.style.display = 'none';
  const ok = await window.api.restoreBackup();
  if (ok) { await refresh(); toolMsg('복원 완료', '#7cb87a'); }
  else toolMsg('복원 취소 또는 실패', '#e88a3a');
};

// ── Gear dropdown ─────────────────────────────────────────────────────────────

const dropdown = document.getElementById('dropdown');
document.getElementById('btn-gear').onclick = (e) => {
  e.stopPropagation();
  backupDropdown.style.display = 'none';
  const r = e.target.getBoundingClientRect();
  dropdown.style.right = '8px';
  dropdown.style.top = (r.bottom + 4) + 'px';
  dropdown.classList.toggle('show');
};
document.addEventListener('click', (e) => {
  if (!dropdown.contains(e.target)) dropdown.classList.remove('show');
  if (!backupDropdown.contains(e.target)) backupDropdown.style.display = 'none';
  if (!document.getElementById('ctx-menu').contains(e.target)) document.getElementById('ctx-menu').classList.remove('show');
});

document.getElementById('dd-settings').onclick = () => { dropdown.classList.remove('show'); window.api.openSettingsWindow(); };
document.getElementById('dd-quit').onclick = () => { window.api.quitApp(); };
document.getElementById('dd-close-all').onclick = () => { dropdown.classList.remove('show'); window.api.closeAllMemos(); };
document.getElementById('dd-show-all').onclick = () => { dropdown.classList.remove('show'); window.api.showAllMemos(); };

// ── Top bar buttons ───────────────────────────────────────────────────────────

document.getElementById('btn-new').onclick = () => window.api.newMemo();
document.getElementById('btn-mgr').onclick = () => openManager();

async function doImport() {
  const dir = await window.api.openFolderDialog();
  if (!dir) return;
  const count = await window.api.importStf(dir);
  toolMsg(count > 0 ? `SMEMO ${count}개 가져오기 완료` : '새 메모 없음 (이미 가져왔거나 stf 없음)', count > 0 ? '#7cb87a' : '#e0b870');
  refresh();
}

// ── Search ────────────────────────────────────────────────────────────────────

document.getElementById('search').oninput = () => renderList();

// ── Manager ───────────────────────────────────────────────────────────────────

function openManager() {
  mgrSelectedFolder = null;
  mgrCheckedMemos.clear();
  mgrSelectedMemoId = null;
  renderMgrFolderTabs();
  renderMgrMemoList();
  document.getElementById('prev-title').textContent = '메모를 선택하세요';
  document.getElementById('prev-date').textContent = '';
  document.getElementById('prev-content').textContent = '';
  document.getElementById('manager-overlay').classList.add('show');
}

document.getElementById('mgr-close').onclick = () => document.getElementById('manager-overlay').classList.remove('show');

function renderMgrFolderTabs() {
  const list = document.getElementById('mgr-folder-list');
  if (!list) return;
  list.innerHTML = '';

  const allRow = document.createElement('div');
  allRow.className = 'mgr-folder-item' + (!mgrSelectedFolder ? ' active' : '');
  allRow.innerHTML = `<span class="mgr-folder-dot" style="background:#888;"></span>전체 (${data.memos.length})`;
  allRow.onclick = () => { mgrSelectedFolder = null; renderMgrFolderTabs(); renderMgrMemoList(); };
  list.appendChild(allRow);

  data.folders.forEach(f => {
    const count = data.memos.filter(m => m.folderId === f.id).length;
    const row = document.createElement('div');
    row.className = 'mgr-folder-item' + (mgrSelectedFolder === f.id ? ' active' : '');
    row.innerHTML = `<span class="mgr-folder-dot" style="background:${f.color || '#7090cc'};"></span>${f.name} (${count})`;
    row.onclick = () => { mgrSelectedFolder = f.id; renderMgrFolderTabs(); renderMgrMemoList(); };
    list.appendChild(row);
  });
}

function renderMgrMemoList() {
  const list = document.getElementById('mgr-memo-list');
  list.innerHTML = '';
  mgrCheckedMemos.clear();
  document.getElementById('mgr-check-all').checked = false;
  const memos = mgrSelectedFolder ? data.memos.filter(m => m.folderId === mgrSelectedFolder) : data.memos;
  document.getElementById('mgr-count').textContent = `${memos.length}개`;

  memos.forEach(memo => {
    const row = document.createElement('div');
    row.className = 'mgr-memo-row' + (mgrSelectedMemoId === memo.id ? ' selected' : '');
    row.innerHTML = `<input type="checkbox" class="mgr-check mgr-memo-check" data-id="${memo.id}"><div class="mgr-color-dot" style="background:${memoColor(memo)}"></div><span class="mgr-row-title">${memo.title || '(제목 없음)'}</span>${memo.starred ? '<svg class="memo-star" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : ''}`;
    row.querySelector('.mgr-memo-check').onchange = (e) => {
      e.stopPropagation();
      if (e.target.checked) mgrCheckedMemos.add(memo.id);
      else mgrCheckedMemos.delete(memo.id);
    };
    row.onclick = (e) => {
      if (e.target.type === 'checkbox') return;
      mgrSelectedMemoId = memo.id;
      list.querySelectorAll('.mgr-memo-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      document.getElementById('prev-date').textContent = fmtDate(memo.updatedAt);
      document.getElementById('prev-title').textContent = memo.title || '(제목 없음)';
      document.getElementById('prev-content').textContent = memo.content?.slice(0, 150) || '';
    };
    list.appendChild(row);
  });
}

document.getElementById('mgr-check-all').onchange = (e) => {
  document.getElementById('mgr-memo-list').querySelectorAll('.mgr-memo-check').forEach(cb => {
    cb.checked = e.target.checked;
    if (e.target.checked) mgrCheckedMemos.add(cb.dataset.id);
    else mgrCheckedMemos.delete(cb.dataset.id);
  });
};

document.getElementById('mgr-delete').onclick = () => {
  if (!mgrCheckedMemos.size) { toolMsg('삭제할 메모를 체크하세요', '#e07070'); return; }
  showConfirm(`${mgrCheckedMemos.size}개 메모를 삭제할까요?`, async () => {
    for (const id of mgrCheckedMemos) await window.api.deleteMemo(id);
    await refresh();
    mgrSelectedMemoId = null;
    renderMgrFolderTabs();
    renderMgrMemoList();
  });
};

document.getElementById('mgr-move').onclick = () => {
  if (!mgrCheckedMemos.size) { toolMsg('이동할 메모를 체크하세요', '#e07070'); return; }
  const list = document.getElementById('folder-move-list');
  list.innerHTML = '';
  data.folders.forEach(f => {
    const btn = document.createElement('button');
    btn.className = 'btn-sm';
    btn.style.cssText = 'width:100%;text-align:left;padding:6px 10px;';
    btn.textContent = f.name;
    btn.onclick = async () => {
      for (const id of mgrCheckedMemos) await window.api.moveMemo({ memoId: id, folderId: f.id });
      document.getElementById('folder-move-modal').style.display = 'none';
      await refresh();
      renderMgrFolderTabs();
      renderMgrMemoList();
    };
    list.appendChild(btn);
  });
  document.getElementById('folder-move-modal').style.display = 'flex';
};

document.getElementById('folder-move-cancel').onclick = () => {
  document.getElementById('folder-move-modal').style.display = 'none';
};

document.getElementById('mgr-new-folder').onclick = async () => {
  openFolderRename(null);
};

document.getElementById('mgr-edit-folder').onclick = async () => {
  if (!mgrSelectedFolder) { toolMsg('폴더를 선택하세요', '#e07070'); return; }
  const folder = data.folders.find(f => f.id === mgrSelectedFolder);
  if (!folder) return;
  openFolderRename(folder);
};

// ── Context menu ─────────────────────────────────────────────────────────────

function fitMenu(menu, x, y) {
  const mw = menu.offsetWidth || 150;
  const mh = menu.offsetHeight || 120;
  menu.style.left = Math.max(0, x + mw > window.innerWidth  ? x - mw : x) + 'px';
  menu.style.top  = Math.max(0, y + mh > window.innerHeight ? y - mh : y) + 'px';
}

let ctxMemo = null;
const ctxMenu = document.getElementById('ctx-menu');

function showMemoCtx(e, memo) {
  ctxMemo = memo;
  document.getElementById('ctx-star').textContent = memo.starred ? '즐겨찾기 해제' : '즐겨찾기 추가';
  ctxMenu.classList.add('show');
  fitMenu(ctxMenu, e.clientX, e.clientY);
}

document.getElementById('ctx-open').onclick = () => { if (ctxMemo) openMemo(ctxMemo); ctxMenu.classList.remove('show'); };
document.getElementById('ctx-star').onclick = async () => {
  if (!ctxMemo) return;
  await window.api.toggleStarred(ctxMemo.id);
  ctxMenu.classList.remove('show');
  refresh();
};
document.getElementById('ctx-delete').onclick = () => {
  if (!ctxMemo) return;
  ctxMenu.classList.remove('show');
  showConfirm(`"${ctxMemo.title || '(제목 없음)'}" 메모를 삭제할까요?`, async () => {
    await window.api.deleteMemo(ctxMemo.id);
    refresh();
  });
};

// ── Confirm modal ─────────────────────────────────────────────────────────────

let confirmCallback = null;

function showConfirm(msg, cb) {
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = cb;
  document.getElementById('confirm-modal').style.display = 'flex';
}

document.getElementById('confirm-yes').onclick = () => {
  document.getElementById('confirm-modal').style.display = 'none';
  confirmCallback?.();
};
document.getElementById('confirm-no').onclick = () => {
  document.getElementById('confirm-modal').style.display = 'none';
};

// ── Folder rename modal ───────────────────────────────────────────────────────

let renamingFolder = null;
let pendingSubFolderParentId = null;

let selectedFolderColor = '#7090cc';

function initFolderColorSwatches() {
  document.querySelectorAll('.fc-swatch').forEach(sw => {
    sw.onclick = () => {
      selectedFolderColor = sw.dataset.color;
      document.querySelectorAll('.fc-swatch').forEach(s => s.style.borderColor = 'transparent');
      sw.style.borderColor = sw.dataset.color;
    };
  });
}
initFolderColorSwatches();

function openSubFolderAdd(parentFolder) {
  pendingSubFolderParentId = parentFolder.id;
  renamingFolder = null;
  selectedFolderColor = '#7090cc';
  const input = document.getElementById('folder-rename-input');
  input.value = '';
  document.getElementById('folder-rename-title').textContent = `'${parentFolder.name}' 하위 폴더 추가`;
  document.getElementById('folder-color-row').style.display = 'block';
  document.querySelectorAll('.fc-swatch').forEach(s => s.style.borderColor = s.dataset.color === '#7090cc' ? '#7090cc' : 'transparent');
  document.getElementById('folder-rename-modal').style.display = 'flex';
  setTimeout(() => { input.focus(); }, 50);
}

function openFolderRename(folder) {
  renamingFolder = folder;
  const input = document.getElementById('folder-rename-input');
  input.value = folder?.name || '';
  if (folder) {
    document.getElementById('folder-rename-title').textContent = '폴더 이름 변경';
    document.getElementById('folder-color-row').style.display = 'block';
    selectedFolderColor = folder.color || '#7090cc';
    document.querySelectorAll('.fc-swatch').forEach(s => s.style.borderColor = s.dataset.color === selectedFolderColor ? s.dataset.color : 'transparent');
  } else {
    document.getElementById('folder-rename-title').textContent = '폴더 생성';
    document.getElementById('folder-color-row').style.display = 'block';
    selectedFolderColor = '#7090cc';
    document.querySelectorAll('.fc-swatch').forEach(s => s.style.borderColor = s.dataset.color === '#7090cc' ? '#7090cc' : 'transparent');
  }
  document.getElementById('folder-rename-modal').style.display = 'flex';
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

document.getElementById('folder-rename-cancel').onclick = () => {
  document.getElementById('folder-rename-modal').style.display = 'none';
  pendingSubFolderParentId = null;
};

document.getElementById('folder-rename-save').onclick = async () => {
  const name = document.getElementById('folder-rename-input').value.trim();
  if (!name) return;
  if (renamingFolder) {
    await window.api.saveFolder({ ...renamingFolder, name, color: selectedFolderColor || renamingFolder.color });
  } else {
    const newFolder = { id: 'folder_' + Date.now(), name, color: selectedFolderColor || '#7090cc', order: data.folders.length };
    if (pendingSubFolderParentId) newFolder.parentId = pendingSubFolderParentId;
    await window.api.saveFolder(newFolder);
    pendingSubFolderParentId = null;
  }
  document.getElementById('folder-rename-modal').style.display = 'none';
  await refresh();
  renderMgrFolderTabs();
};

document.getElementById('folder-rename-input').onkeydown = (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter') document.getElementById('folder-rename-save').click();
  if (e.key === 'Escape') document.getElementById('folder-rename-cancel').click();
};

// ── Memo tab context menu (새 폴더 만들기) ────────────────────────────────────

const memoTabCtxMenu = document.getElementById('memo-tab-ctx-menu');

document.querySelector('.tab[data-tab="memo"]').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  memoTabCtxMenu.style.display = 'block';
  fitMenu(memoTabCtxMenu, e.clientX, e.clientY);
});

document.getElementById('memo-tab-ctx-new-folder').onclick = () => {
  memoTabCtxMenu.style.display = 'none';
  openFolderRename(null);
};

document.addEventListener('click', (e) => {
  if (!memoTabCtxMenu.contains(e.target)) memoTabCtxMenu.style.display = 'none';
});

// ── Folder context menu ───────────────────────────────────────────────────────

let ctxFolder = null;
const folderCtxMenu = document.getElementById('folder-ctx-menu');

function showFolderCtx(e, folder) {
  ctxFolder = folder;
  const hasLock = !!folder.passwordHash;
  const isUnlocked = unlockedFolderIds.has(folder.id);
  document.getElementById('folder-ctx-lock-set').style.display = hasLock ? 'none' : 'block';
  document.getElementById('folder-ctx-lock-change').style.display = hasLock ? 'block' : 'none';
  document.getElementById('folder-ctx-lock-remove').style.display = hasLock ? 'block' : 'none';
  document.getElementById('folder-ctx-relock').style.display = (hasLock && isUnlocked) ? 'block' : 'none';
  document.getElementById('folder-ctx-lock-sep').style.display = 'block';
  folderCtxMenu.style.display = 'block';
  fitMenu(folderCtxMenu, e.clientX, e.clientY);
}

document.addEventListener('click', (e) => {
  if (!folderCtxMenu.contains(e.target)) folderCtxMenu.style.display = 'none';
});

document.getElementById('folder-ctx-new-memo').onclick = () => {
  folderCtxMenu.style.display = 'none';
  if (ctxFolder) window.api.newMemoInFolder(ctxFolder.id);
};

document.getElementById('folder-ctx-add-sub').onclick = () => {
  folderCtxMenu.style.display = 'none';
  if (ctxFolder) openSubFolderAdd(ctxFolder);
};

document.getElementById('folder-ctx-rename').onclick = () => {
  folderCtxMenu.style.display = 'none';
  if (ctxFolder) openFolderRename(ctxFolder);
};

document.getElementById('folder-ctx-delete').onclick = () => {
  if (!ctxFolder) return;
  folderCtxMenu.style.display = 'none';
  showConfirm(`"${ctxFolder.name}" 폴더를 삭제할까요?`, async () => {
    await window.api.deleteFolder(ctxFolder.id);
    refresh();
  });
};

document.getElementById('folder-ctx-lock-set').onclick = () => {
  folderCtxMenu.style.display = 'none';
  if (!ctxFolder) return;
  openSetpwModal(ctxFolder, false);
};
document.getElementById('folder-ctx-lock-change').onclick = () => {
  folderCtxMenu.style.display = 'none';
  if (!ctxFolder) return;
  openSetpwModal(ctxFolder, true);
};
document.getElementById('folder-ctx-lock-remove').onclick = () => {
  folderCtxMenu.style.display = 'none';
  if (!ctxFolder) return;
  openRmpwModal(ctxFolder);
};
document.getElementById('folder-ctx-relock').onclick = async () => {
  folderCtxMenu.style.display = 'none';
  if (!ctxFolder) return;
  await window.api.folderLock(ctxFolder.id);
  unlockedFolderIds.delete(ctxFolder.id);
  refresh();
};

// ── 잠금 해제 모달 ─────────────────────────────────────────────────────────────

let flockTargetFolder = null;
let flockPendingMemo = null;

function openFlockModal(folder, pendingMemo = null) {
  flockTargetFolder = folder;
  flockPendingMemo = pendingMemo;
  document.getElementById('flock-folder-name').textContent = folder.name;
  document.getElementById('flock-pw').value = '';
  document.getElementById('flock-err').textContent = '';
  document.getElementById('flock-verify-step').style.display = 'block';
  document.getElementById('flock-recovery-step').style.display = 'none';
  document.getElementById('flock-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('flock-pw').focus(), 50);
}

function closeFlockModal() {
  document.getElementById('flock-modal').style.display = 'none';
  flockTargetFolder = null;
  flockPendingMemo = null;
}

document.getElementById('flock-cancel').onclick = closeFlockModal;
document.getElementById('flock-rec-cancel').onclick = closeFlockModal;

document.getElementById('flock-ok').onclick = async () => {
  const pw = document.getElementById('flock-pw').value;
  if (!pw) { document.getElementById('flock-err').textContent = '비밀번호를 입력하세요'; return; }
  const res = await window.api.folderVerifyPassword({ folderId: flockTargetFolder.id, password: pw });
  if (res.ok) {
    unlockedFolderIds.add(flockTargetFolder.id);
    const pending = flockPendingMemo;
    closeFlockModal();
    refresh();
    if (pending) openMemo(pending);
  } else {
    document.getElementById('flock-err').textContent = res.error;
    document.getElementById('flock-pw').select();
  }
};

document.getElementById('flock-pw').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('flock-ok').click(); };

document.getElementById('flock-forgot').onclick = async () => {
  document.getElementById('flock-err').textContent = '';
  const res = await window.api.folderSendRecovery(flockTargetFolder.id);
  if (!res.ok) { document.getElementById('flock-err').textContent = res.error; return; }
  document.getElementById('flock-verify-step').style.display = 'none';
  document.getElementById('flock-temp-code').value = '';
  document.getElementById('flock-new-pw1').value = '';
  document.getElementById('flock-new-pw2').value = '';
  document.getElementById('flock-rec-err').textContent = '';
  document.getElementById('flock-recovery-step').style.display = 'block';
  setTimeout(() => document.getElementById('flock-temp-code').focus(), 50);
};

document.getElementById('flock-reset-btn').onclick = async () => {
  const code = document.getElementById('flock-temp-code').value.trim();
  const pw1 = document.getElementById('flock-new-pw1').value;
  const pw2 = document.getElementById('flock-new-pw2').value;
  const errEl = document.getElementById('flock-rec-err');
  if (!code) { errEl.textContent = '임시 코드를 입력하세요'; return; }
  if (!pw1) { errEl.textContent = '새 비밀번호를 입력하세요'; return; }
  if (pw1 !== pw2) { errEl.textContent = '비밀번호가 일치하지 않습니다'; return; }
  const res = await window.api.folderVerifyTempReset({ folderId: flockTargetFolder.id, tempCode: code, newPassword: pw1 });
  if (res.ok) {
    unlockedFolderIds.add(flockTargetFolder.id);
    closeFlockModal();
    refresh();
  } else {
    errEl.textContent = res.error;
  }
};

// ── 비밀번호 설정/변경 모달 ──────────────────────────────────────────────────────

let setpwTargetFolder = null;

async function openSetpwModal(folder, isChange) {
  if (!isChange) {
    const cfg = await window.api.getConfig();
    if (!cfg.recoveryEmail || !cfg.gmailSender || !cfg.gmailAppPassword) {
      alert('이메일 복구 설정을 먼저 해주세요.\n환경설정 → 보안 탭에서 설정할 수 있습니다.');
      return;
    }
  }
  setpwTargetFolder = folder;
  document.getElementById('setpw-title').textContent = isChange ? '🔑 비밀번호 변경' : '🔒 잠금 설정';
  document.getElementById('setpw-current-row').style.display = isChange ? 'block' : 'none';
  document.getElementById('setpw-current').value = '';
  document.getElementById('setpw-new1').value = '';
  document.getElementById('setpw-new2').value = '';
  document.getElementById('setpw-err').textContent = '';
  document.getElementById('setpw-modal').style.display = 'flex';
  setTimeout(() => (isChange ? document.getElementById('setpw-current') : document.getElementById('setpw-new1')).focus(), 50);
}

document.getElementById('setpw-cancel').onclick = () => { document.getElementById('setpw-modal').style.display = 'none'; };

document.getElementById('setpw-ok').onclick = async () => {
  const isChange = document.getElementById('setpw-current-row').style.display !== 'none';
  const current = isChange ? document.getElementById('setpw-current').value : undefined;
  const pw1 = document.getElementById('setpw-new1').value;
  const pw2 = document.getElementById('setpw-new2').value;
  const errEl = document.getElementById('setpw-err');
  if (isChange && !current) { errEl.textContent = '현재 비밀번호를 입력하세요'; return; }
  if (!pw1) { errEl.textContent = '새 비밀번호를 입력하세요'; return; }
  if (pw1 !== pw2) { errEl.textContent = '비밀번호가 일치하지 않습니다'; return; }
  const res = await window.api.folderSetPassword({ folderId: setpwTargetFolder.id, currentPassword: current, newPassword: pw1 });
  if (res.ok) {
    unlockedFolderIds.delete(setpwTargetFolder.id);
    document.getElementById('setpw-modal').style.display = 'none';
    refresh();
  } else {
    errEl.textContent = res.error;
  }
};

// ── 잠금 제거 모달 ────────────────────────────────────────────────────────────

let rmpwTargetFolder = null;

function openRmpwModal(folder) {
  rmpwTargetFolder = folder;
  document.getElementById('rmpw-pw').value = '';
  document.getElementById('rmpw-err').textContent = '';
  document.getElementById('rmpw-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('rmpw-pw').focus(), 50);
}

document.getElementById('rmpw-cancel').onclick = () => { document.getElementById('rmpw-modal').style.display = 'none'; };

document.getElementById('rmpw-ok').onclick = async () => {
  const pw = document.getElementById('rmpw-pw').value;
  if (!pw) { document.getElementById('rmpw-err').textContent = '비밀번호를 입력하세요'; return; }
  const res = await window.api.folderRemovePassword({ folderId: rmpwTargetFolder.id, currentPassword: pw });
  if (res.ok) {
    unlockedFolderIds.delete(rmpwTargetFolder.id);
    document.getElementById('rmpw-modal').style.display = 'none';
    refresh();
  } else {
    document.getElementById('rmpw-err').textContent = res.error;
  }
};

document.getElementById('rmpw-pw').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('rmpw-ok').click(); };

// ── IPC from main ─────────────────────────────────────────────────────────────

window.api.on('data-changed', () => refresh());
window.api.on('config-updated', () => refresh());
window.api.on('set-sidebar-font', (font, size) => {
  const parts = font.split(',').map(f => `'${f.trim()}'`).join(',');
  document.body.style.fontFamily = `${parts},'맑은 고딕',sans-serif`;
  if (size) document.documentElement.style.setProperty('--fs', size + 'px');
});
window.api.on('preview-theme', (name) => applyTheme(name));
window.api.on('memo-closed', (id) => { openMemoIds.delete(id); renderList(); });
window.api.on('alarm-fired', () => { document.querySelector('[data-tab="schedule"]')?.click(); });
window.api.on('focus-search', () => { document.querySelector('[data-tab="memo"]')?.click(); document.getElementById('search').focus(); });
window.api.on('open-settings', () => window.api.openSettingsWindow());
window.api.on('update-status', (status) => {
  const banner = document.getElementById('update-banner');
  if (status === 'downloading') {
    banner.textContent = '⬇ 업데이트 다운로드 중... 0%';
    banner.style.display = 'block';
    banner.style.cursor = 'default';
    banner.style.background = '#2a5a3a';
    banner.onclick = null;
  } else if (status === 'ready') {
    banner.textContent = '✅ 업데이트 준비됨 — 클릭하여 재시작';
    banner.style.display = 'block';
    banner.style.cursor = 'pointer';
    banner.style.background = '#2a5a3a';
    banner.onclick = () => window.api.installUpdate();
  }
});
window.api.on('update-progress', (percent) => {
  const banner = document.getElementById('update-banner');
  banner.textContent = `⬇ 업데이트 다운로드 중... ${percent}%`;
  banner.style.display = 'block';
  banner.style.background = `linear-gradient(to right, #3a7a4a ${percent}%, #2a5a3a ${percent}%)`;
});
window.api.on('portable-update-available', (version) => {
  const banner = document.getElementById('update-banner');
  banner.textContent = `🆕 새 버전 v${version} — 클릭하여 다운로드`;
  banner.style.display = 'block';
  banner.style.cursor = 'pointer';
  banner.onclick = () => window.api.openUrl('https://github.com/regina25846-code/kris-memo/releases/latest');
});

// ── Daily Todo 색상 컨텍스트 메뉴 ────────────────────────────────────────────

const TODO_SWATCHES = [
  // 다크 - 배경으로 쓰기 좋은 딥톤
  '#1a1f3a','#162820','#2a1228','#1e1208',
  // 미드톤 - 차분하고 세련된
  '#2c5f8a','#1e6b4a','#7a3b28','#5c3d8c',
  // 비비드 - 포인트 컬러
  '#e05252','#4fb8d4','#f0a050','#7dc86a',
  // 라이트 - 밝은 배경용
  '#fdf6e3','#e8f4f0','#f0e8f8','#fde8f0',
];

function autoContrast(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return '#f0eef8';
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.55 ? '#1a1828' : '#f0eef8';
}

function applyTodoColors(bg, text, save = true) {
  const root = document.documentElement;
  const theme = SIDEBAR_THEMES[config.sidebarTheme] || SIDEBAR_THEMES.fluent;
  if (bg === null && text === null) {
    config.todoBgColor = null; config.todoTextColor = null;
    root.style.setProperty('--todo-bg', theme['--todo-bg']);
    root.style.setProperty('--todo-text', theme['--todo-text']);
  } else {
    if (bg != null) { root.style.setProperty('--todo-bg', bg); config.todoBgColor = bg; }
    if (text != null) { root.style.setProperty('--todo-text', text); config.todoTextColor = text; }
  }
  if (save) window.api.saveConfig(config);
  _updateTodoSwatchActive();
}

function _updateTodoSwatchActive() {
  const cur = config.todoBgColor;
  document.querySelectorAll('.todo-swatch').forEach(sw =>
    sw.classList.toggle('active', sw.dataset.color === cur));
}

// 스와치 생성
const _todoSwatchWrap = document.getElementById('todo-color-swatches');
TODO_SWATCHES.forEach(color => {
  const sw = document.createElement('div');
  sw.className = 'todo-swatch';
  sw.style.background = color;
  sw.dataset.color = color;
  sw.title = color;
  sw.addEventListener('click', () => {
    applyTodoColors(color, autoContrast(color));
    hideTodoCtxMenu();
  });
  _todoSwatchWrap.appendChild(sw);
});

document.getElementById('todo-custom-btn').addEventListener('click', () => {
  hideTodoCtxMenu();
  window.api.openTodoColorPick(config.todoBgColor || null, config.todoTextColor || null);
});

document.getElementById('todo-reset-btn').addEventListener('click', () => {
  applyTodoColors(null, null);
  hideTodoCtxMenu();
});

const _todoCtxMenu = document.getElementById('todo-ctx-menu');

function hideTodoCtxMenu() { _todoCtxMenu.style.display = 'none'; }

document.getElementById('daily-todo-wrap').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  _updateTodoSwatchActive();
  _todoCtxMenu.style.display = 'block';
  fitMenu(_todoCtxMenu, e.clientX, e.clientY);
});

document.addEventListener('click', (e) => {
  if (!_todoCtxMenu.contains(e.target)) hideTodoCtxMenu();
});
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('#daily-todo-wrap') && !_todoCtxMenu.contains(e.target)) hideTodoCtxMenu();
});

// 플로팅 피커에서 결과 수신
window.api.on('todo-color-result', (bg, text) => applyTodoColors(bg, text));

// ── Init ──────────────────────────────────────────────────────────────────────

updateClock();
setInterval(updateClock, 1000);
renderCalendar();
refresh();

// Daily Todo 이벤트
const _todoTA = document.getElementById('daily-todo-text');
_todoTA.addEventListener('input', () => {
  autoResizeTodo(_todoTA);
  clearTimeout(_todoSaveTimer);
  _todoSaveTimer = setTimeout(saveDailyTodo, 600);
});
_todoTA.addEventListener('keydown', (e) => {
  // Enter 시 새 줄 추가 (기본 동작), Tab은 스페이스 2개
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = _todoTA.selectionStart, en = _todoTA.selectionEnd;
    _todoTA.value = _todoTA.value.slice(0, s) + '  ' + _todoTA.value.slice(en);
    _todoTA.selectionStart = _todoTA.selectionEnd = s + 2;
  }
});
