import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertInputVersionProgress,
  readInputArtifact,
} from './input-artifact.mjs';

test('desktop input artifact has a valid signed APK and certificate manifest', async () => {
  const input = await readInputArtifact();
  assert.ok(input.bytes.length > 0);
  assert.match(input.certificateSha256, /^[a-f0-9]{64}$/);
  assert.equal(input.applicationId, 'com.por.auto.input');
});

test('native component updates cannot silently reuse or decrease their version number', () => {
  const previous = { versionCode: 1, sha256: 'old' };
  assert.doesNotThrow(() => assertInputVersionProgress(previous, previous));
  assert.throws(
    () =>
      assertInputVersionProgress(previous, {
        versionCode: 1,
        sha256: 'new',
      }),
    /increment versionCode/,
  );
  assert.throws(
    () =>
      assertInputVersionProgress(previous, {
        versionCode: 0,
        sha256: 'old',
      }),
    /cannot decrease/,
  );
  assert.doesNotThrow(() =>
    assertInputVersionProgress(previous, {
      versionCode: 2,
      sha256: 'new',
    }),
  );
});
