'use client';

import AttendanceApprovalsWorkspace from '@/app/components/AttendanceApprovalsWorkspace';

export default function AdminAttendanceApprovalsPage() {
  return <AttendanceApprovalsWorkspace mode="admin" backHref="/master/attendance" embedded />;
}
