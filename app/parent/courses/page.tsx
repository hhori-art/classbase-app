'use client';

import { useEffect, useState } from 'react';
import { ListChecks, Users } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { ParentEmpty, ParentPageHeader } from '@/app/components/parent/ParentUI';
import ChildSwitcher, { pickChildId } from '@/app/components/parent/ChildSwitcher';
import { ErrorState, ListSkeleton } from '@/app/components/ui';
import CourseChangeFlow, { type CourseChangeStudent } from '@/app/components/course-registration/CourseChangeFlow';

type Student = CourseChangeStudent & { student_name?: string };

/** 保護者がお子さまの受講講座を登録・変更する画面。保存するとお子さまと他の保護者へ通知される。 */
export default function ParentCoursesPage() {
  const { user } = useAuth();
  // 教室が「受講講座の登録・変更」を非表示にしているときは開かない（メニューからも消える）。
  const { visibility } = usePortalVisibility('parent');
  const hidden = visibility.courseRegistration === false;
  const [students, setStudents] = useState<Student[] | null>(null);
  const [studentId, setStudentId] = useState('');
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setError(false);
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
        if (active) setError(true);
      }
    })();
    return () => { active = false; };
  }, [user, reload]);

  const current = students?.find(student => student.id === studentId) || null;

  return (
    <div className="space-y-5">
      <ParentPageHeader
        title="受講講座の登録・変更"
        description={current?.student_name
          ? `${current.student_name}さんの受講講座を選びます。保存するとすぐに反映され、お子さまにもお知らせします。`
          : '保存するとすぐに反映され、お子さまにもお知らせします。'}
        icon={ListChecks}
        backHref="/parent"
      />
      {!hidden && students && students.length > 1 && (
        <ChildSwitcher options={students.map(student => ({ id: student.id, name: student.student_name, grade: student.grade }))} value={studentId} onChange={setStudentId} />
      )}
      {hidden ? (
        <ParentEmpty icon={ListChecks} title="受講講座の登録・変更は現在受け付けていません" description="変更をご希望の場合は、教室への連絡からお知らせください。" />
      ) : error ? (
        <ErrorState title="お子さまの情報を読み込めませんでした" onRetry={() => setReload(value => value + 1)} />
      ) : !students ? (
        <ListSkeleton rows={4} />
      ) : students.length === 0 || !current ? (
        <ParentEmpty icon={Users} title="お子さまが登録されていません" description="教室にお問い合わせください。" />
      ) : (
        <CourseChangeFlow key={current.id} student={current} viewer="parent" studentName={current.student_name} className="space-y-5" />
      )}
    </div>
  );
}
