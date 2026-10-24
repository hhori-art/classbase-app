'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { BookOpen, Clock, CheckCircle, ChevronRight, AlertCircle, Calendar, FileText, ExternalLink, Smartphone, Monitor } from 'lucide-react';
import { PageHeader, SectionTitle, StatusPill, EmptyState, ErrorState, ListSkeleton } from '@/app/components/ui';
import Link from 'next/link';
import { loadStudentHomework } from '@/lib/client-student-homework';
import { formatDateKeyMonthDay, formatDateKeySlash, isHomeworkOverdue, jstDateKeyOf, parseHomeworkDeadline } from '@/lib/homework-deadline';
import { monoxerPlatform, openMonoxerApp, openMonoxerWeb, type MonoxerPlatform } from '@/lib/monoxer-launch';

export default function StudentHomeworkListPage() {
  const { user, profile } = useAuth();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // 読み込みに失敗したとき「宿題なし」と見分けるためのエラー表示
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [studentInfo, setStudentInfo] = useState<{ grade: string, subjects: string[] } | null>(null);
  
  // 自分の提出状況 {課題ID: true/false}
  // 提出の状態：submitted（先生の確認待ち）・checked（確認済み）・resubmit（再提出）。
  const [submissionStatus, setSubmissionStatus] = useState<{[key:string]: string}>({});

  // 端末の種類（画面の案内と開き方を変える）。サーバー描画との差を避けるため表示後に判定する。
  const [platform, setPlatform] = useState<MonoxerPlatform>('desktop');
  useEffect(() => { setPlatform(monoxerPlatform()); }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      setLoading(true);
      setLoadError('');
      try {
        const userGrade = String(profile?.grade || '');
        const userSubjects = Array.isArray(profile?.subjects) ? profile.subjects : [];
        setStudentInfo({ grade: userGrade, subjects: userSubjects });
        setAssignments(await loadStudentHomework({ limit: 300 }));

        // 4. 自分の提出状況を取得
        const qSub = query(collection(db, 'submissions'), where('student_id', '==', user.uid));
        const subSnap = await getDocs(qSub);
        
        const statusMap: {[key:string]: string} = {};
        subSnap.forEach(d => {
          const data = d.data();
          statusMap[data.assignment_id] = String(data.status || 'submitted');
        });
        setSubmissionStatus(statusMap);

      } catch (e) {
        console.error("Data fetch error:", e);
        setLoadError('宿題を読み込めませんでした。通信状況を確認して、もう一度お試しください。');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [profile, user, reloadKey]);

  if (loading) {
    return (
      <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
        <ListSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <PageHeader
        tone="hero"
        title="Monoxer宿題"
        description="メインの宿題はMonoxerで取り組みます"
        icon={BookOpen}
        backHref="/student"
      />

      <section className="overflow-hidden rounded-card bg-slate-950 text-white shadow-card">
        <div className="p-card">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-btn bg-white/10">
              {platform === 'desktop' ? <Monitor size={28} /> : <Smartphone size={28} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold tracking-wide text-amber-200">宿題</p>
              <h2 className="mt-1 text-xl font-bold">Monoxerで宿題を進める</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                {platform === 'ios'
                  ? 'App Storeの画面が開いたら「開く」を押すと、Monoxerアプリが起動します（入っていないときは「入手」）。'
                  : platform === 'android'
                    ? 'Monoxerアプリが開きます。Google Playの画面になったら「開く」を押してください（入っていないときは「インストール」）。'
                    : 'ブラウザ版のMonoxerを新しいタブで開きます。'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openMonoxerApp(platform)}
            className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-btn bg-white px-5 py-3 text-sm font-bold text-slate-950 transition active:scale-[0.99]"
          >
            <ExternalLink size={18} aria-hidden /> {platform === 'desktop' ? 'Monoxerを開く' : 'Monoxerアプリを開く'}
          </button>
          {platform !== 'desktop' && (
            <button
              type="button"
              onClick={openMonoxerWeb}
              className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-btn border border-white/30 px-5 text-sm font-bold text-white transition hover:bg-white/10"
            >
              <Monitor size={16} aria-hidden /> アプリがうまく開かないときは、ブラウザ版で開く
            </button>
          )}
        </div>
      </section>

      <SectionTitle
        title="画像提出が必要な宿題"
        description={studentInfo ? `${studentInfo.grade}の受講科目のみ表示中` : '全ての宿題を表示中'}
      />

      {/* リスト表示 */}
      {loadError ? (
        <ErrorState title="宿題を読み込めませんでした" message={loadError} onRetry={() => setReloadKey(key => key + 1)} />
      ) : assignments.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="現在、取り組むべき宿題はありません"
          description={<>授業が終わるとここに追加されます。<br />今はゆっくり休みましょう！</>}
        />
      ) : (
        <div className="space-y-3">
          {assignments.map((assign) => {
            const submission = submissionStatus[assign.id];
            // 再提出を求められた宿題は「未提出」と同じく、出し直しが必要なものとして扱う。
            const isSubmitted = Boolean(submission) && submission !== 'resubmit';
            const needsResubmit = submission === 'resubmit';
            // 期限切れ判定（日本時間。日付だけの期限は期限日の終わりまで期限内）
            const deadline = parseHomeworkDeadline(assign.deadline);
            const isLate = isHomeworkOverdue(assign.deadline) && !isSubmitted;
            const classDateLabel = formatDateKeyMonthDay(jstDateKeyOf(assign.class_date));

            // 科目による色分け
            const subj = assign.subject || '';
            const isScience = subj.includes('理科') || ['物理','化学','生物','地学'].some(s => subj.includes(s));
            const isSociety = subj.includes('社会') || ['地理','歴史','公民'].some(s => subj.includes(s));
            const isEnglish = subj.includes('英語');
            const isMath = subj.includes('数学');

            let subjectColor = 'bg-slate-100 text-slate-600';
            if (isScience) subjectColor = 'bg-emerald-100 text-emerald-700';
            else if (isSociety) subjectColor = 'bg-amber-100 text-amber-700';
            else if (isEnglish) subjectColor = 'bg-rose-100 text-rose-700';
            else if (isMath) subjectColor = 'bg-sky-100 text-sky-700';

            return (
              <Link
                key={assign.id}
                href={`/student/homework/${assign.id}`}
                className="group block"
              >
                <div className={`cb-card p-card relative overflow-hidden transition-all duration-300 ${
                  isSubmitted
                    ? 'opacity-80 hover:opacity-100'
                    : 'hover:-translate-y-0.5 hover:!ring-2 hover:ring-accent/30'
                }`}>

                  {/* ステータスバッジ */}
                  <div className="absolute right-4 top-4">
                    {needsResubmit ? (
                      <StatusPill tone="danger" icon={<AlertCircle size={12} aria-hidden />}>再提出</StatusPill>
                    ) : submission === 'checked' ? (
                      <StatusPill tone="success" icon={<CheckCircle size={12} aria-hidden />}>確認済み</StatusPill>
                    ) : isSubmitted ? (
                      <StatusPill tone="success" icon={<CheckCircle size={12} aria-hidden />}>提出済み</StatusPill>
                    ) : isLate ? (
                      <StatusPill tone="danger" icon={<AlertCircle size={12} aria-hidden />}>期限切れ</StatusPill>
                    ) : (
                      <StatusPill tone="accent" icon={<Clock size={12} aria-hidden />}>受付中</StatusPill>
                    )}
                  </div>

                  <div className="pr-24">
                    {/* 科目ラベル & 授業日 */}
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`inline-block rounded-input px-2.5 py-1 text-xs font-bold ${subjectColor}`}>
                        {assign.subject || '一般'}
                      </span>
                      {classDateLabel && (
                        <span className="text-xs font-medium text-fg-muted">
                          {classDateLabel} 授業分
                        </span>
                      )}
                    </div>

                    <h3 className="mb-3 line-clamp-2 text-lg font-bold leading-tight text-fg transition-colors group-hover:text-accent">
                      {assign.title}
                    </h3>

                    <div className="inline-flex items-center gap-2 rounded-input bg-slate-50 px-3 py-1.5 text-xs font-bold text-fg-muted">
                      <Calendar size={14} className={isLate ? 'text-danger' : 'text-accent'} aria-hidden />
                      <span className={isLate ? 'text-danger' : ''}>
                        期限: {formatDateKeySlash(deadline.dateKey) || '未設定'}{deadline.time ? ` ${deadline.time}` : ''} まで
                      </span>
                    </div>
                  </div>

                  {/* 矢印アイコン */}
                  <div className="absolute bottom-4 right-4 text-slate-300 transition-colors group-hover:text-accent">
                    <ChevronRight size={24} strokeWidth={3} aria-hidden />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
