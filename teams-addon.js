(function () {
  'use strict';
  const app = window.HanhKiemApp;
  if (!app) return;
  const $ = (s, root=document) => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const data = () => app.state.data;
  const uiState = () => app.state;
  const visibleStudents = () => app.isAdmin() ? data().students : app.accessibleStudents();
  const classes = () => [...new Set([...(data().classes || []), ...visibleStudents().map(s=>s.className), ...(!app.isAdmin() ? (app.currentTeacher()?.classes || []) : [])].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi'));
  const studentsFor = cls => visibleStudents().filter(s => !cls || s.className === cls);
  const teamsFor = cls => data().teams.filter(t => (!cls || t.className === cls) && (app.isAdmin() || classes().includes(t.className)));
  const teamMembers = t => data().students.filter(s => (t.studentIds || []).includes(s.id));
  // Thi đua tổ được tính độc lập theo từng tuần. Mỗi tổ bắt đầu tuần với 100 điểm.
  const WEEK_BASE_SCORE = 100;
  const teamEntries = (t, week) => data().history.filter(h => {
    if (h.teamId !== t.id) return false;
    if (!['team-action','team-violation','team-participation'].includes(h.type)) return false;
    const w = Number(h.weekNumber || 0);
    return w === Number(week);
  });
  const teamDelta = (h) => h.type === 'team-violation' ? -Math.abs(Number(h.points)||0) : Number(h.points)||0;
  const teamPenalty = (t, week=uiState().teamWeek||1) => teamEntries(t, week).reduce((n,h)=>n+Math.max(0,-teamDelta(h)),0);
  const teamBonus = (t, week=uiState().teamWeek||1) => teamEntries(t, week).reduce((n,h)=>n+Math.max(0,teamDelta(h)),0);
  const teamScore = (t, week=uiState().teamWeek||1) => Math.max(0, WEEK_BASE_SCORE + teamEntries(t, week).reduce((n,h)=>n+teamDelta(h),0));
  const weekOptions = (selected) => Array.from({length:35}, (_,i)=>i+1).map(w=>`<option value="${w}" ${Number(selected)===w?'selected':''}>Tuần ${w}</option>`).join('');
  const fmt = ts => new Date(ts).toLocaleString('vi-VN');
  const persist = async () => { await app.saveData(); };
  const show = (msg, type='success') => app.showToast(msg, type);
  const saveClass = name => {
    name = String(name||'').trim();
    if (!name) return show('Nhập tên lớp trước khi lưu.','error');
    if (classes().some(c=>c.toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi'))) return show('Tên lớp đã tồn tại.','error');
    data().classes.push(name); persist(); render(); show('Đã thêm lớp '+name+'.');
  };
  function render() {
    const root = $('#page-teams');
    if (!root || !data()) return;
    const cls = $('#teamClassFilter')?.value || 'all';
    const activeClass = cls === 'all' ? '' : cls;
    const selectedWeek = Math.min(35, Math.max(1, Number(uiState().teamWeek)||1));
    const teams = teamsFor(activeClass).slice().sort((a,b) => {
      // Sắp xếp theo thứ tự tên tổ (Tổ 1, Tổ 2, Tổ 10), không theo điểm.
      const byName = a.name.localeCompare(b.name, 'vi', {numeric:true, sensitivity:'base'});
      return byName || a.className.localeCompare(b.className, 'vi', {numeric:true, sensitivity:'base'});
    });
    const allClasses = classes();
    const teamOrder = new Map(teams.map((t, i) => [t.id, i]));
    const students = studentsFor(activeClass).slice().sort((a,b) => {
      const teamA = data().teams.find(t => t.className === a.className && (t.studentIds || []).includes(a.id));
      const teamB = data().teams.find(t => t.className === b.className && (t.studentIds || []).includes(b.id));
      const classOrder = a.className.localeCompare(b.className, 'vi', {numeric:true, sensitivity:'base'});
      if (classOrder) return classOrder;
      const orderA = teamA ? teamOrder.get(teamA.id) ?? 9999 : 9999;
      const orderB = teamB ? teamOrder.get(teamB.id) ?? 9999 : 9999;
      return orderA - orderB || (!teamA ? 1 : 0) - (!teamB ? 1 : 0) || a.name.localeCompare(b.name, 'vi', {numeric:true, sensitivity:'base'});
    });
    const week = selectedWeek;
    const visibleIds = new Set(visibleStudents().map(s=>s.id));
    const weekRows = data().history.filter(h => ['team-action','team-violation','team-participation'].includes(h.type) && Number(h.weekNumber||0)===selectedWeek && (app.isAdmin() || classes().includes(h.className))).sort((a,b)=>b.time-a.time);
    const admin = app.isAdmin();
    root.innerHTML = `
      <div class="toolbar" style="margin-bottom:16px;align-items:flex-end">
        <div class="toolbar-left" style="display:flex;gap:14px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:8px">Lớp
            <select id="teamClassFilter"><option value="all">Tất cả lớp</option>${allClasses.map(c=>`<option ${cls===c?'selected':''} value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
          </label>
          <label style="display:flex;align-items:center;gap:8px">Tuần
            <select id="teamWeekNumber">${weekOptions(Number(uiState().teamWeek)||1)}</select>
          </label>
        </div>
        <div class="toolbar-right"><button class="btn btn-secondary" data-action="teams-refresh">↻ Làm mới</button></div>
      </div>
      ${admin ? `<div class="grid grid-2" style="margin-bottom:16px">
        <div class="card"><div class="card-header"><div><h3 class="card-title">Tạo tổ</h3><div class="card-subtitle">Chọn lớp và tạo tổ mới</div></div></div><div class="card-body">
          <form id="teamCreateForm" class="stack-form" style="margin-top:0">
            <label>Tên tổ<input name="name" required maxlength="50" placeholder="Ví dụ: Tổ 1"></label>
            <label>Lớp<select name="className" required>${allClasses.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>
            <label>Cách tính điểm<select name="mode"><option value="sum">Tổng điểm thành viên</option><option value="average">Điểm trung bình thành viên</option><option value="manual">Điểm tổ riêng (nhập thủ công)</option></select></label>
            <label>Điểm tổ riêng<input name="manualScore" type="number" min="0" max="10000" step="0.1" value="0"></label>
            <button class="btn btn-primary" type="submit">+ Tạo tổ</button>
          </form>
          ${allClasses.length?'':'<div class="notice warning" style="margin-top:12px">Bạn chưa có lớp. Thêm lớp ở mục Quản lý lớp bên dưới.</div>'}
        </div></div>
        <div class="card"><div class="card-header"><div><h3 class="card-title">Quản lý lớp</h3><div class="card-subtitle">Tạo danh sách lớp để gán học sinh và tổ</div></div></div><div class="card-body">
          <form id="classCreateForm" class="toolbar" style="margin-top:0"><input name="name" required maxlength="40" placeholder="Tên lớp, ví dụ 10A1"><button class="btn btn-primary" type="submit">Thêm lớp</button></form>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">${allClasses.map(c=>`<span class="pill pill-blue">${esc(c)}</span>`).join(' ')||'<span class="muted">Chưa có lớp</span>'}</div>
        </div></div>
      </div>` : ''}
      <div class="school-kpis" style="margin-bottom:16px">
        <div class="school-kpi kpi-blue"><div><span>Điểm TB các tổ</span><strong>${teams.length ? (teams.reduce((n,t)=>n+teamScore(t,selectedWeek),0)/teams.length).toFixed(2) : '0.00'}</strong><small>Tuần ${selectedWeek}</small></div><div class="kpi-symbol">📊</div></div>
        <div class="school-kpi kpi-green"><div><span>Tổ hạng nhất</span><strong>${teams.length ? esc(teams[0].name) : '—'}</strong><small>${teams.length ? teamScore(teams[0],selectedWeek).toFixed(2)+' điểm' : 'Chưa có dữ liệu'}</small></div><div class="kpi-symbol">🏆</div></div>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><div><h3 class="card-title">Xếp hạng tổ</h3><div class="card-subtitle">Có đủ ba cách tính điểm</div></div></div><div class="table-wrap">
        ${teams.length?`<table><thead><tr><th>Hạng</th><th>Tổ</th><th>Lớp</th><th>Số thành viên</th><th>Cách tính</th><th>Điểm tuần</th><th>Điểm cộng</th><th>Điểm trừ</th>${admin?'<th>Sửa</th><th>Xóa</th>':''}</tr></thead><tbody>${teams.map((t,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(t.name)}</td><td>${esc(t.className)}</td><td>${teamMembers(t).length}</td><td>${t.mode==='manual'?'Điểm tổ riêng':t.mode==='average'?'Điểm trung bình':'Tổng điểm thành viên'}</td><td><strong>${Number(teamScore(t, selectedWeek).toFixed(2))}</strong> / 100</td><td class="text-success">+${Number(teamBonus(t, selectedWeek).toFixed(2))}</td><td class="text-danger">−${Number(teamPenalty(t, selectedWeek).toFixed(2))}</td>${admin?`<td><button class="btn btn-secondary btn-sm" data-action="team-edit" data-id="${esc(t.id)}">Sửa</button></td><td><button class="btn btn-danger btn-sm" data-action="team-delete" data-id="${esc(t.id)}">Xóa</button></td>`:''}</tr>`).join('')}</tbody></table>`:'<div class="empty"><strong>Chưa có tổ</strong>Admin hãy tạo tổ ở phần phía trên.</div>'}
      </div></div>
      <div class="grid grid-2" style="margin-bottom:16px">
        <div class="card team-assignment-card" style="grid-column:1 / -1;width:100%;min-width:0"><div class="card-header"><div><h3 class="card-title">Phân học sinh vào tổ</h3><div class="card-subtitle">Nhập số lần phát biểu, sau đó bấm <strong>Cập nhật phát biểu</strong> để lưu.</div></div><button class="btn btn-primary" type="button" data-action="team-save-speech">💾 Cập nhật phát biểu</button></div><div class="table-wrap team-assignment-table-wrap" style="width:100%;max-width:100%;overflow-x:auto">
          ${students.length?`<table style="width:100%;min-width:900px;table-layout:auto"><thead><tr><th>Học sinh</th><th>Lớp</th><th>Tổ</th><th>Phát biểu Tuần ${selectedWeek}</th></tr></thead><tbody>${students.map(s=>{const opts=teamsFor(s.className);const current=data().teams.find(t=>(t.studentIds||[]).includes(s.id)&&t.className===s.className);const speech=data().history.filter(h=>h.type==='team-participation' && h.studentId===s.id && Number(h.weekNumber||0)===selectedWeek).reduce((n,h)=>n+Math.max(0,Number(h.points)||0),0);return `<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.className)}</td><td><select data-action="team-assign" data-student-id="${esc(s.id)}"><option value="">Chưa xếp tổ</option>${opts.map(t=>`<option value="${esc(t.id)}" ${current?.id===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></td><td><input class="team-speech-input" data-action="team-speech" data-student-id="${esc(s.id)}" type="number" min="0" max="100" step="1" value="${speech}" title="1 phát biểu = 1 điểm cho tổ"><span class="muted" style="margin-left:6px">×1 điểm</span></td></tr>`}).join('')}</tbody></table>`:'<div class="empty">Chưa có học sinh.</div>'}
        </div></div>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><div><h3 class="card-title">Trừ điểm nhiều học sinh</h3><div class="card-subtitle">Chọn nhiều em, nhập số điểm cần trừ và ghi chú</div></div></div><div class="card-body">
        <form id="bulkDeductForm" class="stack-form" style="margin-top:0">
          <label>Lớp<select name="className" required>${allClasses.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>
          <div class="grid grid-2"><label>Tuần<select name="weekNumber">${weekOptions(selectedWeek)}</select></label><label>Số điểm trừ mỗi học sinh<input name="points" type="number" min="0.1" max="10" step="0.1" value="1" required></label></div>
          <label>Nội dung vi phạm<input name="ruleName" maxlength="150" placeholder="Ví dụ: Sử dụng điện thoại" required></label>
          <label>Ghi chú<input name="note" maxlength="200" placeholder="Lý do trừ điểm"></label>
          <div id="bulkStudents" class="stack-form" style="max-height:240px;overflow:auto">${students.map(s=>`<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="studentIds" value="${esc(s.id)}"><span>${esc(s.name)} <span class="muted">(${esc(s.className)})</span></span></label>`).join('')||'<span class="muted">Chưa có học sinh.</span>'}</div>
          <button class="btn btn-danger" type="submit">Trừ điểm các em đã chọn</button>
        </form>
      </div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><div><h3 class="card-title">Ghi nhận thi đua trong tuần</h3><div class="card-subtitle">Mỗi tổ bắt đầu tuần với 100 điểm. Chọn “Trừ điểm tổ” hoặc “Cộng điểm tổ”, nhập số điểm và hệ thống tự xếp hạng.</div></div><span class="school-round-badge">Tuần ${selectedWeek}</span></div><div class="card-body">
        <form id="teamActionForm" class="stack-form" style="margin-top:0">
          <div class="grid grid-2">
            <label>Tuần<select name="weekNumber">${weekOptions(selectedWeek)}</select></label>
            <label>Lớp<select name="className" required>${allClasses.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>
          </div>
          <label>Tổ<select name="teamId" required>${teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name)} — ${esc(t.className)}</option>`).join('')}</select></label>
          <label>Thành viên được ghi nhận<select name="studentId" id="teamEntryStudent"><option value="">Không chọn cá nhân</option></select></label>
          <label>Nội dung<input name="ruleName" maxlength="150" required placeholder="Ví dụ: Sử dụng điện thoại"></label>
          <div class="grid grid-2"><label>Loại ghi nhận<select name="deltaType"><option value="minus" selected>➖ Trừ điểm tổ</option><option value="plus">➕ Cộng điểm tổ</option></select></label><label>Số điểm <input name="points" type="number" min="0.1" max="100" step="0.1" value="50" required></label></div>
          <label>Ghi chú (không bắt buộc)<input name="note" maxlength="200" placeholder="Thông tin thêm"></label>
          <div class="notice info">Ví dụ: <strong>Nhân</strong> + <strong>Sử dụng điện thoại</strong> + <strong>Trừ 50 điểm</strong> → điểm Tổ 1 tự động giảm 50 điểm và bảng xếp hạng tự sắp xếp lại.</div>
          <button class="btn btn-primary" type="submit" ${teams.length?'':'disabled'}>Lưu ghi nhận</button>
        </form>
        ${teams.length?'':'<div class="notice warning" style="margin-top:12px">Hãy tạo tổ trước khi ghi nhận thi đua.</div>'}
      </div></div>
      <div class="card"><div class="card-header"><div><h3 class="card-title">Bảng ghi nhận Tuần ${selectedWeek}</h3><div class="card-subtitle">Mỗi dòng làm thay đổi điểm tổ ngay lập tức. Xóa dòng sẽ tự động trả lại điểm.</div></div></div><div class="card-body" style="padding-bottom:0"><div class="toolbar" style="margin:0"><div><strong>Thao tác</strong><div class="muted" style="margin-top:4px">Sửa và Xóa được tách thành hai nút riêng.</div></div><div class="toolbar-right"><button class="btn btn-danger" data-action="team-delete-week">Xóa dữ liệu tuần ${selectedWeek}</button>${admin?'<button class="btn btn-danger" data-action="team-delete-all-history">Xóa toàn bộ dữ liệu</button>':''}</div></div></div><div class="table-wrap">
        ${weekRows.length?`<table><thead><tr><th>STT</th><th>Tổ</th><th>Học sinh</th><th>Nội dung</th><th>Điểm</th><th>Sửa</th><th>Xóa</th></tr></thead><tbody>${weekRows.map((h,i)=>{const delta=teamDelta(h);return `<tr><td>${i+1}</td><td>${esc(h.teamName || data().teams.find(t=>t.id===h.teamId)?.name || 'Tổ')}</td><td>${esc(h.studentName||'—')}</td><td>${esc(h.ruleName||h.note||'—')}</td><td class="${delta>=0?'text-success':'text-danger'}"><strong>${delta>=0?'+':''}${delta}</strong>${h.type==='team-participation'?'<div class="muted">Phát biểu</div>':''}</td><td><button class="btn btn-secondary btn-sm" data-action="team-entry-edit" data-id="${esc(h.id)}">Sửa</button></td><td><button class="btn btn-danger btn-sm" data-action="team-entry-delete" data-id="${esc(h.id)}">Xóa</button></td></tr>`}).join('')}</tbody></table>`:'<div class="empty"><strong>Chưa có ghi nhận trong Tuần ${selectedWeek}</strong>Nhập vi phạm hoặc phát biểu ở biểu mẫu phía trên.</div>'}
      </div></div>
      ${admin?`<div class="card" style="margin-top:16px"><div class="card-header"><div><h3 class="card-title">Cấu hình điểm và nhật ký</h3><div class="card-subtitle">Điểm cá nhân vẫn nằm trong giới hạn 0–10</div></div></div><div class="card-body">
        <form id="scoreSettingsForm" class="toolbar"><label>Điểm tối thiểu <input name="minScore" type="number" min="0" max="9" step="0.5" value="${esc(data().settings.minScore??0)}"></label><label>Điểm tối đa <input name="maxScore" type="number" min="1" max="10" step="0.5" value="${esc(data().settings.maxScore??10)}"></label><label style="display:flex;gap:8px;align-items:center"><input name="logActivity" type="checkbox" ${data().settings.logActivity!==false?'checked':''}> Lưu nhật ký hoạt động</label><button class="btn btn-primary" type="submit">Lưu cấu hình</button></form>
      </div></div>`:''}`;
    const filter=$('#teamClassFilter');
    if(filter) filter.addEventListener('change',()=>render());
    const weekNumber=$('#teamWeekNumber');
    if(weekNumber) weekNumber.addEventListener('change',e=>{ uiState().teamWeek=Math.min(35,Math.max(1,Number(e.target.value)||1)); render(); });
    const teamSelect = root.querySelector('#teamActionForm select[name="teamId"]');
    const memberSelect = root.querySelector('#teamEntryStudent');
    const fillMembers = () => {
      if(!teamSelect || !memberSelect) return;
      const t = data().teams.find(x=>x.id===teamSelect.value);
      const members = t ? teamMembers(t).filter(s=>visibleIds.has(s.id)) : [];
      memberSelect.innerHTML = '<option value="">Không chọn cá nhân</option>' + members.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    };
    if(teamSelect) { teamSelect.addEventListener('change', fillMembers); fillMembers(); }

    const bulkClass=root.querySelector('#bulkDeductForm select[name="className"]');
    if(bulkClass) bulkClass.addEventListener('change',()=>{
      const selected=bulkClass.value;
      $('#bulkStudents').innerHTML=studentsFor(selected).map(s=>`<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="studentIds" value="${esc(s.id)}"><span>${esc(s.name)} <span class="muted">(${esc(s.className)})</span></span></label>`).join('')||'<span class="muted">Chưa có học sinh.</span>';
    });
    $('#teamCreateForm')?.addEventListener('submit',async e=>{
      e.preventDefault(); if(!admin)return;
      const fd=new FormData(e.currentTarget),name=String(fd.get('name')||'').trim(),className=String(fd.get('className')||''),mode=String(fd.get('mode')||'sum');
      if(!name||!className)return show('Vui lòng nhập tên tổ và lớp.','error');
      if(data().teams.some(t=>t.className===className&&t.name.toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi')))return show('Tên tổ này đã tồn tại trong lớp.','error');
      data().teams.push({id:app.uid('team'),name,className,mode:['sum','average','manual'].includes(mode)?mode:'sum',manualScore:Math.max(0,Number(fd.get('manualScore')||0)),studentIds:[], weeklyBaseScore:WEEK_BASE_SCORE});
      await persist(); render(); show('Đã tạo tổ.');
    });
    $('#classCreateForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!admin)return;const fd=new FormData(e.currentTarget);const name=String(fd.get('name')||'').trim();if(!name)return;if(classes().some(c=>c.toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi')))return show('Tên lớp đã tồn tại.','error');data().classes.push(name);await persist();render();show('Đã thêm lớp.');});
    $('#bulkDeductForm')?.addEventListener('submit',async e=>{
      e.preventDefault(); const fd=new FormData(e.currentTarget); const ids=fd.getAll('studentIds').map(String);const points=Number(fd.get('points'));const note=String(fd.get('note')||'').trim();const ruleName=String(fd.get('ruleName')||'').trim();const weekNumber=Math.min(35,Math.max(1,Number(fd.get('weekNumber'))||selectedWeek));
      if(!ids.length)return show('Hãy chọn ít nhất một học sinh.','error');
      if(!ruleName)return show('Nhập nội dung vi phạm.','error');
      if(!Number.isFinite(points)||points<=0||points>10)return show('Số điểm trừ phải lớn hơn 0 và không quá 10.','error');
      if(!window.confirm(`Bạn chắc chắn muốn trừ ${points} điểm cho ${ids.length} học sinh?`))return;
      const teacher=app.isAdmin()?{id:'admin',name:'Admin'}:app.currentTeacher();
      const now=Date.now();
      ids.forEach(id=>{const student=data().students.find(s=>s.id===id);if(!student)return;const old=Number(student.score)||0;const next=Math.max(Number(data().settings.minScore||0),Math.round((old-points)*100)/100);student.score=next;if(data().settings.logActivity!==false)data().history.push({id:app.uid('his'),studentId:student.id,studentName:student.name,className:student.className,teacherId:teacher?.id||'admin',teacherName:teacher?.name||'Admin',type:'violation',ruleName,points,oldScore:old,newScore:next,note,weekNumber,time:now});});
      await persist();render();show(`Đã cập nhật điểm cho ${ids.length} học sinh.`);
    });
    $('#teamActionForm')?.addEventListener('submit',async e=>{
      e.preventDefault(); const fd=new FormData(e.currentTarget); const teamId=String(fd.get('teamId')||''); const t=data().teams.find(x=>x.id===teamId); const rawPoints=Number(fd.get('points')); const deltaType=String(fd.get('deltaType')||'minus'); const points=deltaType==='minus' ? -Math.abs(rawPoints) : Math.abs(rawPoints); const ruleName=String(fd.get('ruleName')||'').trim(); const weekNumber=Math.min(35,Math.max(1,Number(fd.get('weekNumber'))||selectedWeek));
      if(!t)return show('Không tìm thấy tổ đã chọn.','error');
      if(!ruleName)return show('Nhập nội dung ghi nhận.','error');
      if(!Number.isFinite(rawPoints)||rawPoints<=0||rawPoints>100)return show('Số điểm phải lớn hơn 0 và không quá 100.','error');
      const delta=Math.round(points*100)/100; const selectedStudentId=String(fd.get('studentId')||''); const selectedStudent=data().students.find(s=>s.id===selectedStudentId && (t.studentIds||[]).includes(s.id)); const before=teamScore(t,weekNumber); const after=Math.max(0,before+delta);
      if(!window.confirm(`Ghi “${ruleName}” cho ${t.name}: ${delta>0?'+':''}${delta} điểm?\nĐiểm ${before} → ${after}.`))return;
      const teacher=app.isAdmin()?{id:'admin',name:'Admin'}:app.currentTeacher();
      // Bản ghi thi đua tổ là dữ liệu nguồn để tính điểm tuần, vì vậy luôn phải lưu
      // kể cả khi tùy chọn nhật ký hoạt động của học sinh đang tắt.
      data().history.push({id:app.uid('his'),type:'team-action',teamId:t.id,teamName:t.name,studentId:selectedStudent?.id||'',studentName:selectedStudent?.name||'',className:t.className,teacherId:teacher?.id||'admin',teacherName:teacher?.name||'Admin',ruleName,points:delta,note:String(fd.get('note')||'').trim(),weekNumber,time:Date.now()});
      await persist(); uiState().teamWeek=weekNumber; render(); show(delta < 0 ? `Đã trừ ${Math.abs(delta)} điểm của ${t.name}.` : `Đã cộng ${delta} điểm cho ${t.name}.`); if (delta > 0 && app.celebrate) app.celebrate('team');
    });
    $('#scoreSettingsForm')?.addEventListener('submit',async e=>{
      e.preventDefault();if(!admin)return;const fd=new FormData(e.currentTarget);const min=Number(fd.get('minScore')),max=Number(fd.get('maxScore'));
      if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max>10||min>=max)return show('Điểm tối thiểu phải nhỏ hơn điểm tối đa (trong khoảng 0–10).','error');
      data().settings.minScore=min;data().settings.maxScore=max;data().settings.logActivity=fd.has('logActivity');
      data().students.forEach(s=>s.score=app.clampScore(s.score));
      await persist();render();show('Đã lưu cấu hình điểm và nhật ký.');
    });
  }
  function handleAction(el) {
    const action=el.dataset.action,id=el.dataset.id;
    if(action==='teams-refresh'){render();return true;}
    if(action==='team-delete'){
      if(!app.isAdmin())return true;
      const t=data().teams.find(x=>x.id===id);if(!t)return true;
      if(!window.confirm(`Xóa tổ "${t.name}"? Học sinh sẽ không bị xóa.`))return true;
      data().teams=data().teams.filter(x=>x.id!==id);data().students.forEach(s=>{if(s.teamId===id)s.teamId='';});
      // Also remove this team from membership lists.
      data().teams.forEach(x=>x.studentIds=(x.studentIds||[]).filter(sid=>sid!==undefined));
      persist().then(()=>{render();show('Đã xóa tổ.');});return true;
    }
    if(action==='team-edit'){
      if(!app.isAdmin())return true;
      const t=data().teams.find(x=>x.id===id);if(!t)return true;
      const name=window.prompt('Tên tổ:',t.name);if(name===null)return true;
      const scoreMode=window.prompt('Nhập cách tính: sum = tổng, average = trung bình, manual = điểm tổ riêng',t.mode||'sum');
      if(scoreMode===null)return true;
      const mode=['sum','average','manual'].includes(scoreMode.trim())?scoreMode.trim():'sum';
      let manual=t.manualScore;
      if(mode==='manual'){const v=window.prompt('Điểm tổ riêng:',String(manual||0));if(v===null)return true;manual=Math.max(0,Number(v)||0);}
      t.name=name.trim()||t.name;t.mode=mode;t.manualScore=manual;
      persist().then(()=>{render();show('Đã cập nhật tổ.');});return true;
    }
    if(action==='team-delete-all-history'){
      if(!app.isAdmin())return true;
      if(!data().history.length)return (show('Lịch sử đang trống.'),true);
      if(!window.confirm('Xóa toàn bộ lịch sử hoạt động? Điểm hiện tại của học sinh sẽ không đổi.'))return true;
      data().history=[];persist().then(()=>{render();show('Đã xóa toàn bộ lịch sử.');});return true;
    }
    if(action==='team-entry-delete'){
      const h=data().history.find(x=>x.id===id && ['team-action','team-violation','team-participation'].includes(x.type));
      if(!h)return true;
      if(!app.isAdmin() && !classes().includes(h.className))return true;
      if(!window.confirm(`Xóa ghi nhận “${h.ruleName||''}” (${teamDelta(h)>=0?'+':''}${teamDelta(h)})? Điểm tổ sẽ tự động được tính lại.`))return true;
      data().history=data().history.filter(x=>x.id!==id);
      persist().then(()=>{render();show('Đã xóa ghi nhận. Điểm tổ đã được tính lại.');});return true;
    }
    if(action==='team-entry-edit'){
      const h=data().history.find(x=>x.id===id && ['team-action','team-violation','team-participation'].includes(x.type));
      if(!h)return true;
      if(h.type==='team-participation'){
        const raw=window.prompt('Số lần phát biểu (1 lần = 1 điểm):',String(h.points||0));
        if(raw===null)return true;
        const count=Math.min(100,Math.max(0,Math.round(Number(raw)||0)));
        if(count===0)data().history=data().history.filter(x=>x.id!==h.id); else h.points=count;
        persist().then(()=>{render();show('Đã cập nhật điểm phát biểu.');});
        return true;
      }
      const team=data().teams.find(t=>t.id===h.teamId);
      const studentName=window.prompt('Học sinh / người được ghi nhận:',h.studentName||''); if(studentName===null)return true;
      const ruleName=window.prompt('Nội dung:',h.ruleName||''); if(ruleName===null)return true;
      const pointsRaw=window.prompt('Điểm cộng / trừ (ví dụ -50 hoặc +20):',String(teamDelta(h))); if(pointsRaw===null)return true;
      const points=Number(pointsRaw); if(!Number.isFinite(points)||points===0||Math.abs(points)>100)return show('Điểm phải khác 0 và nằm trong khoảng -100 đến 100.','error');
      const weekRaw=window.prompt('Tuần (1-35):',String(h.weekNumber||uiState().teamWeek||1)); if(weekRaw===null)return true;
      const weekNumber=Math.min(35,Math.max(1,Number(weekRaw)||1));
      h.studentName=String(studentName).trim();h.ruleName=String(ruleName).trim();h.points=Math.round(points*100)/100;h.weekNumber=weekNumber;h.time=Date.now();
      persist().then(()=>{uiState().teamWeek=weekNumber;render();show('Đã sửa ghi nhận và tính lại xếp hạng.');});return true;
    }
    if(action==='team-save-speech'){
      const inputs=[...document.querySelectorAll('.team-speech-input[data-action="team-speech"]')];
      if(!inputs.length)return (show('Không có dữ liệu phát biểu để cập nhật.','warning'),true);
      const week=Number(uiState().teamWeek)||1;
      const teacher=app.isAdmin()?{id:'admin',name:'Admin'}:app.currentTeacher();
      let saved=0;
      inputs.forEach(el=>{
        const studentId=el.dataset.studentId;
        const student=data().students.find(s=>s.id===studentId);
        if(!student)return;
        const team=teamForStudent(student);
        if(!team)return;
        const count=Math.min(100,Math.max(0,Math.round(Number(el.value)||0)));
        data().history=data().history.filter(h=>!(h.type==='team-participation' && h.studentId===studentId && Number(h.weekNumber||0)===week));
        if(count>0){
          data().history.push({id:app.uid('his'),type:'team-participation',teamId:team.id,teamName:team.name,studentId:student.id,studentName:student.name,className:student.className,teacherId:teacher?.id||'admin',teacherName:teacher?.name||'Admin',ruleName:'Phát biểu',points:count,note:`${count} lần phát biểu × 1 điểm`,weekNumber:week,time:Date.now()});
        }
        saved++;
      });
      persist().then(()=>{render();show(`Đã cập nhật và lưu phát biểu Tuần ${week} cho ${saved} học sinh.`);});
      return true;
    }
    if(action==='team-delete-week'){
      const selectedWeek=Number(uiState().teamWeek)||1;
      const matches = h => ['team-action','team-violation','team-participation'].includes(h.type) && Number(h.weekNumber||0)===selectedWeek && (app.isAdmin() || classes().includes(h.className));
      const count=data().history.filter(matches).length;
      if(!count)return (show('Tuần này không có dữ liệu thi đua.'),true);
      if(!window.confirm(`Xóa ${count} ghi nhận của Tuần ${selectedWeek}? Điểm các tổ sẽ trở về mức tính từ dữ liệu còn lại.`))return true;
      data().history=data().history.filter(h=>!matches(h));
      persist().then(()=>{render();show(`Đã xóa dữ liệu Tuần ${selectedWeek}.`);});return true;
    }
    return false;
  }
  document.addEventListener('change',e=>{
    const el=e.target;
    if(el.matches('[data-action="team-assign"]')){
      if(!app.isAdmin()){show('Chỉ Admin mới được phân tổ.','error');render();return;}
      const studentId=el.dataset.studentId,teamId=el.value,student=data().students.find(s=>s.id===studentId);
      data().teams.forEach(t=>t.studentIds=(t.studentIds||[]).filter(id=>id!==studentId));
      if(teamId){const t=data().teams.find(x=>x.id===teamId);if(t&&student&&t.className===student.className)t.studentIds=[...(t.studentIds||[]),studentId];}
      persist().then(()=>{render();show('Đã cập nhật phân tổ.');});
    }
    if(el.matches('[data-action="team-speech"]')){
      const count=Math.min(100,Math.max(0,Math.round(Number(el.value)||0)));
      el.value=count;
      el.dataset.pending='true';
    }
  });
  const teamForStudent = student => data().teams.find(t => t.className === student?.className && (t.studentIds || []).includes(student.id)) || null;
  const dashboardSummary = cls => {
    const visible = teamsFor(cls && cls !== 'all' ? cls : '');
    const week = Number(uiState().dashboardWeek)||Number(uiState().teamWeek)||1;
    const ranked = visible.slice().sort((a,b)=>teamScore(b,week)-teamScore(a,week));
    const avg = ranked.length ? ranked.reduce((sum,t)=>sum+teamScore(t,week),0)/ranked.length : 0;
    return { top: ranked[0] || null, topScore: ranked.length ? teamScore(ranked[0],week) : 0, average: avg, week: `Tuần ${week}`, count: ranked.length };
  };
  window.HanhKiemTeams={render,handleAction,teamScore,teamForStudent,dashboardSummary,getTeamsForClass:(cls)=>teamsFor(cls&&cls!=='all'?cls:'')};
})();
