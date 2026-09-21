//
//  KiwiConfig.swift
//  Shared by the app, the Share Extension, the App Intents and the widget.
//
//  Everything an extension needs to reach the ledger lives in one App Group
//  container. An extension is a separate process with its own sandbox: it
//  cannot read the app's JavaScript state, so the app writes what it knows
//  here and the extensions read it.
//

import Foundation

public enum KiwiConfig {
    /// Must match the App Group capability on every target.
    public static let appGroup = "group.app.kiwi.finance"

    /// Where captured files wait when there is no network.
    public static let outboxFolder = "Outbox"

    private enum Key {
        static let baseURL = "kiwi.baseURL"
        static let ledgerId = "kiwi.ledgerId"
        static let accountId = "kiwi.accountId"
        static let snapshot = "kiwi.snapshot"
    }

    public static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    public static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    // MARK: - What the app writes and the extensions read

    public static var baseURL: URL? {
        get { defaults.string(forKey: Key.baseURL).flatMap(URL.init(string:)) }
        set { defaults.set(newValue?.absoluteString, forKey: Key.baseURL) }
    }

    public static var ledgerId: String? {
        get { defaults.string(forKey: Key.ledgerId) }
        set { defaults.set(newValue, forKey: Key.ledgerId) }
    }

    /// The account a capture lands in when the user has not chosen one.
    public static var accountId: String? {
        get { defaults.string(forKey: Key.accountId) }
        set { defaults.set(newValue, forKey: Key.accountId) }
    }

    /// True once the app has opened at least once and written its config.
    public static var isConfigured: Bool {
        baseURL != nil && ledgerId != nil
    }

    // MARK: - The widget's cached reading

    public static func readSnapshot() -> KiwiSnapshot? {
        guard let data = defaults.data(forKey: Key.snapshot) else { return nil }
        return try? JSONDecoder().decode(KiwiSnapshot.self, from: data)
    }

    public static func writeSnapshot(_ snapshot: KiwiSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: Key.snapshot)
    }
}

/// What the widget shows when it cannot reach the API.
///
/// These are figures the engine computed and the app cached verbatim. Nothing
/// here is recalculated on the device — a cached number is stale, not wrong,
/// and `asOf` is shown so the difference is visible.
public struct KiwiSnapshot: Codable, Sendable {
    public let allowanceMinor: Int?
    public let currency: String
    public let pendingCount: Int
    /// ISO-8601 instant the figures were computed at, not when they were cached.
    public let asOf: String
    /// The engine's own words when the figure is undefined, e.g. no budget set.
    public let unavailableReason: String?

    public init(
        allowanceMinor: Int?,
        currency: String,
        pendingCount: Int,
        asOf: String,
        unavailableReason: String? = nil
    ) {
        self.allowanceMinor = allowanceMinor
        self.currency = currency
        self.pendingCount = pendingCount
        self.asOf = asOf
        self.unavailableReason = unavailableReason
    }
}
