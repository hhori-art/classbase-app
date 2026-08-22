import { redirect } from 'next/navigation';

export default function LegacyStudentZoomPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(item => params.append(key, item));
    } else if (value) {
      params.set(key, value);
    }
  });
  redirect(`/zoom-meeting?${params.toString()}`);
}
