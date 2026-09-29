import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

async function scenario(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tripguessr-deploy-'));
  try {
    const commands = {
      gh: '#!/bin/bash\nprintf "%s\\n" "${TEST_HEAD:-$GITHUB_SHA}"\n',
      node: '#!/bin/bash\necho health >> "$TEST_LOG"\nexit "${TEST_HEALTH_STATUS:-0}"\n',
      gcloud: `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$*" in
  *"services describe"*)
    if [[ -f "$TEST_STATE" ]]; then cat "$TEST_STATE"; else printf '%s\\n' '{"status":{"url":"https://origin.example","traffic":[{"revisionName":"old-good","percent":100}]}}'; fi ;;
  *"run deploy"*) exit "\${TEST_DEPLOY_STATUS:-0}" ;;
  *"update-traffic"*"gh-123-1=100"*)
    printf '%s\\n' '{"status":{"traffic":[{"revisionName":"travelguesser-gh-123-1","percent":100}]}}' > "$TEST_STATE" ;;
esac
`,
    };
    for (const [name, content] of Object.entries(commands))
      await writeFile(join(dir, name), content, { mode: 0o755 });
    const log = join(dir, 'log');
    await writeFile(log, '');
    const result = spawnSync('bash', [resolve('scripts/deploy-ci.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GCP_PROJECT_ID: 'test-project',
        GCP_REGION: 'europe-central2',
        CLOUD_RUN_SERVICE: 'travelguesser',
        DEPLOY_IMAGE: 'registry.example/app@sha256:abc',
        PUBLIC_URL: 'https://public.example',
        GITHUB_SHA: 'abc123',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_STEP_SUMMARY: join(dir, 'summary'),
        TEST_LOG: log,
        TEST_STATE: join(dir, 'state'),
        ...extra,
      },
    });
    return { ...result, log: await readFile(log, 'utf8') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test('deployment promotes the tested image and verifies the public service', async () => {
  const r = await scenario();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /run deploy travelguesser --image=registry.example\/app@sha256:abc/);
  assert.match(r.log, /--to-revisions=travelguesser-gh-123-1=100/);
  assert.match(r.log, /health/);
  assert.doesNotMatch(r.log, /--to-revisions=old-good=100/);
  assert.doesNotMatch(r.log, /--set-env-vars|--memory|--max-instances|--allow-unauthenticated/);
});
test('failed post-deployment verification restores previous traffic and fails CI', async () => {
  const r = await scenario({ TEST_HEALTH_STATUS: '1' });
  assert.equal(r.status, 1);
  assert.match(r.log, /--to-revisions=old-good=100/);
});
test('a failed revision creation leaves the existing traffic untouched', async () => {
  const r = await scenario({ TEST_DEPLOY_STATUS: '1' });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.log, /update-traffic|health/);
});
test('an older commit never deploys over a newer main commit', async () => {
  const r = await scenario({ TEST_HEAD: 'newer123' });
  assert.equal(r.status, 0);
  assert.equal(r.log, '');
});
