// Operator tools use your existing gcloud login, never downloaded service-account keys.
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {OAuth2Client} from 'google-auth-library';
import {Firestore} from '@google-cloud/firestore';
import {Storage} from '@google-cloud/storage';
import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';

export function accessToken() {
  return execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim();
}
export function operatorClients(projectId) {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT=projectId;
  const token=accessToken();
  // Firestore's gRPC stack and Storage currently use different auth header interfaces.
  // Give each SDK an OAuth client from its compatible library version.
  const gaxRequire=createRequire(import.meta.resolve('google-gax'));
  const {OAuth2Client:GrpcOAuth2Client}=gaxRequire('google-auth-library');
  const grpcAuth=new GrpcOAuth2Client({quotaProjectId:projectId});
  grpcAuth.setCredentials({access_token:token,expiry_date:Date.now()+50*60*1000});
  const authClient=new OAuth2Client({quotaProjectId:projectId});
  authClient.setCredentials({access_token:token,expiry_date:Date.now()+50*60*1000});
  const options={projectId,authClient};
  const app=initializeApp({projectId,credential:{getAccessToken:async()=>({access_token:accessToken(),expires_in:3000})}},`operator-${Date.now()}`);
  return {db:new Firestore({projectId,authClient:grpcAuth}),storage:new Storage(options),auth:getAuth(app)};
}
