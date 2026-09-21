//
//  ShareViewController.swift
//  FR-CAP-05 — share a receipt into Kiwi from anywhere.
//
//  The flow is the same one the capture bar follows, because it is the same
//  API: read the text into drafts, show the drafts, and only write when the
//  user says so. What the extractor was unsure about is held for confirmation
//  by the server, so a share can never quietly move a figure.
//
//  An image takes the other road. Reading a screenshot needs a vision model
//  the API does not have yet, so the image is written to the App Group outbox
//  and the app picks it up. The sheet says exactly that rather than implying
//  it was understood.
//

import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        let root = UIHostingController(
            rootView: ShareSheet(
                items: extensionContext?.inputItems as? [NSExtensionItem] ?? [],
                onClose: { [weak self] in
                    self?.extensionContext?.completeRequest(returningItems: nil)
                }
            )
        )

        addChild(root)
        root.view.frame = view.bounds
        root.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(root.view)
        root.didMove(toParent: self)
    }
}

// MARK: - The sheet

private enum ShareState {
    case reading
    case drafts([KiwiDraft], extractedFrom: String)
    case queued(String)
    case saved(Int)
    case failed(String)
}

private struct ShareSheet: View {
    let items: [NSExtensionItem]
    let onClose: () -> Void

    @State private var state: ShareState = .reading
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Group {
                switch state {
                case .reading:
                    ProgressView("Reading what you shared…")

                case let .drafts(drafts, extractedFrom):
                    draftList(drafts, extractedFrom: extractedFrom)

                case let .queued(what):
                    message(
                        title: "Saved to Kiwi",
                        body: "\(what) is waiting to be read. Open Kiwi and it will appear in the queue for you to confirm. It is not in any figure yet."
                    )

                case let .saved(count):
                    message(
                        title: count == 1 ? "Recorded 1 item" : "Recorded \(count) items",
                        body: "They are waiting for you to confirm in Kiwi, so they move no figure until you do."
                    )

                case let .failed(reason):
                    message(title: "Could not record that", body: reason)
                }
            }
            .padding()
            .navigationTitle("Kiwi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", action: onClose)
                }
            }
        }
        .task { await load() }
    }

    private func draftList(_ drafts: [KiwiDraft], extractedFrom: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(extractedFrom)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(3)

            List(drafts) { draft in
                HStack {
                    VStack(alignment: .leading) {
                        Text(draft.merchantName ?? draft.note ?? "Unnamed")
                        Text(draft.date)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(Money.format(minor: draft.amountMinor, currency: draft.currency))
                        .monospacedDigit()
                }
            }
            .listStyle(.plain)

            Text("Nothing is recorded until you save, and what is saved waits for you to confirm in Kiwi.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                Task { await save(drafts) }
            } label: {
                Text(busy ? "Saving…" : "Save to Kiwi").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || drafts.isEmpty)
        }
    }

    private func message(title: String, body: String) -> some View {
        VStack(spacing: 10) {
            Text(title).font(.headline)
            Text(body)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Done", action: onClose).buttonStyle(.borderedProminent).padding(.top, 8)
        }
    }

    // MARK: - Work

    @MainActor
    private func load() async {
        guard KiwiConfig.isConfigured else {
            state = .failed(KiwiAPIError.notConfigured.localizedDescription)
            return
        }

        let attachments = items.flatMap { $0.attachments ?? [] }

        // Text first: it is the only kind the API can read today.
        if let text = await firstText(in: attachments) {
            do {
                let api = try KiwiAPI.fromSharedConfig()
                let drafts = try await api.extract(text: text)
                if drafts.isEmpty {
                    state = .failed("No amount in that. Share something with a figure in it, or type it into Kiwi.")
                } else {
                    state = .drafts(drafts, extractedFrom: text)
                }
            } catch {
                // The network is the usual reason. Keep the text rather than
                // asking the user to find it again.
                CaptureOutbox.add(PendingCapture(kind: .text, text: text, sourceApp: nil))
                state = .queued("What you shared")
            }
            return
        }

        if let (data, name) = await firstImage(in: attachments) {
            let stored = CaptureOutbox.add(
                PendingCapture(kind: .image, fileName: name, sourceApp: nil),
                imageData: data
            )
            state = stored
                ? .queued("That screenshot")
                : .failed("Could not write to Kiwi's shared storage. Check that the App Group is enabled.")
            return
        }

        state = .failed("Kiwi can take a screenshot, a photo or some text.")
    }

    @MainActor
    private func save(_ drafts: [KiwiDraft]) async {
        busy = true
        defer { busy = false }
        do {
            let api = try KiwiAPI.fromSharedConfig()
            guard let accountId = KiwiConfig.accountId else {
                throw KiwiAPIError.notConfigured
            }
            let count = try await api.commit(drafts: drafts, accountId: accountId, source: "share")
            state = .saved(count)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    // MARK: - Reading the attachments

    private func firstText(in attachments: [NSItemProvider]) async -> String? {
        for provider in attachments {
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
               let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                return text
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                return url.absoluteString
            }
        }
        return nil
    }

    private func firstImage(in attachments: [NSItemProvider]) async -> (Data, String)? {
        for provider in attachments where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) else {
                continue
            }
            if let url = item as? URL, let data = try? Data(contentsOf: url) {
                return (data, "\(UUID().uuidString).\(url.pathExtension.isEmpty ? "png" : url.pathExtension)")
            }
            if let image = item as? UIImage, let data = image.pngData() {
                return (data, "\(UUID().uuidString).png")
            }
            if let data = item as? Data {
                return (data, "\(UUID().uuidString).png")
            }
        }
        return nil
    }
}

// `loadItem` is an old-style callback API; this is the async wrapper the
// sheet above reads with.
private extension NSItemProvider {
    func loadItem(forTypeIdentifier identifier: String) async throws -> NSSecureCoding? {
        try await withCheckedThrowingContinuation { continuation in
            loadItem(forTypeIdentifier: identifier, options: nil) { item, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: item)
                }
            }
        }
    }
}
