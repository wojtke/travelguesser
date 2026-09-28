import { randomBytes } from 'node:crypto';
import { HttpError } from '../server/game.js';

export function testAuthentication() {
  const sessions = new Map();
  return {
    config: {
      provider: 'google',
      firebase: {
        apiKey: 'test-public-config',
        authDomain: 'example.firebaseapp.com',
        projectId: 'test-project',
        appId: 'test-app',
      },
    },
    sessions,
    async createSession(token) {
      if (typeof token !== 'string' || !token.startsWith('creator-'))
        throw new HttpError(401, 'Invalid sign-in.');
      const user = { uid: token, name: token, email: `${token}@example.test` },
        cookie = randomBytes(32).toString('hex');
      sessions.set(cookie, user);
      return { cookie, user };
    },
    async verifySession(cookie) {
      if (!sessions.has(cookie)) throw new Error('Invalid or revoked session');
      return sessions.get(cookie);
    },
  };
}
export async function signIn(agent, uid = 'creator-a') {
  const session = await agent.get('/api/session').expect(200);
  agent.set('X-CSRF-Token', session.body.csrfToken);
  return agent.post('/api/auth/session').send({ idToken: uid }).expect(200);
}
