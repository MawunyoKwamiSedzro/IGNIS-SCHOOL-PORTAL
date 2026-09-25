let session = null;

try {
    session = JSON.parse(sessionStorage.getItem('ignis-session') || 'null');
} catch {
    // Remove a malformed saved session and return safely to sign-in.
    sessionStorage.removeItem('ignis-session');
}

if (!session) {
    location.replace('index.html');
} else {
    const page = document.body.dataset.page || 'dashboard';

    const isAdmin = ['Headteacher', 'Manager'].includes(session.role);
    const isTeacher = session.role === 'Teacher';
    const isParent = ['Parent / Student', 'Parent', 'Student'].includes(session.role);

    const nav = [
        ['dashboard', 'Dashboard'],
        ['attendance', 'Attendance'],
        ['students', 'Students'],
        ['classes', 'Classes'],
        ['assignments', 'Assignments'],
        ['scores', 'Academics'],
        ['timetable', 'Timetable'],
        ['fees', 'Fees & billing'],
        ['payment-settings', 'Payment settings'],
        ['staff-attendance', 'Staff attendance'],
        ['announcements', 'Notices'],
        ['accounts', 'People & access'],
        ['settings', 'School settings'],
        ['user-accounts', 'Create user account']
    ];

    const permitted = key => {
        if (isParent) {
            return [
                'dashboard',
                'fees',
                'scores',
                'assignments',
                'timetable',
                'announcements'
            ].includes(key);
        }

        return (
            !(['accounts', 'user-accounts', 'fees', 'payment-settings', 'settings'].includes(key) && !isAdmin) &&
            !(key === 'students' && isParent)
        );
    };

    if (!permitted(page)) {
        location.replace('dashboard.html');
    }

    const storage = {
        get: (key, fallback) => {
            try {
                const value = localStorage.getItem(key);
                return value ? JSON.parse(value) : fallback;
            } catch {
                // A damaged browser cache should never prevent the portal from loading.
                localStorage.removeItem(key);
                return fallback;
            }
        },

        set: (key, value) =>
            localStorage.setItem(key, JSON.stringify(value))
    };

    let students = storage.get(
        'ignis-students',
        []
    );

    /* -----------------------------------------------------
       Classes
       ----------------------------------------------------- */

    let classesData = storage.get(
        'ignis-classes',
        []
    );

    let classRegister = storage.get('ignis-class-register', {});

    /* -----------------------------------------------------
       Assignments
       ----------------------------------------------------- */

    let assignments = storage.get(
        'ignis-assignments',
        []
    );

    // Submission records use student IDs so the Headteacher can review exactly who still needs follow-up.
    let assignmentSubmissions = storage.get('ignis-assignment-submissions', {});

    const assignmentRoster = assignment => students.filter(student => student[2] === assignment.class);
    const submittedIdsFor = assignment => assignmentSubmissions[assignment.id] || [];

    /* -----------------------------------------------------
       Academic scores
       ----------------------------------------------------- */

    let scores = storage.get(
        'ignis-scores',
        {}
    );

    /* -----------------------------------------------------
       Fees ledger
       ----------------------------------------------------- */

    let fees = storage.get(
        'ignis-fees',
        {}
    );

    let payments = storage.get('ignis-payments', []);
    let paymentSettings = storage.get('ignis-payment-settings', {
        accountName: '',
        mtnNumber: '',
        telecelNumber: ''
    });

    /* -----------------------------------------------------
       Notices / announcements
       ----------------------------------------------------- */

    let notices = storage.get(
        'ignis-notices',
        []
    );

    /* -----------------------------------------------------
       Weekly timetable (shared template, by class)
       ----------------------------------------------------- */

    let timetableData = storage.get('ignis-timetable', []);

    /* -----------------------------------------------------
       Supabase-backed user directory
       ----------------------------------------------------- */

    let userAccounts = JSON.parse(sessionStorage.getItem('ignis-user-directory') || '[]').map(account => ({
        ...account,
        name: account.full_name,
        wardId: account.linked_student_id
    }));
    const accountDirectory = () => userAccounts;

    /* -----------------------------------------------------
       Geofenced attendance — approved zones + check-ins
       ----------------------------------------------------- */

    let geofences = storage.get(
        'ignis-geofences',
        []
    );

    let checkins = storage.get('ignis-checkins', []);
    let staffAttendance = storage.get('ignis-staff-attendance', {});
    let attendancePolicy = storage.get('ignis-attendance-policy', { arrivalBy: '' });
    let currentTerm = storage.get('ignis-current-term', 'Not configured');
    let academicTerms = storage.get('ignis-academic-terms', []);

    const localDateKey = date => {
        const value = date || new Date();
        const offset = value.getTimezoneOffset() * 60000;
        return new Date(value.getTime() - offset).toISOString().slice(0, 10);
    };

    const staffMembers = () => accountDirectory().filter(account => account.role === 'Teacher');

    // Haversine distance in metres between two lat/lng points
    const distanceMetres = (lat1, lng1, lat2, lng2) => {
        const R = 6371000;
        const toRad = deg => (deg * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
                Math.cos(toRad(lat2)) *
                Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const nearestZone = (lat, lng) => {
        let best = null;

        geofences.forEach(zone => {
            const d = distanceMetres(lat, lng, zone.lat, zone.lng);

            if (!best || d < best.distance) {
                best = { zone, distance: d };
            }
        });

        return best;
    };

    const todaysCheckins = () => {
        const today = new Date().toDateString();
        return checkins.filter(c => new Date(c.time).toDateString() === today);
    };

    const myLatestCheckin = () =>
        todaysCheckins()
            .filter(c => c.email === session.email || c.name === session.name)
            .slice(-1)[0];

    const isLateArrival = timestamp => {
        if (!attendancePolicy.arrivalBy) return false; const [hours, minutes] = String(attendancePolicy.arrivalBy).split(':').map(Number);
        const cutoff = new Date(timestamp);
        cutoff.setHours(hours, minutes, 0, 0);
        return new Date(timestamp) > cutoff;
    };

    const button = (label, action) => `
        <button class="primary" onclick="${action}">
            ${label}
        </button>
    `;

    const heading = (title, note, action = '') => `
        <div class="page-head">
            <div>
                <p class="eyebrow">
                    IGNIS School · Nsawam, Ghana
                </p>

                <h1>${title}</h1>
                <p>${note}</p>
            </div>

            ${action}
        </div>
    `;

    const table = (headers, body) => `
        <div class="card">
            <table>
                <thead>
                    <tr>
                        ${headers
                            .map(header => `<th>${header}</th>`)
                            .join('')}
                    </tr>
                </thead>

                <tbody>
                    ${body}
                </tbody>
            </table>
        </div>
    `;

    const studentRows = list =>
        list
            .map(
                student => `
                    <tr>
                        <td>${student[0]}</td>

                        <td>
                            <b>${student[1]}</b>
                        </td>

                        <td>${student[2]}</td>

                        <td>
                            <span class="pill green">
                                Active
                            </span>
                        </td>

                        <td><b>${student[3]}</b><small class="subline">${student[4] || 'Phone not recorded'}${student[5] ? ` · ${student[5]}` : ''}</small></td>

                        <td>
                            <button
                                class="link"
                                onclick="studentProfile('${student[0]}')"
                            >
                                View
                            </button>
                        </td>
                    </tr>
                `
            )
            .join('');

    const formatDate = iso => {
        const d = new Date(iso + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    const assignmentsFor = user => {
        if (!isParent) return assignments;

        const ward = students.find(s => s[0] === user.wardId);
        if (!ward) return [];

        return assignments.filter(a => a.class === ward[2]);
    };

    const staffAttendanceReport = date => {
        const records = staffAttendance[date] || {};
        const members = staffMembers();
        const present = members.filter(member => records[member.email]).length;

        return `
            <div class="staff-report-summary"><span><b>${present}</b> present</span><span><b>${members.length - present}</b> not recorded</span></div>
            <div class="table-wrap"><table><thead><tr><th>Staff member</th><th>Role</th><th>Recorded time</th><th>Status</th></tr></thead><tbody>
                ${members.map(member => {
                    const record = records[member.email];
                    return `<tr><td><b>${member.name}</b><small class="subline">${member.email}</small></td><td>${member.role}</td><td>${record ? new Date(record.recordedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td><td><span class="pill ${record ? (record.status === 'late' ? 'amber' : 'green') : 'red'}">${record ? (record.status === 'late' ? 'Late' : 'Present') : 'Not recorded'}</span></td></tr>`;
                }).join('')}
            </tbody></table></div>
        `;
    };

    const notificationItems = () => {
        const items = [];
        const readNotices = new Set(storage.get(`ignis-read-notices:${session.id}`, []));
        const outstanding = Object.values(fees).filter(ledger => ledger.amount > ledger.paid).length;
        const todaysStaff = staffAttendance[localDateKey()] || {};
        const teachersMissing = staffMembers().filter(member => !todaysStaff[member.email]).length;

        if (isAdmin && outstanding) items.push({ icon: '₵', priority: 'Action needed', rank: 2, title: `${outstanding} fee account${outstanding > 1 ? 's' : ''} outstanding`, note: 'Review balances in Fees & billing.', page: 'fees' });
        if (isAdmin && teachersMissing) items.push({ icon: '◷', priority: 'Review', rank: 1, title: `${teachersMissing} teacher${teachersMissing > 1 ? 's' : ''} not marked present`, note: 'Open the daily staff attendance report.', page: 'staff-attendance' });
        if (isTeacher && !staffAttendance[localDateKey()]?.[session.email]) items.push({ icon: '✓', priority: 'Action needed', rank: 2, title: 'Mark your attendance', note: 'Your daily staff register is still open.', page: 'staff-attendance' });
        if (isParent) {
            const ledger = fees[session.wardId];
            if (ledger && ledger.amount > ledger.paid) items.push({ icon: '₵', priority: 'Payment due', rank: 2, title: 'School-fee payment due', note: `GH₵ ${(ledger.amount - ledger.paid).toFixed(2)} remains for this term.`, page: 'fees' });
        }
        const openAssignments = assignmentsFor(session);
        const overdueAssignments = openAssignments.filter(item => item.due && item.due < localDateKey());
        if (overdueAssignments.length) items.push({ icon: '!', priority: 'Overdue', rank: 3, title: `${overdueAssignments.length} assignment${overdueAssignments.length > 1 ? 's' : ''} overdue`, note: 'Review the assignment list and follow up.', page: 'assignments' });
        else if (openAssignments.length) items.push({ icon: '▤', priority: 'New work', rank: 0, title: 'Assignments are available', note: 'Review coursework and due dates.', page: 'assignments' });

        notices
            .filter(notice => (notice.audience === 'All' || (isParent && notice.audience === 'Parents') || (!isParent && notice.audience === 'Staff')) && !readNotices.has(notice.id))
            .forEach(notice => items.push({
                icon: '✉', priority: 'New announcement', rank: 2,
                title: notice.title, note: `Posted ${formatDate(notice.date)} · Open Notices`,
                page: 'announcements', noticeId: notice.id
            }));

        return items.sort((a, b) => b.rank - a.rank);
    };

    const searchEntries = () => {
        const entries = [
            ...students.map(student => ({
                title: student[1],
                note: `${student[0]} · ${student[2]} · Student`,
                searchText: `${student[0]} ${student[1]} ${student[2]} ${student[3] || ''} ${student[4] || ''} ${student[5] || ''}`,
                action: { type: 'student', id: student[0] }
            })),
            ...classesData.map(item => ({
                title: item.name,
                note: `${item.level} · ${item.teacher}`,
                action: { type: 'page', page: 'classes' }
            })),
            ...assignmentsFor(session).map(item => ({
                title: item.title,
                note: `${item.subject} · ${item.class} · Due ${formatDate(item.due)}`,
                action: { type: 'page', page: 'assignments' }
            })),
            ...notices
                .filter(item => item.audience === 'All' || (isParent ? item.audience === 'Parents' : item.audience === 'Staff'))
                .map(item => ({ title: item.title, note: `Notice · ${formatDate(item.date)}`, searchText: `${item.title} ${item.body || ''}`, action: { type: 'page', page: 'announcements' } }))
        ];
        if (isAdmin) entries.push(...userAccounts.map(account => ({
            title: account.name,
            note: `${account.email} · ${account.role}`,
            action: { type: 'page', page: 'accounts' }
        })));
        return entries;
    };

    const operationalSummary = () => {
        const today = new Date().toDateString();
        const studentMarks = Object.entries(classRegister)
            .filter(([key]) => key.endsWith(`::${today}`))
            .flatMap(([, marks]) => Object.values(marks));
        const todayStaff = staffAttendance[localDateKey()] || {};
        const academicFlags = Object.values(scores)
            .flat()
            .filter(score => score.grade === 'D').length;

        return {
            studentsPresent: studentMarks.filter(mark => ['present', 'late'].includes(typeof mark === 'string' ? mark : mark?.status)).length,
            studentsMarked: studentMarks.filter(mark => Boolean(typeof mark === 'string' ? mark : mark?.status)).length,
            staffPresent: Object.keys(todayStaff).length,
            staffTotal: staffMembers().length,
            academicFlags,
            overdue: assignments.filter(item => item.due < localDateKey()).length
        };
    };

    const views = {

        dashboard: () => {
            if (isParent) {
                const ward = students.find(s => s[0] === session.wardId);
                const ledger = ward ? fees[ward[0]] : null;
                const balance = ledger ? ledger.amount - ledger.paid : 0;
                const wardAssignments = assignmentsFor(session);

                return heading(
                    `Welcome back, ${session.name.split(' ')[0]}`,
                    'Here is how your ward is doing this term.'
                )

                + `
                    <div class="card ward-hero">
                        <div>
                            <h2>${ward ? ward[1] : 'Linked student'}</h2>
                            <p>${ward ? ward[2] : 'No class on record'}</p>
                            <small>
                                ${
                                    ledger
                                        ? (balance <= 0
                                            ? 'Fees fully paid for ' + ledger.term
                                            : `GH₵ ${balance.toFixed(2)} outstanding · ${ledger.term}`)
                                        : 'No billing record on file'
                                }
                            </small>
                        </div>
                        ${button('View academics', "location.href='scores.html'")}
                    </div>

                    <div class="card">
                        <h2>Upcoming assignments</h2>
                        ${
                            wardAssignments.length
                                ? wardAssignments
                                    .map(
                                        a => `
                                            <div class="flag">
                                                <span class="flag-icon">▤</span>
                                                <div>
                                                    <b>${a.title}</b>
                                                    <small>${a.subject} · Due ${formatDate(a.due)}</small>
                                                </div>
                                            </div>
                                        `
                                    )
                                    .join('')
                                : `<div class="empty">No assignments recorded yet.</div>`
                        }
                    </div>
                `;
            }

            if (!isAdmin) {                const assignedClasses = classesData.filter(item => item.teacherId === session.id);                const assignedClassNames = new Set(assignedClasses.map(item => item.name));                const myAssignments = assignments.filter(item => assignedClassNames.has(item.class));                const myAttendance = staffAttendance[localDateKey()]?.[session.email];                const upcoming = myAssignments.filter(item => !item.due || item.due >= localDateKey());                return heading(`Welcome back, ${session.name.split(' ')[0]}`, 'Your teaching overview for today.') + `                    <div class="stats">                        <div class="stat"><div class="stat-top">Your attendance</div><b>${myAttendance ? (myAttendance.status === 'late' ? 'Late' : 'Present') : 'Not recorded'}</b><small>${myAttendance ? `Recorded at ${new Date(myAttendance.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Complete your geofenced check-in.'}</small></div>                        <div class="stat"><div class="stat-top">Your classes</div><b>${assignedClasses.length}</b><small>Classes assigned to you</small></div>                        <div class="stat"><div class="stat-top">Your assignments</div><b>${upcoming.length}</b><small>Open coursework for your classes</small></div>                    </div>                    ${!myAttendance ? `<div class="card"><h2>Record your attendance</h2><p>Check in from an approved school location.</p>${button('Verify location', "location.href='attendance.html'")}</div>` : ''}                    <div class="card"><h2>Your classes</h2>${assignedClasses.length ? assignedClasses.map(item => `<div class="flag"><span class="flag-icon">▦</span><div><b>${item.name}</b><small>${item.level || 'Class'}</small></div></div>`).join('') : '<div class="empty">No classes are assigned to your account yet.</div>'}</div>                    <div class="card"><h2>Upcoming assignments</h2>${upcoming.length ? upcoming.map(item => `<div class="flag"><span class="flag-icon">▤</span><div><b>${item.title}</b><small>${item.subject} · ${item.class}${item.due ? ` · Due ${formatDate(item.due)}` : ''}</small></div></div>`).join('') : '<div class="empty">No open assignments for your classes.</div>'}</div>                `;            }            const summary = operationalSummary();

            return heading(
                `Welcome back, ${session.name.split(' ')[0]}`,
                'Your operational overview for today.',
                isAdmin
                    ? button(
                        'Manage school access',
                        "location.href='accounts.html'"
                    )
                    : ''
            )

            + `
                <div class="stats">

                    <div class="stat">
                        <div class="stat-top">
                            Students present
                        </div>

                        <b>${summary.studentsPresent} / ${students.length}</b>

                        <small class="${summary.studentsMarked ? 'positive' : 'warn'}">
                            ${summary.studentsMarked ? `${summary.studentsMarked} marked in today’s registers` : 'No student register marked yet'}
                        </small>
                    </div>

                    <div class="stat">
                        <div class="stat-top">
                            Staff attendance
                        </div>

                        <b>${summary.staffPresent} / ${summary.staffTotal}</b>

                        <small class="warn">
                            ${Math.max(0, summary.staffTotal - summary.staffPresent)} require follow-up
                        </small>
                    </div>

                    <div class="stat">
                        <div class="stat-top">
                            Open assignments
                        </div>

                        <b>${assignments.length}</b>

                        <small>
                            Across ${classesData.length} classes
                        </small>
                    </div>

                    <div class="stat">
                        <div class="stat-top">
                            Academic flags
                        </div>

                        <b>${summary.academicFlags}</b>

                        <small class="${summary.academicFlags ? 'negative' : 'positive'}">
                            ${summary.academicFlags ? 'Scores needing support' : 'No low-score flags recorded'}
                    </div>

                </div>

                <div class="card">
                    <h2>Requires attention</h2>

                    ${summary.staffTotal - summary.staffPresent > 0 ? `
                        <div class="flag"><span class="flag-icon">!</span><div><b>${summary.staffTotal - summary.staffPresent} staff member${summary.staffTotal - summary.staffPresent > 1 ? 's' : ''} not recorded</b><small>Open Staff attendance to review today’s register.</small></div></div>
                    ` : ''}
                    ${summary.overdue ? `
                        <div class="flag"><span class="flag-icon">!</span><div><b>${summary.overdue} assignment${summary.overdue > 1 ? 's' : ''} overdue</b><small>Review coursework and follow up with classes.</small></div></div>
                    ` : ''}
                    ${!summary.overdue && summary.staffTotal === summary.staffPresent ? '<div class="empty">Everything is up to date for today.</div>' : ''}
                </div>
            `;
        },

        attendance: () => {

            /* ---------- Teacher: geofenced clock-in card ---------- */

            const mine = myLatestCheckin();

            const teacherCard = isTeacher ? `
                <div class="attendance-callout">
                    <div>
                        <p class="eyebrow">Geofenced check-in</p>
                        <h2>${
                            mine
                                ? (mine.verified ? 'You are checked in' : 'Last attempt was blocked')
                                : 'You have not checked in today'
                        }</h2>
                        <p>${
                            mine
                                ? `${new Date(mine.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                   · ${mine.zoneName}, ${Math.round(mine.distance)}m from centre
                                   ${mine.verified ? '(within the ' + mine.radius + 'm boundary)' : '(outside the ' + mine.radius + 'm boundary)'}`
                                : `Your location is checked against the approved school zones when you tap the button. ${attendancePolicy.arrivalBy ? `Arrive by ${attendancePolicy.arrivalBy} to be marked on time.` : 'The school has not set an arrival time yet.'}`
                        }</p>
                    </div>
                    ${mine?.verified ? '<span class="pill green">Verified on-site</span>' : button('Verify &amp; clock in', 'clockIn()')}
                </div>
            ` : '';

            /* ---------- Admin: live geofence register ---------- */

            const todays = todaysCheckins();

            const adminRegister = isAdmin ? `
                <div class="card table-card">
                    <div class="section-title">
                        <h2>Today's verified check-ins</h2>
                        <div class="report-actions">${button('Manage approved zones', 'manageGeofences()')}<button class="secondary" onclick="manageAttendancePolicy()">Arrival policy</button></div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Staff member</th>
                                <th>Time</th>
                                <th>Zone / distance</th>
                                <th>Status</th>
                            </tr>
                        </thead>

                        <tbody>
                            ${
                                todays.length
                                    ? todays
                                        .slice()
                                        .reverse()
                                        .map(c => `
                                            <tr>
                                                <td><b>${c.name}</b></td>
                                                <td>${new Date(c.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                                <td>${c.zoneName}, ${Math.round(c.distance)}m</td>
                                                <td>
                                                    <span class="pill ${c.verified ? 'green' : 'red'}">
                                                        ${c.verified ? 'Verified on-site' : 'Blocked · off-site'}
                                                    </span>
                                                </td>
                                            </tr>
                                        `)
                                        .join('')
                                    : `<tr><td colspan="4"><div class="empty">No successful check-ins recorded yet today.</div></td></tr>`
                            }
                        </tbody>
                    </table>
                </div>

                <div class="card">
                    <h2>Approved zones</h2>
                    ${geofences
                        .map(z => `
                            <div class="flag">
                                <span class="flag-icon">◎</span>
                                <div>
                                    <b>${z.name}</b>
                                    <small>${z.lat.toFixed(5)}, ${z.lng.toFixed(5)} · ${z.radius}m radius</small>
                                </div>
                            </div>
                        `)
                        .join('')}
                </div>
            ` : '';

            return heading(
                'Attendance',
                'Geofence-verified staff clock-ins and daily student registers.',
                ''
            )
            + teacherCard
            + adminRegister;
        },

        students: () =>
            heading(
                'Student records',
                'Enrolment, guardians, attendance, and student profile information.',
                isAdmin ? button('+ Enrol student', 'addStudent()') : ''
            )

            + `
                <div class="card">

                    <div class="search-box">
                        <input
                            id="searchInput"
                            placeholder="Search student name, ID or guardian"
                        >

                        <button
                            class="secondary"
                            onclick="findStudents()"
                        >
                            Search
                        </button>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Student</th>
                                <th>Class</th>
                                <th>Status</th>
                                <th>Guardian</th>
                                <th></th>
                            </tr>
                        </thead>

                        <tbody id="studentRows">
                            ${studentRows(students)}
                        </tbody>
                    </table>

                </div>
            `,

        classes: () =>
            heading(
                'Classes',
                'Class registers, assigned teachers, and enrolment by class.',
                isAdmin ? button('+ Add class', 'addClass()') : ''
            )

            + `
                <div class="dashboard-grid">
                    ${classesData
                        .map(
                            c => `
                                <div class="card class-card">
                                    <div>
                                        <h2>${c.name}</h2>
                                        <p>${c.level} · Teacher: ${c.teacher} · ${
                                            students.filter(s => s[2] === c.name).length
                                        } students</p>
                                    </div>
                                    <div class="class-roster-preview">
                                        ${students.filter(s => s[2] === c.name).length
                                            ? students.filter(s => s[2] === c.name).map(s => `<button class="link roster-link" onclick="studentProfile('${s[0]}')"><b>${s[1]}</b><small>${s[0]} · ${s[3]}</small></button>`).join('')
                                            : '<small class="subline">No students enrolled yet.</small>'}
                                    </div>
                                    ${(isTeacher || isAdmin) ? `<button class="secondary" onclick="openRegister('${c.id}')">${isAdmin ? 'View daily register' : 'Open daily register'}</button>` : ''}${isAdmin ? `<button class="link danger-link" onclick="deleteClass('${c.id}')">Delete class</button>` : ''}
                                </div>
                            `
                        )
                        .join('')}
                </div>
            `,

        assignments: () => {
            const ward = isParent ? students.find(student => student[0] === session.wardId) : null;
            const visibleAssignments = assignmentsFor(session);
            return heading(
                isParent ? `Assignments for ${ward ? ward[1] : 'your ward'}` : 'Assignments',
                isParent ? `${ward ? ward[2] : 'Linked class'} coursework, due dates, and submission status.` : 'Homework and coursework across all classes.',
                (isTeacher || isAdmin) ? button('+ New assignment', 'addAssignment()') : ''
            ) + `
                <div class="card">
                    ${visibleAssignments.map(a => {
                        const roster = assignmentRoster(a);
                        const submittedIds = submittedIdsFor(a);
                        const guardianSubmitted = ward && submittedIds.includes(ward[0]);
                        return `
                            <div class="assignment">
                                <div><b>${a.title}</b><small>${a.class} · ${a.subject} · Due ${formatDate(a.due)}</small></div>
                                <div style="display:flex;align-items:center;gap:14px">
                                    <span class="pill ${isParent ? (guardianSubmitted ? 'green' : 'red') : (submittedIds.length >= roster.length && roster.length ? 'green' : (submittedIds.length ? 'amber' : 'red'))}">
                                        ${isParent ? (guardianSubmitted ? 'Submitted' : 'Not submitted') : `${submittedIds.length} / ${roster.length} submitted`}
                                    </span>
                                    ${isAdmin ? `<button class="link" onclick="viewAssignmentProgress('${a.id}')">View students</button><button class="link danger-link" onclick="removeAssignment('${a.id}')">Delete</button>` : (isTeacher ? `<button class="link" onclick="viewAssignmentProgress('${a.id}')">Record submissions</button><button class="link danger-link" onclick="removeAssignment('${a.id}')">Delete</button>` : '')}
                                </div>
                            </div>`;
                    }).join('') || `<div class="empty">No assignments to show.</div>`}
                </div>`;
        },

        scores: () => {
            const target = isParent
                ? students.find(s => s[0] === session.wardId)
                : null;

            const studentScoreCard = student => {
                const list = scores[student[0]] || [];
                const average = list.length
                    ? Math.round(
                        list.reduce((sum, s) => sum + s.classScore + s.examScore, 0) / list.length
                    )
                    : 0;

                return `
                    <div class="card table-card">
                        <div class="section-title">
                            <h2>${student[1]} <small>${student[2]}</small></h2>
                            ${
                                (isTeacher || isAdmin)
                                    ? button('Record score', `addScore('${student[0]}')`)
                                    : ''
                            }
                        </div>
                        <table>
                            <thead>
                                <tr>
                                    <th>Subject</th>
                                    <th>Class score (30)</th>
                                    <th>Exam score (70)</th>
                                    <th>Total</th>
                                    <th>Grade</th>${(isAdmin || isTeacher) ? '<th></th>' : ''}
                                </tr>
                            </thead>
                            <tbody>
                                ${
                                    list.length
                                        ? list
                                            .map(
                                                s => `
                                                    <tr>
                                                        <td>${s.subject}</td>
                                                        <td>${s.classScore}</td>
                                                        <td>${s.examScore}</td>
                                                        <td><b>${s.classScore + s.examScore}</b></td>
                                                        <td><span class="pill ${
                                                            s.grade === 'A' ? 'green' : (s.grade === 'B' ? 'amber' : 'red')
                                                        }">${s.grade}</span></td>${(isAdmin || isTeacher) ? `<td><button class="link danger-link" onclick="deleteScore('${student[0]}', '${encodeURIComponent(s.subject)}', '${encodeURIComponent(s.term || '')}')">Delete</button></td>` : ''}
                                                    </tr>
                                                `
                                            )
                                            .join('')
                                        : `<tr><td colspan="5"><div class="empty">No scores recorded yet.</div></td></tr>`
                                }
                            </tbody>
                        </table>
                        <p class="subline">Overall average this term: ${average} / 100</p>
                    </div>
                `;
            };

            return heading(
                'Academics',
                isParent
                    ? "Your ward's subject scores for the current term."
                    : 'Subject scores and grade records by student.'
            )

            + (
                isParent
                    ? (target ? studentScoreCard(target) : `<div class="card"><div class="empty">No linked student record found.</div></div>`)
                    : students.map(studentScoreCard).join('')
            );
        },

        timetable: () => {
            const ward = isParent ? students.find(student => student[0] === session.wardId) : null;
            const ownClass = ward && classesData.find(cls => cls.name === ward[2]);
            const availableClasses = isParent ? (ownClass ? [ownClass] : []) : (isTeacher ? classesData.filter(cls => cls.teacherId === session.id) : classesData);
            const selectedId = document.getElementById('timetableClass')?.value || availableClasses[0]?.id || '';
            const periods = [...new Set(timetableData.filter(entry => entry.class_id === selectedId).map(entry => `${entry.start_time.slice(0, 5)}–${entry.end_time.slice(0, 5)}`))].sort();
            const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            return heading('Timetable', `Published class schedule · ${currentTerm}.`, (isAdmin || isTeacher) ? button('Manage timetable', 'manageTimetable()') : '') + `
                <div class="card">
                    <div class="section-title"><h2>Class timetable</h2><select id="timetableClass" onchange="render()">${availableClasses.map(cls => `<option value="${cls.id}" ${cls.id === selectedId ? 'selected' : ''}>${cls.name}</option>`).join('')}</select></div>
                    <div class="table-wrap"><table><thead><tr><th>Period</th>${dayNames.map(day => `<th>${day}</th>`).join('')}</tr></thead><tbody>
                        ${periods.length ? periods.map(period => `<tr><td><b>${period}</b></td>${dayNames.map((_, index) => {
                            const [start] = period.split('–');
                            const entry = timetableData.find(item => item.class_id === selectedId && item.weekday === index + 1 && item.start_time.slice(0, 5) === start);
                            const teacher = entry?.teacher_user_id ? accountDirectory().find(person => person.user_id === entry.teacher_user_id)?.name : '';
                            return `<td>${entry ? `<b>${entry.subject}</b>${teacher ? `<small class="subline">${teacher}</small>` : ''}` : '—'}</td>`;
                        }).join('')}</tr>`).join('') : `<tr><td colspan="6"><div class="empty">No timetable entries have been published for this class.</div></td></tr>`}
                    </tbody></table></div>
                </div>`;
        },

        fees: () => {
            if (isParent) {
                const ward = students.find(s => s[0] === session.wardId);
                const ledger = ward ? fees[ward[0]] : null;
                const balance = ledger ? ledger.amount - ledger.paid : 0;

                const recentPayments = payments
                    .filter(payment => payment.studentId === session.wardId)
                    .slice(-3)
                    .reverse();

                return heading('Fees & billing', 'Your ward\u2019s billing statement for the current term.')
                    + (
                        ward && ledger
                            ? `
                                <div class="card ward-hero">
                                    <div>
                                        <h2>${ward[1]} · ${ward[2]}</h2>
                                        <p>${ledger.term}</p>
                                        <small>Amount billed: GH₵ ${ledger.amount.toFixed(2)} · Paid: GH₵ ${ledger.paid.toFixed(2)}</small>
                                    </div>
                                    <span class="pill ${balance <= 0 ? 'green' : 'red'}">
                                        ${balance <= 0 ? 'Fully paid' : `GH₵ ${balance.toFixed(2)} outstanding`}
                                    </span>
                                </div>
                                ${balance > 0 ? `
                                    <section class="payment-card" aria-labelledby="payment-title">
                                        <div class="payment-card-copy">
                                            <p class="eyebrow">School payment details</p>
                                            <h2 id="payment-title">Pay school fees</h2>
                                            <p>Pay the outstanding GH₵ ${balance.toFixed(2)} using your mobile money app or at the school office. Online payment confirmation is not available in this portal.</p>
                                        </div>
                                        <div class="payment-directory" aria-label="School payment directory">
                                            <span>Receive money at</span>
                                            <b>${paymentSettings.accountName || 'School account name not set'}</b>
                                            <span class="directory-line mtn">MTN MoMo: ${paymentSettings.mtnNumber || 'Not configured'}</span>
                                            <span class="directory-line telecel">Telecel Cash: ${paymentSettings.telecelNumber || 'Not configured'}</span>
                                        </div>
                                        <p class="payment-note">Keep your provider receipt. The balance is updated after the school confirms receipt.</p>
                                    </section>
                                ` : ''}
                                ${recentPayments.length ? `
                                    <div class="card payment-history">
                                        <h2>Recent payments</h2>
                                        ${recentPayments.map(payment => `
                                            <div class="payment-row">
                                                <span class="payment-check">✓</span>
                                                <div><b>GH₵ ${payment.amount.toFixed(2)} via ${payment.method}</b><small>${payment.reference} · ${new Date(payment.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
                                                <span class="pill ${payment.status === 'confirmed' ? 'green' : 'amber'}">${payment.status || 'pending'}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            `
                            : `<div class="card"><div class="empty">No billing record found for your ward.</div></div>`
                    );
            }

            const totalBilled = Object.values(fees).reduce((s, f) => s + f.amount, 0);
            const totalPaid = Object.values(fees).reduce((s, f) => s + f.paid, 0);

            return heading(
                'Fees & billing',
                'Term billing overview and outstanding balances by student.'
            )

            + `
                <div class="stats">
                    <div class="stat">
                        <div class="stat-top">Billed this term</div>
                        <b>GH₵ ${totalBilled.toFixed(2)}</b>
                    </div>
                    <div class="stat">
                        <div class="stat-top">Collected</div>
                        <b>GH₵ ${totalPaid.toFixed(2)}</b>
                        <small class="positive">${Math.round((totalPaid / totalBilled) * 100) || 0}% collected</small>
                    </div>
                    <div class="stat">
                        <div class="stat-top">Outstanding</div>
                        <b>GH₵ ${(totalBilled - totalPaid).toFixed(2)}</b>
                    </div>
                </div>

                <div class="card table-card">
                    <table>
                        <thead>
                            <tr>
                                <th>Student</th>
                                <th>Term</th>
                                <th>Billed</th>
                                <th>Paid</th>
                                <th>Status</th>
                                ${isAdmin ? '<th></th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${students
                                .map(s => {
                                    const ledger = fees[s[0]];
                                    const balance = ledger ? ledger.amount - ledger.paid : 0;
                                    return `
                                        <tr>
                                            <td><b>${s[1]}</b></td>
                                            <td>${ledger ? ledger.term : 'Not billed'}</td>
                                            <td>${ledger ? `GH₵ ${ledger.amount.toFixed(2)}` : '—'}</td>
                                            <td>${ledger ? `GH₵ ${ledger.paid.toFixed(2)}` : '—'}</td>
                                            <td>
                                                <span class="pill ${balance <= 0 ? 'green' : 'red'}">
                                                    ${!ledger ? 'Not billed' : balance <= 0 ? 'Paid' : `GH₵ ${balance.toFixed(2)} due`}
                                                </span>
                                            </td>
                                            ${
                                                isAdmin
                                                    ? `<td><button class="link" onclick="${ledger ? `recordPayment('${s[0]}')` : `setStudentFee('${s[0]}')`}">${ledger ? 'Record payment' : 'Set fee'}</button>${ledger ? `<button class="link danger-link" onclick="deleteStudentFee('${s[0]}')">Delete fee</button>` : ''}</td>`
                                                    : ''
                                            }
                                        </tr>
                                    `;
                                })
                                .join('')}
                        </tbody>
                    </table>
                </div>
            `;
        },

        'payment-settings': () => {
            const configured = [paymentSettings.mtnNumber, paymentSettings.telecelNumber].filter(Boolean).length;

            return heading(
                'Payment settings',
                'Set the official mobile-money receiving numbers parents see when paying fees.'
            ) + `
                <div class="stats">
                    <div class="stat"><div class="stat-top">Active payment lines</div><b>${configured} / 2</b><small class="${configured ? 'positive' : 'negative'}">${configured ? 'Ready for parents' : 'Needs setup'}</small></div>
                    <div class="stat"><div class="stat-top">Account name</div><b>${paymentSettings.accountName || 'Not set'}</b><small>Shown on payment instructions</small></div>
                </div>
                <div class="card settings-card">
                    <div class="section-title"><div><h2>Payment instructions</h2><p class="subline">Only enter payment details verified as belonging to the school. Parents will use these details for external payments.</p></div></div>
                    <form id="paymentSettingsForm" onsubmit="savePaymentSettings(event)">
                        <div class="field"><label for="accountName">Account / school name</label><input id="accountName" name="accountName" value="${paymentSettings.accountName}" required></div>
                        <div class="form-row settings-grid">
                            <div class="field"><label for="mtnNumber">MTN MoMo receive number</label><input id="mtnNumber" name="mtnNumber" inputmode="numeric" placeholder="024 XXX XXXX" value="${paymentSettings.mtnNumber}"><small>Use a valid MTN number: 024, 025, 053, 054, or 055.</small></div>
                            <div class="field"><label for="telecelNumber">Telecel Cash receive number</label><input id="telecelNumber" name="telecelNumber" inputmode="numeric" placeholder="020 XXX XXXX" value="${paymentSettings.telecelNumber}"><small>Use a valid Telecel number: 020 or 050.</small></div>
                        </div>
                        <button class="primary" type="submit">Save payment directory</button>
                    </form>
                </div>
            `;
        },

        'staff-attendance': () => {
            const today = localDateKey();
            const myRecord = staffAttendance[today]?.[session.email];
            const staffCard = isTeacher ? `
                <div class="attendance-callout staff-checkin">
                    <div><p class="eyebrow">Daily staff register</p><h2>${myRecord ? 'Attendance recorded for today' : 'Verify your school location'}</h2><p>${myRecord ? `Recorded at ${new Date(myRecord.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} via an approved school zone.` : 'Staff attendance is recorded only after a successful geofenced check-in.'}</p></div>
                    ${myRecord ? `<span class="pill ${myRecord.status === 'late' ? 'amber' : 'green'}">${myRecord.status === 'late' ? 'Late' : 'Present'}</span>` : button('Verify location', "location.href='attendance.html'")}
                </div>
            ` : '';

            const report = isAdmin ? `
                <div class="card table-card">
                    <div class="section-title"><div><h2>Daily teacher attendance report</h2><p class="subline">Each entry is assigned to the staff member who recorded it.</p></div><div class="report-actions"><div class="report-controls"><label for="staffReportDate">Report date</label><input id="staffReportDate" type="date" value="${today}" onchange="renderStaffReport()"></div><button class="secondary" onclick="exportStaffAttendance()">Export staff CSV</button><button class="secondary" onclick="exportStudentAttendance()">Export student CSV</button></div></div>
                    <div id="staffReportTable">${staffAttendanceReport(today)}</div>
                </div>
            ` : '';

            return heading('Staff attendance', isAdmin ? 'Review daily teacher attendance and individual attendance records.' : 'Record your attendance for the school day.') + staffCard + report;
        },

        announcements: () =>
            heading(
                'Notices',
                'School-wide announcements and updates.',
                (isTeacher || isAdmin) ? button('+ Post notice', 'addNotice()') : ''
            )

            + `
                <div class="card">
                    ${
                        notices
                            .filter(n => n.audience === 'All' || (isParent && n.audience === 'Parents') || (!isParent && n.audience === 'Staff'))
                            .slice()
                            .reverse()
                            .map(
                                n => `
                                    <div class="flag">
                                        <span class="flag-icon">✉</span>
                                        <div>
                                            <b>${n.title}</b>
                                            <small>${n.author} · ${formatDate(n.date)} · ${n.audience}</small>
                                            <p style="margin:6px 0 0">${n.body}</p>
                                        </div>
                                        ${
                                            isAdmin
                                                ? `<button class="link" onclick="removeNotice('${n.id}')">Delete</button>`
                                                : ''
                                        }
                                    </div>
                                `
                            )
                            .join('') || `<div class="empty">No notices yet.</div>`
                    }
                </div>
            `,

        accounts: () =>
            heading(
                'User account settings',
                'Manage existing parent, teacher, and student login accounts.',
                button('Create user account', "location.href='user-accounts.html'")
            )

            + `
                <div class="card table-card">
                    <div class="section-title"><div><h2>Portal login directory</h2><p class="subline">Passwords can be reset by the Headteacher. Account access changes apply at the next sign-in.</p></div></div>
                    <div class="search-box"><input id="accountSearch" placeholder="Search by name, email, role, or student"><button class="secondary" onclick="searchAccounts()">Search</button></div>
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Linked student</th>
                                <th>Account</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="accountRows">
                            ${accountDirectory()
                                .map(a => `
                                        <tr>
                                            <td><b>${a.name}</b></td>
                                            <td>${a.email}</td>
                                            <td>${a.role}</td>
                                            <td>${a.wardId ? (students.find(student => student[0] === a.wardId) || [a.wardId, a.wardId])[1] : '—'}</td>
                                            <td><span class="pill ${a.is_active ? 'green' : 'red'}">${a.is_active ? 'Active' : 'Disabled'}</span></td>
                                            <td>
                                                <button class="link" onclick="editUserAccount('${a.email}')">Edit</button>
                                                <button class="link" onclick="resetUserPassword('${a.email}')">Reset password</button>
                                                <button class="link" onclick="toggleUserStatus('${a.user_id}', ${!a.is_active})">${a.is_active ? 'Disable' : 'Enable'}</button> <button class="link danger-link" onclick="deleteUserAccount('${a.user_id}', '${a.email}')">Delete</button>
                                            </td>
                                        </tr>
                                    `)
                                .join('')}
                        </tbody>
                    </table>
                </div>
                <p class="subline">Accounts are managed in Supabase Auth. Invitations are delivered to each account email.</p>
            `,

        settings: () => heading('School settings', 'Set term dates and choose which term is active. Records remain saved under their original term and dates.') + `
            <div class="card settings-card"><form id="schoolTermForm" onsubmit="saveSchoolTerm(event)">
                <div class="field"><label for="academicTermPicker">Saved terms</label><select id="academicTermPicker" onchange="loadAcademicTerm(this.value)"><option value="">Create a new term</option>${academicTerms.map(term => `<option value="${encodeURIComponent(term.name)}" ${term.name === currentTerm ? 'selected' : ''}>${term.name} (${term.startDate} – ${term.endDate})</option>`).join('')}</select></div>
                <div class="field"><label for="currentTermInput">Term name and academic year</label><input id="currentTermInput" name="term" value="${currentTerm === 'Not configured' ? '' : currentTerm}" placeholder="e.g. Term 1 · 2026/2027" required></div>
                <div class="form-grid"><div class="field"><label for="termStartDate">Start date</label><input id="termStartDate" name="startDate" type="date" required></div><div class="field"><label for="termEndDate">End date</label><input id="termEndDate" name="endDate" type="date" required></div></div>
                <div class="actions"><button class="primary" type="submit">Save and set as current</button>${academicTerms.length ? `<button class="secondary" type="button" onclick="setSelectedTermCurrent()">Set selected term as current</button>` : ''}</div>
            </form><p class="subline">Scores and fee ledgers keep their term labels. Student and staff attendance keep the exact attendance date and recorded time. Attendance arrival time and approved locations are configured from the Staff attendance page.</p></div>
        `,

        'user-accounts': () =>
            heading(
                'Create user account',
                'Create a secure portal login for a teacher, parent, or student.'
            )
            + `<div class="card settings-card">${userAccountForm({}, true, 'createUserAccountFromPage(event)')}</div>`
    };

    const render = () => { document.body.innerHTML = `
        <div class="shell">

            <aside class="sidebar" id="sidebar">

                <div class="brand">
                    <div class="crest">I</div>

                    <div>
                        <strong>IGNIS</strong>
                        <span>School Portal</span>
                    </div>
                </div>

                <div class="role-chip">

                    <span class="status-dot"></span>

                    <div>
                        <small>Signed in as</small>
                        <b>${session.role}</b>
                    </div>

                </div>

                <nav>
                    ${nav
                        .filter(item => permitted(item[0]))
                        .map(
                            item => `
                                <button
                                    class="nav-item ${
                                        page === item[0]
                                            ? 'active'
                                            : ''
                                    }"
                                    onclick="location.href='${item[0]}.html'"
                                >
                                    ${item[1]}
                                </button>
                            `
                        )
                        .join('')}
                </nav>

                <div class="sidebar-bottom">

                    <button
                        class="support"
                        onclick="showHelp()"
                    >
                        ? Help & Support
                    </button>

                    <small>
                        © 2026 IGNIS School
                    </small>

                </div>

            </aside>

            <main>

                <header class="topbar">

                    <div class="topbar-start">
                        <button class="menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false" onclick="toggleNavigation()">☰</button>
                    <div class="crumb">
                        <span>IGNIS School</span>
                        <b>/</b>

                        <strong>
                            ${nav.find(item => item[0] === page)?.[1]}
                        </strong>
                    </div>
                    </div>

                    <div class="top-actions">

                        <button class="top-icon-button search-trigger" type="button" onclick="openQuickSearch()" aria-label="Search school records"><span aria-hidden="true">⌕</span><span class="search-label">Search records</span><kbd>Ctrl K</kbd></button>
                        <button class="top-icon-button" type="button" onclick="openNotifications()" aria-label="Open notifications">
                            <span aria-hidden="true">♢</span>
                            ${notificationItems().length ? `<span class="notification-badge">${notificationItems().length > 9 ? '9+' : notificationItems().length}</span>` : ''}
                        </button>

                        <div class="term">
                            <div>
                                <small>Current term</small>
                                <b>${currentTerm}</b>
                            </div>
                        </div>

                        <button
                            class="profile"
                            onclick="logout()"
                        >
                            <span>${session.initials}</span>

                            <div>
                                <b>${session.name}</b>
                                <small>Sign out</small>
                            </div>
                        </button>

                    </div>

                </header>

                <section class="content">
                    ${views[page]()}
                </section>

            </main>

        </div>

        <div
            class="toast"
            id="toast"
        ></div>

        <div
            class="modal-backdrop"
            id="modal"
        >
            <div class="modal" role="dialog" aria-modal="true" aria-label="Portal dialog">

                <button
                    class="modal-close"
                    onclick="closeModal()"
                >
                    ×
                </button>

                <div id="modalContent"></div>

            </div>
        </div>
    `; if (page === 'settings') { const saved = academicTerms.find(term => term.name === currentTerm); if (saved) { document.getElementById('termStartDate').value = saved.startDate || ''; document.getElementById('termEndDate').value = saved.endDate || ''; } } };

    render();

    window.toast = text => {
        const element = document.getElementById('toast');

        element.textContent = text;
        element.classList.add('show');

        setTimeout(() => {
            element.classList.remove('show');
        }, 2500);
    };

    window.logout = () => {
        sessionStorage.removeItem('ignis-session');
        window.ignisSupabase?.client?.auth.signOut().finally(() => location.replace('index.html'));
    };

    window.closeModal = () => {
        document
            .getElementById('modal')
            .classList.remove('open');
    };

    window.toggleNavigation = () => {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.querySelector('.menu-toggle');
        const isOpen = sidebar.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.textContent = isOpen ? '×' : '☰';
    };

    window.showHelp = () => {
        openModal(`
            <h2 id="modalTitle">Help & support</h2>
            <p>For account assistance, contact the IGNIS school office directly.</p>
            <div class="help-shortcuts">
                <span><kbd>Ctrl</kbd> + <kbd>K</kbd> Search the portal</span>
                <span><kbd>Esc</kbd> Close a window</span>
            </div>
        `);
    };

    const openModal = content => {
        document.getElementById('modalContent').innerHTML = content;
        const modal = document.getElementById('modal');
        modal.classList.add('open');
        const firstFocusable = modal.querySelector('input, select, textarea, button');
        if (firstFocusable) firstFocusable.focus();
    };

    window.openQuickSearch = () => {
        const entries = searchEntries();
        openModal(`
            <h2 id="modalTitle">Search school records</h2>
            <p class="subline">Search records available to your account. Students can be found by name, ID, class, or guardian contact.</p>
            <div class="search-box modal-search"><input id="quickSearchInput" type="search" placeholder="Search by name, ID, class, or keyword…" autocomplete="off"></div>
            <div id="quickSearchResults" class="quick-results"></div>
        `);
        const input = document.getElementById('quickSearchInput');
        const results = document.getElementById('quickSearchResults');
        const showResults = () => {
            const query = input.value.trim().toLocaleLowerCase();
            if (query.length < 2) {
                results.innerHTML = '<div class="empty">Enter at least two characters to search available records.</div>';
                return;
            }
            const matches = entries
                .filter(item => `${item.searchText || ''} ${item.title} ${item.note}`.toLocaleLowerCase().includes(query))
                .sort((a, b) => Number(b.title.toLocaleLowerCase().startsWith(query)) - Number(a.title.toLocaleLowerCase().startsWith(query)))
                .slice(0, 12);
            results.innerHTML = matches.length ? matches.map((item, index) => `
                <button class="quick-result" type="button" data-index="${index}"><b>${item.title}</b><small>${item.note}</small></button>
            `).join('') : '<div class="empty">No matching records found.</div>';
            results.querySelectorAll('[data-index]').forEach(button => {
                button.onclick = () => {
                    const item = matches[Number(button.dataset.index)];
                    closeModal();
                    if (item.action.type === 'student') window.studentProfile(item.action.id);
                    else location.href = `${item.action.page}.html`;
                };
            });
        };
        input.addEventListener('input', showResults);
        showResults();
    };

    window.openNotifications = () => {
        const items = notificationItems();
        openModal(`
            <h2 id="modalTitle">Pending notifications</h2>
            <p class="subline">Current reminders from attendance, fees, and coursework. Most urgent items appear first.</p>
            <div class="notification-summary"><b>${items.length ? `${items.length} pending item${items.length === 1 ? '' : 's'}` : 'No pending items'}</b><small>Open a reminder to go to the related section.</small></div>
            <div class="notification-list">
                ${items.length ? items.map((item, index) => `
                    <button type="button" class="notification-item priority-${item.rank}" data-index="${index}"><span class="flag-icon">${item.icon}</span><span class="notification-copy"><b>${item.title}</b><small>${item.note}</small></span><span class="notification-priority priority-${item.rank}">${item.priority}</span></button>
                `).join('') : '<div class="empty">You’re all caught up.</div>'}
            </div>
        `);
        document.querySelectorAll('.notification-item').forEach(button => {
            button.onclick = () => {
                const item = items[Number(button.dataset.index)];
                if (item.noticeId) {
                    const read = new Set(storage.get(`ignis-read-notices:${session.id}`, []));
                    read.add(item.noticeId);
                    storage.set(`ignis-read-notices:${session.id}`, [...read]);
                }
                closeModal();
                location.href = `${item.page}.html`;
            };
        });
    };

    document.getElementById('modal').addEventListener('click', event => {
        if (event.target.id === 'modal') closeModal();
    });

    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            openQuickSearch();
        }
        if (event.key === 'Escape') closeModal();
    });

    window.savePaymentSettings = async event => {
        event.preventDefault();
        const data = new FormData(event.target);
        const normalize = value => String(value || '').replace(/\D/g, '');
        const mtnNumber = normalize(data.get('mtnNumber'));
        const telecelNumber = normalize(data.get('telecelNumber'));

        if (mtnNumber && !/^(024|025|053|054|055)\d{7}$/.test(mtnNumber)) {
            toast('Enter a valid MTN MoMo receiving number.');
            return;
        }

        if (telecelNumber && !/^(020|050)\d{7}$/.test(telecelNumber)) {
            toast('Enter a valid Telecel Cash receiving number.');
            return;
        }

        paymentSettings = {
            accountName: String(data.get('accountName')).trim(),
            mtnNumber,
            telecelNumber
        };
        const { error } = await window.ignisSupabase.client.from('school_settings').upsert({
            setting_key: 'payment_settings', setting_value: paymentSettings, updated_by: session.id
        });
        if (error) { toast(error.message || 'Payment directory could not be saved.'); return; }
        storage.set('ignis-payment-settings', paymentSettings);
        toast('Payment directory saved for parents.');
        render();
    };

    window.saveSchoolTerm = async event => {
        event.preventDefault();
        const form = new FormData(event.target);
        const term = String(form.get('term')).trim();
        const startDate = String(form.get('startDate'));
        const endDate = String(form.get('endDate'));
        if (!startDate || !endDate || startDate > endDate) { toast('Choose a valid start date and end date for the term.'); return; }
        const record = { name: term, startDate, endDate };
        academicTerms = [...academicTerms.filter(item => item.name !== term), record].sort((a, b) => a.startDate.localeCompare(b.startDate));
        const { error: termsError } = await window.ignisSupabase.client.from('school_settings').upsert({ setting_key: 'academic_terms', setting_value: academicTerms, updated_by: session.id });
        if (termsError) { toast(termsError.message || 'Term history could not be saved.'); return; }
        const { error } = await window.ignisSupabase.client.from('school_settings').upsert({ setting_key: 'current_term', setting_value: record, updated_by: session.id });
        if (error) { toast(error.message || 'Current term could not be saved.'); return; }
        currentTerm = term;
        storage.set('ignis-current-term', currentTerm);
        storage.set('ignis-academic-terms', academicTerms);
        toast('Term dates saved. It is now the current term.');
        render();
    };

    window.loadAcademicTerm = encodedName => {
        const term = academicTerms.find(item => item.name === decodeURIComponent(encodedName || ''));
        document.getElementById('currentTermInput').value = term?.name || '';
        document.getElementById('termStartDate').value = term?.startDate || '';
        document.getElementById('termEndDate').value = term?.endDate || '';
    };

    window.setSelectedTermCurrent = async () => {
        const name = document.getElementById('academicTermPicker')?.value;
        const term = academicTerms.find(item => item.name === decodeURIComponent(name || ''));
        if (!term) { toast('Select a saved term first.'); return; }
        const { error } = await window.ignisSupabase.client.from('school_settings').upsert({ setting_key: 'current_term', setting_value: term, updated_by: session.id });
        if (error) { toast(error.message || 'Current term could not be changed.'); return; }
        currentTerm = term.name;
        storage.set('ignis-current-term', currentTerm);
        toast('Current term changed. Historical records remain available.');
        render();
    };

    window.markSelfPresent = () => {
        // Retained for older bookmarked actions; attendance can no longer bypass location verification.
        window.clockIn();
    };

    window.renderStaffReport = () => {
        const dateInput = document.getElementById('staffReportDate');
        const table = document.getElementById('staffReportTable');
        if (dateInput && table) table.innerHTML = staffAttendanceReport(dateInput.value || localDateKey());
    };

    function downloadCsv(filename, rows) {
        const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    window.exportStaffAttendance = () => {
        const date = document.getElementById('staffReportDate')?.value || localDateKey();
        const records = staffAttendance[date] || {};
        const rows = [['Date', 'Staff member', 'Email', 'Role', 'Status', 'Recorded date and time']];
        staffMembers().forEach(member => {
            const record = records[member.email];
            rows.push([date, member.name, member.email, member.role, record ? record.status : 'Not recorded', record ? new Date(record.recordedAt).toLocaleString() : '']);
        });
        downloadCsv(`staff-attendance-${date}.csv`, rows);
    };

    window.exportStudentAttendance = () => {
        const date = document.getElementById('staffReportDate')?.value || localDateKey();
        const dateLabel = new Date(`${date}T12:00:00`).toDateString();
        const rows = [['Date', 'Class', 'Student ID', 'Student', 'Status', 'Recorded date and time']];
        classesData.forEach(cls => {
            const marks = classRegister[`${cls.id}::${dateLabel}`] || {};
            students.filter(student => student[2] === cls.name).forEach(student => {
                const mark = marks[student[0]];
                const status = typeof mark === 'string' ? mark : (mark?.status || 'Not recorded');
                rows.push([date, cls.name, student[0], student[1], status, mark?.recordedAt ? new Date(mark.recordedAt).toLocaleString() : '']);
            });
        });
        downloadCsv(`student-attendance-${date}.csv`, rows);
    };

    window.searchAccounts = () => {
        const query = (document.getElementById('accountSearch')?.value || '').trim().toLowerCase();
        document.querySelectorAll('#accountRows tr').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(query); });
    };

    let clockInPending = false;
    window.clockIn = () => {
        if (clockInPending) return;
        if (!isTeacher) {
            toast('Only teaching staff can use teacher clock-in.');
            return;
        }
        if (staffAttendance[localDateKey()]?.[session.email]) {
            toast('Your attendance is already recorded for today.');
            return;
        }
        if (!window.isSecureContext || !navigator.geolocation) {
            toast('Location check-in requires the secure HTTPS portal and browser location support.');
            return;
        }

        clockInPending = true;
        toast('Getting your location…');

        const onLocationSuccess = async position => {
                const { latitude, longitude } = position.coords;
                try {
                    const { data, error } = await window.ignisSupabase.client.functions.invoke('clock-in', { body: { latitude, longitude } });
                    if (error || data?.error) {
                        clockInPending = false;
                        let reason = data?.error;
                        if (!reason && error?.context) {
                            try {
                                const response = error.context.clone ? error.context.clone() : error.context;
                                const details = typeof response.json === 'function' ? await response.json() : response;
                                reason = details?.error || details?.message;
                            } catch (_) {
                                // Keep the SDK message if the response body is unavailable or already consumed.
                            }
                        }
                        toast(reason || error?.message || 'Check-in failed. Confirm the attendance service and approved school zone.');
                        return;
                    }
                    const record = { email: session.email, name: session.name, time: Date.parse(data.recorded_at), lat: latitude, lng: longitude, zoneName: data.zone_name, distance: data.distance_meters, radius: data.radius_meters || geofences.find(zone => zone.name === data.zone_name)?.radius, verified: true };
                    checkins.push(record);
                    const date = localDateKey(new Date(record.time));
                    staffAttendance[date] ||= {};
                    staffAttendance[date][session.email] = { email: session.email, name: session.name, role: session.role, status: data.status, recordedAt: data.recorded_at, zoneName: data.zone_name, distance: data.distance_meters };
                    storage.set('ignis-staff-attendance', staffAttendance);
                    storage.set('ignis-checkins', checkins);
                    clockInPending = false;
                    toast(`Location verified — attendance recorded${data.status === 'late' ? ' as late' : ''}.`);
                    render();
                } catch (error) {
                    clockInPending = false;
                    toast(`Check-in could not reach the attendance service: ${error.message || 'check your connection and retry.'}`);
                }
        };
        const onLocationError = error => {
            clockInPending = false;
            const messages = {
                1: 'Location permission is blocked. Allow location access for this site, then try again.',
                2: 'Your device could not determine its location. Turn on device location and retry.',
                3: 'Location lookup timed out. Try again outdoors or with Wi-Fi enabled.'
            };
            toast(messages[error.code] || 'Location could not be verified. Check-in blocked.');
        };
        navigator.geolocation.getCurrentPosition(onLocationSuccess, error => {
            if (error.code === 1) { onLocationError(error); return; }
            toast('Precise GPS is unavailable. Trying standard device location…');
            navigator.geolocation.getCurrentPosition(onLocationSuccess, onLocationError, { enableHighAccuracy: false, maximumAge: 10000, timeout: 30000 });
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    };

    window.manageGeofences = () => {
        openModal(`
            <h2>Approved zones</h2>
            <p>Teachers must be within a zone's radius to clock in successfully.</p>

            <form id="zoneForm">
                <div class="field">
                    <label>Zone name</label>
                    <input name="name" placeholder="e.g. IGNIS Annex" required>
                </div>
                <div class="form-row" style="display:flex;gap:10px">
                    <div class="field" style="flex:1">
                        <label>Latitude</label>
                        <input name="lat" type="number" step="any" required>
                    </div>
                    <div class="field" style="flex:1">
                        <label>Longitude</label>
                        <input name="lng" type="number" step="any" required>
                    </div>
                </div>
                <button class="secondary" type="button" onclick="useCurrentLocationForZone()">Use this device location</button>
                <small class="subline">Set the zone centre while this device is at the school.</small>
                <div class="field">
                    <label>Radius (metres)</label>
                    <input name="radius" type="number" value="150" required>
                </div>

                <button class="primary" type="submit" style="margin-top:6px;width:100%">
                    Add zone
                </button>
            </form>

            <div style="margin-top:18px">
                ${geofences
                    .map(
                        (z, i) => `
                            <div class="flag">
                                <span class="flag-icon">◎</span>
                                <div>
                                    <b>${z.name}</b>
                                    <small>${z.lat.toFixed(5)}, ${z.lng.toFixed(5)} · ${z.radius}m</small>
                                </div>
                                <button class="link" onclick="removeGeofence(${i})">Remove</button>
                            </div>
                        `
                    )
                    .join('')}
            </div>
        `);

        window.useCurrentLocationForZone = () => {
            if (!isAdmin) { toast('Only school administrators can set attendance zones.'); return; }
            if (!window.isSecureContext || !navigator.geolocation) { toast('Location setup requires the secure HTTPS portal and browser location support.'); return; }
            const form = document.getElementById('zoneForm');
            const captureButton = form.querySelector('button[type="button"]');
            captureButton.disabled = true;
            captureButton.textContent = 'Getting this device location…';
            const onPosition = position => {
                form.elements.lat.value = position.coords.latitude.toFixed(6);
                form.elements.lng.value = position.coords.longitude.toFixed(6);
                captureButton.disabled = false;
                captureButton.textContent = 'Use this device location';
                toast(`Coordinates filled. Device accuracy is about ${Math.round(position.coords.accuracy)}m; set an appropriate zone radius.`);
            };
            const onError = error => {
                captureButton.disabled = false;
                captureButton.textContent = 'Use this device location';
                toast(error.code === 1 ? 'Allow location access for this site, then try again.' : 'Could not get this device location. Check device location and retry.');
            };
            navigator.geolocation.getCurrentPosition(onPosition, error => {
                if (error.code === 1) { onError(error); return; }
                toast('Precise GPS is unavailable. Trying standard device location…');
                navigator.geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: false, maximumAge: 10000, timeout: 30000 });
            }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
        };

        document.getElementById('zoneForm').onsubmit = async e => {
            e.preventDefault();
            const data = new FormData(e.target);

            const lat = parseFloat(data.get('lat'));
            const lng = parseFloat(data.get('lng'));
            const radius = parseFloat(data.get('radius'));
            if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180 || !Number.isFinite(radius) || radius < 25 || radius > 2000) {
                toast('Use valid coordinates and a radius from 25 to 2,000 metres.');
                return;
            }

            const { data: zone, error } = await window.ignisSupabase.client.from('geofences').insert({
                name: String(data.get('name')).trim(), latitude: lat, longitude: lng, radius_meters: radius
            }).select('id, name, latitude, longitude, radius_meters').single();
            if (error) { toast(error.message || 'Approved zone could not be saved.'); return; }
            geofences.push({ id: zone.id, name: zone.name, lat: zone.latitude, lng: zone.longitude, radius: zone.radius_meters });
            storage.set('ignis-geofences', geofences);
            closeModal();
            toast('Approved zone added');
            render();
        };
    };

    window.removeGeofence = async index => {
        if (geofences.length <= 1) {
            toast('Keep at least one approved zone available for teacher attendance.');
            return;
        }
        const zone = geofences[index];
        const { error } = await window.ignisSupabase.client.from('geofences').update({ enabled: false }).eq('id', zone.id);
        if (error) { toast(error.message || 'Approved zone could not be removed.'); return; }
        geofences.splice(index, 1);
        storage.set('ignis-geofences', geofences);
        closeModal();
        toast('Zone removed');
        render();
    };

    window.manageAttendancePolicy = () => {
        openModal(`
            <h2 id="modalTitle">Teacher arrival policy</h2>
            <p class="subline">A verified check-in after this time is recorded as late. The time uses the device’s local time.</p>
            <form id="attendancePolicyForm">
                <div class="field"><label for="arrivalBy">Expected arrival time</label><input id="arrivalBy" name="arrivalBy" type="time" value="${attendancePolicy.arrivalBy || ''}" required></div>
                <button class="primary" type="submit" style="width:100%">Save arrival policy</button>
            </form>
        `);
        document.getElementById('attendancePolicyForm').onsubmit = async event => {
            event.preventDefault();
            attendancePolicy = { arrivalBy: String(new FormData(event.target).get('arrivalBy')) };
            const { error } = await window.ignisSupabase.client.from('school_settings').upsert({
                setting_key: 'arrival_by', setting_value: { time: attendancePolicy.arrivalBy }, updated_by: session.id
            });
            if (error) { toast(error.message || 'Arrival policy could not be saved.'); return; }
            storage.set('ignis-attendance-policy', attendancePolicy);
            closeModal();
            toast('Teacher arrival policy saved.');
            render();
        };
    };

    window.findStudents = () => {
        const query = document
            .getElementById('searchInput')
            .value
            .toLowerCase();

        document.getElementById('studentRows').innerHTML =
            studentRows(
                students.filter(student =>
                    student
                        .join(' ')
                        .toLowerCase()
                        .includes(query)
                )
            );
    };

    /* -----------------------------------------------------
       Students: enrol / profile
       ----------------------------------------------------- */

    window.addStudent = () => {
        openModal(`
            <h2>Enrol student</h2>
            <form id="studentForm">
                <div class="field">
                    <label>Full name</label>
                    <input name="name" required>
                </div>
                <div class="field">
                    <label>Class</label>
                    <select name="class" required>
                        ${classesData.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="field">
                    <label>Linked parent / guardian (optional)</label>
                    <input name="guardian">
                </div>
                <div class="form-row settings-grid">
                    <div class="field">
                        <label>Guardian phone number (optional)</label>
                        <input name="guardianPhone" type="tel" inputmode="tel" placeholder="024 XXX XXXX" autocomplete="tel">
                    </div>
                    <div class="field">
                        <label>Guardian email address (optional)</label>
                        <input name="guardianEmail" type="email" placeholder="guardian@email.com" autocomplete="email">
                    </div>
                </div>
                <button class="primary" type="submit" style="width:100%">Enrol student</button>
            </form>
        `);

        document.getElementById('studentForm').onsubmit = async e => {
            e.preventDefault();
            const data = new FormData(e.target);
            const id = 'IG-' + Date.now().toString().slice(-7);
            const guardianPhone = String(data.get('guardianPhone')).replace(/\D/g, '');
            const guardianEmail = String(data.get('guardianEmail')).trim().toLowerCase();
            const className = String(data.get('class'));
            const classRow = classesData.find(item => item.name === className);

            if (guardianPhone && !/^0\d{9}$/.test(guardianPhone)) {
                toast('Enter a valid 10-digit guardian phone number.');
                return;
            }

            if (!classRow) {
                toast('Create a class before enrolling students.');
                return;
            }
            const submit = e.target.querySelector('[type="submit"]');
            submit.disabled = true;
            const { data: savedStudent, error } = await window.ignisSupabase.client.from('students').insert({
                id,
                full_name: String(data.get('name')).trim(),
                class_id: classRow.id,
                guardian_name: String(data.get('guardian') || '').trim() || null,
                guardian_phone: guardianPhone || null,
                guardian_email: guardianEmail || null
            }).select('id, full_name, class_id, guardian_name, guardian_phone, guardian_email').single();
            if (error) {
                submit.disabled = false;
                toast(error.message || 'Student could not be saved.');
                return;
            }
            students.push([savedStudent.id, savedStudent.full_name, className, savedStudent.guardian_name || '', savedStudent.guardian_phone || '', savedStudent.guardian_email || '']);
            storage.set('ignis-students', students);
            closeModal();
            toast('Student enrolled');
            render();
        };
    };

    window.deleteStudent=async id=>{const student=students.find(item=>item[0]===id);if(!student||!isAdmin||!window.confirm('Permanently delete '+student[1]+'? Attendance, scores, fees, and family links will also be deleted. Payment records prevent deletion.'))return;const {error}=await window.ignisSupabase.client.from('students').delete().eq('id',id);if(error){toast('Student could not be deleted: '+error.message);return;}students=students.filter(item=>item[0]!==id);delete scores[id];delete fees[id];Object.keys(classRegister).forEach(key=>{if(classRegister[key])delete classRegister[key][id];});Object.keys(assignmentSubmissions).forEach(key=>{assignmentSubmissions[key]=(assignmentSubmissions[key]||[]).filter(sid=>sid!==id);});userAccounts.forEach(account=>{if(account.wardId===id){account.wardId=undefined;account.linked_student_id=null;}});storage.set('ignis-students',students);storage.set('ignis-scores',scores);storage.set('ignis-fees',fees);storage.set('ignis-class-register',classRegister);storage.set('ignis-assignment-submissions',assignmentSubmissions);toast('Student and linked school records deleted.');render();}; window.studentProfile = id => {
        const student = students.find(s => s[0] === id);
        if (!student) return;

        const ledger = fees[id];
        const subjectScores = scores[id] || [];

        openModal(`
            <h2>${student[1]}</h2>${isAdmin ? `<button class="link danger-link" onclick="deleteStudent('${id}')">Delete student</button>` : ''}
            <p class="subline">${id} · ${student[2]}</p>

            <div class="field">
                <label>Guardian details</label>
                <p style="margin:0"><b>${student[3]}</b><br><span class="subline">${student[4] || 'Phone not recorded'} · ${student[5] || 'Email not recorded'}</span></p>
            </div>

            <div class="field">
                <label>Fees</label>
                <p style="margin:0">
                    ${
                        ledger
                            ? `GH₵ ${ledger.paid.toFixed(2)} paid of GH₵ ${ledger.amount.toFixed(2)} (${ledger.term})`
                            : 'No billing record'
                    }
                </p>
            </div>

            <div class="field">
                <label>Recent scores</label>
                ${
                    subjectScores.length
                        ? subjectScores
                            .map(s => `<p style="margin:2px 0">${s.subject}: <b>${s.classScore + s.examScore}</b> (${s.grade})</p>`)
                            .join('')
                        : '<p style="margin:0">No scores recorded</p>'
                }
            </div>
        `);
    };

    /* -----------------------------------------------------
       Classes
       ----------------------------------------------------- */

    window.addClass = () => {
        openModal(`
            <h2>Add class</h2>
            <form id="classForm">
                <div class="field">
                    <label>Class name</label>
                    <input name="name" placeholder="e.g. Primary 6A" required>
                </div>
                <div class="field">
                    <label>Level</label>
                    <input name="level" placeholder="e.g. Primary" required>
                </div>
                <div class="field">
                    <label>Teacher in charge</label>
                    <select name="teacher_user_id"><option value="">Unassigned</option>${staffMembers().map(person => `<option value="${person.user_id}">${person.name}</option>`).join('')}</select>
                </div>
                <button class="primary" type="submit" style="width:100%">Add class</button>
            </form>
        `);

        document.getElementById('classForm').onsubmit = async e => {
            e.preventDefault();
            const data = new FormData(e.target);
            const { data: savedClass, error } = await window.ignisSupabase.client.from('classes').insert({
                name: String(data.get('name')).trim(),
                level: String(data.get('level')).trim(),
                teacher_user_id: String(data.get('teacher_user_id') || '') || null
            }).select('id, name, level, teacher_user_id').single();
            if (error) {
                toast(error.message || 'Class could not be saved.');
                return;
            }
            const teacher = staffMembers().find(person => person.user_id === savedClass.teacher_user_id);
            classesData.push({ id: savedClass.id, name: savedClass.name, level: savedClass.level, teacherId: savedClass.teacher_user_id, teacher: teacher?.name || '' });
            storage.set('ignis-classes', classesData);
            closeModal();
            toast('Class added');
            render();
        };
    };

    window.deleteClass=async id=>{const cls=classesData.find(item=>item.id===id);if(!cls||!isAdmin||!window.confirm('Delete '+cls.name+'? Its timetable and assignments will be deleted; students will remain without a class.'))return;const {error}=await window.ignisSupabase.client.from('classes').delete().eq('id',id);if(error){toast('Class could not be deleted: '+error.message);return;}students=students.map(item=>item[2]===cls.name?[item[0],item[1],'Unassigned',...item.slice(3)]:item);const removed=assignments.filter(item=>item.class===cls.name);removed.forEach(item=>delete assignmentSubmissions[item.id]);assignments=assignments.filter(item=>item.class!==cls.name);timetableData=timetableData.filter(item=>item.class_id!==id);classRegister=Object.fromEntries(Object.entries(classRegister).filter(([key])=>!key.startsWith(id+'::')));classesData=classesData.filter(item=>item.id!==id);storage.set('ignis-students',students);storage.set('ignis-classes',classesData);storage.set('ignis-assignments',assignments);storage.set('ignis-assignment-submissions',assignmentSubmissions);storage.set('ignis-timetable',timetableData);storage.set('ignis-class-register',classRegister);toast('Class deleted.');render();}; window.manageTimetable = () => {
        const availableClasses = isAdmin ? classesData : classesData.filter(cls => cls.teacherId === session.id);
        if (!availableClasses.length) { toast('No classes are assigned to your account.'); return; }
        const selectedClass = availableClasses[0];
        openModal(`<h2>Manage timetable</h2><p class="subline">Add or remove published periods for a class.</p>
            <form id="timetableEntryForm">
                <div class="field"><label>Class</label><select name="class_id">${availableClasses.map(cls => `<option value="${cls.id}">${cls.name}</option>`).join('')}</select></div>
                <div class="form-row settings-grid"><div class="field"><label>Day</label><select name="weekday"><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option></select></div><div class="field"><label>Subject</label><input name="subject" required></div></div>
                <div class="form-row settings-grid"><div class="field"><label>Starts</label><input name="start_time" type="time" required></div><div class="field"><label>Ends</label><input name="end_time" type="time" required></div></div>
                <div class="field"><label>Teacher</label><select name="teacher_user_id"><option value="">Unassigned</option>${staffMembers().map(person => `<option value="${person.user_id}">${person.name}</option>`).join('')}</select></div>
                <button class="primary" type="submit" style="width:100%">Add period</button>
            </form>
            <div class="audit"><b>${selectedClass.name}</b>${timetableData.filter(item => item.class_id === selectedClass.id).map(item => `<div class="flag"><span>${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'][item.weekday]} ${item.start_time.slice(0,5)}–${item.end_time.slice(0,5)} · ${item.subject}</span><button class="link" onclick="removeTimetableEntry('${item.id}')">Delete</button></div>`).join('') || '<p>No periods added yet.</p>'}</div>`);
        document.getElementById('timetableEntryForm').onsubmit = async event => {
            event.preventDefault();
            const data = new FormData(event.target);
            const classId = String(data.get('class_id'));
            if (Number(data.get('end_time').replace(':', '')) <= Number(data.get('start_time').replace(':', ''))) { toast('The end time must be after the start time.'); return; }
            const { data: saved, error } = await window.ignisSupabase.client.from('timetable_entries').insert({
                class_id: classId, weekday: Number(data.get('weekday')), start_time: data.get('start_time'), end_time: data.get('end_time'),
                subject: String(data.get('subject')).trim(), teacher_user_id: String(data.get('teacher_user_id') || '') || null, created_by: session.id
            }).select('id, class_id, weekday, start_time, end_time, subject, teacher_user_id').single();
            if (error) { toast(error.message || 'Timetable period could not be saved.'); return; }
            timetableData.push(saved);
            storage.set('ignis-timetable', timetableData);
            closeModal(); render();
            toast('Timetable period published.');
        };
    };

    window.removeTimetableEntry = async id => {const entry=timetableData.find(item=>item.id===id);if(!entry||!window.confirm('Delete this timetable period?'))return;
        const { error } = await window.ignisSupabase.client.from('timetable_entries').delete().eq('id', id);
        if (error) { toast(error.message || 'Timetable period could not be removed.'); return; }
        timetableData = timetableData.filter(entry => entry.id !== id);
        storage.set('ignis-timetable', timetableData);
        closeModal(); render();
        toast('Timetable period removed.');
    };

    window.openRegister = classId => {
        const cls = classesData.find(c => c.id === classId);
        if (!cls) return;
        const canMark = isTeacher && cls.teacher === session.name;

        const roster = students.filter(s => s[2] === cls.name);
        const today = new Date().toDateString();
        const dayKey = cls.id + '::' + today;
        const marks = classRegister[dayKey] || {};
        const markStatus = studentId => typeof marks[studentId] === 'string' ? marks[studentId] : marks[studentId]?.status || '';
        const presentCount = roster.filter(s => ['present', 'late'].includes(markStatus(s[0]))).length;

        openModal(`
            <h2>${cls.name} — ${canMark ? 'register' : 'attendance record'}</h2>
            <p class="subline">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${canMark ? 'Select and save each student’s attendance.' : 'View-only: attendance is updated by the teacher in charge.'}</p>
            <div class="staff-report-summary"><span><b>${roster.length}</b> enrolled</span><span><b>${presentCount}</b> present / late</span><span><b>${roster.filter(s => markStatus(s[0]) === 'absent').length}</b> absent</span></div>

            ${
                roster.length
                    ? roster
                        .map(
                            s => `
                                <div class="flag">
                                    <span class="flag-icon">◎</span>
                                    <div>
                                        <b>${s[1]}</b>
                                        <small>${s[0]} · Guardian: ${s[3]}${s[4] ? ` · ${s[4]}` : ''}</small>
                                    </div>
                    <select class="attendance-select" ${canMark ? `onchange="markRegister('${dayKey}','${s[0]}',this.value)"` : 'disabled'}>
                                        <option value="" disabled ${!markStatus(s[0]) ? 'selected' : ''}>Not marked</option>
                                        <option value="present" ${markStatus(s[0]) === 'present' ? 'selected' : ''}>Present</option>
                                        <option value="absent" ${markStatus(s[0]) === 'absent' ? 'selected' : ''}>Absent</option>
                                        <option value="late" ${markStatus(s[0]) === 'late' ? 'selected' : ''}>Late</option>
                                    </select>
                                </div>
                            `
                        )
                        .join('')
                    : '<div class="empty">No students enrolled in this class yet.</div>'
            }
        `);
    };

    window.markRegister = async (dayKey, studentId, status) => {
        const classId = dayKey.split('::')[0];
        const cls = classesData.find(item => item.id === classId);
        if (!isTeacher || !cls || cls.teacher !== session.name) {
            toast('Only the teacher in charge can update this class register.');
            return;
        }
        const date = localDateKey(new Date(dayKey.split('::')[1]));
        const recordedAt = new Date().toISOString();
        const { error } = await window.ignisSupabase.client.from('student_attendance').upsert({
            student_id: studentId,
            attendance_date: date,
            status,
            marked_by: session.id,
            recorded_at: recordedAt
        }, { onConflict: 'student_id,attendance_date' });
        if (error) {
            toast(error.message || 'Attendance could not be saved.');
            return;
        }
        classRegister[dayKey] ||= {};
        classRegister[dayKey][studentId] = { status, recordedAt };
        storage.set('ignis-class-register', classRegister);
        toast('Attendance updated');
    };

    /* -----------------------------------------------------
       Assignments
       ----------------------------------------------------- */

    window.addAssignment = () => {
        openModal(`
            <h2>New assignment</h2>
            <form id="assignmentForm">
                <div class="field">
                    <label>Title</label>
                    <input name="title" required>
                </div>
                <div class="field">
                    <label>Class</label>
                    <select name="class" required>
                        ${classesData.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="field">
                    <label>Subject</label>
                    <input name="subject" required>
                </div>
                <div class="field">
                    <label>Due date</label>
                    <input name="due" type="date" required>
                </div>
                <button class="primary" type="submit" style="width:100%">Create assignment</button>
            </form>
        `);

        document.getElementById('assignmentForm').onsubmit = async e => {
            e.preventDefault();
            const data = new FormData(e.target);
            const className = data.get('class');
            const classRow = classesData.find(item => item.name === className);
            if (!classRow) { toast('Create a class before assigning work.'); return; }
            const { data: saved, error } = await window.ignisSupabase.client.from('assignments').insert({
                title: String(data.get('title')).trim(), subject: String(data.get('subject')).trim(),
                class_id: classRow.id, due_at: new Date(`${data.get('due')}T23:59:00`).toISOString(), created_by: session.id
            }).select('id, title, subject, class_id, due_at').single();
            if (error) { toast(error.message || 'Assignment could not be saved.'); return; }
            assignments.unshift({ id: saved.id, title: saved.title, subject: saved.subject, class: className, due: saved.due_at.slice(0, 10), submitted: 0, total: students.filter(s => s[2] === className).length });
            assignmentSubmissions[saved.id] = [];
            closeModal();
            toast('Assignment created');
            render();
        };
    };

    window.removeAssignment = async id => {const assignment=assignments.find(item=>item.id===id);if(!assignment||!window.confirm('Delete assignment '+assignment.title+' and its submissions?'))return;
        const { error } = await window.ignisSupabase.client.from('assignments').delete().eq('id', id);
        if (error) { toast(error.message || 'Assignment could not be removed.'); return; }
        assignments = assignments.filter(a => a.id !== id);
        delete assignmentSubmissions[id];
        storage.set('ignis-assignments', assignments);
        storage.set('ignis-assignment-submissions', assignmentSubmissions);
        toast('Assignment removed');
        render();
    };

    window.viewAssignmentProgress = id => {
        const assignment = assignments.find(item => item.id === id);
        if (!assignment || (!isAdmin && !isTeacher)) return;
        const roster = assignmentRoster(assignment);
        const submitted = new Set(submittedIdsFor(assignment));
        const canRecord = isTeacher && classesData.find(item => item.name === assignment.class)?.teacher === session.name;
        const missing = roster.filter(student => !submitted.has(student[0])).length;

        openModal(`
            <h2>${assignment.title}</h2>
            <p class="subline">${assignment.class} · ${assignment.subject} · Due ${formatDate(assignment.due)}</p>
            <div class="staff-report-summary"><span><b>${roster.length}</b> assigned</span><span><b>${submitted.size}</b> submitted</span><span><b>${missing}</b> not submitted</span></div>
            <div class="assignment-progress">
                ${roster.length ? roster.map(student => {
                    const hasSubmitted = submitted.has(student[0]);
                    return `<div class="flag"><span class="flag-icon">${hasSubmitted ? '✓' : '!'}</span><div><b>${student[1]}</b><small>${student[0]} · Guardian: ${student[3]}</small></div><span class="pill ${hasSubmitted ? 'green' : 'red'}">${hasSubmitted ? 'Submitted' : 'Not submitted'}</span>${canRecord ? `<button class="link" onclick="toggleAssignmentSubmission('${assignment.id}','${student[0]}')">${hasSubmitted ? 'Undo' : 'Mark submitted'}</button>` : ''}</div>`;
                }).join('') : '<div class="empty">No students are enrolled in this class.</div>'}
            </div>
        `);
    };

    window.toggleAssignmentSubmission = async (assignmentId, studentId) => {
        const assignment = assignments.find(item => item.id === assignmentId);
        const cls = assignment && classesData.find(item => item.name === assignment.class);
        if (!assignment || !isTeacher || !cls || cls.teacher !== session.name) {
            toast('Only the teacher in charge can record submissions.');
            return;
        }
        const submitted = new Set(submittedIdsFor(assignment));
        const removing = submitted.has(studentId);
        const query = window.ignisSupabase.client.from('assignment_submissions');
        const result = removing
            ? await query.delete().eq('assignment_id', assignmentId).eq('student_id', studentId)
            : await query.insert({ assignment_id: assignmentId, student_id: studentId });
        if (result.error) { toast(result.error.message || 'Submission record could not be updated.'); return; }
        if (removing) submitted.delete(studentId);
        else submitted.add(studentId);
        assignmentSubmissions[assignmentId] = [...submitted];
        assignment.submitted = submitted.size;
        assignment.total = assignmentRoster(assignment).length;
        storage.set('ignis-assignment-submissions', assignmentSubmissions);
        storage.set('ignis-assignments', assignments);
        toast('Submission record updated.');
        render();
        window.viewAssignmentProgress(assignmentId);
    };

    /* -----------------------------------------------------
       Academic scores
       ----------------------------------------------------- */

    window.addScore = studentId => {
        openModal(`
            <h2>Record score</h2>
            <form id="scoreForm">
                <div class="field">
                    <label>Subject</label>
                    <input name="subject" required>
                </div>
                <div class="field">
                    <label>Term</label>
                    <input name="term" placeholder="Enter the current term and academic year" required>
                </div>
                <div class="form-row" style="display:flex;gap:10px">
                    <div class="field" style="flex:1">
                        <label>Class score (out of 30)</label>
                        <input name="classScore" type="number" min="0" max="30" required>
                    </div>
                    <div class="field" style="flex:1">
                        <label>Exam score (out of 70)</label>
                        <input name="examScore" type="number" min="0" max="70" required>
                    </div>
                </div>
                <button class="primary" type="submit" style="width:100%">Save score</button>
            </form>
        `);

        document.getElementById('scoreForm').onsubmit = async e => {
            e.preventDefault();
            const data = new FormData(e.target);
            const classScore = parseInt(data.get('classScore'), 10);
            const examScore = parseInt(data.get('examScore'), 10);
            const total = classScore + examScore;
            const grade = total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : 'D';

            const subject = String(data.get('subject')).trim();
            const term = String(data.get('term')).trim();
            const { error } = await window.ignisSupabase.client.from('scores').upsert({
                student_id: studentId, subject, term, class_score: classScore, exam_score: examScore, recorded_by: session.id
            }, { onConflict: 'student_id,subject,term' });
            if (error) { toast(error.message || 'Score could not be saved.'); return; }
            scores[studentId] = (scores[studentId] || []).filter(score => !(score.subject === subject && score.term === term));
            scores[studentId].push({ subject, classScore, examScore, grade, term });

            storage.set('ignis-scores', scores);
            closeModal();
            toast('Score recorded');
            render();
        };
    };

    /* -----------------------------------------------------
       Fees
       ----------------------------------------------------- */

    window.deleteScore=async(studentId,encodedSubject,encodedTerm)=>{if(!isAdmin&&!isTeacher)return;const subject=decodeURIComponent(encodedSubject);const term=decodeURIComponent(encodedTerm);if(!window.confirm('Delete the '+subject+' score'+(term?' for '+term:'')+'?'))return;const {error}=await window.ignisSupabase.client.from('scores').delete().eq('student_id',studentId).eq('subject',subject).eq('term',term);if(error){toast('Score could not be deleted: '+error.message);return;}scores[studentId]=(scores[studentId]||[]).filter(item=>!(item.subject===subject&&(item.term||'')===term));storage.set('ignis-scores',scores);toast('Score deleted.');render();}; window.recordPayment = studentId => {
        const ledger = fees[studentId];
        if (!ledger) { toast('Set a fee for this student before recording a payment.'); return; }
        openModal(`
            <h2>Record payment</h2>
            <p class="subline">${ledger.term} · Outstanding: GH₵ ${(ledger.amount - ledger.paid).toFixed(2)}</p>
            <form id="paymentForm">
                <div class="field">
                    <label>Amount received (GH₵)</label>
                    <input name="amount" type="number" min="1" step="0.01" required>
                </div>
                <div class="field">
                    <label>Payment channel</label>
                    <select name="method">
                        <option>MTN MoMo</option>
                        <option>Telecel Cash</option>
                        <option>Bank transfer</option>
                        <option>Cash at school</option>
                    </select>
                </div>
                <button class="primary" type="submit" style="width:100%">Record payment</button>
            </form>
        `);

        document.getElementById('paymentForm').onsubmit = async e => {
            e.preventDefault();
            const data = new FormData(e.target);
            const amount = parseFloat(data.get('amount'));

            if (!Number.isFinite(amount) || amount <= 0) {
                toast('Enter a valid payment amount.');
                return;
            }

            const balance = Math.max(0, ledger.amount - ledger.paid);

            if (amount > balance) {
                toast(`Amount exceeds the GH₵ ${balance.toFixed(2)} balance.`);
                return;
            }

            const { data: reference, error } = await window.ignisSupabase.client.rpc('record_school_payment', {
                p_student_id: studentId, p_term: ledger.term, p_amount: amount, p_method: String(data.get('method'))
            });
            if (error) { toast(error.message || 'Payment could not be recorded.'); return; }
            ledger.paid += amount;
            payments.push({ studentId, amount, method: data.get('method'), reference, createdAt: new Date().toISOString(), status: 'confirmed' });
            storage.set('ignis-fees', fees);
            storage.set('ignis-payments', payments);

            closeModal();
            toast('Payment recorded');
            render();
        };
    };

    window.setStudentFee = studentId => {
        const current = fees[studentId] || {};
        openModal(`<h2>Set student fees</h2><p class="subline">Create or update this student’s term ledger.</p><form id="feeForm"><div class="field"><label>Term</label><input name="term" value="${current.term || ''}" required></div><div class="field"><label>Amount billed (GH₵)</label><input name="amount" type="number" min="0" step="0.01" value="${current.amount ?? ''}" required></div><div class="field"><label>Already paid (GH₵)</label><input name="paid" type="number" min="0" step="0.01" value="${current.paid ?? 0}" required></div><button class="primary" type="submit" style="width:100%">Save fee ledger</button></form>`);
        document.getElementById('feeForm').onsubmit = async event => {
            event.preventDefault();
            const data = new FormData(event.target);
            const amount = Number(data.get('amount'));
            const paid = Number(data.get('paid'));
            const term = String(data.get('term')).trim();
            if (!Number.isFinite(amount) || !Number.isFinite(paid) || amount < 0 || paid < 0 || paid > amount) { toast('Enter valid fee amounts. Paid cannot exceed billed.'); return; }
            const { error } = await window.ignisSupabase.client.from('fees').upsert({ student_id: studentId, term, amount, paid }, { onConflict: 'student_id,term' });
            if (error) { toast(error.message || 'Fee ledger could not be saved.'); return; }
            fees[studentId] = { term, amount, paid };
            storage.set('ignis-fees', fees);
            closeModal();
            toast('Fee ledger saved.');
            render();
        };
    };

    window.deleteStudentFee=async studentId=>{if(!isAdmin)return;const ledger=fees[studentId];const student=students.find(item=>item[0]===studentId);if(!ledger||!window.confirm('Delete the '+ledger.term+' fee ledger for '+(student?.[1]||studentId)+'?'))return;const {error}=await window.ignisSupabase.client.from('fees').delete().eq('student_id',studentId).eq('term',ledger.term);if(error){toast('Fee ledger could not be deleted: '+error.message);return;}delete fees[studentId];storage.set('ignis-fees',fees);toast('Fee ledger deleted.');render();}; window.startMobileMoneyPayment = () => toast("Online payment is unavailable until a mobile money provider is connected.");

    /* -----------------------------------------------------
       Notices
       ----------------------------------------------------- */

    window.addNotice = () => {
        openModal(`
            <h2>Post notice</h2>
            <form id="noticeForm">
                <div class="field">
                    <label>Title</label>
                    <input name="title" required>
                </div>
                <div class="field">
                    <label>Message</label>
                    <textarea name="body" required></textarea>
                </div>
                <div class="field">
                    <label>Audience</label>
                    <select name="audience">
                        <option value="All">Everyone</option>
                        <option value="Parents">Parents only</option>
                        <option value="Staff">Staff only</option>
                    </select>
                </div>
                <button class="primary" type="submit" style="width:100%">Post notice</button>
            </form>
        `);

        document.getElementById('noticeForm').onsubmit = async e => {
            e.preventDefault();
            const data = new FormData(e.target);

            const { data: saved, error } = await window.ignisSupabase.client.from('notices').insert({
                title: String(data.get('title')).trim(), body: String(data.get('body')).trim(), audience: String(data.get('audience')), published_by: session.id
            }).select('id, title, body, audience, published_at').single();
            if (error) { toast(error.message || 'Notice could not be posted.'); return; }
            notices.unshift({ id: saved.id, title: saved.title, body: saved.body, audience: saved.audience, author: session.name, date: saved.published_at.slice(0, 10) });

            storage.set('ignis-notices', notices);
            closeModal();
            toast('Notice posted');
            render();
        };
    };

    window.removeNotice = async id => {const notice=notices.find(item=>item.id===id);if(!notice||!isAdmin||!window.confirm('Delete notice '+notice.title+'?'))return;
        const { error } = await window.ignisSupabase.client.from('notices').delete().eq('id', id);
        if (error) { toast(error.message || 'Notice could not be removed.'); return; }
        notices = notices.filter(n => n.id !== id);
        storage.set('ignis-notices', notices);
        toast('Notice removed');
        render();
    };

    /* -----------------------------------------------------
       Accounts
       ----------------------------------------------------- */

    function linkedStudentOptions(selectedId = '') {
        const saved = storage.get('ignis-students', []);
        const records = [...(Array.isArray(saved) ? saved : Object.values(saved || {})), ...(Array.isArray(students) ? students : [])];
        const normalized = records.map(student => Array.isArray(student)
            ? student
            : [student.id || student.studentId || '', student.name || student.fullName || '', student.class || student.className || '']);
        students = [...new Map(normalized.filter(student => student[0] && student[1]).map(student => [String(student[0]), student])).values()];
        return `<option value="">No linked student</option>${students.map(student => `<option value="${student[0]}" ${String(selectedId) === String(student[0]) ? 'selected' : ''}>${student[1]} · ${student[0]} · ${student[2] || 'Class not assigned'}</option>`).join('')}`;
    }

    function userAccountForm(account = {}, isNew = false, submitHandler = '') { return `
        <h2>${isNew ? 'Add user account' : 'Edit user account'}</h2>
        <p class="subline">${isNew ? 'Invite a teacher, parent, or student by email.' : 'Update this user’s school profile and family link.'}</p>
        <form id="userAccountForm" ${submitHandler ? `onsubmit="${submitHandler}"` : ''}>
            <div class="field"><label>Full name</label><input name="name" value="${account.name || ''}" required></div>
            <div class="field"><label>Email address</label><input name="email" type="email" value="${account.email || ''}" required ${isNew ? '' : 'readonly'}></div>
            <div class="form-row settings-grid">
                <div class="field"><label>Role</label><select name="role"><option ${account.role === 'Teacher' ? 'selected' : ''}>Teacher</option><option ${account.role === 'Parent' ? 'selected' : ''}>Parent</option><option ${account.role === 'Student' ? 'selected' : ''}>Student</option><option ${account.role === 'Parent / Student' ? 'selected' : ''}>Parent / Student</option><option ${account.role === 'Headteacher' ? 'selected' : ''}>Headteacher</option><option ${account.role === 'Manager' ? 'selected' : ''}>Manager</option></select></div>
                <div class="field"><label>Linked student <span class="subline">(optional for student accounts)</span></label><select name="wardId">${linkedStudentOptions(account.wardId)}</select><button class="link refresh-link" type="button" onclick="refreshLinkedStudents()">↻ Refresh enrolled students</button></div>
            </div>
            <div class="field"><label>Class for a new Student account</label><select name="studentClassId"><option value="">Choose class</option>${classesData.map(cls => '<option value="' + cls.id + '">' + cls.name + '</option>').join('')}</select></div><button class="primary" type="submit" style="width:100%">${isNew ? 'Send invitation' : 'Save account changes'}</button>
        </form>
    `; }

    const saveUserAccount = async (event, originalEmail = null) => {
        event.preventDefault();
        const data = new FormData(event.target);
        const email = String(data.get('email')).trim().toLowerCase();
        const role = String(data.get('role'));
        let wardId = String(data.get('wardId') || ''); const studentClassId = String(data.get('studentClassId') || '');
        if (['Parent', 'Parent / Student'].includes(role) && !students.some(student => student[0] === wardId)) {
            toast('Select the student this parent or student account should be linked to.');
            return;
        }
        const client = window.ignisSupabase.client;
        const fullName = String(data.get('name')).trim();
        if (originalEmail) {
            const account = accountDirectory().find(item => item.email === originalEmail);
            const { error } = await client.from('profiles').update({ full_name: fullName, role, linked_student_id: wardId || null }).eq('user_id', account.user_id);
            if (error) { toast(error.message || 'Profile update failed.'); return; }
            const { error: removeError } = await client.from('parent_student_links').delete().eq('parent_user_id', account.user_id);
            if (removeError) { toast('Student link could not be updated: ' + removeError.message); return; }
            if (wardId && ['Parent', 'Parent / Student'].includes(role)) {
                const { error: linkError } = await client.from('parent_student_links').insert({ parent_user_id: account.user_id, student_id: wardId });
                if (linkError) { toast(linkError.message || 'Student link could not be saved.'); return; }
            }
            account.name = fullName;
            account.full_name = fullName;
            account.role = role;
            account.wardId = wardId || undefined;
            account.linked_student_id = wardId || null;
            if (account.user_id === session.id) {
                session = { ...session, name: fullName, role, wardId: wardId || undefined };
                sessionStorage.setItem('ignis-session', JSON.stringify(session));
            }
        } else {
            let newStudentRecord=null;if(role==='Student'&&!wardId){const studentClass=classesData.find(item=>item.id===studentClassId);if(!studentClass){toast('Choose a class to enrol this new student.');return;}wardId='IG-'+Date.now().toString().slice(-7);const {data:savedStudent,error:studentError}=await client.from('students').insert({id:wardId,full_name:fullName,class_id:studentClass.id}).select('id,full_name,class_id').single();if(studentError){toast('Student record could not be created: '+studentError.message);return;}newStudentRecord=savedStudent;students.push([savedStudent.id,savedStudent.full_name,studentClass.name,'','','']);storage.set('ignis-students',students);} const { data: created, error } = await client.functions.invoke('create-user', {
                body: { email, full_name: fullName, role, linked_student_id: wardId || null }
            });
            if (error || created?.error) { if(newStudentRecord){const {error:rollbackError}=await client.from('students').delete().eq('id',newStudentRecord.id);if(rollbackError){toast('Invitation failed; student cleanup failed: '+rollbackError.message);return;}students=students.filter(student=>student[0]!==newStudentRecord.id);storage.set('ignis-students',students);} toast(created?.error || error?.message || 'Invitation could not be sent.'); return; }
            userAccounts.push({ user_id: created.user_id, email, name: fullName, full_name: fullName, role, wardId: wardId || undefined, linked_student_id: wardId || null, is_active: true });
        }
        sessionStorage.setItem('ignis-user-directory', JSON.stringify(userAccounts.map(account => ({
            user_id: account.user_id, email: account.email, full_name: account.name, role: account.role, linked_student_id: account.wardId || null
        }))));
        closeModal();
        toast(originalEmail ? 'Account profile updated.' : 'Invitation sent.');
        render();
    };

    window.createUserAccountFromPage = event => saveUserAccount(event);

    window.addUserAccount = async () => {
        await window.refreshLinkedStudents(); openModal(userAccountForm({}, true));
        document.getElementById('userAccountForm').onsubmit = event => saveUserAccount(event);
    };

    window.refreshLinkedStudents = async () => {
        const select = document.querySelector('select[name="wardId"]');
        if (!select && !window.ignisSupabase?.client) return;
        const selectedId = select?.value || '';
        const client=window.ignisSupabase.client; const [sr,cr]=await Promise.all([client.from('students').select('id, full_name, class_id').order('full_name'),client.from('classes').select('id, name')]); if(sr.error||cr.error){toast('Student list could not be loaded: '+(sr.error||cr.error).message);return;} const names=new Map((cr.data||[]).map(c=>[c.id,c.name])); students=(sr.data||[]).map(s=>[String(s.id),s.full_name,names.get(s.class_id)||'']); storage.set('ignis-students',students); if(select) select.innerHTML=linkedStudentOptions(selectedId);
        toast('Student list refreshed from Supabase.');
    };

    window.editUserAccount = async email => {
        const account = accountDirectory().find(item => item.email === email);
        if (!account) return;
        await window.refreshLinkedStudents(); openModal(userAccountForm(account));
        document.getElementById('userAccountForm').onsubmit = event => saveUserAccount(event, email);
    };

    window.toggleUserStatus = async (userId, isActive) => {
        const { data, error } = await window.ignisSupabase.client.functions.invoke('set-user-status', { body: { user_id: userId, is_active: isActive } });
        if (error || data?.error) { toast(data?.error || error?.message || 'Account status could not be updated.'); return; }
        const account = userAccounts.find(item => item.user_id === userId);
        if (account) account.is_active = isActive;
        sessionStorage.setItem('ignis-user-directory', JSON.stringify(userAccounts.map(item => ({
            user_id: item.user_id, email: item.email, full_name: item.name, role: item.role, linked_student_id: item.wardId || null, is_active: item.is_active
        }))));
        toast(isActive ? 'Account enabled.' : 'Account disabled.');
        render();
    };

    window.deleteUserAccount = async (userId, email) => { if (userId === session.id) { toast('You cannot delete your own account.'); return; } if (!window.confirm('Permanently delete the IGNIS account for ' + email + '?')) return; const { data, error } = await window.ignisSupabase.client.functions.invoke('set-user-status', { body: { user_id: userId, delete_user: true } }); if (error || data?.error) { toast(data?.error || error?.message || 'Account could not be deleted.'); return; } userAccounts = userAccounts.filter(account => account.user_id !== userId); sessionStorage.setItem('ignis-user-directory', JSON.stringify(userAccounts.map(account => ({ user_id: account.user_id, email: account.email, full_name: account.name, role: account.role, linked_student_id: account.wardId || null, is_active: account.is_active })))); toast('Portal account deleted.'); render(); }; if (page === 'user-accounts') setTimeout(() => window.refreshLinkedStudents(), 0); window.resetUserPassword = async email => {
        const { error } = await window.ignisSupabase.client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/IGNIS-SCHOOL-PORTAL/reset-password.html` });
        toast(error ? error.message : `Password reset email sent to ${email}.`);
    };
}
    function attachPageSearch() {
        const currentPage = document.body.dataset.page || 'dashboard';
        const listTargets = {
            classes: ['.class-card', 'Search classes, teachers, or students'],
            assignments: ['.assignment', 'Search assignments, classes, or subjects'],
            scores: ['.table-card', 'Search students, classes, or subjects'],
            timetable: ['.table-wrap tbody tr', 'Search timetable periods, subjects, or teachers'],
            fees: ['.table-card tbody tr', 'Search students, classes, or fee status'],
            'staff-attendance': ['#staffReportTable tbody tr', 'Search staff attendance records'],
            attendance: ['.table-card tbody tr', 'Search attendance records'],
            announcements: ['.card > .flag', 'Search notices or message text']
        };
        const config = listTargets[currentPage];
        const content = document.querySelector('.content');
        const firstTarget = config && content?.querySelector(config[0]);
        if (!firstTarget || content.querySelector('.page-list-search')) return;
        const search = document.createElement('div');
        search.className = 'search-box page-list-search';
        search.innerHTML = '<input type="search" aria-label="Search this list" placeholder="' + config[1] + '"><button class="secondary" type="button">Search</button>';
        const input = search.querySelector('input');
        const filter = () => {
            const query = input.value.trim().toLocaleLowerCase();
            content.querySelectorAll(config[0]).forEach(item => {
                item.hidden = Boolean(query) && !item.textContent.toLocaleLowerCase().includes(query);
            });
        };
        input.addEventListener('input', filter);
        search.querySelector('button').addEventListener('click', filter);
        const targetCard = firstTarget.closest('.card');
        if (targetCard) targetCard.before(search);
        else firstTarget.before(search);
    }
    const pageSearchObserver = new MutationObserver(() => {
        if (!document.querySelector('.page-list-search')) attachPageSearch();
    });
    pageSearchObserver.observe(document.body, { childList: true, subtree: true });
    attachPageSearch();
