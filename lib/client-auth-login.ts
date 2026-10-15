import { Auth, signInWithEmailAndPassword } from 'firebase/auth';

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export async function signInWithNetworkRetry(auth: Auth, email: string, password: string) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (error: any) {
    if (error?.code !== 'auth/network-request-failed' || navigator.onLine === false) throw error;
    await wait(700);
    return signInWithEmailAndPassword(auth, email, password);
  }
}
