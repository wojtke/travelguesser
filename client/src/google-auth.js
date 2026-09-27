import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, inMemoryPersistence, setPersistence, signInWithPopup, signOut } from 'firebase/auth';
import { api, json } from './api';

export async function prepareGoogleSignIn(config) {
  const auth=getAuth(getApps()[0] || initializeApp(config));
  await setPersistence(auth,inMemoryPersistence);
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  return async()=>{
    try {
      const result=await signInWithPopup(auth,provider);
      const idToken=await result.user.getIdToken();
      return await api('/auth/session',json('POST',{idToken}));
    } catch(error) {
      const messages={
        'auth/popup-closed-by-user':'Sign-in was closed. You can try again whenever you’re ready.',
        'auth/popup-blocked':'Please allow the Google sign-in popup for this site, then try again.',
        'auth/cancelled-popup-request':'Another sign-in window is already open.',
        'auth/network-request-failed':'Couldn’t reach Google. Check your connection and try again.',
      };
      throw new Error(messages[error.code] || error.message || 'Sign-in failed. Please try again.');
    } finally {
      // The server's HttpOnly cookie is the app session; no Google token is kept in browser storage.
      await signOut(auth).catch(()=>{});
    }
  };
}
