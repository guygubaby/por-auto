import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {readInputArtifact,assertInputVersionProgress} from './input-artifact.mjs';

test('mobile installer carries exactly the signed native input artifact with the same version and certificate',async()=>{
  const input=await readInputArtifact();
  const module={exports:{}};
  vm.runInNewContext(await readFile(new URL('../mobile-workflows/wechat-suite/src/input-apk.js',import.meta.url),'utf8'),{module});
  const payload=module.exports,bytes=Buffer.from(payload.base64,'base64');
  assert.equal(payload.versionCode,input.versionCode);assert.equal(payload.certificateSha256,input.certificateSha256);
  assert.equal(bytes.length,payload.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),payload.sha256);
  assert.deepEqual(bytes,input.bytes);
});
test('native component updates cannot silently reuse or decrease their version number',()=>{
  const previous={versionCode:1,sha256:'old'};
  assert.doesNotThrow(()=>assertInputVersionProgress(previous,previous));
  assert.throws(()=>assertInputVersionProgress(previous,{versionCode:1,sha256:'new'}),/increment versionCode/);
  assert.throws(()=>assertInputVersionProgress(previous,{versionCode:0,sha256:'old'}),/cannot decrease/);
  assert.doesNotThrow(()=>assertInputVersionProgress(previous,{versionCode:2,sha256:'new'}));
});
