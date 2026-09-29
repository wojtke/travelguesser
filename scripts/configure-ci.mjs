// One-time operator setup. Uses the existing gh/gcloud logins, never a service-account key.
// PROJECT_ID=... DEPLOY_REPOSITORY=owner/repo node scripts/configure-ci.mjs [--apply]
import { execFileSync } from 'node:child_process';
const project = process.env.PROJECT_ID;
const repo = process.env.DEPLOY_REPOSITORY;
const region = process.env.DEPLOY_REGION || 'europe-central2';
const service = 'travelguesser';
const registry = 'cloud-run-source-deploy';
const pool = 'tripguessr-github';
const provider = 'github';
const account = `tripguessr-github-deploy@${project}.iam.gserviceaccount.com`;
if (
  !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project || '') ||
  !/^[\w.-]+\/[\w.-]+$/.test(repo || '') ||
  !/^[a-z]+-[a-z]+\d$/.test(region)
)
  throw Error('Set valid PROJECT_ID, DEPLOY_REPOSITORY and optionally DEPLOY_REGION.');
const call = (command, args, json = false) => {
  const text = execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  return json ? JSON.parse(text) : text;
};
const exists = (args) => {
  try {
    execFileSync('gcloud', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const repository = call('gh', ['api', `repos/${repo}`], true);
const number = call('gcloud', ['projects', 'describe', project, '--format=value(projectNumber)']);
const runtime = call('gcloud', [
  'run',
  'services',
  'describe',
  service,
  `--region=${region}`,
  `--project=${project}`,
  '--format=value(spec.template.spec.serviceAccountName)',
]);
const providerName = `projects/${number}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`;
const condition = `assertion.repository_id == '${repository.id}' && assertion.repository_owner_id == '${repository.owner.id}' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '${repo}/.github/workflows/ci.yml@refs/heads/main' && (assertion.event_name == 'push' || assertion.event_name == 'workflow_dispatch')`;
console.log(
  JSON.stringify(
    {
      project,
      repo,
      providerName,
      account,
      runtime,
      condition,
      roles: {
        service: 'roles/run.developer',
        runtime: 'roles/iam.serviceAccountUser',
        registry: 'roles/artifactregistry.writer',
        quota: 'roles/serviceusage.serviceUsageConsumer',
      },
    },
    null,
    2,
  ),
);
if (!process.argv.includes('--apply')) {
  console.log('Preview only. Add --apply to configure.');
  process.exit(0);
}
const common = [`--project=${project}`, '--quiet'];
call('gcloud', [
  'services',
  'enable',
  'iamcredentials.googleapis.com',
  'sts.googleapis.com',
  ...common,
]);
if (!exists(['iam', 'service-accounts', 'describe', account, ...common]))
  call('gcloud', [
    'iam',
    'service-accounts',
    'create',
    'tripguessr-github-deploy',
    '--display-name=TripGuessr GitHub deployer',
    ...common,
  ]);
if (!exists(['iam', 'workload-identity-pools', 'describe', pool, '--location=global', ...common]))
  call('gcloud', [
    'iam',
    'workload-identity-pools',
    'create',
    pool,
    '--location=global',
    '--display-name=TripGuessr GitHub',
    ...common,
  ]);
const providerArgs = [
  provider,
  '--location=global',
  `--workload-identity-pool=${pool}`,
  '--issuer-uri=https://token.actions.githubusercontent.com',
  '--attribute-mapping=google.subject=assertion.sub,attribute.repository_id=assertion.repository_id',
  `--attribute-condition=${condition}`,
  ...common,
];
const providerExists = exists([
  'iam',
  'workload-identity-pools',
  'providers',
  'describe',
  provider,
  '--location=global',
  `--workload-identity-pool=${pool}`,
  ...common,
]);
call('gcloud', [
  'iam',
  'workload-identity-pools',
  'providers',
  providerExists ? 'update-oidc' : 'create-oidc',
  ...providerArgs,
]);
call('gcloud', [
  'iam',
  'service-accounts',
  'add-iam-policy-binding',
  account,
  '--role=roles/iam.workloadIdentityUser',
  `--member=principalSet://iam.googleapis.com/projects/${number}/locations/global/workloadIdentityPools/${pool}/attribute.repository_id/${repository.id}`,
  ...common,
]);
const member = `--member=serviceAccount:${account}`;
call('gcloud', [
  'run',
  'services',
  'add-iam-policy-binding',
  service,
  `--region=${region}`,
  member,
  '--role=roles/run.developer',
  ...common,
]);
call('gcloud', [
  'iam',
  'service-accounts',
  'add-iam-policy-binding',
  runtime,
  member,
  '--role=roles/iam.serviceAccountUser',
  ...common,
]);
call('gcloud', [
  'artifacts',
  'repositories',
  'add-iam-policy-binding',
  registry,
  `--location=${region}`,
  member,
  '--role=roles/artifactregistry.writer',
  ...common,
]);
call('gcloud', [
  'projects',
  'add-iam-policy-binding',
  project,
  member,
  '--role=roles/serviceusage.serviceUsageConsumer',
  '--condition=None',
  '--quiet',
]);
const variables = {
  GCP_PROJECT_ID: project,
  GCP_REGION: region,
  GCP_WORKLOAD_IDENTITY_PROVIDER: providerName,
  GCP_DEPLOY_SERVICE_ACCOUNT: account,
  GCP_ARTIFACT_REPOSITORY: registry,
  CLOUD_RUN_SERVICE: service,
  PUBLIC_URL: 'https://tripguessr.com',
};
for (const [name, value] of Object.entries(variables))
  call('gh', ['variable', 'set', name, '--repo', repo, '--body', value]);
console.log('Configured keyless, main-branch deployment and repository variables.');
