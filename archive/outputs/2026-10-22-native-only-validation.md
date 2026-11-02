# Native accessibility-only validation (WeCom)

> Historical device evidence captured before the code-review fixes. The current mobile package is `1.0.12 / 58`; current automated checks and remaining acceptance work are recorded in [review fixes](2026-10-22-review-fixes.md). The device send and old installer evidence below must not be treated as validation of the new source or package 58.

## Scope

The product scope is now WeCom only. All ordinary WeChat desktop workflows, the WeChat mobile package, their registry entries and their generated release assets were removed. Previously installed WeChat workflows disappear from the workspace, and their linked schedules are paused without deleting history.

The supported recipient choices are:

- all direct chats from the WeCom `全部` category;
- all groups from the WeCom `群聊` category;
- both categories, deduplicated by full title.

New category runs do not perform global search for each recipient.

## Automated checks

| Check | Result |
| --- | --- |
| Mobile core and packaging | 38 / 38 |
| React/Vitest | 8 / 8 |
| Playwright | 4 / 4 |
| Go race tests | `go test -race ./internal/...` |
| TypeScript and Vite production build | passed |
| Mobile bundle/hash/syntax check | 2 packages passed |
| Asset preparation | input, ADB, u2 overlay and mobile bundle hashes passed |

The mobile catalog contained the harmless `demo-hello` package and `wecom-suite` only. The WeCom mobile package tested at that point was `1.0.10 / 56`.

## Real-device formal send

Device: vivo X21, Android 9, WeCom 5.0.12.

On 2026-10-22 at 13:46 CST, the desktop Go execution path selected `全部群聊` and sent this manual message once to the account's complete group list:

```text
【Por Auto 验收】企业微信自动发送测试 2026-10-22 13:46，可忽略。
```

Observed evidence:

- The complete group inventory contained one group: `ajfjfjfh`.
- The workflow opened the category row directly and rechecked the chat title.
- The message was written and fully read back before the unique send button was used.
- `events.jsonl` records `send_requested`.
- The post-send native tree contains the exact message text and an empty editor.
- The runner did not retry. There is exactly one test message in the group.

Evidence:

- `work/go-device-cache/wecom-formal-send-20261022/runs/1792647986044/`
- `work/go-device-cache/wecom-formal-send-20261022/sent-message-readback.json`

### Detector correction

The first run reported `uncertain` because the WeCom 5.0.12 profile mapped the outgoing-message selector to `iuc`, a resource used by timestamps and system notices. The real message-body node is `ith`.

After the UI was independently inspected, the desktop and mobile profiles were corrected to use `ith`. A new regression test confirms that the timestamp node is ignored and the actual message body is returned as outgoing. A read-only live-device test then observed the exact sent message, the correct chat title and an empty input box. No second message was sent.

The live readback passed:

```text
PASS sent message readback; title=ajfjfjfh
```

## Remaining scope

- The send is verified from the sender's native UI. Delivery to another member's device or read receipts are not verified by this test.
- WeCom direct mode remains unit-tested; this account has no direct-chat target distinct from the group.
- Windows execution is still build-only.
- Long-running mobile schedules and remote-network HTTP delivery remain separate acceptance cases.

## Local deliverables

- Apple Silicon DMG: `build/darwin-arm64/Por Auto 0.4.0 arm64.dmg`
- AutoJs6 bootstrap: `deliverables/PorAuto-AutoJs6-bootstrap.js`
- Mobile offline bundle: `deliverables/PorAuto-mobile-scripts.json`

The Windows installer and signed release archives still require their platform-specific release workflow.
