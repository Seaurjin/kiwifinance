# The native iOS shell

Three things the PRD asks for have no React Native equivalent, because each
one runs in its own process outside the app:

| | What it is | Source |
|---|---|---|
| **FR-CAP-05** | Share Extension — send a screenshot, a photo or some text to Kiwi from any app | `KiwiShareExtension/` |
| **FR-CAP-06** | App Intents — Siri, Shortcuts, and Back Tap | `KiwiIntents/` |
| **FR-CAP-07** | WidgetKit — today's allowance on the home and lock screens | `KiwiWidget/` |

All three funnel into the **same capture path the app uses**: extract, then
commit, through the same API. Nothing here writes to a ledger directly and
nothing here computes a figure — the widget reads `daily_allowance` out of a
fact set the engine produced, and an intent that records a purchase leaves it
in the review queue for a person to confirm.

> **Not compiled.** These sources were written in an environment with no macOS
> and no Swift toolchain, so they have never been built or run. Treat the first
> `⌘B` as part of the work. The TypeScript side (`../../src/native/shell.ts`
> and its wiring in `../../App.tsx`) *is* typechecked by `pnpm typecheck`.

## Why the files live here and not in `ios/`

`expo prebuild` generates `apps/mobile/ios/` and `--clean` deletes it. These
sources sit outside that folder and are added to the Xcode project **by
reference**, so regenerating the native project loses the target configuration
but never the code.

## Layout

```
KiwiShared/         compiled into every target
  KiwiConfig.swift    the App Group: base URL, ledger id, account id, cached figure
  Money.swift         formatting only; the exponent table mirrors @kiwi/core
  KiwiAPI.swift       extract · commit · the budget report the widget reads
  CaptureOutbox.swift what a capture does when it cannot be sent yet
KiwiShareExtension/ FR-CAP-05
KiwiIntents/        FR-CAP-06 — added to the app target
KiwiWidget/         FR-CAP-07
KiwiBridge/         the app's side of the App Group, called from JavaScript
```

## Setting it up, once, on your Mac

```bash
pnpm install
pnpm --filter @kiwi/mobile exec expo prebuild -p ios   # generates apps/mobile/ios
open apps/mobile/ios/*.xcworkspace
```

Then, in Xcode:

**1. App Group on the app target.** Signing & Capabilities → **+ Capability** →
App Groups → check `group.app.kiwi.finance`. `app.json` already declares the
entitlement, so it should be there; add it if prebuild did not.

**2. The bridge.** *Add Files to…* → `native/ios/KiwiBridge` and
`native/ios/KiwiShared`, with **“Copy items if needed” unchecked** and *Create
groups* selected. Target: the **app** only. Xcode will offer to create a
bridging header when the `.m` lands — accept, and put this in it:

```objc
#import <React/RCTBridgeModule.h>
```

**3. App Intents.** Add `native/ios/KiwiIntents/KiwiAppIntents.swift` to the
**app** target. Intents must live in the app (or a dedicated extension) to be
visible to Siri and Shortcuts.

**4. Share Extension.** File → New → **Target… → Share Extension**, name it
`KiwiShareExtension`. Then:

- delete the generated `ShareViewController.swift` and `MainInterface.storyboard`
- add `native/ios/KiwiShareExtension/ShareViewController.swift` to it
- replace the generated `Info.plist` with `native/ios/KiwiShareExtension/Info.plist`
- add the four `KiwiShared/*.swift` files to this target too (File Inspector →
  Target Membership)
- Signing & Capabilities → **+ Capability** → App Groups → the same group

**5. Widget.** File → New → **Target… → Widget Extension**, name it
`KiwiWidget`, with *Include Configuration App Intent* and *Include Live
Activity* unchecked. Then the same four steps: delete the generated Swift file,
add `native/ios/KiwiWidget/KiwiWidget.swift`, use our `Info.plist`, add
`KiwiShared/*.swift` to the target, and add the App Group.

**6. Deployment target** iOS 16.0 or later on all three targets (the widget
uses `containerBackground` behind an `#available` check, so iOS 17 is not
required).

### Back Tap

iOS has no back-tap API: it is a Shortcut the user assigns. Once the app has
run once, **Settings → Accessibility → Touch → Back Tap → Double Tap →
Kiwi: Record a purchase**. That is `LogExpenseIntent` with
`openAppWhenRun = false`, so a double tap on the back of the phone asks what
you spent and records it without the app coming to the front.

## Running it

```bash
pnpm dev                                    # the API on :8787
EXPO_PUBLIC_API_URL=http://192.168.x.x:8787 pnpm dev:ios   # a real device needs the LAN address
```

The app publishes `baseURL`, `ledgerId` and `accountId` into the App Group on
every load, so **open the app once** before trying the share sheet, an intent
or the widget. Each of them says so plainly when it has not happened yet
rather than failing silently.

`NSAllowsLocalNetworking` is set in `app.json` and in the widget's `Info.plist`
so a development build can talk to an API on your machine over plain HTTP.
**Remove both before shipping** — production is https.

## What each one does when something is wrong

| Situation | What happens |
|---|---|
| App never opened | Every surface says "Open Kiwi once so it can tell this extension where your ledger is" |
| No network while sharing text | The text goes to the outbox; the app sends it on next launch |
| A shared screenshot | Goes to the outbox and stays there — reading an image needs a vision model the API does not have yet. The app shows the count; nothing is discarded |
| Widget cannot reach the API | Shows the last figure the app cached, labelled with the time it was computed |
| No budget set | The widget shows the engine's own reason, not a zero |

## What is deliberately not here

- **No local computation.** There is no arithmetic in any of these targets
  beyond formatting a number for display. That is the point of P-1.
- **No auth.** The API has no authentication yet, so neither does this. When
  it arrives, the token belongs in a Keychain group shared with the extensions,
  not in `UserDefaults` — `KiwiConfig` is where that goes.
- **No config plugin.** The targets are added by hand in Xcode. An Expo config
  plugin would make `expo prebuild --clean` reproducible and is worth writing
  once the target layout stops changing.
