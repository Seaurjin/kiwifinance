//
//  CaptureOutbox.swift
//  What a capture does when it cannot be read yet.
//
//  Two cases end up here. One: there is no network, and a share sheet must not
//  lose what the user gave it. Two: the share is an image, and reading an
//  image needs a vision model the API does not have yet — the file waits in
//  the App Group container until the app can send it.
//
//  Nothing in the outbox is in the ledger. It moves no figure and appears in
//  no report until it has been read and confirmed, which is the same rule
//  every other capture path follows.
//

import Foundation

public struct PendingCapture: Codable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case text
        case image
    }

    public let id: String
    public let kind: Kind
    /// The shared text, for `.text`.
    public let text: String?
    /// File name inside the outbox folder, for `.image`.
    public let fileName: String?
    /// Where it came from, shown to the user: "Photos", "Safari", "Mail".
    public let sourceApp: String?
    public let createdAt: String

    public init(
        id: String = UUID().uuidString,
        kind: Kind,
        text: String? = nil,
        fileName: String? = nil,
        sourceApp: String? = nil,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.kind = kind
        self.text = text
        self.fileName = fileName
        self.sourceApp = sourceApp
        self.createdAt = createdAt
    }
}

public enum CaptureOutbox {
    private static var folderURL: URL? {
        guard let container = KiwiConfig.containerURL else { return nil }
        let folder = container.appendingPathComponent(KiwiConfig.outboxFolder, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    /// Writes the capture and, for an image, the bytes beside it.
    @discardableResult
    public static func add(_ capture: PendingCapture, imageData: Data? = nil) -> Bool {
        guard let folder = folderURL else { return false }
        do {
            if let imageData, let fileName = capture.fileName {
                try imageData.write(to: folder.appendingPathComponent(fileName), options: .atomic)
            }
            let json = try JSONEncoder().encode(capture)
            try json.write(to: folder.appendingPathComponent("\(capture.id).json"), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// Oldest first, so the app drains them in the order they were captured.
    public static func list() -> [PendingCapture] {
        guard let folder = folderURL,
              let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path)
        else { return [] }

        return names
            .filter { $0.hasSuffix(".json") }
            .compactMap { name in
                guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { return nil }
                return try? JSONDecoder().decode(PendingCapture.self, from: data)
            }
            .sorted { $0.createdAt < $1.createdAt }
    }

    public static func fileURL(for capture: PendingCapture) -> URL? {
        guard let folder = folderURL, let fileName = capture.fileName else { return nil }
        return folder.appendingPathComponent(fileName)
    }

    /// Called by the app once a capture has reached the ledger — never before.
    public static func remove(id: String) {
        guard let folder = folderURL else { return }
        let json = folder.appendingPathComponent("\(id).json")
        if let data = try? Data(contentsOf: json),
           let capture = try? JSONDecoder().decode(PendingCapture.self, from: data),
           let fileName = capture.fileName {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(fileName))
        }
        try? FileManager.default.removeItem(at: json)
    }

    public static var count: Int { list().count }
}
