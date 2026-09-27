import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomBytes } from 'node:crypto';
import { HttpError } from './game.js';

export const SESSION_DURATION = 5 * 86400 * 1000;
export function publicUser(user) {
  return { uid:user.uid || user.sub, name:user.name || user.displayName || '', email:user.email || '' };
}
export function validateGoogleIdentity(claims, now = Date.now()) {
  if (!claims?.uid || claims.firebase?.sign_in_provider !== 'google.com' || claims.email_verified !== true) {
    throw new HttpError(401, 'Please sign in with your Google account.');
  }
  const age = now / 1000 - claims.auth_time;
  if (!Number.isFinite(age) || age < -60 || age > 300) throw new HttpError(401, 'Please sign in again to continue.');
  return claims;
}
export function createAuthentication() {
  const { FIREBASE_API_KEY:apiKey, FIREBASE_AUTH_DOMAIN:authDomain, GOOGLE_CLOUD_PROJECT:projectId, FIREBASE_APP_ID:appId } = process.env;
  if (apiKey && authDomain && projectId && appId) {
    const auth = getAuth(getApps()[0] || initializeApp({ projectId }));
    return {
      config:{ provider:'google', firebase:{apiKey,authDomain,projectId,appId} },
      async createSession(idToken) {
        if (typeof idToken !== 'string' || idToken.length > 12000) throw new HttpError(401, 'Please sign in with Google.');
        let claims;
        try { claims = await auth.verifyIdToken(idToken,true); } catch { throw new HttpError(401, 'Your sign-in expired. Please try again.'); }
        validateGoogleIdentity(claims);
        const cookie = await auth.createSessionCookie(idToken,{expiresIn:SESSION_DURATION});
        return { cookie,user:publicUser(claims) };
      },
      async verifySession(cookie) {
        const claims = await auth.verifySessionCookie(cookie,true);
        if (claims.firebase?.sign_in_provider !== 'google.com' || claims.email_verified !== true) throw new Error('Invalid provider');
        return publicUser(claims);
      },
    };
  }
  if (process.env.NODE_ENV === 'production' || process.env.DATA_BACKEND === 'gcp') {
    throw new Error('Configure FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_APP_ID, and GOOGLE_CLOUD_PROJECT.');
  }
  // Local development has no cloud credentials and never accepts this mode in production.
  const sessions = new Map();
  return {
    config:{provider:'local'},
    async createSession(token) {
      if (token !== 'local-development') throw new HttpError(401,'Use the local development sign-in.');
      const user={uid:'local-developer',name:'Local explorer',email:''}, cookie=randomBytes(32).toString('hex');
      sessions.set(cookie,{user,expires:Date.now()+SESSION_DURATION});
      return {cookie,user};
    },
    async verifySession(cookie) {
      const session=sessions.get(cookie);
      if(!session || session.expires<Date.now())throw new Error('Expired session');
      return session.user;
    },
  };
}
