'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ParentEmpty, ParentPageHeader } from '@/app/components/parent/ParentUI';
import ChildSwitcher, { pickChildId } from '@/app/components/parent/ChildSwitcher';
import { ButtonLink, ErrorState, ListSkeleton } from '@/app/components/ui';
import TimetableView from '@/app/components/timetable/TimetableView';
import type { StudentTimetable } from '@/lib/timetable';

type Student = { id: string; student_name?: string; grade?: string };

/** 保護者向けの時間割。紐づいているお子さまごとに、毎週の授業と2週間の予定（休講つき）を表示する。 */
export default function ParentTimetablePage() {
  const { user } = useAuth();
  const [students, setStudents] = useState<Student[] | null>(null);
  const [studentId, setStudentId] = useState('');
  const [studentsError, setStudentsError] = useState(false);
  const [studentsReload, setStudentsReload] = useState(0);
  const [data, setData] = useState<StudentTimetable | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setStudentsError(false);
    (async () => {
      try {
        const res = await fetch('/api/parent/dashboard', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.error || 'students-failed');
        if (!active) return;
        const list: Student[] = Array.isArray(body.students) ? body.students : [];
        setStudents(list);
        setStudentId(current => pickChildId(user.uid, list.map(student => student.id), current));
      } catch {
        if (active) setStudentsError(true);
      }
    })();
    return () => { active = false; };
  }, [user, studentsReload]);

  useEffect(() => {
    if (!user || !studentId) return;
    let active = true;
    setData(null);
    setError(false);
    (async () => {
      try {
        const res = await fetch(`/api/parent/timetable?student_id=${encodeURIComponent(studentId)}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.error || 'timetable-failed');
        if (active) setData(body as StudentTimetable);
      } catch {
        if (active) setError(true);
      }
    })();
    return () => { active = false; };
  }, [user, studentId, reload]);

  const current = students?.find(student => student.id === studentId);

  return (
    <div className="space-y-5">
      <ParentPageHeader
        title="時間割"
        description={current?.student_name ? `${current.student_name}さんの毎週の授業と、今後2週間の予定です。` : 'お子さまの毎週の授業と、今後2週間の予定です。'}
        icon={CalendarDays}
        backHref="/parent"
        actions={<ButtonLink href="/parent/courses" variant="secondary" className="no-underline">受講講座を変更する</ButtonLink>}
      />
      {students && students.length > 1 && (
        <ChildSwitcher options={students.map(student => ({ id: student.id, name: student.student_name, grade: student.grade }))} value={studentId} onChange={setStudentId} />
      )}
      {studentsError ? (
        <ErrorState title="お子さまの情報を読み込めませんでした" onRetry={() => setStudentsReload(value => value + 1)} />
      ) : !students ? (
        <ListSkeleton rows={4} />
      ) : students.length === 0 ? (
        <ParentEmpty icon={Users} title="お子さまが登録されていません" description="教室にお問い合わせください。" />
      ) : error ? (
        <ErrorState title="時間割を読み込めませんでした" onRetry={() => setReload(value => value + 1)} />
      ) : !data ? (
        <ListSkeleton rows={4} />
      ) : (
        <TimetableView data={data} audience="parent" />
      )}
    </div>
  );
}
