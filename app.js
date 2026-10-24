(function () {
  'use strict';

  const STORAGE_KEY = 'hanhkiem_manager_v1';
  // Dữ liệu dùng chung trên Firebase Realtime Database.
  const FIREBASE_ROOT_PATH = '/';
  let cloudReady = false;
  let databaseRef = null;
  const VERSION = 5;
  const FIXED_MAX_SCORE = 10;
  const DEFAULT_RULES = [
    { id: 'v-late', type: 'violation', name: 'Đi học muộn', points: 1 },
    { id: 'v-uniform', type: 'violation', name: 'Không đúng đồng phục', points: 1 },
    { id: 'v-homework', type: 'violation', name: 'Không làm bài tập', points: 1 },
    { id: 'v-phone', type: 'violation', name: 'Sử dụng điện thoại sai quy định', points: 2 },
    { id: 'r-participate', type: 'reward', name: 'Tích cực phát biểu', points: 1 },
    { id: 'r-help', type: 'reward', name: 'Giúp đỡ bạn bè', points: 1 },
    { id: 'r-achievement', type: 'reward', name: 'Có thành tích tốt', points: 2 },
    { id: 'r-activity', type: 'reward', name: 'Tham gia hoạt động trường', points: 1 }
  ];

  const state = {
    data: null,
    currentUser: null,
    currentPage: 'dashboard',
    dashboardClass: 'all',
    dashboardWeek: 1,
    teamWeek: 1,
    studentClass: 'all',
    studentSearch: '',
    historySearch: '',
    historyType: 'all',
    mobileMenuOpen: false
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clone = (obj) => JSON.parse(JSON.stringify(obj));

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function clampScore(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const settings = state.data && state.data.settings ? state.data.settings : {};
    const min = Number.isFinite(Number(settings.minScore)) ? Number(settings.minScore) : 0;
    // Điểm cộng có thể vượt mốc 10 (ví dụ 10 + 1 = 11); điểm trừ vẫn không xuống dưới điểm tối thiểu.
    const max = Math.max(100, Number.isFinite(Number(settings.maxScore)) ? Number(settings.maxScore) : FIXED_MAX_SCORE);
    return Math.min(max, Math.max(min, Math.round(num * 100) / 100));
  }

  function normalizeData(raw) {
    const base = defaultData();
    const d = raw && typeof raw === 'object' ? raw : {};
    const out = {
      version: VERSION,
      admin: {
        username: String(d.admin?.username || base.admin.username),
        password: String(d.admin?.password || base.admin.password)
      },
      teachers: Array.isArray(d.teachers) ? d.teachers : base.teachers,
      students: Array.isArray(d.students) ? d.students : base.students,
      rules: Array.isArray(d.rules) ? d.rules : base.rules,
      teacherRules: Array.isArray(d.teacherRules) ? d.teacherRules : base.teacherRules,
      history: Array.isArray(d.history) ? d.history : [],
      teams: Array.isArray(d.teams) ? d.teams : [],
      classes: Array.isArray(d.classes) ? d.classes : [],
      settings: { ...base.settings, ...(d.settings || {}) }
    };
    out.settings.minScore = Math.max(0, Math.min(9, Number(out.settings.minScore ?? 0) || 0));
    out.settings.maxScore = Math.max(out.settings.minScore + 1, Math.min(10, Number(out.settings.maxScore ?? FIXED_MAX_SCORE) || FIXED_MAX_SCORE));
    out.settings.logActivity = out.settings.logActivity !== false;
    out.students = out.students.map(s => ({
      id: String(s.id || uid('stu')),
      name: String(s.name || '').trim(),
      className: String(s.className || '').trim(),
      score: clampScore(s.score ?? FIXED_MAX_SCORE),
      teamId: String(s.teamId || '')
    })).filter(s => s.name && s.className);
    out.teachers = out.teachers.map(t => ({
      id: String(t.id || uid('tea')),
      name: String(t.name || '').trim(),
      username: String(t.username || '').trim(),
      password: String(t.password || ''),
      classes: Array.isArray(t.classes) ? t.classes.map(x => String(x).trim()).filter(Boolean) : String(t.classes || '').split(',').map(x => x.trim()).filter(Boolean),
      active: t.active !== false,
      avatar: String(t.avatar || '')
    })).filter(t => t.name && t.username);
    out.rules = out.rules.map(r => ({
      id: String(r.id || uid('rule')),
      type: r.type === 'reward' ? 'reward' : 'violation',
      name: String(r.name || '').trim(),
      points: Math.max(0, Math.round(Number(r.points) || 0))
    })).filter(r => r.name && r.points > 0);
    out.teacherRules = out.teacherRules.map(r => ({
      id: String(r.id || uid('trule')),
      teacherId: String(r.teacherId || ''),
      className: String(r.className || '').trim(),
      type: r.type === 'reward' ? 'reward' : 'violation',
      name: String(r.name || '').trim(),
      points: Math.max(0, Math.min(10, Math.round(Number(r.points) || 0)))
    })).filter(r => r.teacherId && r.className && r.name && r.points > 0);
    out.history = out.history.map(h => ({
      id: String(h.id || uid('his')),
      studentId: String(h.studentId || ''),
      studentName: String(h.studentName || ''),
      className: String(h.className || ''),
      teacherId: String(h.teacherId || ''),
      teacherName: String(h.teacherName || ''),
      type: ['reward','violation','deletion','team-action','team-violation','team-participation'].includes(h.type) ? h.type : 'violation',
      actionType: ['reward','violation'].includes(h.actionType) ? h.actionType : '',
      ruleName: String(h.ruleName || ''),
      points: Math.max(0, Number(h.points) || 0),
      oldScore: clampScore(h.oldScore),
      newScore: clampScore(h.newScore),
      note: String(h.note || ''),
      deletedHistoryId: String(h.deletedHistoryId || ''),
      time: Number.isFinite(Number(h.time)) ? Number(h.time) : Date.now(),
      teamId: String(h.teamId || ''),
      teamName: String(h.teamName || ''),
      weekNumber: Math.min(35, Math.max(1, Number(h.weekNumber) || 1))
    }));
    out.settings.siteName = String(out.settings.siteName || base.settings.siteName).trim() || base.settings.siteName;
    return out;
  }

  function defaultData() {
    return {
      version: VERSION,
      admin: { username: 'admin', password: 'admin123' },
      teachers: [],
      students: [],
      rules: clone(DEFAULT_RULES),
      teacherRules: [],
      history: [],
      teams: [],
      classes: [],
      settings: { siteName: 'Quản lý điểm hạnh kiểm', minScore: 0, maxScore: FIXED_MAX_SCORE, logActivity: true }
    };
  }

  const memoryStorage = (() => {
    const bag = {};
    return {
      getItem: key => Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null,
      setItem: (key, value) => { bag[key] = String(value); },
      removeItem: key => { delete bag[key]; },
      clear: () => Object.keys(bag).forEach(key => delete bag[key])
    };
  })();

  function getStorage() {
    try {
      if (window.localStorage) {
        const testKey = '__hk_storage_test__';
        window.localStorage.setItem(testKey, '1');
        window.localStorage.removeItem(testKey);
        return window.localStorage;
      }
    } catch (err) {
      console.warn('localStorage không khả dụng, dùng bộ nhớ tạm cho phiên hiện tại.', err);
    }
    return memoryStorage;
  }

  function loadLocalData() {
    try {
      const raw = getStorage().getItem(STORAGE_KEY);
      return raw ? normalizeData(JSON.parse(raw)) : null;
    } catch (err) {
      console.error('Không thể đọc dữ liệu cục bộ:', err);
      return null;
    }
  }

  function initFirebaseDatabase() {
    if (!window.firebase || !window.firebaseConfig) {
      throw new Error('Thiếu Firebase SDK hoặc firebaseConfig.');
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(window.firebaseConfig);
    }
    databaseRef = firebase.database().ref(FIREBASE_ROOT_PATH);
    return databaseRef;
  }

  function watchFirebaseChanges() {
    if (!databaseRef) return;
    databaseRef.on('value', snapshot => {
      const remote = snapshot.val();
      if (!remote || typeof remote !== 'object') return;

      const normalized = normalizeData(remote);
      normalized.students.forEach(s => { s.score = clampScore(s.score); });
      const changed = JSON.stringify(normalized) !== JSON.stringify(state.data);
      cloudReady = true;
      getStorage().setItem(STORAGE_KEY, JSON.stringify(normalized));

      if (changed && state.data) {
        state.data = normalized;
        $('#loginSiteName').textContent = state.data.settings.siteName;
        if (state.currentUser) {
          renderAppShell();
        }
      }
    }, err => {
      console.error('Firebase listener error:', err);
      cloudReady = false;
    });
  }

  async function loadData() {
    const local = loadLocalData();
    try {
      initFirebaseDatabase();
      const snapshot = await databaseRef.once('value');
      const remote = snapshot.val();
      // Lần đầu dùng: nếu Firebase chưa có dữ liệu, khởi tạo một bộ dữ liệu chung.
      // Ưu tiên dữ liệu cục bộ hiện có để tránh bỏ mất dữ liệu của người dùng.
      if (!remote || typeof remote !== 'object') {
        const initialData = normalizeData(local || defaultData());
        await databaseRef.set(initialData);
        cloudReady = true;
        getStorage().setItem(STORAGE_KEY, JSON.stringify(initialData));
        watchFirebaseChanges();
        return initialData;
      }
      const data = normalizeData(remote);
      cloudReady = true;
      getStorage().setItem(STORAGE_KEY, JSON.stringify(data));
      watchFirebaseChanges();
      return data;
    } catch (err) {
      console.warn('Không kết nối được Firebase, sử dụng dữ liệu cục bộ:', err);
      cloudReady = false;
      return local || defaultData();
    }
  }

  async function saveData() {
    try {
      state.data.version = VERSION;
      state.data.settings.maxScore = Math.max(Number(state.data.settings.minScore || 0) + 1, Math.min(10, Number(state.data.settings.maxScore || FIXED_MAX_SCORE)));
      state.data.students.forEach(s => { s.score = clampScore(s.score); });
      const serialized = JSON.stringify(state.data);
      getStorage().setItem(STORAGE_KEY, serialized);

      if (!databaseRef) initFirebaseDatabase();
      await databaseRef.set(state.data);
      cloudReady = true;
      return true;
    } catch (err) {
      console.error(err);
      cloudReady = false;
      showToast('Không thể đồng bộ dữ liệu lên Firebase. Dữ liệu vẫn được lưu tạm trên thiết bị.', 'error');
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function scoreClass(score) {
    if (score >= 8) return 'good';
    if (score >= 5) return 'mid';
    return 'low';
  }

  function scoreHtml(score) {
    const s = clampScore(score);
    const critical = s <= 2 ? ' score-critical' : '';
    const max = state.data?.settings?.maxScore ?? 10;
    if (s > max) {
      const extra = (s - max).toFixed(2).replace(/\.00$/, '');
      return `<span class="score ${scoreClass(max)}${critical}">${max}</span><span class="muted"> + </span><span class="score-bonus" title="Điểm cộng thêm">${extra}</span>`;
    }
    return `<span class="score ${scoreClass(s)}${critical}">${s}</span><span class="muted"> / ${max}</span>`;
  }

  function celebrate(kind = 'success') {
    const layer = document.createElement('div');
    layer.className = 'celebration-layer';
    const count = kind === 'team' ? 34 : 22;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('i');
      piece.className = 'celebration-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.setProperty('--dx', `${(Math.random() - .5) * 260}px`);
      piece.style.setProperty('--rot', `${(Math.random() - .5) * 900}deg`);
      piece.style.animationDelay = `${Math.random() * .18}s`;
      piece.style.width = `${6 + Math.random() * 6}px`;
      piece.style.height = `${10 + Math.random() * 10}px`;
      piece.style.background = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#ef4444'][Math.floor(Math.random()*5)];
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 1700);
  }

  function showToast(message, type = 'success') {
    const wrap = $('#toastContainer');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function setLoginMessage(message, type = 'error') {
    const el = $('#loginMessage');
    if (!message) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.className = `form-message ${type}`;
    el.textContent = message;
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0].slice(0,1) + parts[parts.length - 1].slice(0,1)).toUpperCase();
  }

  function setAvatarElement(el, avatar, fallback) {
    if (!el) return;
    el.innerHTML = '';
    if (avatar) {
      const img = document.createElement('img');
      img.src = avatar;
      img.alt = 'Ảnh đại diện';
      img.decoding = 'async';
      el.appendChild(img);
      el.classList.add('has-image');
    } else {
      el.textContent = fallback || '?';
      el.classList.remove('has-image');
    }
  }

  function isAdmin() { return state.currentUser?.role === 'admin'; }
  function currentTeacher() { return state.currentUser?.role === 'teacher' ? state.data.teachers.find(t => t.id === state.currentUser.teacherId) : null; }

  function canAccessStudent(student) {
    if (isAdmin()) return true;
    const t = currentTeacher();
    return !!t && t.active && t.classes.includes(student.className);
  }

  function accessibleStudents() {
    return state.data.students.filter(canAccessStudent);
  }

  function uniqueClasses(students = state.data.students) {
    return [...new Set(students.map(s => s.className).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'vi'));
  }

  function teacherClasses() {
    const t = currentTeacher();
    return t ? t.classes : [];
  }

  function effectiveClassOptions() {
    const classes = uniqueClasses(accessibleStudents());
    if (isAdmin()) return classes;
    return teacherClasses().sort((a,b) => a.localeCompare(b, 'vi'));
  }

  function renderAppShell() {
    $('#loginScreen').hidden = true;
    $('#appShell').hidden = false;
    const siteName = state.data.settings.siteName;
    $('#sidebarSiteName').textContent = siteName;
    $('#loginSiteName').textContent = siteName;
    $('#sidebarRole').textContent = isAdmin() ? 'ADMIN' : 'GIÁO VIÊN';
    $('#userDisplayName').textContent = isAdmin() ? 'Quản trị viên' : (currentTeacher()?.name || 'Giáo viên');
    $('#userDisplayRole').textContent = isAdmin() ? 'Quản trị viên' : 'Giáo viên';
    if (isAdmin()) setAvatarElement($('#userAvatar'), '', 'A');
    else setAvatarElement($('#userAvatar'), currentTeacher()?.avatar || '', initials(currentTeacher()?.name));
    $('#maxScorePill').textContent = `Điểm ${state.data.settings.minScore ?? 0}–${state.data.settings.maxScore ?? 10}`;
    $$('.admin-only').forEach(el => { el.style.display = isAdmin() ? '' : 'none'; });
    $$('.teacher-only').forEach(el => { el.style.display = isAdmin() ? 'none' : ''; });
    navigate(state.currentPage || 'dashboard', false);
  }

  function navigate(page, updateHistory = true) {
    const allowed = ['dashboard','students','teachers','rules','my-violations','my-rewards','teacher-account','history','settings','teams'];
    if (!allowed.includes(page) || (!isAdmin() && ['teachers','rules','settings'].includes(page)) || (isAdmin() && ['my-violations','my-rewards','teacher-account'].includes(page))) page = 'dashboard';
    state.currentPage = page;
    if (updateHistory) state.mobileMenuOpen = false;
    $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    $$('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
    const titles = { dashboard: 'Tổng quan', students: 'Học sinh', teachers: 'Giáo viên', rules: 'Quy định điểm', 'my-violations': 'Vi phạm lớp tôi', 'my-rewards': 'Khen thưởng lớp tôi', 'teacher-account': 'Tài khoản', history: 'Lịch sử', settings: 'Cài đặt', teams: 'Quản lý tổ & xếp hạng' };
    $('#pageTitle').textContent = titles[page];
    $('#pageHeading').textContent = titles[page];
    document.body.classList.remove('mobile-menu-open');
    if (page === 'dashboard') renderDashboard();
    if (page === 'students') renderStudents();
    if (page === 'teachers') renderTeachers();
    if (page === 'rules') renderRules();
    if (page === 'my-violations') renderMyRules('violation');
    if (page === 'my-rewards') renderMyRules('reward');
    if (page === 'teacher-account') renderTeacherAccount();
    if (page === 'history') renderHistory();
    if (page === 'settings') renderSettings();
    if (page === 'teams' && window.HanhKiemTeams) window.HanhKiemTeams.render();
  }

  function renderDashboard() {
    const allStudents = accessibleStudents();
    const cls = state.dashboardClass;
    const selectedWeek = Math.min(35, Math.max(1, Number(state.dashboardWeek) || 1));
    const students = cls === 'all' ? allStudents : allStudents.filter(s => s.className === cls);
    const histories = state.data.history.filter(h => {
      const stu = state.data.students.find(s => s.id === h.studentId);
      return !!stu && canAccessStudent(stu) && (cls === 'all' || stu.className === cls) && Number(h.weekNumber || 1) === selectedWeek;
    });
    const violations = histories.filter(h => h.type === 'violation');
    const rewards = histories.filter(h => h.type === 'reward');
    const avg = students.length ? students.reduce((sum, s) => sum + clampScore(s.score), 0) / students.length : 0;
    const classes = effectiveClassOptions();
    const classStudents = students.length;
    const maxScore = state.data?.settings?.maxScore ?? 10;
    // Top 5 học sinh được xếp theo số lần phát biểu trong tuần đang xem.
    const speechCounts = new Map();
    state.data.history.filter(h => h.type === 'team-participation' && Number(h.weekNumber || 0) === selectedWeek)
      .forEach(h => {
        const stu = state.data.students.find(s => s.id === h.studentId);
        if (!stu || !canAccessStudent(stu) || (cls !== 'all' && stu.className !== cls)) return;
        speechCounts.set(stu.id, (speechCounts.get(stu.id) || 0) + Math.max(0, Number(h.points) || 0));
      });
    const topStudents = students.slice()
      .sort((a,b) => (speechCounts.get(b.id) || 0) - (speechCounts.get(a.id) || 0) || a.name.localeCompare(b.name, 'vi'))
      .slice(0,5);
    const recent = histories.slice().sort((a,b) => b.time - a.time).slice(0, 5);

    // Xếp hạng tổ theo tuần: 100 điểm gốc + điểm cộng/trừ + điểm phát biểu.
    const teams = [];
    const teamList = window.HanhKiemTeams?.getTeamsForClass?.(cls) || state.data.teams || [];
    teamList.forEach((team, index) => {
      const members = state.data.students.filter(s => (team.studentIds || []).includes(s.id) && (cls === 'all' || s.className === cls));
      const score = window.HanhKiemTeams?.teamScore ? window.HanhKiemTeams.teamScore(team, selectedWeek) : 100;
      teams.push({ name: team.name || `Tổ ${index + 1}`, score, count: members.length });
    });
    teams.sort((a,b) => b.score - a.score);

    const lowStudents = students.filter(s => clampScore(s.score) < 5);
    const alertText = lowStudents.length
      ? `Có ${lowStudents.length} học sinh cần được theo dõi điểm hạnh kiểm.`
      : (violations.length ? `Có ${violations.length} lượt vi phạm được ghi nhận trong phạm vi đang xem.` : 'Chưa có vấn đề cần xử lý.');

    $('#page-dashboard').innerHTML = `
      <div class="school-dashboard">
        <div class="school-dashboard-head">
          <div>
            <div class="school-eyebrow">TỔNG QUAN LỚP HỌC</div>
            <h3>Xin chào, ${escapeHtml(isAdmin() ? 'Quản trị viên' : (currentTeacher()?.name || 'Giáo viên'))}!</h3>
            <p>Theo dõi nhanh sĩ số, điểm hạnh kiểm và tình hình thi đua của lớp.</p>
          </div>
          <div class="school-head-actions">
            <label class="class-picker">Lớp đang xem
              <select id="dashboardClassFilter">
                <option value="all" ${cls === 'all' ? 'selected' : ''}>Tất cả lớp</option>
                ${classes.map(c => `<option value="${escapeHtml(c)}" ${cls === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </label>
            <label class="class-picker">Tuần
              <select id="dashboardWeekFilter">
                ${Array.from({length:35}, (_,i) => i+1).map(w => `<option value="${w}" ${Number(state.dashboardWeek) === w ? 'selected' : ''}>Tuần ${w}</option>`).join('')}
              </select>
            </label>
            <button class="btn btn-school-primary" data-action="export-excel">Xuất báo cáo</button>
          </div>
        </div>

        <div class="school-kpis">
          <div class="school-kpi kpi-blue">
            <div><span>Tổng học sinh</span><strong>${classStudents}</strong><small>Học sinh trong lớp</small></div>
            <div class="kpi-symbol">👥</div>
          </div>
          <div class="school-kpi kpi-purple">
            <div><span>Sĩ số đã đủ</span><strong>${classStudents}</strong><small>100% sĩ số hiện tại</small></div>
            <div class="kpi-symbol">✓</div>
          </div>
          <div class="school-kpi kpi-green">
            <div><span>Điểm TB lớp</span><strong>${avg.toFixed(2)}</strong><small>Trên thang ${maxScore}</small></div>
            <div class="kpi-symbol">★</div>
          </div>
          <button class="school-kpi kpi-red school-kpi-clickable" data-action="show-week-violations" type="button">
            <div><span>Vi phạm cần xử lý</span><strong>${violations.length}</strong><small>Tuần ${selectedWeek} · ${new Set(violations.map(h => h.studentId)).size} học sinh</small></div>
            <div class="kpi-symbol">!</div>
          </button>
        </div>

        <div class="school-kpis" style="margin-top:14px">
          <div class="school-kpi kpi-orange">
            <div><span>Điểm trung bình các tổ</span><strong>${teams.length ? (teams.reduce((sum,t)=>sum+t.score,0)/teams.length).toFixed(2) : '0.00'}</strong><small>Tuần ${selectedWeek}</small></div>
            <div class="kpi-symbol">📊</div>
          </div>
          <div class="school-kpi kpi-green">
            <div><span>Tổ hạng nhất</span><strong>${teams.length ? escapeHtml(teams[0].name) : '—'}</strong><small>${teams.length ? teams[0].score.toFixed(2)+' điểm' : 'Chưa có dữ liệu'}</small></div>
            <div class="kpi-symbol">🏆</div>
          </div>
        </div>

        <div class="school-alert">
          <div class="alert-icon">!</div>
          <div><strong>Thông báo:</strong> ${escapeHtml(alertText)}</div>
          <button class="alert-close" aria-label="Đóng">×</button>
        </div>

        <div class="school-main-grid">
          <div class="school-panel">
            <div class="school-panel-head">
              <div><h3>Xếp hạng thi đua các tổ</h3><p>Thứ hạng tự động theo điểm cộng/trừ của Tuần ${Number(state.dashboardWeek)||1}</p></div>
              <span class="school-round-badge">Tuần ${Number(state.dashboardWeek) || 1}</span>
            </div>
            <div class="rank-list">
              ${teams.length ? teams.slice(0,6).map((t,i) => `
                <div class="rank-row">
                  <div class="rank-no">${i+1}</div>
                  <div class="rank-info"><strong>${escapeHtml(t.name)}</strong><span>${t.count} thành viên</span></div>
                  <div class="rank-bar"><i style="width:${Math.max(8, Math.min(100, t.score))}%"></i></div>
                  <strong class="rank-score">${t.score.toFixed(2)} / 100</strong>
                </div>`).join('') : `<div class="school-empty">Chưa có dữ liệu tổ. Hãy thêm học sinh và phân tổ.</div>`}
            </div>
          </div>

          <div class="school-panel">
            <div class="school-panel-head">
              <div><h3>Top 5 học sinh phát biểu nhiều nhất</h3><p>Xếp theo số lần phát biểu trong Tuần ${selectedWeek}</p></div>
              <span class="school-medal">🏆</span>
            </div>
            <div class="top-students">
              ${topStudents.length ? topStudents.map((s,i) => `
                <button class="top-student" data-action="student-detail" data-id="${escapeHtml(s.id)}">
                  <span class="student-rank">${i+1}</span>
                  <span class="student-avatar">${escapeHtml(initials(s.name))}</span>
                  <span class="student-name"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.className)}</small></span>
                  <span class="student-score">${speechCounts.get(s.id) || 0} <small>lần phát biểu</small></span>
                </button>`).join('') : `<div class="school-empty">Chưa có học sinh.</div>`}
            </div>
          </div>
        </div>

        <div class="school-bottom-grid">
          <div class="school-panel">
            <div class="school-panel-head"><div><h3>Hoạt động gần đây</h3><p>Những cập nhật mới nhất</p></div><button class="btn btn-school-light" data-action="go-history">Xem tất cả</button></div>
            ${recent.length ? `<div class="school-activity">${recent.map(h => `
              <div class="school-activity-row">
                <span class="activity-badge ${h.type === 'reward' ? 'reward' : 'violation'}">${h.type === 'reward' ? '+' : '−'}</span>
                <div><strong>${escapeHtml(h.studentName)}</strong><span>${escapeHtml(h.ruleName)} · ${formatDate(h.time)}</span></div>
                <b>${h.type === 'reward' ? '+' : '−'}${h.points}</b>
              </div>`).join('')}</div>` : `<div class="school-empty">Chưa có hoạt động gần đây.</div>`}
          </div>
          <div class="school-panel school-summary">
            <div class="school-panel-head"><div><h3>Tình hình hạnh kiểm</h3><p>Phân bố điểm của học sinh</p></div></div>
            <div class="summary-metrics">
              <div><span>Tốt (≥ 8)</span><strong>${students.filter(s => clampScore(s.score) >= 8).length}</strong></div>
              <div><span>Khá (5–7.99)</span><strong>${students.filter(s => clampScore(s.score) >= 5 && clampScore(s.score) < 8).length}</strong></div>
              <div><span>Cần chú ý (&lt; 5)</span><strong>${lowStudents.length}</strong></div>
            </div>
          </div>
        </div>
      </div>`;

    const filter = $('#dashboardClassFilter');
    if (filter) filter.addEventListener('change', e => { state.dashboardClass = e.target.value; renderDashboard(); });
    const weekFilter = $('#dashboardWeekFilter');
    if (weekFilter) weekFilter.addEventListener('change', e => { state.dashboardWeek = Math.min(35, Math.max(1, Number(e.target.value) || 1)); renderDashboard(); });
    const close = $('.alert-close');
    if (close) close.addEventListener('click', e => e.currentTarget.closest('.school-alert')?.remove());
  }

  function renderStudents() {
    const students = accessibleStudents().filter(s => {
      const q = state.studentSearch.trim().toLocaleLowerCase('vi');
      const matchQ = !q || s.name.toLocaleLowerCase('vi').includes(q);
      const matchClass = state.studentClass === 'all' || s.className === state.studentClass;
      return matchQ && matchClass;
    });
    const classes = effectiveClassOptions();
    const studentTeamName = s => window.HanhKiemTeams?.teamForStudent(s)?.name || 'Chưa xếp tổ';
    const adminTools = isAdmin() ? `
      <button class="btn btn-primary" data-action="add-student">+ Thêm học sinh</button>
      <button class="btn btn-secondary" data-action="import-students">📥 Nhập Excel/CSV</button>
      <button class="btn btn-secondary" data-action="download-template">⬇️ Tải Excel mẫu</button>
      <button class="btn btn-danger" data-action="bulk-student-deduct">− Trừ nhiều học sinh</button>` : `<button class="btn btn-danger" data-action="bulk-student-deduct">− Trừ nhiều học sinh</button>`;

    $('#page-students').innerHTML = `
      <div class="toolbar" style="margin-bottom:16px;">
        <div class="toolbar-left">
          <div class="search-wrap"><span class="search-icon">⌕</span><input id="studentSearch" value="${escapeHtml(state.studentSearch)}" placeholder="Tìm theo họ và tên..."></div>
          <select id="studentClassFilter" style="min-width:150px"><option value="all">Tất cả lớp</option>${classes.map(c=>`<option value="${escapeHtml(c)}" ${state.studentClass===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select>
        </div>
        <div class="toolbar-right">${adminTools}<button class="btn btn-primary" data-action="export-excel">📊 Xuất Excel</button></div>
      </div>
      ${!isAdmin() && currentTeacher() ? `<div class="notice info" style="margin-bottom:16px;">Bạn đang xem các lớp phụ trách: <strong>${escapeHtml(currentTeacher().classes.join(', ') || 'Chưa được phân lớp')}</strong>.</div>` : ''}
      <div class="card">
        <div class="card-header"><div><h3 class="card-title">Danh sách học sinh</h3><div class="card-subtitle">${students.length} học sinh phù hợp · giữ nguyên thứ tự nhập</div></div></div>
        <div class="table-wrap">
          ${students.length ? `<table><thead><tr><th>STT</th><th>Họ và tên</th><th>Tổ</th><th>Lớp</th><th>Điểm hiện tại</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${students.map((s,i)=>`
            <tr>
              <td>${i+1}</td>
              <td><button class="link-btn" data-action="student-detail" data-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button></td>
              <td>${escapeHtml(studentTeamName(s))}</td>
              <td>${escapeHtml(s.className)}</td>
              <td>${scoreHtml(s.score)}</td>
              <td>${statusPill(s.score)}</td>
              <td><div class="actions">
                <button class="btn btn-secondary" data-action="student-detail" data-id="${escapeHtml(s.id)}">Chi tiết</button>
                ${canAccessStudent(s) ? `<button class="btn btn-danger" data-action="record-violation" data-id="${escapeHtml(s.id)}">− Vi phạm</button><button class="btn btn-success" data-action="record-reward" data-id="${escapeHtml(s.id)}">+ Khen thưởng</button>` : ''}
                ${isAdmin() ? `<button class="btn btn-secondary" data-action="edit-student" data-id="${escapeHtml(s.id)}">Sửa</button><button class="btn btn-danger" data-action="delete-student" data-id="${escapeHtml(s.id)}">Xóa</button>` : ''}
              </div></td>
            </tr>`).join('')}</tbody></table>` : `<div class="empty"><strong>Không tìm thấy học sinh</strong>Thử thay đổi từ khóa hoặc bộ lọc lớp.</div>`}
        </div>
      </div>`;

    $('#studentSearch').addEventListener('input', e => { state.studentSearch = e.target.value; renderStudents(); restoreCaret('studentSearch', state.studentSearch.length); });
    $('#studentClassFilter').addEventListener('change', e => { state.studentClass = e.target.value; renderStudents(); });
  }

  function restoreCaret(id, pos) {
    const el = $('#' + id);
    if (!el) return;
    try { el.focus(); el.setSelectionRange(pos,pos); } catch (_) {}
  }

  function statusPill(score) {
    const s = clampScore(score);
    if (s >= 8) return '<span class="pill pill-success">Tốt</span>';
    if (s >= 5) return '<span class="pill pill-warning">Cần theo dõi</span>';
    return '<span class="pill pill-danger">Thấp</span>';
  }

  function renderTeachers() {
    if (!isAdmin()) return navigate('dashboard');
    const teachers = state.data.teachers.slice().sort((a,b)=>a.name.localeCompare(b.name,'vi'));
    $('#page-teachers').innerHTML = `
      <div class="toolbar" style="margin-bottom:16px;"><div><div class="muted">Quản lý tài khoản có quyền thao tác học sinh</div><h3 style="margin:4px 0 0;font-size:22px;">Giáo viên</h3></div><div class="toolbar-right"><button class="btn btn-primary" data-action="add-teacher">+ Thêm giáo viên</button></div></div>
      <div class="card"><div class="card-header"><div><h3 class="card-title">Danh sách giáo viên</h3><div class="card-subtitle">${teachers.length} tài khoản</div></div></div><div class="table-wrap">
      ${teachers.length ? `<table><thead><tr><th>STT</th><th>Họ tên</th><th>Tài khoản</th><th>Lớp phụ trách</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${teachers.map((t,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(t.name)}</td><td><code>${escapeHtml(t.username)}</code></td><td>${t.classes.length ? t.classes.map(c=>`<span class="pill pill-blue">${escapeHtml(c)}</span>`).join(' ') : '<span class="muted">Chưa phân lớp</span>'}</td><td>${t.active?'<span class="pill pill-success">Đang hoạt động</span>':'<span class="pill pill-danger">Đã khóa</span>'}</td><td><div class="actions"><button class="btn btn-secondary" data-action="edit-teacher" data-id="${escapeHtml(t.id)}">Sửa</button><button class="btn btn-secondary" data-action="toggle-teacher" data-id="${escapeHtml(t.id)}">${t.active?'Khóa':'Mở khóa'}</button><button class="btn btn-danger" data-action="delete-teacher" data-id="${escapeHtml(t.id)}">Xóa</button></div></td></tr>`).join('')}</tbody></table>` : `<div class="empty"><strong>Chưa có giáo viên</strong>Thêm tài khoản giáo viên để phân quyền thao tác.</div>`}
      </div></div>`;
  }

  function renderRules() {
    if (!isAdmin()) return navigate('dashboard');
    const violations = state.data.rules.filter(r=>r.type==='violation').sort((a,b)=>a.name.localeCompare(b.name,'vi'));
    const rewards = state.data.rules.filter(r=>r.type==='reward').sort((a,b)=>a.name.localeCompare(b.name,'vi'));
    const table = (rules, type) => rules.length ? `<table><thead><tr><th>STT</th><th>Nội dung</th><th>Điểm</th><th>Thao tác</th></tr></thead><tbody>${rules.map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td><span class="pill ${type==='reward'?'pill-success':'pill-danger'}">${type==='reward'?'+':'−'}${r.points}</span></td><td><div class="actions"><button class="btn btn-secondary" data-action="edit-rule" data-id="${escapeHtml(r.id)}">Sửa</button><button class="btn btn-danger" data-action="delete-rule" data-id="${escapeHtml(r.id)}">Xóa</button></div></td></tr>`).join('')}</tbody></table>` : `<div class="empty"><strong>Chưa có quy định</strong>Thêm quy định để giáo viên có thể sử dụng.</div>`;
    $('#page-rules').innerHTML = `
      <div class="toolbar" style="margin-bottom:16px;"><div><div class="muted">Quy định được áp dụng khi giáo viên ghi nhận thao tác</div><h3 style="margin:4px 0 0;font-size:22px;">Quy định điểm</h3></div><button class="btn btn-primary" data-action="add-rule">+ Thêm quy định</button></div>
      <div class="grid grid-2">
        <div class="card"><div class="card-header"><div><h3 class="card-title">⚠️ Vi phạm</h3><div class="card-subtitle">Điểm trừ</div></div></div><div class="table-wrap">${table(violations,'violation')}</div></div>
        <div class="card"><div class="card-header"><div><h3 class="card-title">🏆 Khen thưởng</h3><div class="card-subtitle">Điểm cộng</div></div></div><div class="table-wrap">${table(rewards,'reward')}</div></div>
      </div>`;
  }

  function teacherOwnRules() {
    const t = currentTeacher();
    if (!t) return [];
    return state.data.teacherRules.filter(r => r.teacherId === t.id);
  }

  function teacherRulesForClass(className, type = null) {
    const t = currentTeacher();
    if (!t || !t.classes.includes(className)) return [];
    return state.data.teacherRules.filter(r => r.teacherId === t.id && r.className === className && (!type || r.type === type));
  }

  function availableRulesForStudent(student, type) {
    const globalRules = state.data.rules.filter(r => r.type === type).map(r => ({ ...r, source: 'global' }));
    if (isAdmin()) return globalRules;
    const tRules = teacherRulesForClass(student.className, type).map(r => ({ ...r, source: 'teacher', ownerName: currentTeacher()?.name || '' }));
    return globalRules.concat(tRules);
  }

  function renderMyRules(type = 'violation') {
    if (isAdmin()) return navigate('dashboard');
    const teacher = currentTeacher();
    if (!teacher) return navigate('dashboard');
    const own = teacherOwnRules().filter(r => r.type === type);
    const label = type === 'reward' ? 'Khen thưởng' : 'Vi phạm';
    const icon = type === 'reward' ? '🏆' : '⚠️';
    const verb = type === 'reward' ? 'cộng' : 'trừ';
    const intro = type === 'reward'
      ? 'Tự thiết lập các nội dung khen thưởng và số điểm cộng cho từng lớp bạn được phân công.'
      : 'Tự thiết lập các lỗi vi phạm và số điểm trừ cho từng lớp bạn được phân công.';
    const grouped = teacher.classes.map(className => ({
      className,
      items: own.filter(r => r.className === className)
    }));
    const table = items => items.length ? `<div class="table-wrap"><table><thead><tr><th>STT</th><th>Nội dung</th><th>Điểm</th><th>Thao tác</th></tr></thead><tbody>${items.map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td><span class="pill ${type==='reward'?'pill-success':'pill-danger'}">${type==='reward'?'+':'−'}${r.points}</span></td><td><div class="actions"><button class="btn btn-secondary" data-action="edit-my-rule" data-id="${escapeHtml(r.id)}">Sửa</button><button class="btn btn-danger" data-action="delete-my-rule" data-id="${escapeHtml(r.id)}">Xóa</button></div></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><strong>Chưa có quy định ${label.toLowerCase()}</strong>Hãy thêm quy định riêng cho lớp này.</div>`;
    const root = type === 'reward' ? '#page-my-rewards' : '#page-my-violations';
    $(root).innerHTML = `
      <div class="toolbar" style="margin-bottom:16px;"><div><div class="muted">${escapeHtml(intro)}</div><h3 style="margin:4px 0 0;font-size:22px;">${icon} ${label} lớp tôi</h3></div><div class="toolbar-right"><button class="btn btn-primary" data-action="add-my-rule" data-type="${type}">+ Thêm ${label.toLowerCase()}</button></div></div>
      <div class="notice info" style="margin-bottom:16px;">Chỉ áp dụng cho <strong>đúng lớp</strong> bạn chọn. Quy định chung do Admin tạo vẫn hoạt động bình thường. Mỗi quy định có thể ${verb} điểm nhưng tổng điểm học sinh luôn được giới hạn từ 0 đến 10.</div>
      ${grouped.length ? grouped.map(g => `<div class="card" style="margin-bottom:16px;"><div class="card-header"><div><h3 class="card-title">Lớp ${escapeHtml(g.className)}</h3><div class="card-subtitle">${g.items.length} quy định ${label.toLowerCase()}</div></div><button class="btn btn-secondary" data-action="add-my-rule" data-class="${escapeHtml(g.className)}" data-type="${type}">+ Thêm cho lớp này</button></div>${table(g.items)}</div>`).join('') : `<div class="empty"><strong>Chưa được phân công lớp</strong>Liên hệ Admin để được phân công lớp trước khi tạo quy định riêng.</div>`}
    `;
  }

  async function compressAvatar(file, size = 256) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Vui lòng chọn một file ảnh hợp lệ.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Ảnh quá lớn. Vui lòng chọn ảnh dưới 8MB.');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Không thể đọc ảnh.'));
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('File ảnh không hợp lệ.'));
      image.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.86);
  }

  function renderTeacherAccount() {
    const teacher = currentTeacher();
    if (!teacher) return navigate('dashboard');
    const avatar = teacher.avatar || '';
    $('#page-teacher-account').innerHTML = `
      <div class="toolbar" style="margin-bottom:16px;"><div><div class="muted">Quản lý thông tin cá nhân của tài khoản giáo viên.</div><h3 style="margin:4px 0 0;font-size:22px;">👤 Tài khoản của tôi</h3></div></div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-header"><div><h3 class="card-title">Ảnh đại diện</h3><div class="card-subtitle">Ảnh được lưu ngay trong trình duyệt này.</div></div></div>
          <div class="card-body">
            <div class="profile-avatar-panel">
              <div class="avatar avatar-large" id="teacherAvatarPreview"></div>
              <div>
                <strong>${escapeHtml(teacher.name)}</strong>
                <div class="muted" style="margin-top:4px;">${escapeHtml(teacher.username)}</div>
                <div class="actions" style="margin-top:12px;"><label class="btn btn-secondary" for="teacherAvatarInput">📷 Chọn ảnh</label><input id="teacherAvatarInput" type="file" accept="image/*" hidden><button class="btn btn-danger" type="button" data-action="remove-avatar">Xóa ảnh</button></div>
              </div>
            </div>
            <div class="notice info" style="margin-top:16px;">Nên dùng ảnh vuông. Hệ thống sẽ tự cắt giữa ảnh và nén nhẹ để tiết kiệm dung lượng dữ liệu.</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div><h3 class="card-title">Thông tin tài khoản</h3><div class="card-subtitle">Bạn chỉ có thể sửa tài khoản của chính mình.</div></div></div>
          <div class="card-body">
            <form id="teacherAccountForm" class="stack-form" style="margin-top:0;">
              <label>Họ và tên<input name="name" value="${escapeHtml(teacher.name)}" required></label>
              <label>Tài khoản<input value="${escapeHtml(teacher.username)}" disabled></label>
              <label>Lớp phụ trách<input value="${escapeHtml(teacher.classes.join(', ') || 'Chưa phân công')}" disabled></label>
              <label>Mật khẩu mới<input name="password" type="password" autocomplete="new-password" placeholder="Để trống nếu không đổi"></label>
              <label>Nhập lại mật khẩu mới<input name="password2" type="password" autocomplete="new-password" placeholder="Để trống nếu không đổi"></label>
              <div class="modal-actions"><button class="btn btn-primary" type="submit">Lưu thay đổi</button></div>
            </form>
          </div>
        </div>
      </div>`;
    setAvatarElement($('#teacherAvatarPreview'), avatar, initials(teacher.name));
    let pendingAvatar = avatar;
    const fileInput = $('#teacherAvatarInput');
    if (fileInput) fileInput.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        pendingAvatar = await compressAvatar(file);
        setAvatarElement($('#teacherAvatarPreview'), pendingAvatar, initials(teacher.name));
        showToast('Đã chọn ảnh. Nhấn “Lưu thay đổi” để lưu.', 'success');
      } catch (err) {
        showToast(err.message || 'Không thể xử lý ảnh.', 'error');
        e.target.value = '';
      }
    });
    $('#teacherAccountForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const name = String(fd.get('name') || '').trim();
      const password = String(fd.get('password') || '');
      const password2 = String(fd.get('password2') || '');
      if (!name) return showToast('Vui lòng nhập họ và tên.', 'error');
      if ((password || password2) && password !== password2) return showToast('Mật khẩu nhập lại không khớp.', 'error');
      if (password && password.length < 6) return showToast('Mật khẩu mới phải có ít nhất 6 ký tự.', 'error');
      teacher.name = name;
      teacher.avatar = pendingAvatar || '';
      if (password) teacher.password = password;
      saveData();
      renderAppShell();
      navigate('teacher-account');
      showToast('Đã cập nhật tài khoản.');
    });
  }

  function isScoreHistory(h) {
    return h && (h.type === 'violation' || h.type === 'reward');
  }

  function historyLabel(h) {
    if (h.type === 'reward') return '<span class="pill pill-success">Khen thưởng</span>';
    if (h.type === 'violation') return '<span class="pill pill-danger">Vi phạm</span>';
    return '<span class="pill pill-neutral">Đã xóa lịch sử</span>';
  }

  function historyDeltaText(h) {
    if (!isScoreHistory(h)) return '—';
    return `${h.type === 'reward' ? '+' : '−'}${h.points}`;
  }

  function recalibrateStudentHistory(studentId) {
    const indexed = state.data.history.map((h, index) => ({ h, index }))
      .filter(x => x.h.studentId === studentId && isScoreHistory(x.h))
      .sort((a, b) => Number(a.h.time) - Number(b.h.time) || a.index - b.index);
    let score = FIXED_MAX_SCORE;
    for (const item of indexed) {
      const h = item.h;
      h.oldScore = clampScore(score);
      const delta = h.type === 'reward' ? Number(h.points) : -Number(h.points);
      score = Math.max(Number(state.data.settings.minScore || 0), Math.round((score + (Number.isFinite(delta) ? delta : 0)) * 100) / 100);
      h.newScore = score;
    }
    const student = state.data.students.find(s => s.id === studentId);
    if (student) student.score = clampScore(score);
    return score;
  }

  function deleteHistoryEntry(historyId) {
    const entry = state.data.history.find(h => h.id === historyId);
    if (!entry || !isScoreHistory(entry)) return showToast('Bản ghi không tồn tại hoặc đã được xóa.', 'warning');
    const student = state.data.students.find(s => s.id === entry.studentId);
    if (!student || !canAccessStudent(student)) return showToast('Bạn không có quyền xóa lịch sử này.', 'error');
    const kind = entry.type === 'reward' ? 'khen thưởng' : 'vi phạm';
    const message = `Xóa ${kind} “${entry.ruleName}” của ${entry.studentName}?\n${formatDate(entry.time)} · ${entry.oldScore} → ${entry.newScore}\n\nSau khi xóa, điểm hiện tại và các mốc điểm lịch sử sau đó sẽ được tính lại. Bản ghi này sẽ bị xóa hoàn toàn, không tạo nhật ký xóa.`;
    if (!confirmAction(message)) return;

    state.data.history = state.data.history.filter(h => h.id !== historyId);
    recalibrateStudentHistory(entry.studentId);
    saveData();
    showToast(`Đã xóa ${kind}; không lưu thêm nhật ký xóa.`);
    renderCurrentPage();
  }

  function renderHistory() {
    const allowedIds = new Set(accessibleStudents().map(s => s.id));
    const filtered = state.data.history.slice().sort((a,b)=>b.time-a.time).filter(h => {
      if (!allowedIds.has(h.studentId)) return false;
      const q = state.historySearch.trim().toLocaleLowerCase('vi');
      const text = `${h.studentName} ${h.className} ${h.teacherName} ${h.ruleName} ${h.note}`.toLocaleLowerCase('vi');
      const typeMatch = state.historyType === 'all' || h.type === state.historyType || (state.historyType === 'deletion' && h.type === 'deletion');
      return (!q || text.includes(q)) && typeMatch;
    });
    const hasHistory = state.data.history.length > 0;
    const actualCount = state.data.history.filter(isScoreHistory).length;
    $('#page-history').innerHTML = `
      <div class="toolbar" style="margin-bottom:16px;">
        <div class="toolbar-left"><div class="search-wrap"><span class="search-icon">⌕</span><input id="historySearch" value="${escapeHtml(state.historySearch)}" placeholder="Tìm học sinh, giáo viên, nội dung..."></div><select id="historyType"><option value="all" ${state.historyType==='all'?'selected':''}>Tất cả</option><option value="violation" ${state.historyType==='violation'?'selected':''}>Vi phạm</option><option value="reward" ${state.historyType==='reward'?'selected':''}>Khen thưởng</option><option value="deletion" ${state.historyType==='deletion'?'selected':''}>Nhật ký xóa</option></select></div>
        <div class="toolbar-right">${actualCount ? '<button class="btn btn-secondary" data-action="undo-last">↶ Xóa/hoàn tác gần đây</button>' : ''}<button class="btn btn-primary" data-action="export-excel">📊 Xuất Excel</button></div>
      </div>
      <div class="notice info" style="margin-bottom:16px;">Bạn có thể xóa <strong>bất kỳ vi phạm hoặc khen thưởng nào</strong> trong phạm vi học sinh bạn được phép quản lý. Hệ thống sẽ hỏi xác nhận lần cuối, tính lại điểm và lưu một bản ghi <strong>Đã xóa lịch sử</strong> để kiểm tra sau này.</div>
      <div class="card"><div class="card-header"><div><h3 class="card-title">Lịch sử thay đổi điểm</h3><div class="card-subtitle">${filtered.length} bản ghi đang hiển thị · ${actualCount} bản ghi còn hiệu lực</div></div></div><div class="table-wrap">
      ${filtered.length ? `<table><thead><tr><th>Thời gian</th><th>Học sinh</th><th>Lớp</th><th>Người thực hiện</th><th>Loại</th><th>Nội dung</th><th>Điểm</th><th>Trước → Sau</th><th>Ghi chú</th><th>Thao tác</th></tr></thead><tbody>${filtered.map(h=>`<tr><td>${formatDate(h.time)}</td><td>${escapeHtml(h.studentName)}</td><td>${escapeHtml(h.className)}</td><td>${escapeHtml(h.teacherName)}</td><td>${historyLabel(h)}</td><td>${escapeHtml(h.ruleName)}</td><td>${historyDeltaText(h)}</td><td>${isScoreHistory(h) ? `${clampScore(h.oldScore)} → <strong>${clampScore(h.newScore)}</strong>` : '—'}</td><td>${escapeHtml(h.note || '—')}</td><td>${isScoreHistory(h) ? `<button class="btn btn-danger btn-sm" data-action="delete-history" data-id="${escapeHtml(h.id)}">🗑 Xóa</button>` : '<span class="muted">Đã lưu nhật ký</span>'}</td></tr>`).join('')}</tbody></table>` : `<div class="empty"><strong>${hasHistory ? 'Không có bản ghi phù hợp' : 'Chưa có lịch sử'}</strong>${hasHistory ? 'Thử thay đổi bộ lọc.' : 'Lịch sử sẽ được tạo khi ghi vi phạm/khen thưởng.'}</div>`}
      </div></div>`;
    $('#historySearch').addEventListener('input', e => { state.historySearch = e.target.value; renderHistory(); restoreCaret('historySearch', state.historySearch.length); });
    $('#historyType').addEventListener('change', e => { state.historyType = e.target.value; renderHistory(); });
  }

  function renderSettings() {
    if (!isAdmin()) return navigate('dashboard');
    const s = state.data.settings;
    $('#page-settings').innerHTML = `
      <div class="grid grid-2">
        <div class="card"><div class="card-header"><div><h3 class="card-title">Thông tin website</h3><div class="card-subtitle">Cấu hình hiển thị cơ bản</div></div></div><div class="card-body"><form id="siteSettingsForm" class="stack-form" style="margin-top:0;"><label>Tên website<input name="siteName" value="${escapeHtml(s.siteName)}" required></label><label>Điểm khởi đầu<input value="${escapeHtml(s.maxScore ?? 10)}" disabled></label><label>Điểm tối đa<input value="${escapeHtml(s.maxScore ?? 10)}" disabled></label><div class="notice info">Bạn có thể chỉnh điểm tối thiểu/tối đa trong mục Quản lý tổ → Cấu hình điểm và nhật ký.</div><button class="btn btn-primary" type="submit">Lưu thông tin</button></form></div></div>
        <div class="card"><div class="card-header"><div><h3 class="card-title">Tài khoản Admin</h3><div class="card-subtitle">Thay đổi tài khoản và mật khẩu quản trị</div></div></div><div class="card-body"><form id="adminSettingsForm" class="stack-form" style="margin-top:0;"><label>Tài khoản Admin<input name="username" value="${escapeHtml(state.data.admin.username)}" required></label><label>Mật khẩu mới<input type="password" name="password" placeholder="Để trống để giữ nguyên"></label><label>Nhập lại mật khẩu<input type="password" name="password2" placeholder="Để trống nếu không đổi"></label><button class="btn btn-primary" type="submit">Lưu tài khoản</button></form></div></div>
        <div class="card"><div class="card-header"><div><h3 class="card-title">Sao lưu & khôi phục</h3><div class="card-subtitle">Dữ liệu được lưu trên Firebase</div></div></div><div class="card-body"><div class="toolbar"><button class="btn btn-secondary" data-action="backup">⬇️ Sao lưu JSON</button><label class="btn btn-secondary" style="display:inline-flex;cursor:pointer;">⬆️ Khôi phục JSON<input id="restoreFile" type="file" accept="application/json,.json" hidden></label></div><div class="notice warning" style="margin-top:14px;">Khôi phục sẽ thay thế toàn bộ dữ liệu hiện tại trong Firebase và các thiết bị đang dùng chung.</div></div></div>
        <div class="card"><div class="card-header"><div><h3 class="card-title">Thông tin dữ liệu</h3><div class="card-subtitle">Tổng quan cơ sở dữ liệu cục bộ</div></div></div><div class="card-body"><div class="kpi-row"><div class="kpi-mini"><span>Học sinh</span><strong>${state.data.students.length}</strong></div><div class="kpi-mini"><span>Giáo viên</span><strong>${state.data.teachers.length}</strong></div><div class="kpi-mini"><span>Lịch sử</span><strong>${state.data.history.length}</strong></div></div><div class="notice danger" style="margin-top:12px;">Nút xóa toàn bộ dữ liệu không được đặt trong giao diện để tránh mất dữ liệu ngoài ý muốn.</div></div></div>
      </div>`;
    $('#siteSettingsForm').addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.currentTarget); const siteName = String(fd.get('siteName')||'').trim(); if (!siteName) return showToast('Tên website không được để trống.', 'error'); state.data.settings.siteName = siteName; saveData(); renderAppShell(); showToast('Đã cập nhật thông tin website.'); });
    $('#adminSettingsForm').addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.currentTarget); const username = String(fd.get('username')||'').trim(); const password = String(fd.get('password')||''); const password2 = String(fd.get('password2')||''); if (!username) return showToast('Tài khoản Admin không được để trống.', 'error'); if (password && password !== password2) return showToast('Mật khẩu nhập lại không khớp.', 'error'); state.data.admin.username = username; if (password) state.data.admin.password = password; saveData(); showToast('Đã cập nhật tài khoản Admin.'); });
    $('#restoreFile').addEventListener('change', handleRestoreJson);
  }

  function openModal({title, body, footer='', wide=false}) {
    const root = $('#modalRoot');
    root.hidden = false;
    root.innerHTML = `<div class="modal ${wide?'wide':''}" role="dialog" aria-modal="true"><div class="modal-header"><h3 class="modal-title">${title}</h3><button class="close-btn" data-modal-close aria-label="Đóng">×</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div>`;
    root.onclick = e => { if (e.target === root || e.target.closest('[data-modal-close]')) closeModal(); };
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('#modalRoot').hidden = true;
    $('#modalRoot').innerHTML = '';
    document.body.style.overflow = '';
  }

  function confirmAction(message) {
    return window.confirm(message);
  }

  function showStudentDetail(id) {
    const student = state.data.students.find(s => s.id === id);
    if (!student || !canAccessStudent(student)) return showToast('Bạn không có quyền xem học sinh này.', 'error');
    const logs = state.data.history.filter(h => h.studentId === student.id).sort((a,b)=>b.time-a.time).slice(0,20);
    openModal({title:'Chi tiết học sinh', wide:true, body:`
      <div class="detail-head"><div><div class="detail-name">${escapeHtml(student.name)}</div><div class="detail-class">Lớp ${escapeHtml(student.className)}</div></div><div><div class="detail-score ${scoreClass(student.score)}">${clampScore(student.score)}<span class="muted" style="font-size:14px;"> / ${state.data.settings.maxScore ?? 10}</span></div><div style="text-align:right;margin-top:8px;">${statusPill(student.score)}</div></div></div>
      <div style="height:18px"></div>
      <div class="toolbar" style="margin-bottom:10px;"><div><h4 style="margin:0;font-size:14px;">Lịch sử gần đây</h4><div class="muted" style="font-size:12px;">Tối đa 20 bản ghi mới nhất</div></div><div class="actions">${canAccessStudent(student)?`<button class="btn btn-danger" data-action="record-violation" data-id="${escapeHtml(student.id)}">− Vi phạm</button><button class="btn btn-success" data-action="record-reward" data-id="${escapeHtml(student.id)}">+ Khen thưởng</button>`:''}</div></div>
      ${logs.length?`<div class="table-wrap"><table style="min-width:0"><thead><tr><th>Thời gian</th><th>Loại</th><th>Nội dung</th><th>Điểm</th><th>Trước → Sau</th><th>Người thực hiện</th><th>Ghi chú</th><th>Thao tác</th></tr></thead><tbody>${logs.map(h=>`<tr><td>${formatDate(h.time)}</td><td>${historyLabel(h)}</td><td>${escapeHtml(h.ruleName)}</td><td>${historyDeltaText(h)}</td><td>${isScoreHistory(h) ? `${h.oldScore} → <strong>${h.newScore}</strong>` : '—'}</td><td>${escapeHtml(h.teacherName)}</td><td>${escapeHtml(h.note||'—')}</td><td>${isScoreHistory(h) ? `<button class="btn btn-danger btn-sm" data-action="delete-history" data-id="${escapeHtml(h.id)}">🗑 Xóa</button>` : '<span class="muted">Đã lưu nhật ký</span>'}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><strong>Chưa có lịch sử</strong>Chưa phát sinh vi phạm, khen thưởng hoặc thao tác xóa.</div>`}
    `});
  }

  function showStudentForm(studentId = null) {
    if (!isAdmin()) return;
    const student = studentId ? state.data.students.find(s => s.id === studentId) : null;
    openModal({title: student ? 'Sửa học sinh' : 'Thêm học sinh', body:`
      <form id="studentForm" class="stack-form" style="margin-top:0;">
        <label>Họ và tên<input name="name" value="${escapeHtml(student?.name||'')}" required></label>
        <label>Lớp<input name="className" value="${escapeHtml(student?.className||'')}" required placeholder="Ví dụ: 12A2"></label>
        <div class="notice info">Điểm ${student?'hiện tại được giữ nguyên':'khởi đầu'} theo mức tối đa ${state.data.settings.maxScore ?? 10}.</div>
        <div class="modal-actions"><button class="btn btn-secondary" type="button" data-modal-close>Hủy</button><button class="btn btn-primary" type="submit">${student?'Lưu thay đổi':'Thêm học sinh'}</button></div>
      </form>`});
    $('#studentForm').addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.currentTarget); const name = String(fd.get('name')||'').trim(); const className = String(fd.get('className')||'').trim(); if (!name || !className) return showToast('Vui lòng nhập đầy đủ họ tên và lớp.', 'error'); const dup = state.data.students.find(s => s.name.toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi') && s.className.toLocaleLowerCase('vi')===className.toLocaleLowerCase('vi') && s.id !== studentId); if (dup) return showToast('Học sinh cùng tên + lớp đã tồn tại.', 'error'); if (student) { student.name = name; student.className = className; student.score = clampScore(student.score); showToast('Đã cập nhật học sinh.'); } else { state.data.students.push({id:uid('stu'),name,className,score:Number(state.data.settings.maxScore ?? FIXED_MAX_SCORE)}); showToast(`Đã thêm học sinh với ${state.data.settings.maxScore ?? FIXED_MAX_SCORE}/${state.data.settings.maxScore ?? FIXED_MAX_SCORE} điểm.`); } saveData(); closeModal(); renderStudents(); });
  }

  function showTeacherForm(teacherId = null) {
    if (!isAdmin()) return;
    const t = teacherId ? state.data.teachers.find(x=>x.id===teacherId) : null;
    openModal({title:t?'Sửa giáo viên':'Thêm giáo viên', body:`
      <form id="teacherForm" class="stack-form" style="margin-top:0;">
        <label>Họ tên giáo viên<input name="name" value="${escapeHtml(t?.name||'')}" required></label>
        <label>Tài khoản<input name="username" value="${escapeHtml(t?.username||'')}" required></label>
        <label>Mật khẩu<input name="password" type="password" value="" ${t?'':'required'} placeholder="${t?'Để trống để giữ nguyên':'Nhập mật khẩu'}"></label>
        <label>Lớp phụ trách<input name="classes" value="${escapeHtml((t?.classes||[]).join(', '))}" placeholder="Ví dụ: 12A1, 12A2"></label>
        <label style="display:flex;grid-template-columns:none;align-items:center;gap:9px;font-weight:600;"><input name="active" type="checkbox" style="width:auto" ${t?.active!==false?'checked':''}> Tài khoản đang hoạt động</label>
        <div class="notice info">Giáo viên chỉ thao tác được với học sinh thuộc các lớp được phân công.</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-secondary" type="button" data-modal-close>Hủy</button><button class="btn btn-primary" type="submit">${t?'Lưu thay đổi':'Tạo tài khoản'}</button></div>
      </form>`});
    $('#teacherForm').addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.currentTarget); const name = String(fd.get('name')||'').trim(); const username = String(fd.get('username')||'').trim(); const password = String(fd.get('password')||''); const classes = String(fd.get('classes')||'').split(',').map(x=>x.trim()).filter(Boolean); const active = fd.get('active') === 'on'; if (!name || !username || (!t && !password)) return showToast('Vui lòng nhập đủ thông tin bắt buộc.', 'error'); const same = state.data.teachers.find(x=>x.username.toLocaleLowerCase()===username.toLocaleLowerCase() && x.id !== teacherId); if (same || username.toLocaleLowerCase()===state.data.admin.username.toLocaleLowerCase()) return showToast('Tài khoản đã tồn tại.', 'error'); if (t) { t.name=name; t.username=username; if(password)t.password=password; t.classes=classes; t.active=active; showToast('Đã cập nhật giáo viên.'); } else { state.data.teachers.push({id:uid('tea'),name,username,password,classes,active}); showToast('Đã tạo tài khoản giáo viên.'); } saveData(); closeModal(); renderTeachers(); });
  }

  function showRuleForm(ruleId = null) {
    if (!isAdmin()) return;
    const r = ruleId ? state.data.rules.find(x=>x.id===ruleId) : null;
    openModal({title:r?'Sửa quy định':'Thêm quy định',body:`
      <form id="ruleForm" class="stack-form" style="margin-top:0;">
        <label>Loại quy định<select name="type"><option value="violation" ${r?.type==='violation'||!r?'selected':''}>Vi phạm — trừ điểm</option><option value="reward" ${r?.type==='reward'?'selected':''}>Khen thưởng — cộng điểm</option></select></label>
        <label>Nội dung<input name="name" value="${escapeHtml(r?.name||'')}" required placeholder="Ví dụ: Đi học muộn"></label>
        <label>Số điểm<input name="points" type="number" min="1" max="10" step="1" value="${r?.points||1}" required></label>
        <div class="notice warning">Điểm học sinh cuối cùng vẫn luôn được giới hạn trong 0–10, bất kể tổng điểm cộng/trừ.</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-secondary" type="button" data-modal-close>Hủy</button><button class="btn btn-primary" type="submit">${r?'Lưu thay đổi':'Thêm quy định'}</button></div>
      </form>`});
    $('#ruleForm').addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.currentTarget); const type = String(fd.get('type')); const name = String(fd.get('name')||'').trim(); const points = Math.max(1, Math.min(10, Math.round(Number(fd.get('points'))||0))); if(!name || points<1)return showToast('Vui lòng nhập nội dung và số điểm hợp lệ.','error'); const same = state.data.rules.find(x=>x.name.toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi') && x.type===type && x.id!==ruleId); if(same)return showToast('Quy định cùng loại và nội dung đã tồn tại.','error'); if(r){r.type=type;r.name=name;r.points=points;showToast('Đã cập nhật quy định.');}else{state.data.rules.push({id:uid('rule'),type,name,points});showToast('Đã thêm quy định.');} saveData();closeModal();renderRules();});
  }

  function showTeacherRuleForm(ruleId = null, presetClass = '', fixedType = '') {
    if (isAdmin()) return;
    const teacher = currentTeacher();
    if (!teacher || !teacher.classes.length) return showToast('Bạn chưa được phân công lớp.', 'warning');
    const r = ruleId ? state.data.teacherRules.find(x => x.id === ruleId && x.teacherId === teacher.id) : null;
    if (ruleId && !r) return showToast('Quy định không tồn tại hoặc bạn không có quyền sửa.', 'error');
    const defaultClass = r?.className || (teacher.classes.includes(presetClass) ? presetClass : teacher.classes[0]);
    const chosenType = r?.type || fixedType || 'violation';
    openModal({title:r?'Sửa quy định lớp':'Thêm quy định lớp', body:`
      <form id="teacherRuleForm" class="stack-form" style="margin-top:0;">
        <label>Lớp áp dụng<select name="className">${teacher.classes.map(c=>`<option value="${escapeHtml(c)}" ${c===defaultClass?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select></label>
        ${fixedType && !r ? `<input type="hidden" name="type" value="${fixedType}">` : `<label>Loại quy định<select name="type"><option value="violation" ${chosenType==='violation'?'selected':''}>Vi phạm — trừ điểm</option><option value="reward" ${chosenType==='reward'?'selected':''}>Khen thưởng — cộng điểm</option></select></label>`}
        <label>Nội dung<input name="name" value="${escapeHtml(r?.name||'')}" required placeholder="Ví dụ: Quên phù hiệu lớp"></label>
        <label>Số điểm<input name="points" type="number" min="1" max="10" step="1" value="${r?.points||1}" required></label>
        <div class="notice info">Quy định này chỉ áp dụng cho lớp đã chọn và chỉ tài khoản của bạn nhìn thấy/sử dụng được.</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-secondary" type="button" data-modal-close>Hủy</button><button class="btn btn-primary" type="submit">${r?'Lưu thay đổi':'Thêm quy định'}</button></div>
      </form>`});
    $('#teacherRuleForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const className = String(fd.get('className')||'').trim();
      const type = String(fd.get('type')||'');
      const name = String(fd.get('name')||'').trim();
      const points = Math.max(1, Math.min(10, Math.round(Number(fd.get('points'))||0)));
      if (!teacher.classes.includes(className)) return showToast('Lớp không thuộc phạm vi được phân công.', 'error');
      if (!['violation','reward'].includes(type) || !name || points < 1) return showToast('Vui lòng nhập đủ thông tin hợp lệ.', 'error');
      const dup = state.data.teacherRules.find(x => x.teacherId===teacher.id && x.className.toLocaleLowerCase('vi')===className.toLocaleLowerCase('vi') && x.type===type && x.name.toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi') && x.id!==ruleId);
      if (dup) return showToast('Quy định cùng loại, cùng lớp và cùng nội dung đã tồn tại.', 'error');
      if (r) { r.className=className; r.type=type; r.name=name; r.points=points; showToast('Đã cập nhật quy định lớp.'); }
      else { state.data.teacherRules.push({id:uid('trule'), teacherId:teacher.id, className, type, name, points}); showToast('Đã thêm quy định riêng cho lớp.'); }
      saveData(); closeModal(); navigate(type === 'reward' ? 'my-rewards' : 'my-violations', false);
    });
  }

  function showActionForm(studentId, type) {
    const student = state.data.students.find(s=>s.id===studentId);
    if (!student || !canAccessStudent(student)) return showToast('Bạn không có quyền thao tác với học sinh này.', 'error');
    const rules = availableRulesForStudent(student, type).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
    if (!rules.length) return showToast(`Chưa có quy định ${type==='reward'?'khen thưởng':'vi phạm'} cho lớp ${student.className}. Admin hoặc bạn có thể tạo quy định trước.`, 'warning');
    openModal({title:type==='reward'?'Ghi nhận khen thưởng':'Ghi nhận vi phạm', body:`
      <div class="detail-head" style="margin-bottom:16px;"><div><div class="detail-name" style="font-size:18px">${escapeHtml(student.name)}</div><div class="detail-class">Lớp ${escapeHtml(student.className)}</div></div><div><div class="detail-score ${scoreClass(student.score)}" style="font-size:30px">${clampScore(student.score)}<span class="muted" style="font-size:12px"> / 10</span></div></div></div>
      <form id="actionForm" class="stack-form" style="margin-top:0;">
        <label>${type==='reward'?'Nội dung khen thưởng':'Lỗi vi phạm'}<select name="ruleId">${rules.filter(r=>r.source==='global').length ? `<optgroup label="Quy định chung">${rules.filter(r=>r.source==='global').map(r=>`<option value="global:${escapeHtml(r.id)}">${escapeHtml(r.name)} — ${type==='reward'?'+':'−'}${r.points} điểm</option>`).join('')}</optgroup>` : ''}${rules.filter(r=>r.source==='teacher').length ? `<optgroup label="Quy định của bạn cho lớp ${escapeHtml(student.className)}">${rules.filter(r=>r.source==='teacher').map(r=>`<option value="teacher:${escapeHtml(r.id)}">${escapeHtml(r.name)} — ${type==='reward'?'+':'−'}${r.points} điểm</option>`).join('')}</optgroup>` : ''}</select></label>
        <label>Tuần<select name="weekNumber">${Array.from({length:35}, (_,i) => i+1).map(w => `<option value="${w}" ${w===Math.min(35,Math.max(1,Number(state.dashboardWeek)||1))?'selected':''}>Tuần ${w}</option>`).join('')}</select></label>
        <label>Ghi chú<textarea name="note" placeholder="Ghi chú thêm (không bắt buộc)"></textarea></label>
        <div class="notice ${type==='reward'?'success':'warning'}">Điểm sẽ được cập nhật tự động và luôn nằm trong khoảng 0–10.</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-secondary" type="button" data-modal-close>Hủy</button><button class="btn ${type==='reward'?'btn-success':'btn-danger'}" type="submit">${type==='reward'?'Cộng điểm':'Trừ điểm'}</button></div>
      </form>`});
    $('#actionForm').addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.currentTarget); const ref = String(fd.get('ruleId')||''); const [source, ruleId] = ref.split(':'); let rule = null; if (source === 'teacher') { rule = availableRulesForStudent(student, type).find(r=>r.source==='teacher' && r.id===ruleId && r.teacherId===currentTeacher()?.id && r.className===student.className); } else { rule = state.data.rules.find(r=>r.id===ruleId && r.type===type); } const note = String(fd.get('note')||'').trim(); const weekNumber = Math.min(35, Math.max(1, Number(fd.get('weekNumber')) || Number(state.dashboardWeek) || 1)); if(!rule) return showToast('Quy định không tồn tại hoặc bạn không có quyền sử dụng.','error'); recordAction(student, rule, type, note, weekNumber); });
  }

  function recordAction(student, rule, type, note='', weekNumber=1) {
    const oldScore = clampScore(student.score);
    const delta = type === 'reward' ? Number(rule.points) : -Number(rule.points);
    const newScore = Math.max(Number(state.data.settings.minScore || 0), Math.round((oldScore + delta) * 100) / 100);
    student.score = newScore;
    const teacher = isAdmin() ? {id:'admin',name:'Admin'} : currentTeacher();
    if (state.data.settings.logActivity !== false) state.data.history.push({id:uid('his'),studentId:student.id,studentName:student.name,className:student.className,teacherId:teacher?.id||'admin',teacherName:teacher?.name||'Admin',type,ruleName:rule.name,points:Math.max(0,Number(rule.points)||0),oldScore,newScore,note,weekNumber,time:Date.now()});
    saveData();
    closeModal();
    showToast(`${type==='reward'?'Đã ghi nhận khen thưởng':'Đã ghi nhận vi phạm'}: ${oldScore} → ${newScore}.`);
    if (type === 'reward') celebrate('success');
    renderCurrentPage();
  }

  function showWeeklyViolations(week = Number(state.dashboardWeek) || 1, cls = state.dashboardClass) {
    week = Math.min(35, Math.max(1, Number(week) || 1));
    const rows = state.data.history.filter(h => {
      if (h.type !== 'violation' || Number(h.weekNumber || 1) !== week) return false;
      const stu = state.data.students.find(s => s.id === h.studentId);
      return !!stu && canAccessStudent(stu) && (cls === 'all' || !cls || stu.className === cls);
    }).sort((a,b) => b.time - a.time);
    openModal({title:`Vi phạm cần xử lý — Tuần ${week}`, body:`
      <div class="notice warning" style="margin-bottom:14px">Danh sách chỉ hiển thị các vi phạm của <strong>Tuần ${week}</strong>${cls && cls !== 'all' ? `, lớp <strong>${escapeHtml(cls)}</strong>` : ''}.</div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>STT</th><th>Học sinh</th><th>Lớp</th><th>Vi phạm</th><th>Điểm trừ</th><th>Thời gian</th></tr></thead><tbody>${rows.map((h,i)=>`<tr><td>${i+1}</td><td><strong>${escapeHtml(h.studentName)}</strong></td><td>${escapeHtml(h.className)}</td><td>${escapeHtml(h.ruleName)}</td><td class="text-danger"><strong>−${Number(h.points)||0}</strong></td><td>${formatDate(h.time)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><strong>Không có vi phạm</strong>Tuần ${week} hiện chưa có học sinh nào bị ghi nhận vi phạm.</div>`}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn btn-secondary" type="button" data-modal-close>Đóng</button></div>
    `});
  }

  function renderCurrentPage() {
    if (state.currentPage === 'dashboard') renderDashboard();
    else if (state.currentPage === 'students') renderStudents();
    else if (state.currentPage === 'teachers') renderTeachers();
    else if (state.currentPage === 'rules') renderRules();
    else if (state.currentPage === 'history') renderHistory();
    else if (state.currentPage === 'settings') renderSettings();
  }

  function undoLast() {
    const allowedIds = new Set(accessibleStudents().map(s => s.id));
    const last = state.data.history.slice().sort((a,b)=>b.time-a.time).find(h => allowedIds.has(h.studentId) && isScoreHistory(h));
    if (!last) return showToast('Không có thao tác vi phạm/khen thưởng để xóa.', 'warning');
    return deleteHistoryEntry(last.id);
  }

  function deleteStudent(id) {
    if (!isAdmin()) return;
    const student = state.data.students.find(s=>s.id===id);
    if (!student) return;
    if (!confirmAction(`Xóa học sinh ${student.name} (${student.className})?\nLịch sử của học sinh sẽ vẫn được giữ lại.`)) return;
    state.data.students = state.data.students.filter(s=>s.id!==id);
    saveData(); renderStudents(); showToast('Đã xóa học sinh.');
  }

  function deleteTeacher(id) {
    if (!isAdmin()) return;
    const t = state.data.teachers.find(x=>x.id===id); if(!t)return;
    if (!confirmAction(`Xóa tài khoản giáo viên ${t.name}?`)) return;
    state.data.teachers = state.data.teachers.filter(x=>x.id!==id); saveData(); renderTeachers(); showToast('Đã xóa giáo viên.');
  }

  function deleteMyRule(id) {
    if (isAdmin()) return;
    const teacher = currentTeacher();
    const r = state.data.teacherRules.find(x => x.id === id && x.teacherId === teacher?.id);
    if (!r) return showToast('Không tìm thấy quy định hoặc bạn không có quyền xóa.', 'error');
    if (!confirmAction(`Xóa quy định "${r.name}" của lớp ${r.className}?\nLịch sử cũ vẫn được giữ nguyên.`)) return;
    state.data.teacherRules = state.data.teacherRules.filter(x => x.id !== id || x.teacherId !== teacher.id);
    saveData(); renderMyRules(); showToast('Đã xóa quy định lớp.');
  }

  function deleteRule(id) {
    if (!isAdmin()) return;
    const r=state.data.rules.find(x=>x.id===id); if(!r)return;
    if (!confirmAction(`Xóa quy định "${r.name}"?\nCác lịch sử cũ vẫn giữ nguyên nội dung.`)) return;
    state.data.rules = state.data.rules.filter(x=>x.id!==id); saveData(); renderRules(); showToast('Đã xóa quy định.');
  }

  function downloadBlob(filename, content, type) {
    const a=document.createElement('a'); const blob=new Blob([content],{type}); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  function backupJson() {
    const payload = JSON.stringify(normalizeData(state.data), null, 2);
    downloadBlob(`backup-hanh-kiem-${new Date().toISOString().slice(0,10)}.json`, payload, 'application/json;charset=utf-8');
    showToast('Đã tải file sao lưu JSON.');
  }

  async function handleRestoreJson(e) {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !parsed.admin || !Array.isArray(parsed.students) || !Array.isArray(parsed.history)) throw new Error('Sai cấu trúc dữ liệu.');
      if (!confirmAction('Khôi phục dữ liệu từ file này? Dữ liệu hiện tại sẽ bị thay thế.')) return;
      state.data = normalizeData(parsed);
      saveData();
      state.currentPage = 'dashboard';
      renderAppShell();
      showToast('Đã khôi phục dữ liệu.');
    } catch (err) {
      console.error(err); showToast('File JSON không hợp lệ hoặc không thể đọc.', 'error');
    } finally { e.target.value=''; }
  }

  function xmlEscape(value) {
    return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }

  function crc32(bytes) {
    let table = crc32.table;
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
      crc32.table = table;
    }
    let c = 0xFFFFFFFF;
    for (const b of bytes) c = table[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function writeU16(v) { return [v & 255, (v >>> 8) & 255]; }
  function writeU32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }

  function concatBytes(parts) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total); let offset = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; }
    return out;
  }

  function makeStoredZip(entries) {
    const encoder = new TextEncoder();
    const locals=[]; const centrals=[]; let offset=0;
    for (const entry of entries) {
      const nameBytes=encoder.encode(entry.name); const data=typeof entry.data==='string'?encoder.encode(entry.data):entry.data; const crc=crc32(data);
      const localHeader=new Uint8Array(concatBytes([
        Uint8Array.from(writeU32(0x04034b50)), Uint8Array.from(writeU16(20)), Uint8Array.from(writeU16(0)), Uint8Array.from(writeU16(0)),
        Uint8Array.from(writeU16(0)), Uint8Array.from(writeU16(0)), Uint8Array.from(writeU32(crc)), Uint8Array.from(writeU32(data.length)), Uint8Array.from(writeU32(data.length)),
        Uint8Array.from(writeU16(nameBytes.length)), Uint8Array.from(writeU16(0)), nameBytes, data
      ]));
      locals.push(localHeader);
      const central=new Uint8Array(concatBytes([
        Uint8Array.from(writeU32(0x02014b50)), Uint8Array.from(writeU16(20)), Uint8Array.from(writeU16(20)), Uint8Array.from(writeU16(0)), Uint8Array.from(writeU16(0)),
        Uint8Array.from(writeU16(0)), Uint8Array.from(writeU16(0)), Uint8Array.from(writeU32(crc)), Uint8Array.from(writeU32(data.length)), Uint8Array.from(writeU32(data.length)),
        Uint8Array.from(writeU16(nameBytes.length)), Uint8Array.from(writeU16(0)), Uint8Array.from(writeU16(0)), Uint8Array.from(writeU16(0)), Uint8Array.from(writeU16(0)), Uint8Array.from(writeU32(0)), Uint8Array.from(writeU32(offset)), nameBytes
      ]));
      centrals.push(central); offset += localHeader.length;
    }
    const centralData=concatBytes(centrals);
    const eocd=new Uint8Array(concatBytes([
      Uint8Array.from(writeU32(0x06054b50)), Uint8Array.from(writeU16(0)), Uint8Array.from(writeU16(0)),
      Uint8Array.from(writeU16(entries.length)), Uint8Array.from(writeU16(entries.length)), Uint8Array.from(writeU32(centralData.length)), Uint8Array.from(writeU32(offset)), Uint8Array.from(writeU16(0))
    ]));
    return concatBytes([...locals, centralData, eocd]);
  }

  function indexToColumn(index) {
    let n = Number(index) + 1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function worksheetXml(name, rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const sheetRows = safeRows.map((row, r) => {
      const values = Array.isArray(row) ? row : [row];
      return `<row r="${r + 1}">${values.map((value, c) => {
        const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
        const ref = `${indexToColumn(c)}${r + 1}`;
        return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;
      }).join('')}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  }

  function buildXlsxWorkbook(sheets) {
    const list = sheets.filter(s => s && s.name && Array.isArray(s.rows)).map((s, i) => ({ ...s, name: String(s.name).slice(0, 31) || `Sheet${i+1}` }));
    if (!list.length) throw new Error('Không có dữ liệu để xuất Excel.');
    const sheetParts = [];
    const workbookSheets = [];
    const workbookRels = [];
    list.forEach((sheet, i) => {
      const n = i + 1;
      const sheetPath = `xl/worksheets/sheet${n}.xml`;
      sheetParts.push({ name: sheetPath, data: worksheetXml(sheet.name, sheet.rows) });
      workbookSheets.push(`<sheet name="${xmlEscape(sheet.name)}" sheetId="${n}" r:id="rId${n}"/>`);
      workbookRels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    });
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets.join('')}</sheets></workbook>`;
    const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels.join('')}</Relationships>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const overrides = [`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`, ...list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)];
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`;
    return makeStoredZip([{name:'[Content_Types].xml',data:types},{name:'_rels/.rels',data:rootRels},{name:'xl/workbook.xml',data:workbook},{name:'xl/_rels/workbook.xml.rels',data:workbookRelsXml},...sheetParts]);
  }

  function historyExportRows(entries) {
    return entries.slice().sort((a,b)=>Number(a.time)-Number(b.time)).map((h, i) => [
      i + 1,
      formatDate(h.time),
      h.studentName,
      h.className,
      h.teacherName,
      h.type === 'violation' ? 'Vi phạm' : h.type === 'reward' ? 'Khen thưởng' : 'Đã xóa lịch sử',
      h.ruleName,
      h.points,
      isScoreHistory(h) ? h.oldScore : '',
      isScoreHistory(h) ? h.newScore : '',
      h.note || ''
    ]);
  }

  function exportExcel() {
    try {
      const accessible = accessibleStudents();
      const allowedIds = new Set(accessible.map(s => s.id));
      const history = state.data.history.filter(h => allowedIds.has(h.studentId));
      const teacher = currentTeacher();
      const rules = isAdmin()
        ? state.data.rules.map(r => [r.type === 'violation' ? 'Vi phạm' : 'Khen thưởng', 'Quy định chung', r.name, r.points, ''])
        : state.data.rules.map(r => [r.type === 'violation' ? 'Vi phạm' : 'Khen thưởng', 'Quy định chung', r.name, r.points, ''])
            .concat(state.data.teacherRules.filter(r => r.teacherId === teacher?.id && teacher?.classes.includes(r.className)).map(r => [r.type === 'violation' ? 'Vi phạm' : 'Khen thưởng', 'Quy định riêng', r.name, r.points, r.className]));
      const avg = accessible.length ? accessible.reduce((sum, s) => sum + clampScore(s.score), 0) / accessible.length : 0;
      const studentsRows = [
        ['STT', 'Lớp', 'Họ và tên', 'Điểm còn lại', 'Trạng thái'],
        ...accessible.map((s, i) => [i + 1, s.className, s.name, clampScore(s.score), clampScore(s.score) >= 8 ? 'Tốt' : clampScore(s.score) >= 5 ? 'Cần theo dõi' : 'Thấp'])
      ];
      const historyRows = [['STT', 'Thời gian', 'Họ và tên', 'Lớp', 'Người thực hiện', 'Loại', 'Nội dung', 'Số điểm', 'Điểm trước', 'Điểm sau', 'Ghi chú'], ...historyExportRows(history)];
      const ruleRows = [['Loại', 'Nguồn', 'Nội dung', 'Điểm', 'Lớp áp dụng'], ...rules];
      const summaryRows = [
        ['Mục', 'Giá trị'],
        ['Phạm vi xuất', isAdmin() ? 'Toàn bộ dữ liệu' : `Các lớp: ${(teacher?.classes || []).join(', ') || 'Chưa phân công'}`],
        ['Tổng số học sinh', accessible.length],
        ['Điểm trung bình', Number(avg.toFixed(2))],
        ['Lượt vi phạm', history.filter(h => h.type === 'violation').length],
        ['Lượt khen thưởng', history.filter(h => h.type === 'reward').length],
        ['Xuất lúc', formatDate(Date.now())]
      ];
      const sheets = [
        { name: 'Danh sách học sinh', rows: studentsRows },
        { name: 'Thống kê', rows: summaryRows },
        { name: 'Lịch sử', rows: historyRows },
        { name: 'Quy định', rows: ruleRows }
      ];
      if (isAdmin()) {
        sheets.push({
          name: 'Giáo viên',
          rows: [
            ['STT', 'Họ tên', 'Tài khoản', 'Lớp phụ trách', 'Trạng thái'],
            ...state.data.teachers.map((t, i) => [i + 1, t.name, t.username, t.classes.join(', '), t.active ? 'Đang hoạt động' : 'Đã khóa'])
          ]
        });
      }
      const bytes = buildXlsxWorkbook(sheets);
      downloadBlob(`hanh-kiem-${new Date().toISOString().slice(0,10)}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      showToast(`Đã xuất Excel: ${accessible.length} học sinh, ${history.length} bản ghi lịch sử.`);
    } catch (err) {
      console.error(err);
      showToast('Không thể xuất file Excel. Bạn có thể thử lại hoặc dùng Sao lưu JSON.', 'error');
    }
  }

  function buildSampleXlsx() {
    const rows = [['Lớp','Họ và tên'],['12A2','Nguyễn Văn A'],['12A2','Trần Thị B'],['12A3','Lê Văn C']];
    const cells = rows.map((row, r) => `<row r="${r+1}">${row.map((value,c)=>{ const col=String.fromCharCode(65+c); return `<c r="${col}${r+1}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`; }).join('')}</row>`).join('');
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Danh sách" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
    return makeStoredZip([{name:'[Content_Types].xml',data:types},{name:'_rels/.rels',data:rootRels},{name:'xl/workbook.xml',data:workbook},{name:'xl/_rels/workbook.xml.rels',data:workbookRels},{name:'xl/worksheets/sheet1.xml',data:sheet}]);
  }

  function downloadSampleXlsx() {
    try {
      const bytes=buildSampleXlsx();
      downloadBlob('mau-danh-sach-hoc-sinh.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      showToast('Đã tải file Excel mẫu (.xlsx).');
    } catch (err) {
      console.error(err);
      const csv='\ufeffLớp,Họ và tên\r\n12A2,Nguyễn Văn A\r\n12A2,Trần Thị B\r\n12A3,Lê Văn C\r\n';
      downloadBlob('mau-danh-sach-hoc-sinh.csv',csv,'text/csv;charset=utf-8');
      showToast('Không tạo được XLSX mẫu; đã tải mẫu CSV thay thế.','warning');
    }
  }

  function showImportModal() {
    if (!isAdmin()) return;
    openModal({title:'Nhập danh sách học sinh', wide:true, body:`
      <div class="notice info" style="margin-bottom:14px;">File Excel/CSV gồm đúng 2 cột theo mẫu: <strong>Cột 1: Lớp</strong> và <strong>Cột 2: Họ và tên</strong>. Website cũng chấp nhận file có đảo thứ tự 2 cột nếu tiêu đề vẫn đúng. Mỗi học sinh mới tự động nhận 10/10 điểm; tên + lớp trùng sẽ được bỏ qua.</div>
      <div class="import-grid">
        <div class="import-box"><strong>1. Chọn file</strong><p class="muted">Hỗ trợ .xlsx và .csv. Với Excel, website đọc sheet đầu tiên.</p><input id="excelFileInput" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><div id="importFileStatus" class="muted" style="margin-top:8px"></div></div>
        <div class="import-box"><strong>2. Dán từ Excel</strong><p class="muted">Copy 2 cột từ Excel và dán vào ô bên dưới.</p><textarea id="pasteExcelData" placeholder="Lớp\tHọ và tên\n12A2\tNguyễn Văn A"></textarea><button class="btn btn-secondary" id="pasteImportBtn">Nhập dữ liệu đã dán</button></div>
      </div>
      <div class="import-box" style="margin-top:12px;"><strong>Ví dụ dữ liệu hợp lệ</strong><table class="sample-table"><thead><tr><th>Lớp</th><th>Họ và tên</th></tr></thead><tbody><tr><td>12A2</td><td>Nguyễn Văn A</td></tr><tr><td>12A2</td><td>Trần Thị B</td></tr></tbody></table></div>
      <div id="importResult" style="margin-top:12px"></div>
    `,footer:'<button class="btn btn-secondary" data-modal-close>Đóng</button>'});
    $('#excelFileInput').addEventListener('change', handleImportFile);
    $('#pasteImportBtn').addEventListener('click', () => { const text=$('#pasteExcelData').value; const rows=parseDelimited(text, '\t'); applyImportedRows(rows); });
  }

  function normalizeHeader(s) { return String(s||'').trim().toLocaleLowerCase('vi').replace(/\s+/g,' '); }

  function parseDelimited(text, preferredDelimiter = null) {
    const input = String(text||'').replace(/^\ufeff/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    if (!input.trim()) return [];
    const firstLine = input.split('\n')[0];
    const delimiter = preferredDelimiter || (firstLine.includes('\t') ? '\t' : ',');
    const rows=[]; let row=[]; let field=''; let quoted=false;
    for(let i=0;i<input.length;i++){
      const ch=input[i];
      if(quoted){
        if(ch==='"' && input[i+1]==='"'){field+='"';i++;}
        else if(ch==='"'){quoted=false;}
        else field+=ch;
      } else {
        if(ch==='"'){quoted=true;}
        else if(ch===delimiter){row.push(field.trim());field='';}
        else if(ch==='\n'){row.push(field.trim());rows.push(row);row=[];field='';}
        else field+=ch;
      }
    }
    row.push(field.trim()); rows.push(row);
    return rows.filter(r=>r.some(x=>String(x).trim()!==''));
  }

  function rowsToStudents(rows) {
    if (!rows.length) return { rows: [], error: 'Không có dữ liệu.' };
    const header = rows[0].map(normalizeHeader);
    const nameHeaders = new Set(['họ và tên','ho va ten','họ tên','ho ten','họ tên thí sinh','ho ten thi sinh','họ và tên thí sinh','ho va ten thi sinh']);
    const classHeaders = new Set(['lớp','lop']);
    let nameIndex = header.findIndex(x => nameHeaders.has(x));
    let classIndex = header.findIndex(x => classHeaders.has(x));
    // Với file đúng 2 cột theo mẫu Lớp | Họ tên thí sinh, cho phép nhận theo vị trí
    // để tương thích với các file Excel thực tế có tiêu đề hơi khác nhau.
    if ((nameIndex < 0 || classIndex < 0) && header.length >= 2) {
      const looksLikeClass = classHeaders.has(header[0]) || header[0].includes('lớp');
      const looksLikeName = nameHeaders.has(header[1]) || /họ.*tên|ho.*ten/i.test(header[1]);
      if (looksLikeClass && looksLikeName) { classIndex = 0; nameIndex = 1; }
    }
    if (nameIndex < 0 || classIndex < 0) return { rows: [], error: 'Không tìm thấy cột Lớp và Họ tên thí sinh. Mẫu đúng: cột 1 = Lớp, cột 2 = Họ tên thí sinh.' };
    const out=[];
    for(let i=1;i<rows.length;i++){
      const name=String(rows[i][nameIndex]||'').trim(); const className=String(rows[i][classIndex]||'').trim();
      if(name && className) out.push({name,className});
    }
    return { rows: out };
  }

  function applyImportedRows(rawRows) {
    const parsed = rowsToStudents(rawRows);
    if(parsed.error){ $('#importResult').innerHTML=`<div class="notice danger">${escapeHtml(parsed.error)}</div>`; return; }
    let added=0, duplicate=0;
    parsed.rows.forEach(item=>{
      const exists=state.data.students.some(s=>s.name.toLocaleLowerCase('vi')===item.name.toLocaleLowerCase('vi') && s.className.toLocaleLowerCase('vi')===item.className.toLocaleLowerCase('vi'));
      if(exists){duplicate++;return;}
      state.data.students.push({id:uid('stu'),name:item.name,className:item.className,score:FIXED_MAX_SCORE}); added++;
    });
    saveData();
    $('#importResult').innerHTML=`<div class="notice success">Đã thêm <strong>${added}</strong> học sinh. Bỏ qua <strong>${duplicate}</strong> học sinh bị trùng.</div>`;
    showToast(`Đã thêm ${added} học sinh; bỏ qua ${duplicate} học sinh trùng.`);
  }

  async function handleImportFile(e) {
    const file=e.target.files?.[0]; if(!file)return;
    $('#importFileStatus').textContent='Đang đọc file...';
    try{
      const name=file.name.toLowerCase();
      if(name.endsWith('.csv')){
        applyImportedRows(parseDelimited(await file.text()));
      } else if(name.endsWith('.xlsx')) {
        const buffer=await file.arrayBuffer();
        const rows=await parseXlsxMinimal(buffer);
        applyImportedRows(rows);
      } else throw new Error('Định dạng file chưa được hỗ trợ.');
      $('#importFileStatus').textContent='Đã đọc file.';
    }catch(err){
      console.error(err);
      $('#importFileStatus').textContent='Không thể đọc file.';
      $('#importResult').innerHTML=`<div class="notice danger">Không thể đọc file Excel/CSV. ${escapeHtml(err.message || 'Lỗi không xác định')}. Hãy thử lại hoặc dùng chức năng dán từ Excel.</div>`;
    } finally { e.target.value=''; }
  }

  async function parseXlsxMinimal(arrayBuffer) {
    if(typeof DecompressionStream === 'undefined') throw new Error('Trình duyệt không hỗ trợ giải nén XLSX. Hãy dùng Chrome hoặc Edge phiên bản mới.');
    const zip = new SimpleZip(new Uint8Array(arrayBuffer));
    const workbookXml = await zip.text('xl/workbook.xml');
    const relsXml = await zip.text('xl/_rels/workbook.xml.rels');
    if(!workbookXml || !relsXml) throw new Error('File XLSX thiếu workbook.xml hoặc quan hệ sheet.');
    const wb = new DOMParser().parseFromString(workbookXml,'application/xml');
    const rels = new DOMParser().parseFromString(relsXml,'application/xml');
    const firstSheet = wb.getElementsByTagName('sheet')[0];
    if(!firstSheet) throw new Error('Không tìm thấy sheet trong Excel.');
    const rid = firstSheet.getAttribute('r:id');
    let target='';
    for(const rel of Array.from(rels.getElementsByTagName('Relationship'))){ if(rel.getAttribute('Id')===rid){ target=rel.getAttribute('Target')||''; break; } }
    if(!target) throw new Error('Không xác định được sheet đầu tiên.');
    target=target.replace(/^\/+/, '');
    if(!target.startsWith('xl/')) target='xl/'+target.replace(/^\.\//,'');
    const sharedText = await zip.text('xl/sharedStrings.xml');
    const shared=[];
    if(sharedText){
      const sdoc=new DOMParser().parseFromString(sharedText,'application/xml');
      for(const si of Array.from(sdoc.getElementsByTagName('si'))){ shared.push(Array.from(si.getElementsByTagName('t')).map(n=>n.textContent||'').join('')); }
    }
    const sheetText=await zip.text(target);
    if(!sheetText) throw new Error('Không đọc được sheet đầu tiên.');
    const sdoc=new DOMParser().parseFromString(sheetText,'application/xml');
    const rows=[];
    for(const rowEl of Array.from(sdoc.getElementsByTagName('row'))){
      const cells=[]; let lastIndex=-1;
      for(const c of Array.from(rowEl.getElementsByTagName('c'))){
        if(c.parentNode!==rowEl) continue;
        const ref=c.getAttribute('r')||''; const col=columnToIndex(ref.match(/[A-Z]+/i)?.[0]||'');
        while(cells.length<col) cells.push('');
        const type=c.getAttribute('t');
        let value='';
        const v=c.getElementsByTagName('v')[0]?.textContent ?? '';
        if(type==='s') value=shared[Number(v)] ?? '';
        else if(type==='inlineStr') value=Array.from(c.getElementsByTagName('t')).map(n=>n.textContent||'').join('');
        else if(type==='b') value=v==='1'?'TRUE':'FALSE';
        else value=v;
        cells[col]=value; lastIndex=Math.max(lastIndex,col);
      }
      rows.push(cells.slice(0,lastIndex+1));
    }
    return rows;
  }

  function columnToIndex(letters){ let n=0; for(const ch of letters.toUpperCase()){ n=n*26+(ch.charCodeAt(0)-64); } return Math.max(0,n-1); }

  class SimpleZip {
    constructor(bytes){ this.bytes=bytes; this.entries=new Map(); this.readDirectory(); }
    readDirectory(){
      const b=this.bytes; const view=new DataView(b.buffer,b.byteOffset,b.byteLength); let eocd=-1;
      for(let i=b.length-22;i>=0;i--){ if(view.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
      if(eocd<0) throw new Error('File không phải ZIP/XLSX hợp lệ.');
      const cdOffset=view.getUint32(eocd+16,true); const cdSize=view.getUint32(eocd+12,true); let p=cdOffset; const end=cdOffset+cdSize;
      while(p<end){ if(view.getUint32(p,true)!==0x02014b50) throw new Error('Directory ZIP không hợp lệ.'); const method=view.getUint16(p+10,true); const compSize=view.getUint32(p+20,true); const uncompSize=view.getUint32(p+24,true); const nameLen=view.getUint16(p+28,true); const extraLen=view.getUint16(p+30,true); const commentLen=view.getUint16(p+32,true); const localOffset=view.getUint32(p+42,true); const name=new TextDecoder().decode(b.subarray(p+46,p+46+nameLen)); this.entries.set(name,{method,compSize,uncompSize,localOffset}); p+=46+nameLen+extraLen+commentLen; }
    }
    async bytesOf(name){
      const e=this.entries.get(name); if(!e) return null; const b=this.bytes; const view=new DataView(b.buffer,b.byteOffset,b.byteLength); const p=e.localOffset; if(view.getUint32(p,true)!==0x04034b50) throw new Error('Local ZIP header không hợp lệ.'); const nameLen=view.getUint16(p+26,true); const extraLen=view.getUint16(p+28,true); const start=p+30+nameLen+extraLen; const comp=b.subarray(start,start+e.compSize);
      if(e.method===0) return comp;
      if(e.method===8){ const ds=new DecompressionStream('deflate-raw'); const stream=new Blob([comp]).stream().pipeThrough(ds); return new Uint8Array(await new Response(stream).arrayBuffer()); }
      throw new Error('XLSX dùng phương pháp nén chưa được hỗ trợ.');
    }
    async text(name){ const bytes=await this.bytesOf(name); return bytes?new TextDecoder('utf-8').decode(bytes):null; }
  }

  function showBulkStudentDeduct() {
    const students = accessibleStudents();
    const classes = effectiveClassOptions();
    openModal({title:'Trừ điểm nhiều học sinh', body:`
      <div class="notice warning" style="margin-bottom:14px">Chọn nhiều học sinh để áp dụng <strong>cùng một nội dung và số điểm trừ</strong>. Bản ghi được lưu theo tuần bạn chọn.</div>
      <form id="bulkStudentModalForm" class="stack-form">
        <div class="grid grid-2">
          <label>Tuần<select name="weekNumber">${Array.from({length:35},(_,i)=>i+1).map(w=>`<option value="${w}" ${w===Number(state.dashboardWeek)||w===1?'selected':''}>Tuần ${w}</option>`).join('')}</select></label>
          <label>Số điểm trừ<input name="points" type="number" min="0.1" max="10" step="0.1" value="1" required></label>
        </div>
        <label>Nội dung vi phạm<input name="ruleName" maxlength="150" placeholder="Ví dụ: Sử dụng điện thoại" required></label>
        <label>Lớp lọc<select id="bulkStudentClass"><option value="all">Tất cả lớp</option>${classes.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select></label>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong>Chọn học sinh</strong><button class="btn btn-secondary btn-sm" type="button" id="bulkSelectAll">Chọn tất cả</button></div>
        <div id="bulkStudentChoices" style="max-height:300px;overflow:auto;border:1px solid var(--border,#ddd);border-radius:12px;padding:10px">${students.map(st=>`<label class="bulk-student-choice" data-class="${escapeHtml(st.className)}" style="display:flex;gap:10px;align-items:center;padding:8px;border-radius:8px"><input type="checkbox" name="studentIds" value="${escapeHtml(st.id)}"><span><strong>${escapeHtml(st.name)}</strong> <span class="muted">(${escapeHtml(st.className)})</span></span></label>`).join('')}</div>
        <label>Ghi chú (không bắt buộc)<input name="note" maxlength="200" placeholder="Thông tin thêm"></label>
        <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn btn-secondary" type="button" data-modal-close>Hủy</button><button class="btn btn-danger" type="submit">Trừ điểm đã chọn</button></div>
      </form>`});
    const form=$('#bulkStudentModalForm'); if(!form)return;
    const cls=$('#bulkStudentClass');
    cls?.addEventListener('change',()=>$$('.bulk-student-choice',form).forEach(row=>row.hidden=cls.value!=='all' && row.dataset.class!==cls.value));
    $('#bulkSelectAll')?.addEventListener('click',()=>$$('.bulk-student-choice input[type="checkbox"]',form).filter(x=>!x.closest('label').hidden).forEach(x=>x.checked=true));
    form.addEventListener('submit',e=>{
      e.preventDefault(); const fd=new FormData(form); const ids=fd.getAll('studentIds').map(String); const points=Number(fd.get('points')); const ruleName=String(fd.get('ruleName')||'').trim(); const note=String(fd.get('note')||'').trim(); const weekNumber=Math.min(35,Math.max(1,Number(fd.get('weekNumber'))||1));
      if(!ids.length)return showToast('Hãy chọn ít nhất một học sinh.','error');
      if(!ruleName)return showToast('Nhập nội dung vi phạm.','error');
      if(!Number.isFinite(points)||points<=0||points>10)return showToast('Số điểm trừ phải lớn hơn 0 và không quá 10.','error');
      const selected=ids.map(id=>state.data.students.find(st=>st.id===id)).filter(Boolean);
      if(!confirmAction(`Trừ ${points} điểm cho ${selected.length} học sinh trong Tuần ${weekNumber} với nội dung “${ruleName}”?`))return;
      const teacher=isAdmin()?{id:'admin',name:'Admin'}:currentTeacher(); const now=Date.now();
      selected.forEach(st=>{const old=Number(st.score)||0;const next=Math.max(Number(state.data.settings.minScore||0),Math.round((old-points)*100)/100);st.score=next;if(state.data.settings.logActivity!==false)state.data.history.push({id:uid('his'),studentId:st.id,studentName:st.name,className:st.className,teacherId:teacher?.id||'admin',teacherName:teacher?.name||'Admin',type:'violation',ruleName,points,oldScore:old,newScore:next,note,weekNumber,time:now});});
      saveData(); closeModal(); renderStudents(); showToast(`Đã trừ ${points} điểm cho ${selected.length} học sinh.`);
    });
  }

  function setupEventDelegation() {
    document.addEventListener('click', e => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action; const id = actionEl.dataset.id;
      try {
        if (window.HanhKiemTeams && window.HanhKiemTeams.handleAction(actionEl)) return;
        if(action==='go-students') return navigate('students');
        if(action==='go-history') return navigate('history');
        if(action==='student-detail') return showStudentDetail(id);
        if(action==='show-week-violations') return showWeeklyViolations(state.dashboardWeek, state.dashboardClass);
        if(action==='add-student') return showStudentForm();
        if(action==='import-students') return showImportModal();
        if(action==='download-template') return downloadSampleXlsx();
        if(action==='export-excel') return exportExcel();
        if(action==='edit-student') return showStudentForm(id);
        if(action==='delete-student') return deleteStudent(id);
        if(action==='record-violation') return showActionForm(id,'violation');
        if(action==='record-reward') return showActionForm(id,'reward');
        if(action==='bulk-student-deduct') return showBulkStudentDeduct();
        if(action==='add-teacher') return showTeacherForm();
        if(action==='edit-teacher') return showTeacherForm(id);
        if(action==='toggle-teacher'){ const t=state.data.teachers.find(x=>x.id===id); if(t){t.active=!t.active;saveData();renderTeachers();showToast(t.active?'Đã mở khóa tài khoản.':'Đã khóa tài khoản.');} return; }
        if(action==='delete-teacher') return deleteTeacher(id);
        if(action==='add-rule') return showRuleForm();
        if(action==='edit-rule') return showRuleForm(id);
        if(action==='delete-rule') return deleteRule(id);
        if(action==='add-my-rule') return showTeacherRuleForm(null, actionEl.dataset.class || '', actionEl.dataset.type || '');
        if(action==='edit-my-rule') return showTeacherRuleForm(id);
        if(action==='delete-my-rule') return deleteMyRule(id);
        if(action==='remove-avatar') { const t=currentTeacher(); if(t){t.avatar=''; saveData(); renderTeacherAccount(); renderAppShell(); navigate('teacher-account'); showToast('Đã xóa ảnh đại diện.');} return; }
        if(action==='delete-history') return deleteHistoryEntry(id);
        if(action==='undo-last') return undoLast();
        if(action==='backup') return backupJson();
      } catch (err) { console.error(err); showToast('Thao tác không thực hiện được. Vui lòng thử lại.', 'error'); }
    });

    $$('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.page)));
    $('#logoutBtn').addEventListener('click', () => logout());
    $('#mobileMenuBtn').addEventListener('click', () => { document.body.classList.toggle('mobile-menu-open'); });
    const passwordToggle = $('#passwordToggle');
    const passwordInput = $('#loginPassword');
    if (passwordToggle && passwordInput) {
      passwordToggle.addEventListener('click', () => {
        const show = passwordInput.type === 'password';
        passwordInput.type = show ? 'text' : 'password';
        passwordToggle.setAttribute('aria-pressed', String(show));
        passwordToggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
        passwordToggle.setAttribute('title', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
        passwordToggle.textContent = show ? '🙈' : '👁';
      });
    }
  }

  function login(username, password) {
    const u=String(username||'').trim(); const p=String(password||'');
    if(u===state.data.admin.username && p===state.data.admin.password){ state.currentUser={role:'admin'}; return true; }
    const t=state.data.teachers.find(x=>x.username===u && x.password===p);
    if(t){ if(!t.active){setLoginMessage('Tài khoản giáo viên đang bị khóa.','error'); return false;} state.currentUser={role:'teacher',teacherId:t.id}; return true; }
    return false;
  }

  function logout(){
    state.currentUser=null;
    state.currentPage='dashboard';
    $('#appShell').hidden=true;
    $('#loginScreen').hidden=false;
    $('#loginUsername').value='';
    $('#loginPassword').value='';
    $('#loginPassword').type='password';
    const passwordToggle = $('#passwordToggle');
    if (passwordToggle) {
      passwordToggle.setAttribute('aria-pressed','false');
      passwordToggle.setAttribute('aria-label','Hiện mật khẩu');
      passwordToggle.setAttribute('title','Hiện mật khẩu');
      passwordToggle.textContent='👁';
    }
    setLoginMessage('');
    $('#loginUsername').focus();
    document.body.classList.remove('mobile-menu-open');
  }

  async function init(){
    try{
      state.data=normalizeData(await loadData());
      state.data.students.forEach(s => { s.score = clampScore(s.score); });
      $('#loginSiteName').textContent=state.data.settings.siteName;
      setupEventDelegation();
      $('#appErrorReload').addEventListener('click',()=>window.location.reload());
      $('#loginForm').addEventListener('submit',e=>{ e.preventDefault(); const ok=login($('#loginUsername').value,$('#loginPassword').value); if(!ok && state.currentUser===null) {setLoginMessage('Sai tài khoản hoặc mật khẩu.'); return;} setLoginMessage(''); renderAppShell(); });
      $('#loginUsername').focus();
      window.addEventListener('error', ev => { console.error(ev.error||ev.message); showAppError('Có lỗi JavaScript xảy ra. Dữ liệu hiện tại vẫn được lưu tạm trên thiết bị.'); });
      window.addEventListener('unhandledrejection', ev => { console.error(ev.reason); showAppError('Có lỗi không mong muốn. Bạn có thể tải lại trang để tiếp tục.'); });
    }catch(err){ console.error(err); showAppError('Không thể khởi tạo ứng dụng. Hãy tải lại trang.'); }
  }

  function showAppError(msg){ const root=$('#appError'); if(root){ $('#appErrorText').textContent=msg; root.hidden=false; } }

  window.HanhKiemApp = {
    state,
    normalizeData,
    clampScore,
    parseDelimited,
    rowsToStudents,
    parseXlsxMinimal,
    buildXlsxWorkbook,
    exportExcel,
    saveData,
    navigate,
    isAdmin,
    currentTeacher,
    accessibleStudents,
    uid,
    clampScore,
    showToast,
    celebrate,
    confirmAction,
    getStorage
  };

  document.addEventListener('DOMContentLoaded', init);
})();
