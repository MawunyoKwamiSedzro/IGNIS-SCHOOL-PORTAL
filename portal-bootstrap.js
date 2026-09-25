/* Verify every protected page against Supabase before loading portal code. */
(async () => {
    const { client, error: setupError } = window.ignisSupabase || {};
    if (!client) {
        document.body.innerHTML = `<main style="max-width:600px;margin:12vh auto;padding:24px;font:16px system-ui;color:#183b42"><h1>IGNIS setup required</h1><p>${setupError || 'Supabase is not configured.'}</p><p>Follow <a href="supabase/SETUP.md">the Supabase setup guide</a>.</p></main>`;
        return;
    }

    try {
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError || !user) {
            location.replace('index.html');
            return;
        }

        const { data: profile, error: profileError } = await client
            .from('profiles')
            .select('full_name, role, linked_student_id, is_active')
            .eq('user_id', user.id)
            .single();
        if (profileError || !profile) throw new Error('Your account has no IGNIS school profile. Ask the school administrator to finish account setup.');
        if (!profile.is_active) throw new Error('This account is disabled. Contact the school administrator.'); const cacheRecord = JSON.parse(sessionStorage.getItem('ignis-portal-cache') || 'null'); const cachedSession = JSON.parse(sessionStorage.getItem('ignis-session') || 'null'); if (cacheRecord?.userId === user.id && cachedSession?.id === user.id && Date.now() - cacheRecord.savedAt < 20000 && localStorage.getItem('ignis-students') && localStorage.getItem('ignis-classes')) { const cachedScript = document.createElement('script'); cachedScript.src = 'portal.js'; cachedScript.onerror = () => { document.body.innerHTML = '<p>IGNIS could not load. Refresh the page or contact support.</p>'; }; document.body.append(cachedScript); return; }

        let directory = [];
        if (['Headteacher', 'Manager'].includes(profile.role)) {
            const { data, error } = await client.from('profiles').select('user_id, email, full_name, role, linked_student_id, is_active').order('full_name');
            if (error) throw error;
            directory = data || [];
            sessionStorage.setItem('ignis-user-directory', JSON.stringify(directory));
        }

        const { data: classRows, error: classesError } = await client.from('classes').select('id, name, level, teacher_user_id').order('name');
        if (classesError) throw classesError;
        const { data: zoneRows, error: zonesError } = await client.from('geofences').select('id, name, latitude, longitude, radius_meters').eq('enabled', true);
        if (zonesError) throw zonesError;
        localStorage.setItem('ignis-geofences', JSON.stringify((zoneRows || []).map(zone => ({ id: zone.id, name: zone.name, lat: zone.latitude, lng: zone.longitude, radius: zone.radius_meters }))));
        const { data: arrivalSetting } = await client.from('school_settings').select('setting_value').eq('setting_key', 'arrival_by').maybeSingle();
        localStorage.setItem('ignis-attendance-policy', JSON.stringify({ arrivalBy: arrivalSetting?.setting_value?.time || '' }));
        const { data: termSetting } = await client.from('school_settings').select('setting_value').eq('setting_key', 'current_term').maybeSingle();
        localStorage.setItem('ignis-current-term', JSON.stringify(termSetting?.setting_value?.name || 'Not configured'));
        const { data: studentRows, error: studentsError } = await client.from('students')
            .select('id, full_name, class_id, guardian_name, guardian_phone, guardian_email, status')
            .order('full_name');
        if (studentsError) throw studentsError;
        const teacherNames = new Map(directory.map(teacher => [teacher.user_id, teacher.full_name]));
        teacherNames.set(user.id, profile.full_name);
        const classNames = new Map((classRows || []).map(row => [row.id, row.name]));
        localStorage.setItem('ignis-classes', JSON.stringify((classRows || []).map(row => ({
            id: row.id,
            name: row.name,
            level: row.level,
            teacherId: row.teacher_user_id,
            teacher: row.teacher_user_id === user.id ? profile.full_name : (teacherNames.get(row.teacher_user_id) || '')
        }))));
        localStorage.setItem('ignis-students', JSON.stringify((studentRows || []).map(row => [
            row.id, row.full_name, classNames.get(row.class_id) || '', row.guardian_name || '', row.guardian_phone || '', row.guardian_email || '', row.status
        ])));
        const { data: timetableRows, error: timetableError } = await client.from('timetable_entries')
            .select('id, class_id, weekday, start_time, end_time, subject, teacher_user_id').order('start_time');
        if (timetableError) throw timetableError;
        localStorage.setItem('ignis-timetable', JSON.stringify(timetableRows || []));

        const [{ data: assignmentRows, error: assignmentError }, { data: submissionRows, error: submissionError },
            { data: scoreRows, error: scoreError }, { data: feeRows, error: feeError },
            { data: paymentRows, error: paymentError }, { data: noticeRows, error: noticeError }] = await Promise.all([
            client.from('assignments').select('id, title, subject, description, class_id, due_at').order('created_at', { ascending: false }),
            client.from('assignment_submissions').select('assignment_id, student_id'),
            client.from('scores').select('student_id, subject, class_score, exam_score, term').order('updated_at', { ascending: false }),
            client.from('fees').select('student_id, term, amount, paid, updated_at').order('updated_at', { ascending: false }),
            client.from('payments').select('student_id, amount, method, reference, created_at, status').order('created_at', { ascending: false }),
            client.from('notices').select('id, title, body, audience, published_by, published_at').order('published_at', { ascending: false })
        ]);
        const loadError = assignmentError || submissionError || scoreError || feeError || paymentError || noticeError;
        if (loadError) throw loadError;
        const classNamesById = new Map((classRows || []).map(row => [row.id, row.name]));
        localStorage.setItem('ignis-assignments', JSON.stringify((assignmentRows || []).map(row => ({
            id: row.id, title: row.title, subject: row.subject, class: classNamesById.get(row.class_id) || '', due: row.due_at?.slice(0, 10) || '', description: row.description
        }))));
        const submissions = {};
        (submissionRows || []).forEach(row => { (submissions[row.assignment_id] ||= []).push(row.student_id); });
        localStorage.setItem('ignis-assignment-submissions', JSON.stringify(submissions));
        const scores = {};
        (scoreRows || []).forEach(row => {
            (scores[row.student_id] ||= []).push({ subject: row.subject, classScore: Number(row.class_score), examScore: Number(row.exam_score), grade: Number(row.class_score) + Number(row.exam_score) >= 80 ? 'A' : Number(row.class_score) + Number(row.exam_score) >= 60 ? 'B' : Number(row.class_score) + Number(row.exam_score) >= 45 ? 'C' : 'D', term: row.term });
        });
        localStorage.setItem('ignis-scores', JSON.stringify(scores));
        const fees = {};
        (feeRows || []).forEach(row => { if (!fees[row.student_id]) fees[row.student_id] = { term: row.term, amount: Number(row.amount), paid: Number(row.paid) }; });
        localStorage.setItem('ignis-fees', JSON.stringify(fees));
        localStorage.setItem('ignis-payments', JSON.stringify((paymentRows || []).map(row => ({ studentId: row.student_id, amount: Number(row.amount), method: row.method, reference: row.reference, createdAt: row.created_at, status: row.status }))));
        const namesById = new Map(directory.map(item => [item.user_id, item.full_name]));
        namesById.set(user.id, profile.full_name);
        localStorage.setItem('ignis-notices', JSON.stringify((noticeRows || []).map(row => ({ id: row.id, title: row.title, body: row.body, audience: row.audience, author: namesById.get(row.published_by) || 'IGNIS School', date: row.published_at.slice(0, 10) }))));
        const { data: paymentSetting } = await client.from('school_settings').select('setting_value').eq('setting_key', 'payment_settings').maybeSingle();
        localStorage.setItem('ignis-payment-settings', JSON.stringify(paymentSetting?.setting_value || { accountName: '', mtnNumber: '', telecelNumber: '' }));

        const { data: staffRows, error: staffError } = await client.from('staff_attendance').select('staff_user_id, attendance_date, status, recorded_at, latitude, longitude, zone_name, distance_meters');
        if (staffError) throw staffError;
        const directoryById = new Map([...directory, { user_id: user.id, email: user.email, full_name: profile.full_name, role: profile.role }].map(item => [item.user_id, item]));
        const staffAttendance = {};
        const checkins = [];
        (staffRows || []).forEach(row => {
            const person = directoryById.get(row.staff_user_id);
            if (!person) return;
            const date = row.attendance_date;
            staffAttendance[date] ||= {};
            staffAttendance[date][person.email] = { email: person.email, name: person.full_name, role: person.role, status: row.status, recordedAt: row.recorded_at };
            if (row.latitude !== null && row.longitude !== null) checkins.push({
                email: person.email, name: person.full_name, time: Date.parse(row.recorded_at), lat: row.latitude, lng: row.longitude,
                zoneName: row.zone_name || '', distance: row.distance_meters || 0, radius: 0, verified: true
            });
        });
        localStorage.setItem('ignis-staff-attendance', JSON.stringify(staffAttendance));
        localStorage.setItem('ignis-checkins', JSON.stringify(checkins));

        const { data: marks, error: marksError } = await client.from('student_attendance').select('student_id, attendance_date, status, recorded_at');
        if (marksError) throw marksError;
        const registers = {};
        (marks || []).forEach(mark => {
            const student = (studentRows || []).find(row => row.id === mark.student_id);
            if (!student?.class_id) return;
            const dateLabel = new Date(`${mark.attendance_date}T12:00:00`).toDateString();
            const key = `${student.class_id}::${dateLabel}`;
            registers[key] ||= {};
            registers[key][student.id] = { status: mark.status, recordedAt: mark.recorded_at };
        });
        localStorage.setItem('ignis-class-register', JSON.stringify(registers));

        sessionStorage.setItem('ignis-session', JSON.stringify({
            id: user.id,
            email: user.email,
            name: profile.full_name,
            role: profile.role,
            wardId: profile.linked_student_id || undefined,
            initials: profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('')
        }));

        sessionStorage.setItem('ignis-portal-cache', JSON.stringify({ userId: user.id, savedAt: Date.now() })); const script = document.createElement('script');
        script.src = 'portal.js';
        script.onerror = () => { document.body.innerHTML = '<p style="padding:24px;font:16px system-ui">IGNIS could not load. Refresh the page or contact support.</p>'; };
        document.body.append(script);
    } catch (error) {
        document.body.innerHTML = `<main style="max-width:600px;margin:12vh auto;padding:24px;font:16px system-ui;color:#183b42"><h1>IGNIS access error</h1><p>${String(error.message || error).replace(/[<>]/g, '')}</p><a href="index.html">Return to sign in</a></main>`;
        await client.auth.signOut();
    }
})();
