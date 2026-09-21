//
//  KiwiAppIntents.swift
//  FR-CAP-06 — record something without opening the app.
//
//  Two intents, both of which run without bringing the app to the front:
//  one records what you say, one reads back what you have left to spend.
//  They go through the same extract → review path as every other capture, so
//  a figure recorded by Siri is held for confirmation exactly like a figure
//  typed into the app.
//
//  Back tap is not an API. iOS exposes it as a Shortcut the user assigns in
//  Settings → Accessibility → Touch → Back Tap, so what this file has to
//  provide is a shortcut worth assigning: `LogExpenseIntent` with no
//  parameters, which opens the dictation prompt.
//

import AppIntents
import Foundation

// MARK: - Record something

struct LogExpenseIntent: AppIntent {
    static var title: LocalizedStringResource = "Record a purchase"
    static var description = IntentDescription(
        "Say or type what you spent. Kiwi reads it into a draft and holds it for you to confirm."
    )

    /// False: the whole point is not having to open the app.
    static var openAppWhenRun: Bool = false

    @Parameter(
        title: "What did you spend?",
        description: "For example: lunch 35, taxi 22",
        requestValueDialog: "What did you spend?"
    )
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard KiwiConfig.isConfigured, let accountId = KiwiConfig.accountId else {
            return .result(dialog: IntentDialog(stringLiteral: KiwiAPIError.notConfigured.localizedDescription))
        }

        let api = try KiwiAPI.fromSharedConfig()

        let drafts: [KiwiDraft]
        do {
            drafts = try await api.extract(text: text)
        } catch {
            // Keep what was said. A capture that is lost because the train
            // went into a tunnel is worse than one that waits.
            CaptureOutbox.add(PendingCapture(kind: .text, text: text, sourceApp: "Shortcuts"))
            return .result(dialog: "Kiwi could not reach your ledger, so I have kept that to record when it can.")
        }

        guard !drafts.isEmpty else {
            return .result(dialog: "I could not find an amount in that. Try \"lunch 35, taxi 22\".")
        }

        let count = try await api.commit(drafts: drafts, accountId: accountId, source: "voice")

        // Only total what can be totalled. Minor units of two currencies do
        // not add up, and a spoken summary is not worth breaking P-2 for.
        let currencies = Set(drafts.map(\.currency))
        let summary: String? = currencies.count == 1
            ? Money.format(minor: abs(drafts.map(\.amountMinor).reduce(0, +)), currency: drafts[0].currency)
            : nil

        switch (count, summary) {
        case (1, .some(let summary)):
            return .result(dialog: "Recorded \(summary). It is waiting for you to confirm.")
        case (_, .some(let summary)):
            return .result(dialog: "Recorded \(count) items, \(summary) in all. They are waiting for you to confirm.")
        default:
            return .result(dialog: "Recorded \(count) items in several currencies. They are waiting for you to confirm.")
        }
    }
}

// MARK: - Read back the allowance

struct ShowAllowanceIntent: AppIntent {
    static var title: LocalizedStringResource = "What can I spend today?"
    static var description = IntentDescription(
        "Reads back what today's budget leaves you. The figure is computed by Kiwi's engine, not on the phone."
    )
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard KiwiConfig.isConfigured else {
            return .result(dialog: IntentDialog(stringLiteral: KiwiAPIError.notConfigured.localizedDescription))
        }

        let api = try KiwiAPI.fromSharedConfig()
        let snapshot: KiwiSnapshot
        do {
            snapshot = try await api.allowance()
            KiwiConfig.writeSnapshot(snapshot)
        } catch {
            guard let cached = KiwiConfig.readSnapshot() else {
                return .result(dialog: "I could not reach your ledger just now.")
            }
            let amount = cached.allowanceMinor.map { Money.format(minor: $0, currency: cached.currency) }
            return .result(
                dialog: amount.map { "Last I knew, \($0) a day — I could not reach your ledger to check." }
                    ?? "I could not reach your ledger just now."
            )
        }

        guard let allowanceMinor = snapshot.allowanceMinor else {
            return .result(
                dialog: IntentDialog(
                    stringLiteral: snapshot.unavailableReason ?? "There is no budget set, so there is nothing to divide up."
                )
            )
        }

        let amount = Money.format(minor: allowanceMinor, currency: snapshot.currency)
        return .result(
            dialog: snapshot.pendingCount > 0
                ? "\(amount) a day for the rest of the month. \(snapshot.pendingCount) captures are waiting for you to confirm."
                : "\(amount) a day for the rest of the month."
        )
    }
}

// MARK: - What Siri and Back Tap can see

struct KiwiShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogExpenseIntent(),
            phrases: [
                "Record a purchase in \(.applicationName)",
                "Log an expense in \(.applicationName)",
                "Add a receipt to \(.applicationName)",
                "\(.applicationName) 记一笔",
            ],
            shortTitle: "Record a purchase",
            systemImageName: "plus.circle"
        )
        AppShortcut(
            intent: ShowAllowanceIntent(),
            phrases: [
                "What can I spend today in \(.applicationName)",
                "Ask \(.applicationName) what is left",
                "\(.applicationName) 今天还能花多少",
            ],
            shortTitle: "Today's allowance",
            systemImageName: "gauge.with.dots.needle.33percent"
        )
    }
}
