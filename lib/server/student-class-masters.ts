import 'server-only';

import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';

/** 生徒向け授業・振替判定で共通利用する、更新頻度の低いマスタ。 */
export const loadStudentClassMasters = unstable_cache(async () => {
  const db = adminDb();
  const [optionSnap, curriculumSnap, testPrepOptionSnap, classButtonSettingsSnap] = await Promise.all([
    db.collection('course_registration_options').limit(1000).get(),
    db.collection('annual_curriculum_schedules').limit(1500).get(),
    db.collection('test_prep_course_options').where('is_active', '==', true).limit(500).get(),
    db.collection('settings').doc('class_button').get(),
  ]);
  return {
    optionDocs: optionSnap.docs.map(doc => ({ id: doc.id, data: doc.data() })),
    curriculumDocs: curriculumSnap.docs.map(doc => ({ id: doc.id, data: doc.data() })),
    testPrepOptionDocs: testPrepOptionSnap.docs.map(doc => ({ id: doc.id, data: doc.data() })),
    classButtonSettingsData: classButtonSettingsSnap.exists ? classButtonSettingsSnap.data() : {},
  };
}, ['student-class-masters-v1'], {
  revalidate: 300,
  tags: ['course-registration-options', 'student-class-masters'],
});
