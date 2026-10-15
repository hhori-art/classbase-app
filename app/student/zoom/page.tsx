import { redirect } from 'next/navigation';

export default async function LegacyStudentZoomPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  Object.entries((await searchParams) || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(item => params.append(key, item));
    } else if (value) {
      params.set(key, value);
    }
  });
  redirect(`/zoom-meeting?${params.toString()}`);
}
