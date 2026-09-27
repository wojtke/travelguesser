// Adds Firebase to the current project, enables Google sign-in, and writes private deployment config.
// PROJECT_ID=... SUPPORT_EMAIL=... node scripts/configure-auth.mjs
// After deploying: PROJECT_ID=... node scripts/configure-auth.mjs --domains https://your-service-url
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {accessToken} from './admin-cloud.mjs';

const project=process.env.PROJECT_ID;
if(!project)throw new Error('Set PROJECT_ID.');
const token=accessToken();
async function request(url,method='GET',body){
  const res=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'x-goog-user-project':project,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const data=await res.json();
  if(!res.ok)throw new Error(`${res.status}: ${data.error?.message||'Google API request failed'}`);
  return data;
}
async function waitOperation(operation){
  while(!operation.done){await new Promise(resolve=>setTimeout(resolve,1500));operation=await request(`https://firebase.googleapis.com/v1beta1/${operation.name}`);}
  if(operation.error)throw new Error(operation.error.message);
}
const authUrl=`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
if(process.argv.includes('--domains')){
  const domains=process.argv.slice(process.argv.indexOf('--domains')+1).map(url=>new URL(url).hostname);
  const current=await request(authUrl);
  await request(`${authUrl}?updateMask=authorizedDomains`,'PATCH',{authorizedDomains:[...new Set([...current.authorizedDomains,...domains])]});
  console.log('Google sign-in domains configured.');
}else{
  if(!process.env.SUPPORT_EMAIL)throw new Error('Set SUPPORT_EMAIL to a project owner’s Google account.');
  try{await request(`https://firebase.googleapis.com/v1beta1/projects/${project}`);}catch(e){if(!e.message.startsWith('404:'))throw e;await waitOperation(await request(`https://firebase.googleapis.com/v1beta1/projects/${project}:addFirebase`,'POST',{}));}
  const apps=await request(`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`);
  let app=apps.apps?.find(a=>a.displayName==='TravelGuesser Web');
  if(!app){await waitOperation(await request(`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`,'POST',{displayName:'TravelGuesser Web'}));app=(await request(`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`)).apps.find(a=>a.displayName==='TravelGuesser Web');}
  const config=await request(`https://firebase.googleapis.com/v1beta1/${app.name}/config`);
  await mkdir('.local/firebase-setup',{recursive:true,mode:0o700});
  await writeFile('.local/firebase-config.json',JSON.stringify(config,null,2),{mode:0o600});
  await writeFile('.local/firebase-setup/firebase.json',JSON.stringify({auth:{providers:{anonymous:false,emailPassword:false,googleSignIn:{oAuthBrandDisplayName:'TravelGuesser',supportEmail:process.env.SUPPORT_EMAIL}}}}),{mode:0o600});
  const run=spawnSync('npm',['exec','--yes','--package=firebase-tools@15.31.0','--','firebase','deploy','--only','auth','--project',project,'--non-interactive'],{cwd:'.local/firebase-setup',env:{...process.env,FIREBASE_TOKEN:token,GOOGLE_CLOUD_QUOTA_PROJECT:project},stdio:'inherit'});
  if(run.status!==0)throw new Error('Firebase Auth deployment failed.');
  const current=await request(authUrl);
  await request(`${authUrl}?updateMask=authorizedDomains,signIn.anonymous.enabled,signIn.email.enabled`,'PATCH',{authorizedDomains:[...new Set([...current.authorizedDomains,'localhost','127.0.0.1'])],signIn:{anonymous:{enabled:false},email:{enabled:false}}});
}
const config=JSON.parse(await readFile('.local/firebase-config.json','utf8'));
await writeFile('.local/runtime-env.json',JSON.stringify({DATA_BACKEND:'gcp',GOOGLE_CLOUD_PROJECT:project,PHOTO_BUCKET:process.env.PHOTO_BUCKET||`${project}-photos`,FIREBASE_API_KEY:config.apiKey,FIREBASE_AUTH_DOMAIN:config.authDomain,FIREBASE_APP_ID:config.appId}),{mode:0o600});
