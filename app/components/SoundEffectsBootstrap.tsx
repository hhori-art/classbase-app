'use client';

import { useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { useSound } from '@/lib/sound';

function isInteractiveElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const element = target.closest(
    'button, a, [role="button"], input[type="checkbox"], input[type="radio"], select, summary, [data-sound-click]'
  );
  if (!element) return false;
  if (element.closest('[data-sound="off"]')) return false;
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  if (element instanceof HTMLInputElement && element.disabled) return false;
  if (element instanceof HTMLSelectElement && element.disabled) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

export default function SoundEffectsBootstrap() {
  const { profile } = useAuth();
  const enabled = profile?.settings?.sound_se !== false;
  const { play } = useSound(enabled);

  useEffect(() => {
    if (!enabled) return;

    const handlePointerUp = (event: PointerEvent) => {
      if (isInteractiveElement(event.target)) play('button');
    };

    window.addEventListener('pointerup', handlePointerUp, true);
    return () => window.removeEventListener('pointerup', handlePointerUp, true);
  }, [enabled, play]);

  return null;
}
