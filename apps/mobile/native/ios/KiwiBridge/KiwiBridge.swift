//
//  KiwiBridge.swift
//  The app's side of the App Group.
//
//  Extensions cannot see the app's JavaScript state, so the app publishes the
//  little that they need: where the API is, which ledger, which account, and
//  the last figure the engine returned. It also drains the outbox — captures
//  taken while the extension had no network, or screenshots that need a model
//  the API does not have yet.
//
//  It publishes nothing else. An extension gets a base URL and an id, not a
//  copy of the ledger.
//

import Foundation
import WidgetKit

@objc(KiwiBridge)
final class KiwiBridge: NSObject {
    /// Nothing here touches UIKit, so it can run off the main thread.
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(setConfig:ledgerId:accountId:resolver:rejecter:)
    func setConfig(
        _ baseURL: String,
        ledgerId: String,
        accountId: String,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let url = URL(string: baseURL) else {
            reject("bad_url", "\(baseURL) is not a URL.", nil)
            return
        }
        KiwiConfig.baseURL = url
        KiwiConfig.ledgerId = ledgerId
        KiwiConfig.accountId = accountId.isEmpty ? nil : accountId
        resolve(nil)
    }

    /// The figures come from the engine through the API; this stores them
    /// verbatim so the widget has something to show when it is offline.
    @objc(writeSnapshot:resolver:rejecter:)
    func writeSnapshot(
        _ snapshot: NSDictionary,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        let allowance = snapshot["allowanceMinor"] as? NSNumber
        KiwiConfig.writeSnapshot(
            KiwiSnapshot(
                allowanceMinor: allowance?.intValue,
                currency: snapshot["currency"] as? String ?? "",
                pendingCount: (snapshot["pendingCount"] as? NSNumber)?.intValue ?? 0,
                asOf: snapshot["asOf"] as? String ?? ISO8601DateFormatter().string(from: Date()),
                unavailableReason: snapshot["unavailableReason"] as? String
            )
        )
        WidgetCenter.shared.reloadAllTimelines()
        resolve(nil)
    }

    /// What is waiting to be read. Each entry is still outside the ledger.
    @objc(pendingCaptures:rejecter:)
    func pendingCaptures(
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        let captures: [[String: Any]] = CaptureOutbox.list().map { capture in
            var row: [String: Any] = [
                "id": capture.id,
                "kind": capture.kind.rawValue,
                "createdAt": capture.createdAt,
            ]
            if let text = capture.text { row["text"] = text }
            if let url = CaptureOutbox.fileURL(for: capture) { row["fileUri"] = url.absoluteString }
            if let sourceApp = capture.sourceApp { row["sourceApp"] = sourceApp }
            return row
        }
        resolve(captures)
    }

    /// Called only once a capture has reached the ledger.
    @objc(removePendingCapture:resolver:rejecter:)
    func removePendingCapture(
        _ id: String,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        CaptureOutbox.remove(id: id)
        resolve(nil)
    }
}
