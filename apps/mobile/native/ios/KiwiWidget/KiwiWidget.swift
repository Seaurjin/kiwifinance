//
//  KiwiWidget.swift
//  FR-CAP-07 — what today leaves you, on the home screen.
//
//  The widget renders one figure and computes none. The timeline provider
//  asks the API for the budget report and reads `daily_allowance` out of the
//  fact set; if it cannot reach the API it shows the last figure the app
//  cached, labelled with when it was computed. A stale number that says it is
//  stale is honest; a number the widget worked out itself would not be.
//

import SwiftUI
import WidgetKit

// MARK: - Timeline

struct AllowanceEntry: TimelineEntry {
    let date: Date
    let snapshot: KiwiSnapshot?
    let state: State

    enum State {
        case ready
        /// The app has not run yet, so there is nothing to point at.
        case needsSetup
        /// Showing a cached figure because the ledger could not be reached.
        case stale
    }

    static let placeholder = AllowanceEntry(
        date: Date(),
        snapshot: KiwiSnapshot(
            allowanceMinor: 4_200,
            currency: "SGD",
            pendingCount: 2,
            asOf: ISO8601DateFormatter().string(from: Date())
        ),
        state: .ready
    )
}

struct AllowanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> AllowanceEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (AllowanceEntry) -> Void) {
        // The gallery preview must never show someone's real figures.
        if context.isPreview {
            completion(.placeholder)
            return
        }
        Task { completion(await entry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AllowanceEntry>) -> Void) {
        Task {
            let current = await entry()
            // A daily allowance changes when money is spent, not on a clock,
            // so half-hourly is frequent enough to be useful and rare enough
            // that iOS keeps honouring it.
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
            completion(Timeline(entries: [current], policy: .after(next)))
        }
    }

    private func entry() async -> AllowanceEntry {
        guard KiwiConfig.isConfigured else {
            return AllowanceEntry(date: Date(), snapshot: nil, state: .needsSetup)
        }
        do {
            let api = try KiwiAPI.fromSharedConfig()
            let snapshot = try await api.allowance()
            KiwiConfig.writeSnapshot(snapshot)
            return AllowanceEntry(date: Date(), snapshot: snapshot, state: .ready)
        } catch {
            return AllowanceEntry(date: Date(), snapshot: KiwiConfig.readSnapshot(), state: .stale)
        }
    }
}

// MARK: - Views

struct AllowanceWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: AllowanceEntry

    var body: some View {
        switch family {
        case .accessoryRectangular:
            lockScreen
        case .systemMedium:
            medium
        default:
            small
        }
    }

    // MARK: pieces

    private var amountText: String? {
        guard let snapshot = entry.snapshot, let minor = snapshot.allowanceMinor else { return nil }
        return Money.format(minor: minor, currency: snapshot.currency)
    }

    private var caption: String {
        switch entry.state {
        case .needsSetup:
            return "Open Kiwi once"
        case .stale:
            return "Last known figure"
        case .ready:
            return "a day, rest of the month"
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("LEFT TO SPEND")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)

            if let amountText {
                Text(amountText)
                    .font(.system(size: 20, weight: .semibold, design: .monospaced))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            } else {
                Text(entry.snapshot?.unavailableReason ?? "No budget set")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(caption).font(.caption2).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            pendingRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Tapping the widget records something rather than just opening the
        // app: the shortest path from noticing a figure to correcting it.
        .widgetURL(URL(string: "kiwi://capture"))
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 16) {
            small
            VStack(alignment: .leading, spacing: 8) {
                if let snapshot = entry.snapshot {
                    Label("\(snapshot.pendingCount) waiting for you", systemImage: "tray.full")
                        .font(.caption)
                    Text("as of \(shortTime(snapshot.asOf))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Link(destination: URL(string: "kiwi://capture")!) {
                    Label("Record something", systemImage: "plus.circle")
                        .font(.caption)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var lockScreen: some View {
        VStack(alignment: .leading) {
            Text("Left to spend").font(.caption2)
            Text(amountText ?? "—").font(.headline).minimumScaleFactor(0.7).lineLimit(1)
        }
    }

    @ViewBuilder private var pendingRow: some View {
        if let snapshot = entry.snapshot, snapshot.pendingCount > 0 {
            Text("\(snapshot.pendingCount) to confirm")
                .font(.caption2)
                .foregroundStyle(.orange)
        }
    }

    /// "as of 14:05" — the instant the engine computed the figure, not the
    /// instant the widget drew it.
    private func shortTime(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return iso }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }
}

// MARK: - Widget

struct KiwiAllowanceWidget: Widget {
    let kind = "KiwiAllowanceWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AllowanceProvider()) { entry in
            if #available(iOS 17.0, *) {
                AllowanceWidgetView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
            } else {
                AllowanceWidgetView(entry: entry).padding()
            }
        }
        .configurationDisplayName("Left to spend")
        .description("Today's allowance, and anything waiting for you to confirm.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

@main
struct KiwiWidgetBundle: WidgetBundle {
    var body: some Widget {
        KiwiAllowanceWidget()
    }
}
