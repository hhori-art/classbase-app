import NotificationsClient from '@/app/components/NotificationsClient';
import StudentCourseRegistrationPrompt from '@/app/components/StudentCourseRegistrationPrompt';

export default function StudentNotificationsPage() {
  return <><div className="mx-auto max-w-3xl px-4 pt-4"><StudentCourseRegistrationPrompt mode="notification" /></div><NotificationsClient backHref="/student" /></>;
}
