document.addEventListener('DOMContentLoaded', () => {
    let state = {
        currentDate: new Date(),
        doctors: JSON.parse(localStorage.getItem('doctors')) || [],
        shifts: JSON.parse(localStorage.getItem('shifts')) || {},
        holidays: {}
    };

    let pendingNgDates = [];

    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    let editingDateStr = null;
    let editingDateObj = null;

    const els = {
        currentMonthDisplay: document.getElementById('current-month-display'),
        prevMonthBtn: document.getElementById('prev-month'),
        nextMonthBtn: document.getElementById('next-month'),
        todayBtn: document.getElementById('today-btn'),
        autoAssignBtn: document.getElementById('auto-assign-btn'),
        exportExcelBtn: document.getElementById('export-excel-btn'),
        calendarGrid: document.getElementById('calendar-grid'),
        
        doctorList: document.getElementById('doctor-list'),
        addDoctorForm: document.getElementById('add-doctor-form'),
        newDocName: document.getElementById('new-doctor-name'),
        newDocSenior: document.getElementById('new-doctor-senior'),
        newDocWeekendEr: document.getElementById('new-doctor-weekend-er'),
        newDocOutpt: document.getElementById('new-doctor-outpatient'),
        
        ngDateVal: document.getElementById('ng-date-val'),
        ngWeightVal: document.getElementById('ng-weight-val'),
        addNgBtn: document.getElementById('add-ng-btn'),
        pendingNgList: document.getElementById('pending-ng-list'),

        csvUpload: document.getElementById('csv-upload'),
        clearAllBtn: document.getElementById('clear-all-data-btn'),
        
        modal: document.getElementById('assignment-modal'),
        modalOverlay: document.getElementById('modal-overlay'),
        closeModalBtn: document.getElementById('close-modal'),
        cancelAssignmentBtn: document.getElementById('cancel-assignment'),
        saveAssignmentBtn: document.getElementById('save-assignment'),
        modalDateDisplay: document.getElementById('modal-date-display'),
        modalWarnings: document.getElementById('modal-warnings'),
        
        selects: {
            ward: document.getElementById('select-ward'),
            er: document.getElementById('select-er'),
            wardDay: document.getElementById('select-ward-day'),
            wardNight: document.getElementById('select-ward-night'),
            erDay: document.getElementById('select-er-day'),
            erNight: document.getElementById('select-er-night'),
        },
        fgs: {
            ward: document.getElementById('fg-ward'),
            er: document.getElementById('fg-er'),
            wardDay: document.getElementById('fg-ward-day'),
            wardNight: document.getElementById('fg-ward-night'),
            erDay: document.getElementById('fg-er-day'),
            erNight: document.getElementById('fg-er-night'),
        }
    };

    async function init() {
        await fetchHolidays();
        els.newDocSenior.addEventListener('change', () => {
            if(!els.newDocSenior.checked) els.newDocWeekendEr.checked = false;
        });
        renderDoctors();
        renderCalendar();
    }

    async function fetchHolidays() {
        try {
            const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
            if (res.ok) state.holidays = await res.json();
        } catch (e) { console.warn("API Error", e); }
    }

    function saveData() {
        localStorage.setItem('doctors', JSON.stringify(state.doctors));
        localStorage.setItem('shifts', JSON.stringify(state.shifts));
    }

    function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2); }

    function formatDateStr(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function isHoliday(dateObj, dateStr) {
        return dateObj.getDay() === 0 || state.holidays[dateStr];
    }

    const roleLabels = { ward: '🏥病棟', er: '🚑救急', wardDay: '🏥病棟(日)', wardNight: '🏥病棟(夜)', erDay: '🚑救急(日)', erNight: '🚑救急(夜)' };

    function getRequiredRoles(dateObj, dateStr) {
        return isHoliday(dateObj, dateStr) ? ['wardDay', 'wardNight', 'erDay', 'erNight'] : ['ward', 'er'];
    }

    // === Rules ===
    function checkAssignmentRule(doctorId, role, dateObj) {
        if (!doctorId) return { valid: true, error: null, warning: null };
        const doctor = state.doctors.find(d => d.id === doctorId);
        if (!doctor) return { valid: false, error: "医師が見つかりません", warning: null };

        const dateStr = formatDateStr(dateObj);
        let errs = [];
        let warns = [];

        // 1. Role Constraints
        // [修正] 8年目以上(シニア)は病棟専任。8年目以下(ジュニア)は救急専任。
        if (doctor.isSenior) {
            // シニアは救急不可（特例: canDoWeekendER かつ 日祝の erDay/erNight のみ許可）
            if (['er', 'erDay', 'erNight'].includes(role)) {
                const isWeekendErAllowed = doctor.canDoWeekendER
                    && ['erDay', 'erNight'].includes(role)
                    && isHoliday(dateObj, dateStr);
                if (!isWeekendErAllowed) {
                    errs.push("8年目以上は病棟専任です（救急不可）");
                }
            }
        } else {
            // [修正] ジュニアは病棟に絶対割り当て不可
            if (['ward', 'wardDay', 'wardNight'].includes(role)) {
                errs.push("8年目以下は救急専任です（病棟不可）");
            }
        }

        // 2. Outpatient Constraints（翌日外来チェック）
        if (doctor.outpatientDays && doctor.outpatientDays.length > 0) {
            const nextDay = new Date(dateObj);
            nextDay.setDate(nextDay.getDate() + 1);
            if (doctor.outpatientDays.includes(dayNames[nextDay.getDay()])) {
                errs.push("翌日が外来です");
            }
        }

        // 3. NG Dates Constraints（不可日チェック: 3段階）
        const ng1 = doctor.ngDates1 || [];
        const ng2 = doctor.ngDates2 || [];
        const ng3 = doctor.ngDates3 || [];
        // 後方互換: 旧フォーマット(hardNgDates/softNgDates)もサポート
        const hardNg = doctor.hardNgDates || [];
        const softNg = doctor.softNgDates || [];

        if (hardNg.includes(dateStr) || ng1.includes(dateStr)) errs.push("不可日(第1希望)です");
        else if (ng2.includes(dateStr)) warns.push("不可日(第2希望)です");
        else if (ng3.includes(dateStr) || softNg.includes(dateStr)) warns.push("不可日(第3希望)です");

        // 4. 連続当直チェック（完全禁止: エラー）
        const prevDay = new Date(dateObj); prevDay.setDate(prevDay.getDate() - 1);
        const nextDay2 = new Date(dateObj); nextDay2.setDate(nextDay2.getDate() + 1);
        const prevStr = formatDateStr(prevDay);
        const nextStr2 = formatDateStr(nextDay2);

        const prevShifts = state.shifts[prevStr] || {};
        const nextShifts2 = state.shifts[nextStr2] || {};

        const assignedPrev = Object.values(prevShifts).includes(doctorId);
        const assignedNext = Object.values(nextShifts2).includes(doctorId);

        if (assignedPrev) errs.push("前日も当直です（連続当直禁止）");
        if (assignedNext) errs.push("翌日も当直です（連続当直禁止）");

        // 5. 同一週2回禁止（月曜始まりの週）
        const weekStart = new Date(dateObj);
        const dow = weekStart.getDay(); // 0=日
        // 日曜始まりで週を定義（日〜土）
        weekStart.setDate(weekStart.getDate() - dow);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        let weekCount = 0;
        for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
            const ds = formatDateStr(d);
            if (ds === dateStr) continue; // 自分自身はカウントしない
            const dayShifts = state.shifts[ds] || {};
            if (Object.values(dayShifts).includes(doctorId)) weekCount++;
        }
        if (weekCount >= 1) errs.push("同一週にすでに当直があります（週2回禁止）");

        return {
            valid: errs.length === 0,
            error: errs.length ? errs.join(" / ") : null,
            warning: warns.length ? warns.join(" / ") : null
        };
    }

    function getDoctorShiftStats(doctorId) {
        let count = 0;
        const currentYear = state.currentDate.getFullYear();
        const currentMonth = state.currentDate.getMonth();
        for (const [dateStr, dayShifts] of Object.entries(state.shifts)) {
            const sd = new Date(dateStr);
            if (sd.getFullYear() === currentYear && sd.getMonth() === currentMonth) {
                Object.values(dayShifts).forEach(id => {
                    if (id === doctorId) count++;
                });
            }
        }
        return count;
    }

    // === UI Handlers ===
    
    function renderPendingNgs() {
        els.pendingNgList.innerHTML = '';
        pendingNgDates.forEach((ng, i) => {
            const li = document.createElement('li');
            li.className = `pending-ng-item ${ng.type}`;
            const labelMap = { hard: '第1希望不可', soft: '第2希望不可', soft3: '第3希望不可' };
            li.innerHTML = `<span>${ng.date} (${labelMap[ng.type] || ng.type})</span> <span class="remove-ng" data-idx="${i}">x</span>`;
            els.pendingNgList.appendChild(li);
        });
        document.querySelectorAll('.remove-ng').forEach(btn => {
            btn.addEventListener('click', e => {
                pendingNgDates.splice(e.currentTarget.dataset.idx, 1);
                renderPendingNgs();
            });
        });
    }

    els.addNgBtn.addEventListener('click', () => {
        const d = els.ngDateVal.value;
        if(d) {
            pendingNgDates.push({ date: d, type: els.ngWeightVal.value });
            els.ngDateVal.value = '';
            renderPendingNgs();
        }
    });

    els.addDoctorForm.addEventListener('submit', e => {
        e.preventDefault();
        const name = els.newDocName.value.trim();
        const isSenior = els.newDocSenior.checked;
        const weekendEr = els.newDocWeekendEr.checked;
        
        let outpatients = [];
        dayNames.forEach(d => { if (els.newDocOutpt.value.includes(d)) outpatients.push(d); });

        const ng1 = pendingNgDates.filter(n => n.type==='hard').map(n=>n.date);
        const ng2 = pendingNgDates.filter(n => n.type==='soft').map(n=>n.date);
        const ng3 = pendingNgDates.filter(n => n.type==='soft3').map(n=>n.date);

        if (name) {
            state.doctors.push({
                id: generateId(), name, isSenior, canDoWeekendER: weekendEr,
                outpatientDays: outpatients,
                ngDates1: ng1, ngDates2: ng2, ngDates3: ng3,
                // 後方互換用
                hardNgDates: ng1, softNgDates: ng2
            });
            els.newDocName.value = ''; els.newDocSenior.checked = false;
            els.newDocWeekendEr.checked = false; els.newDocOutpt.value = '';
            pendingNgDates = []; renderPendingNgs(); saveData(); renderDoctors(); renderCalendar();
        }
    });

    // === CSV Import ===
    els.csvUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            // BOM除去・改行正規化
            const text = evt.target.result.replace(/^\uFEFF/, '');
            const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
            let count = 0;
            lines.forEach((line, index) => {
                if (index === 0 && line.includes('名前')) return; // ヘッダースキップ
                const parts = line.split(',');
                if (parts.length < 1) return;

                const name = parts[0].replace(/"/g, '').trim();
                if (!name) return;

                const c1 = (parts[1] || '').replace(/"/g,'').trim().toLowerCase();
                const isSen = (c1 === '1' || c1 === '○' || c1 === 'true');

                const c2 = (parts[2] || '').replace(/"/g,'').trim().toLowerCase();
                const weekEr = (c2 === '1' || c2 === '○' || c2 === 'true');

                let opts = [];
                if (parts[3]) {
                    dayNames.forEach(d => { if (parts[3].replace(/"/g,'').includes(d)) opts.push(d); });
                }

                // [新機能] 不可日1〜3をCSVから読み込む (列4, 5, 6)
                const parseDate = (val) => {
                    if (!val) return null;
                    const d = val.replace(/"/g,'').trim();
                    return d.match(/^\d{4}-\d{2}-\d{2}$/) ? d : null;
                };

                const ng1 = parseDate(parts[4]) ? [parseDate(parts[4])] : [];
                const ng2 = parseDate(parts[5]) ? [parseDate(parts[5])] : [];
                const ng3 = parseDate(parts[6]) ? [parseDate(parts[6])] : [];

                state.doctors.push({
                    id: generateId(), name, isSenior: isSen, canDoWeekendER: weekEr,
                    outpatientDays: opts,
                    ngDates1: ng1, ngDates2: ng2, ngDates3: ng3,
                    hardNgDates: ng1, softNgDates: ng2
                });
                count++;
            });
            if (count > 0) {
                alert(`${count}名インポートしました`);
                saveData(); renderDoctors(); renderCalendar();
            }
            els.csvUpload.value = '';
        };
        reader.readAsText(file, 'UTF-8');
    });

    els.clearAllBtn.addEventListener('click', () => {
        if(confirm('データ消去しますか？')) {
            state.doctors = []; state.shifts = {};
            saveData(); renderDoctors(); renderCalendar();
        }
    });

    function removeDoctor(id) {
        if (confirm('削除しますか？')) {
            state.doctors = state.doctors.filter(d => d.id !== id);
            for (const date in state.shifts) {
                for (const role in state.shifts[date]) {
                    if (state.shifts[date][role] === id) delete state.shifts[date][role];
                }
            }
            saveData(); renderDoctors(); renderCalendar();
        }
    }

    function renderDoctors() {
        els.doctorList.innerHTML = '';
        Object.values(els.selects).forEach(sc => sc.innerHTML = '<option value="">-- 未割り当て --</option>');
        
        if(state.doctors.length === 0){
            els.doctorList.innerHTML = '<li class="doctor-item" style="color:#aaa;">なし</li>'; return;
        }

        state.doctors.forEach(doc => {
            const count = getDoctorShiftStats(doc.id);
            const li = document.createElement('li');
            li.className = 'doctor-item';
            
            const badges = [];
            if(doc.isSenior) badges.push(`<span class="badge-senior">シニア</span>`);
            if(doc.canDoWeekendER) badges.push(`<span class="badge-erok">休救可</span>`);
            const opStr = doc.outpatientDays?.length ? doc.outpatientDays.join('・') : 'なし';

            // NG日の件数表示
            const ngCount = (doc.ngDates1||[]).length + (doc.ngDates2||[]).length + (doc.ngDates3||[]).length
                          + (doc.hardNgDates||[]).length + (doc.softNgDates||[]).length;
            const ngStr = ngCount > 0 ? ` / NG:${ngCount}日` : '';

            li.innerHTML = `
                <div class="doctor-info">
                    <span class="doctor-name">${doc.name} ${badges.join('')}</span>
                    <span class="doctor-meta">外来: ${opStr}${ngStr}</span>
                    <span class="doctor-count">今月:${count}回</span>
                </div>
                <button class="remove-doctor-btn" data-id="${doc.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            `;
            els.doctorList.appendChild(li);

            Object.values(els.selects).forEach(sc => {
                const opt = document.createElement('option');
                opt.value = doc.id;
                opt.textContent = `${doc.name} (${count}回)`;
                sc.appendChild(opt);
            });
        });
        document.querySelectorAll('.remove-doctor-btn').forEach(b =>
            b.addEventListener('click', e => removeDoctor(e.currentTarget.dataset.id))
        );
    }

    function renderCalendar() {
        const y = state.currentDate.getFullYear(), m = state.currentDate.getMonth();
        els.currentMonthDisplay.textContent = `${y}年 ${m + 1}月`;
        els.calendarGrid.innerHTML = '';

        const fd = new Date(y, m, 1), ld = new Date(y, m + 1, 0);
        const td = new Date(); const isCurr = td.getFullYear() === y && td.getMonth() === m;

        for (let i = 0; i < fd.getDay(); i++) {
            const e = document.createElement('div'); e.className = 'calendar-day empty';
            els.calendarGrid.appendChild(e);
        }

        for (let d = 1; d <= ld.getDate(); d++) {
            const dObj = new Date(y, m, d); const dStr = formatDateStr(dObj);
            const isHol = isHoliday(dObj, dStr);
            const dayDiv = document.createElement('div'); dayDiv.className = 'calendar-day';
            
            if (isHol) dayDiv.classList.add('hol');
            else if (dObj.getDay() === 0) dayDiv.classList.add('sun');
            else if (dObj.getDay() === 6) dayDiv.classList.add('sat');
            if (isCurr && d === td.getDate()) dayDiv.classList.add('today');

            dayDiv.innerHTML = `<div class="day-number">${isCurr && d === td.getDate() ? `<span>${d}</span>` : d} <span class="hol-name">${state.holidays[dStr]||''}</span></div>`;
            
            const cont = document.createElement('div'); cont.className = 'shift-slots';
            const roles = getRequiredRoles(dObj, dStr);
            const daySh = state.shifts[dStr] || {};

            roles.forEach(role => {
                const id = daySh[role];
                const badge = document.createElement('div'); badge.className = `shift-badge ${role}`;
                if (id) {
                    const doc = state.doctors.find(dx => dx.id === id);
                    if(doc) {
                        const rule = checkAssignmentRule(id, role, dObj);
                        badge.textContent = `${roleLabels[role]}: ${doc.name}`;
                        if(!rule.valid) { badge.classList.add('warning'); badge.title = rule.error; }
                        else if(rule.warning) { badge.classList.add('soft-warning'); badge.title = rule.warning; }
                    }
                } else {
                    badge.classList.add('empty'); badge.textContent = `${roleLabels[role]}: 未割当`;
                }
                cont.appendChild(badge);
            });
            dayDiv.appendChild(cont);
            dayDiv.addEventListener('click', () => openModal(dObj, dStr));
            els.calendarGrid.appendChild(dayDiv);
        }
        renderDoctors();
    }

    els.prevMonthBtn.addEventListener('click', () => { state.currentDate.setMonth(state.currentDate.getMonth() - 1); renderCalendar(); });
    els.nextMonthBtn.addEventListener('click', () => { state.currentDate.setMonth(state.currentDate.getMonth() + 1); renderCalendar(); });
    els.todayBtn.addEventListener('click', () => { state.currentDate = new Date(); renderCalendar(); });

    // === Auto Assign (改善版: 連続当直禁止・週2回禁止・月上限・NG日・公平性) ===
    els.autoAssignBtn.addEventListener('click', () => {
        if(state.doctors.length === 0) return alert('医師を登録してください。');
        if(!confirm(`未割り当て枠を自動生成します。\n\n適用ルール:\n・連続当直禁止\n・同一週2回禁止\n・NG日(第1希望)は除外\n・当直回数が均等になるよう調整`)) return;

        let made = 0;
        let skipped = 0;
        const y = state.currentDate.getFullYear(), m = state.currentDate.getMonth();
        const ld = new Date(y, m + 1, 0).getDate();

        for (let d = 1; d <= ld; d++) {
            const dObj = new Date(y, m, d); const dStr = formatDateStr(dObj);
            const roles = getRequiredRoles(dObj, dStr);
            if(!state.shifts[dStr]) state.shifts[dStr] = {};

            // 同日内で既に割り当てられた医師ID（重複防止）
            const assignedToday = new Set(Object.values(state.shifts[dStr]).filter(Boolean));

            roles.forEach(role => {
                if(state.shifts[dStr][role]) return; // 既割当はスキップ

                // checkAssignmentRuleで全ルール（連続・週2・月上限・役職・NG）を一括チェック
                let candidates = state.doctors.map(doc => {
                    const r = checkAssignmentRule(doc.id, role, dObj);
                    return { doc, valid: r.valid, warning: r.warning };
                }).filter(c => c.valid && !assignedToday.has(c.doc.id));

                if (candidates.length > 0) {
                    candidates.forEach(c => {
                        let score = 0;

                        // (A) 当月当直回数が多いほどスコア高（公平性）
                        score += getDoctorShiftStats(c.doc.id) * 1000;

                        // (B) NG日（第2・第3希望）ペナルティ（第1希望はcheckで除外済み）
                        const ds = formatDateStr(dObj);
                        const ng2 = c.doc.ngDates2 || c.doc.softNgDates || [];
                        const ng3 = c.doc.ngDates3 || [];
                        if (ng2.includes(ds)) score += 5000;
                        else if (ng3.includes(ds)) score += 2000;

                        // (C) わずかなランダム性（同スコア時の分散）
                        score += Math.random() * 100;

                        c.score = score;
                    });

                    candidates.sort((a, b) => a.score - b.score);
                    const chosen = candidates[0].doc;
                    state.shifts[dStr][role] = chosen.id;
                    assignedToday.add(chosen.id);
                    made++;
                } else {
                    skipped++;
                }
            });
        }
        saveData();
        renderCalendar();
        let msg = `${made}件割り当てました。`;
        if (skipped > 0) msg += `\n⚠️ ${skipped}枠は条件を満たす医師がおらず未割り当てです。\n医師を追加するか、月の上限を見直してください。`;
        alert(msg);
    });

    // === Excel Export (カレンダー形式 + 一覧) ===
    els.exportExcelBtn.addEventListener('click', () => {
        if(typeof XLSX === 'undefined') return alert('現在ライブラリ読み込み中です。少々お待ちを。');

        const y = state.currentDate.getFullYear(), m = state.currentDate.getMonth();
        const ld = new Date(y, m + 1, 0).getDate();
        const wb = XLSX.utils.book_new();
        const n = id => { const dc = state.doctors.find(x => x.id === id); return dc ? dc.name : ''; };

        // =============================================
        // シート1: カレンダー形式
        // =============================================
        // 各セルは3行構成: [日付・祝日名] [🏥病棟: 氏名] [🚑救急: 氏名]
        // 日〜土の7列、週ごとに行を積む。各日は3行使う。

        const CAL_ROWS_PER_DAY = 4; // 日付行 + 病棟 + 救急(平日) or 病棟日/夜 + 救急日/夜(祝) + 空白行
        const COL_DAYS = ['日','月','火','水','木','金','土'];

        // ワークシートデータをオブジェクト形式で直接構築
        const wsCalData = {};
        const merges = [];

        // ヘッダー行 (row 0): タイトル
        const titleCell = `A1`;
        wsCalData[titleCell] = { v: `${y}年${m+1}月 当直表`, t: 's' };
        merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }); // A1:G1をマージ

        // 曜日ヘッダー行 (row 1)
        COL_DAYS.forEach((d, ci) => {
            wsCalData[XLSX.utils.encode_cell({ r: 1, c: ci })] = { v: d, t: 's' };
        });

        // カレンダー本体
        const firstDayOfWeek = new Date(y, m, 1).getDay(); // 月初の曜日(0=日)
        let currentRow = 2; // 0-indexed、row2から開始

        // 週ごとにブロックを作る
        // 全日を週配列に分割
        const weeks = [[]];
        // 月初前の空白
        for (let i = 0; i < firstDayOfWeek; i++) weeks[0].push(null);
        for (let d = 1; d <= ld; d++) {
            const lastWeek = weeks[weeks.length - 1];
            if (lastWeek.length === 7) weeks.push([]);
            weeks[weeks.length - 1].push(d);
        }
        // 最終週の空白補完
        while (weeks[weeks.length - 1].length < 7) weeks[weeks.length - 1].push(null);

        weeks.forEach(week => {
            // 各週ブロック: 日付行(1行) + コンテンツ行(複数行) + 区切り行
            const contentRows = CAL_ROWS_PER_DAY - 1; // 日付除いたコンテンツ行数

            week.forEach((day, ci) => {
                if (day === null) return;
                const dObj = new Date(y, m, day);
                const dStr = formatDateStr(dObj);
                const isHol = isHoliday(dObj, dStr);
                const holName = state.holidays[dStr] || (dObj.getDay() === 0 ? '日曜' : '');
                const s = state.shifts[dStr] || {};

                // 行0: 日付 + 祝日名
                const dateLabel = holName ? `${day}  ${holName}` : String(day);
                wsCalData[XLSX.utils.encode_cell({ r: currentRow, c: ci })] = { v: dateLabel, t: 's' };

                if (isHol) {
                    // 祝日・日曜: 病棟日/夜, 救急日/夜
                    wsCalData[XLSX.utils.encode_cell({ r: currentRow + 1, c: ci })] = {
                        v: `🏥日 ${n(s.wardDay) || '未割当'}`, t: 's'
                    };
                    wsCalData[XLSX.utils.encode_cell({ r: currentRow + 2, c: ci })] = {
                        v: `🏥夜 ${n(s.wardNight) || '未割当'}`, t: 's'
                    };
                    wsCalData[XLSX.utils.encode_cell({ r: currentRow + 3, c: ci })] = {
                        v: `🚑日 ${n(s.erDay) || '未割当'}`, t: 's'
                    };
                    wsCalData[XLSX.utils.encode_cell({ r: currentRow + 4, c: ci })] = {
                        v: `🚑夜 ${n(s.erNight) || '未割当'}`, t: 's'
                    };
                } else {
                    // 平日・土曜: 病棟, 救急
                    wsCalData[XLSX.utils.encode_cell({ r: currentRow + 1, c: ci })] = {
                        v: `🏥 ${n(s.ward) || '未割当'}`, t: 's'
                    };
                    wsCalData[XLSX.utils.encode_cell({ r: currentRow + 2, c: ci })] = {
                        v: `🚑 ${n(s.er) || '未割当'}`, t: 's'
                    };
                }
            });

            // 祝日がある週はコンテンツ行が5行必要なので合わせる
            const hasHolidayInWeek = week.some(day => {
                if (!day) return false;
                const dObj = new Date(y, m, day);
                return isHoliday(dObj, formatDateStr(dObj));
            });
            currentRow += hasHolidayInWeek ? 6 : 4; // 日付+コンテンツ+空白
        });

        // シートの範囲を設定
        wsCalData['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: currentRow + 1, c: 6 } });
        wsCalData['!merges'] = merges;

        // 列幅設定
        wsCalData['!cols'] = Array(7).fill({ wch: 18 });

        // 行高設定 (カレンダー本体の各行)
        const rowHeights = [];
        rowHeights[0] = { hpt: 24 }; // タイトル
        rowHeights[1] = { hpt: 18 }; // 曜日
        for (let r = 2; r < currentRow + 2; r++) rowHeights[r] = { hpt: 16 };
        wsCalData['!rows'] = rowHeights;

        XLSX.utils.book_append_sheet(wb, wsCalData, `${m+1}月カレンダー`);

        // =============================================
        // シート2: 従来の一覧表
        // =============================================
        const listData = [['日付', '曜日', '祝祭日', '病棟(平日)/病棟日中(日祝)', '病棟夜間(日祝)', '救急(平日)/救急日中(日祝)', '救急夜間(日祝)']];
        for (let d = 1; d <= ld; d++) {
            const dObj = new Date(y, m, d); const dStr = formatDateStr(dObj);
            const isHol = isHoliday(dObj, dStr);
            const dw = dayNames[dObj.getDay()];
            const s = state.shifts[dStr] || {};
            if (isHol) {
                listData.push([dStr, dw, state.holidays[dStr]||'日曜', n(s.wardDay), n(s.wardNight), n(s.erDay), n(s.erNight)]);
            } else {
                listData.push([dStr, dw, '', n(s.ward), '', n(s.er), '']);
            }
        }
        const wsList = XLSX.utils.aoa_to_sheet(listData);
        wsList['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, wsList, '一覧表');

        XLSX.writeFile(wb, `当直表_${y}年${m+1}月.xlsx`);
    });

    // === Modal ===
    function updateModalState() {
        let errs=[], warns=[];
        Object.values(els.selects).forEach(sel => {
            if(!sel.parentElement.parentElement.classList.contains('hidden')) {
                const role = sel.getAttribute('data-role');
                const id = sel.value;
                sel.classList.remove('has-warning', 'has-soft-warning');
                if(id) {
                    const chk = checkAssignmentRule(id, role, editingDateObj);
                    if(!chk.valid) { sel.classList.add('has-warning'); errs.push(`${roleLabels[role]}: ${chk.error}`); }
                    else if(chk.warning) { sel.classList.add('has-soft-warning'); warns.push(`${roleLabels[role]}: ${chk.warning}`); }
                }
            }
        });
        
        if(errs.length || warns.length){
            els.modalWarnings.innerHTML =
                (errs.length ? `<div class="modal-error">❌ ${errs.join('<br>')}</div>` : '') + 
                (warns.length ? `<div class="modal-warnings">⚠️ ${warns.join('<br>')}</div>` : '');
            els.modalWarnings.classList.remove('hidden');
        } else {
            els.modalWarnings.classList.add('hidden');
        }
    }

    function openModal(dObj, dStr) {
        editingDateStr = dStr; editingDateObj = dObj;
        els.modalDateDisplay.textContent = `${dObj.getFullYear()}/${dObj.getMonth()+1}/${dObj.getDate()} (${dayNames[dObj.getDay()]})`;
        const roles = getRequiredRoles(dObj, dStr);
        const dS = state.shifts[dStr] || {};
        
        ['ward','er','wardDay','wardNight','erDay','erNight'].forEach(r => {
            if(roles.includes(r)){
                els.fgs[r].classList.remove('hidden');
                els.selects[r].value = dS[r] || '';
            } else {
                els.fgs[r].classList.add('hidden');
            }
        });
        updateModalState();
        els.modal.classList.remove('hidden');
    }

    function closeModal() { els.modal.classList.add('hidden'); }

    function saveAssignment() {
        if(!state.shifts[editingDateStr]) state.shifts[editingDateStr] = {};
        getRequiredRoles(editingDateObj, editingDateStr).forEach(r => {
            if(els.selects[r].value) state.shifts[editingDateStr][r] = els.selects[r].value;
            else delete state.shifts[editingDateStr][r];
        });
        if(Object.keys(state.shifts[editingDateStr]).length === 0) delete state.shifts[editingDateStr];
        saveData(); closeModal(); renderCalendar();
    }

    Object.values(els.selects).forEach(sc => sc.addEventListener('change', updateModalState));
    els.closeModalBtn.addEventListener('click', closeModal);
    els.cancelAssignmentBtn.addEventListener('click', closeModal);
    els.saveAssignmentBtn.addEventListener('click', saveAssignment);
    els.modalOverlay.addEventListener('click', closeModal);
    
    init();
});
