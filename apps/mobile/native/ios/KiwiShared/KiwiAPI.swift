//
//  KiwiAPI.swift
//  The same REST API the web app and the React Native app use.
//
//  An extension talks to the API directly rather than to the app: it runs in
//  its own process, and the app may not be running at all. It uses exactly the
//  routes the capture bar uses — extract, then commit — so a receipt shared
//  from Photos lands in the same review queue as one typed into the app, with
//  the same confidence rules applied server-side.
//
//  Nothing in this file computes a figure. `allowance()` asks for a standard
//  report and reads the value the engine returned.
//

import Foundation

public struct KiwiDraft: Codable, Identifiable, Sendable {
    public var id: String { "\(date)-\(amountMinor)-\(merchantName ?? "")" }

    public var amountMinor: Int
    public var currency: String
    public var date: String
    public var merchantName: String?
    public var categorySlug: String?
    public var note: String?
    public var confidence: Double

    public init(
        amountMinor: Int,
        currency: String,
        date: String,
        merchantName: String? = nil,
        categorySlug: String? = nil,
        note: String? = nil,
        confidence: Double
    ) {
        self.amountMinor = amountMinor
        self.currency = currency
        self.date = date
        self.merchantName = merchantName
        self.categorySlug = categorySlug
        self.note = note
        self.confidence = confidence
    }
}

public enum KiwiAPIError: LocalizedError {
    case notConfigured
    case http(status: Int, message: String)
    case malformed(String)

    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Open Kiwi once so it can tell this extension where your ledger is."
        case let .http(status, message):
            return message.isEmpty ? "The ledger answered \(status)." : message
        case let .malformed(what):
            return "The ledger sent something unexpected (\(what))."
        }
    }
}

public struct KiwiAPI: Sendable {
    private let baseURL: URL
    private let ledgerId: String
    private let session: URLSession

    public init(baseURL: URL, ledgerId: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.ledgerId = ledgerId
        self.session = session
    }

    /// Built from what the app last wrote into the App Group.
    public static func fromSharedConfig(session: URLSession = .shared) throws -> KiwiAPI {
        guard let baseURL = KiwiConfig.baseURL, let ledgerId = KiwiConfig.ledgerId else {
            throw KiwiAPIError.notConfigured
        }
        return KiwiAPI(baseURL: baseURL, ledgerId: ledgerId, session: session)
    }

    // MARK: - Capture (FR-CAP-05, FR-CAP-06)

    /// Reads one line of text into drafts. Writes nothing.
    public func extract(text: String) async throws -> [KiwiDraft] {
        struct Body: Encodable { let text: String }
        struct Response: Decodable { let drafts: [KiwiDraft] }
        let response: Response = try await post("/api/ledgers/\(ledgerId)/capture/extract", Body(text: text))
        return response.drafts
    }

    /// Writes the drafts. Anything the extractor was unsure about is held in
    /// the review queue by the server, not by this code.
    @discardableResult
    public func commit(drafts: [KiwiDraft], accountId: String, source: String) async throws -> Int {
        struct Body: Encodable {
            let accountId: String
            let source: String
            let extractedBy: String
            let drafts: [KiwiDraft]
        }
        struct Transaction: Decodable { let id: String }
        struct Response: Decodable { let transactions: [Transaction] }

        let response: Response = try await post(
            "/api/ledgers/\(ledgerId)/capture/commit",
            Body(accountId: accountId, source: source, extractedBy: "share-extension", drafts: drafts)
        )
        return response.transactions.count
    }

    // MARK: - The widget's figure (FR-CAP-07)

    /// The daily allowance, taken from the budget report's fact set.
    ///
    /// The widget does not know what an allowance is and does not work one
    /// out: it asks for the standard report and reads the fact whose metric id
    /// is `daily_allowance`, with the currency and the reason-if-missing the
    /// engine attached to it.
    public func allowance() async throws -> KiwiSnapshot {
        struct Fact: Decodable {
            let metric: String
            let value: Double?
            let currency: String?
            let unavailableReason: String?
        }
        struct Block: Decodable { let facts: [Fact] }
        struct FactSet: Decodable { let generatedAt: String; let blocks: [Block] }
        struct Response: Decodable { let factSet: FactSet }

        let response: Response = try await get("/api/ledgers/\(ledgerId)/reports/budget_replan")
        let facts = response.factSet.blocks.flatMap(\.facts)
        guard let allowance = facts.first(where: { $0.metric == "daily_allowance" }) else {
            throw KiwiAPIError.malformed("no daily_allowance in the budget report")
        }

        let pending = try? await pendingCount()
        return KiwiSnapshot(
            allowanceMinor: allowance.value.map { Int($0) },
            currency: allowance.currency ?? "",
            pendingCount: pending ?? 0,
            asOf: response.factSet.generatedAt,
            unavailableReason: allowance.unavailableReason
        )
    }

    public func pendingCount() async throws -> Int {
        struct Response: Decodable { let pendingCount: Int }
        let response: Response = try await get("/api/ledgers/\(ledgerId)")
        return response.pendingCount
    }

    // MARK: - Transport

    /// `appendingPathComponent` would leave a double slash if the path kept
    /// its leading one, and the server would 404 on it.
    private func url(for path: String) -> URL {
        baseURL.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: url(for: path))
        request.timeoutInterval = 15
        return try await send(request)
    }

    private func post<Body: Encodable, T: Decodable>(_ path: String, _ body: Body) async throws -> T {
        var request = URLRequest(url: url(for: path))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        guard (200..<300).contains(status) else {
            struct APIError: Decodable { let error: String; let message: String? }
            let decoded = try? JSONDecoder().decode(APIError.self, from: data)
            throw KiwiAPIError.http(status: status, message: decoded?.message ?? decoded?.error ?? "")
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw KiwiAPIError.malformed(String(describing: T.self))
        }
    }
}
