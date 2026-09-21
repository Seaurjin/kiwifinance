//
//  Money.swift
//  Display only. Nothing here decides what a number is — only how it looks.
//
//  The exponent table mirrors packages/core/src/currency.ts. A wrong exponent
//  misstates an amount by a factor of 100, so the two tables must be changed
//  together; the test in packages/core/test/money.test.ts is the reference.
//

import Foundation

public enum Money {
    /// Currencies whose minor-unit exponent is not 2 (ISO 4217).
    private static let nonDefaultExponents: [String: Int] = [
        "BIF": 0, "CLP": 0, "DJF": 0, "GNF": 0, "ISK": 0, "JPY": 0, "KMF": 0,
        "KRW": 0, "PYG": 0, "RWF": 0, "UGX": 0, "UYI": 0, "VND": 0, "VUV": 0,
        "XAF": 0, "XOF": 0, "XPF": 0,
        "BHD": 3, "IQD": 3, "JOD": 3, "KWD": 3, "LYD": 3, "OMR": 3, "TND": 3,
    ]

    public static func exponent(of currency: String) -> Int {
        nonDefaultExponents[currency.uppercased()] ?? 2
    }

    /// 47_456 SGD minor → "SGD 474.56". The code is shown rather than a symbol
    /// because a ledger holds several currencies at once and "$" is ambiguous.
    public static func format(minor: Int, currency: String) -> String {
        let exponent = exponent(of: currency)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = exponent
        formatter.maximumFractionDigits = exponent
        formatter.usesGroupingSeparator = true

        let value = Decimal(minor) / pow(Decimal(10), exponent)
        let text = formatter.string(from: value as NSDecimalNumber) ?? "\(minor)"
        return "\(currency.uppercased()) \(text)"
    }

    /// "35.20" typed by a person → 3520 minor units of their currency.
    /// Returns nil rather than guessing when the text is not a number.
    public static func minorUnits(from text: String, currency: String) -> Int? {
        let cleaned = text
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Decimal(string: cleaned) else { return nil }
        let scaled = value * pow(Decimal(10), exponent(of: currency))
        // Half-even, the same rounding mode @kiwi/core uses by default, so a
        // number typed here and the same number typed in the web app become
        // the same integer.
        let handler = NSDecimalNumberHandler(
            roundingMode: .bankers,
            scale: 0,
            raiseOnExactness: false,
            raiseOnOverflow: false,
            raiseOnUnderflow: false,
            raiseOnDivideByZero: false
        )
        return NSDecimalNumber(decimal: scaled).rounding(accordingToBehavior: handler).intValue
    }
}
