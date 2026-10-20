# Native editor hint state

One source-compatible class overlay for official uiautomator2 server **0.4.0**
(`d0449b9da4b32ad28bee0d3c3f561c49010acf35`). The only behavioral change is
adding the native Android `isShowingHintText()` flag to XML nodes on API 26+.
This distinguishes a placeholder from a real user draft, even when their text is identical.
No OCR, extra Android application, accessibility permission, or input method is needed.

`AccessibilityNodeInfoDumper.java` comes from upstream `app/src/main/java/com/wetest/uia2/stub/`.
The accompanying MIT license applies. `classes.dex` contains only that class and its
inner classes. Official server classes supply all runtime dependencies.

Rebuild with JDK 17+ and Android SDK platform 34/build-tools 34.0.0:

```sh
ANDROID_HOME=/path/to/sdk node scripts/build-u2-hint.mjs
```

`prepare:u2` checks source and bytecode hashes and copies the small DEX overlay.
The desktop runner verifies its hash, loads it before the unmodified official server,
and refuses to treat a missing hint flag as an empty editor. Revalidate the overlay
against the real device before upgrading the pinned server.
