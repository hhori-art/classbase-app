import { useCallback, useEffect, useRef } from 'react';

export type SoundEffectType =
  | 'answer_correct'
  | 'answer_incorrect'
  | 'button'
  | 'login_bonus'
  | 'coin_acquired'
  | 'quest_cleared'
  | 'notification';

const SOUND_FILES: Partial<Record<SoundEffectType, string>> = {
  login_bonus: '/sounds/login-bonus.mp3',
  coin_acquired: '/sounds/coin-acquired.mp3',
  quest_cleared: '/sounds/quest-cleared.mp3',
  notification: '/sounds/notification.mp3',
};

const SOUND_VOLUMES: Record<SoundEffectType, number> = {
  answer_correct: 0.35,
  answer_incorrect: 0.28,
  button: 0.18,
  login_bonus: 0.6,
  coin_acquired: 0.5,
  quest_cleared: 0.7,
  notification: 0.5,
};

type ToneStep = {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
};

const TONE_PATTERNS: Record<SoundEffectType, ToneStep[]> = {
  answer_correct: [
    { frequency: 659, duration: 0.08, type: 'sine' },
    { frequency: 880, duration: 0.12, type: 'sine' },
  ],
  answer_incorrect: [
    { frequency: 220, duration: 0.12, type: 'triangle' },
    { frequency: 165, duration: 0.16, type: 'triangle' },
  ],
  button: [
    { frequency: 520, duration: 0.04, type: 'sine', volume: 0.12 },
  ],
  login_bonus: [
    { frequency: 523, duration: 0.08, type: 'sine' },
    { frequency: 659, duration: 0.08, type: 'sine' },
    { frequency: 784, duration: 0.16, type: 'sine' },
  ],
  coin_acquired: [
    { frequency: 988, duration: 0.05, type: 'triangle' },
    { frequency: 1319, duration: 0.07, type: 'triangle' },
    { frequency: 1568, duration: 0.11, type: 'triangle' },
  ],
  quest_cleared: [
    { frequency: 523, duration: 0.08, type: 'sine' },
    { frequency: 659, duration: 0.08, type: 'sine' },
    { frequency: 784, duration: 0.08, type: 'sine' },
    { frequency: 1047, duration: 0.2, type: 'sine' },
  ],
  notification: [
    { frequency: 880, duration: 0.08, type: 'sine' },
    { frequency: 1175, duration: 0.14, type: 'sine' },
  ],
};

const isBrowser = () => typeof window !== 'undefined';
let sharedAudioContext: AudioContext | null = null;
let unlockListenersRegistered = false;
let unlocked = false;

function getAudioContext() {
  if (!isBrowser()) return null;
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContextCtor();
  }
  return sharedAudioContext;
}

function unlockAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
  resume
    .then(() => {
      if (unlocked) return;
      const gain = ctx.createGain();
      const osc = ctx.createOscillator();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      osc.frequency.setValueAtTime(20, now);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.01);
      unlocked = true;
    })
    .catch(() => {});
}

export function initSoundUnlock() {
  if (!isBrowser() || unlockListenersRegistered) return;
  unlockListenersRegistered = true;

  const options: AddEventListenerOptions = { passive: true, capture: true };
  window.addEventListener('pointerdown', unlockAudio, options);
  window.addEventListener('touchstart', unlockAudio, options);
  window.addEventListener('keydown', unlockAudio, options);
}

async function playAudioFile(type: SoundEffectType, volume: number) {
  const soundPath = SOUND_FILES[type];
  if (!soundPath || !isBrowser()) return false;

  const audio = new Audio(soundPath);
  audio.volume = volume;

  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

function playSynthSound(type: SoundEffectType, volume: number) {
  if (!isBrowser()) return;

  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const pattern = TONE_PATTERNS[type];
  let startAt = ctx.currentTime + 0.01;

  pattern.forEach(step => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const stepVolume = step.volume ?? volume;

    osc.type = step.type || 'sine';
    osc.frequency.setValueAtTime(step.frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, stepVolume), startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + step.duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + step.duration + 0.02);
    startAt += step.duration + 0.025;
  });

}

async function playBrowserSound(type: SoundEffectType) {
  const volume = SOUND_VOLUMES[type];
  playSynthSound(type, volume);

  // Optional custom audio files are supported, but synth remains the primary path
  // because it works without bundled assets and keeps feedback immediate.
  if (SOUND_FILES[type]) {
    await playAudioFile(type, Math.min(volume, 0.35));
  }
}

export function useSound(enabled: boolean = true) {
  const lastPlayedRef = useRef<Record<string, number>>({});

  useEffect(() => {
    initSoundUnlock();
  }, []);

  const play = useCallback((type: SoundEffectType) => {
    if (!enabled) return;
    if (!isBrowser()) return;

    const now = Date.now();
    if (now - (lastPlayedRef.current[type] || 0) < 80) return;
    lastPlayedRef.current[type] = now;

    playBrowserSound(type).catch(() => {});
  }, [enabled]);

  const stop = useCallback(() => {}, []);

  return { play, stop };
}

export async function playSoundEffect(
  type: SoundEffectType,
  userPreferences?: { sound_se?: boolean }
) {
  if (userPreferences?.sound_se === false) return;
  if (!isBrowser()) return;
  initSoundUnlock();

  await playBrowserSound(type).catch(() => {});
}
