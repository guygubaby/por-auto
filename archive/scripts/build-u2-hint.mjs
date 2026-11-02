import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = new URL('../native/u2-hint/', import.meta.url);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw Error('Set ANDROID_HOME to an installed Android SDK (platform 34, build-tools 34.0.0).');
const build = await mkdtemp(join(tmpdir(), 'por-u2-hint-'));
const source = await readFile(new URL('AccessibilityNodeInfoDumper.java', root));
const stubs = {
  'androidx/annotation/RequiresApi.java': 'package androidx.annotation; public @interface RequiresApi { int value(); }',
  'androidx/test/uiautomator/UiDevice.java': 'package androidx.test.uiautomator; public class UiDevice { public static UiDevice getInstance(android.app.Instrumentation i){return null;} public android.app.UiAutomation getUiAutomation(){return null;} public void waitForIdle(){} public int getDisplayRotation(){return 0;} public int getDisplayWidth(){return 0;} public int getDisplayHeight(){return 0;} }',
  'uiautomator/InstrumentShellWrapper.java': 'package uiautomator; public class InstrumentShellWrapper extends android.app.Instrumentation { public static InstrumentShellWrapper getInstance(){return null;} }',
  'com/wetest/uia2/stub/AccessibilityNodeInfoHelper.java': 'package com.wetest.uia2.stub; class AccessibilityNodeInfoHelper { static android.graphics.Rect getVisibleBoundsInScreen(android.view.accessibility.AccessibilityNodeInfo n,int w,int h,boolean t){return null;} }',
};
try {
  const files = [];
  for (const [name, text] of Object.entries(stubs)) {
    const file = join(build, name); await mkdir(resolve(file, '..'), { recursive: true }); await writeFile(file, text); files.push(file);
  }
  const file = join(build, 'com/wetest/uia2/stub/AccessibilityNodeInfoDumper.java');
  await writeFile(file, source); files.push(file);
  const classes = join(build, 'classes'); await mkdir(classes);
  const java = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name) : name;
  const android = join(sdk, 'platforms/android-34/android.jar');
  execFileSync(java('javac'), ['-source', '8', '-target', '8', '-cp', android, '-d', classes, ...files], { stdio: 'inherit' });
  // Compile-time stubs never enter the overlay; every dependency comes from the pinned official server.
  const folder = join(classes, 'com/wetest/uia2/stub');
  const entries = (await readdir(folder)).filter(n => n.startsWith('AccessibilityNodeInfoDumper')).sort();
  const dex = join(build, 'dex'); await mkdir(dex);
  execFileSync(java('java'), ['-cp', join(sdk, 'build-tools/34.0.0/lib/d8.jar'), 'com.android.tools.r8.D8', '--min-api', '21', '--lib', android, '--output', dex, ...entries.map(n => join(folder, n))], { stdio: 'inherit' });
  await writeFile(new URL('classes.dex', root), await readFile(join(dex, 'classes.dex')));
  const sha = b => createHash('sha256').update(b).digest('hex');
  await writeFile(new URL('manifest.json', root), JSON.stringify({ upstream: 'd0449b9da4b32ad28bee0d3c3f561c49010acf35', sourceSha256: sha(source), dexSha256: sha(await readFile(join(dex, 'classes.dex'))) }, null, 2) + '\n');
} finally { await rm(build, { recursive: true, force: true }); }
