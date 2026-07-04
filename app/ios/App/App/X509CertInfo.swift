import Foundation

// Extracts the issuer name and expiry (notAfter) from a certificate.
// iOS has no public Security API for these fields (SecCertificateCopyValues and
// the kSecOID* constants are macOS-only), so this parses the certificate DER
// directly. Layout per RFC 5280:
//   Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
//   TBSCertificate ::= SEQUENCE { [0] version OPTIONAL, serialNumber,
//     signature, issuer Name, validity SEQUENCE { notBefore, notAfter }, ... }

/// Date formatter for cert expiry, matching the shape of Java's `Date.toString()`
/// used on the Android side (e.g. "Thu Jul 02 00:00:00 PDT 2026") so both
/// platforms show a comparable human-readable expiry string.
private let certExpiryFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "EEE MMM dd HH:mm:ss zzz yyyy"
    return formatter
}()

/// Extract the issuer name and expiry date from a certificate. Returns nil for
/// either field independently if it can't be read, so the caller can fall back
/// per-field instead of discarding both.
func certificateIssuerAndExpiry(_ certificate: SecCertificate) -> (issuer: String?, expiry: String?) {
    let der = [UInt8](SecCertificateCopyData(certificate) as Data)
    var outer = DERReader(der)
    guard let certSeq = outer.next(), certSeq.tag == 0x30 else { return (nil, nil) }
    var certReader = DERReader(certSeq.content)
    guard let tbs = certReader.next(), tbs.tag == 0x30 else { return (nil, nil) }
    var tbsReader = DERReader(tbs.content)

    // First field is either the optional [0] EXPLICIT version or serialNumber.
    guard let first = tbsReader.next() else { return (nil, nil) }
    if first.tag == 0xA0 {
        // Version present; consume serialNumber.
        guard tbsReader.next() != nil else { return (nil, nil) }
    }
    guard tbsReader.next() != nil, // signature AlgorithmIdentifier
          let issuer = tbsReader.next(), issuer.tag == 0x30,
          let validity = tbsReader.next(), validity.tag == 0x30 else {
        return (nil, nil)
    }

    return (issuerName(issuer.content), notAfterString(validity.content))
}

// MARK: - DER reader

private struct DERTLV {
    let tag: UInt8
    let content: [UInt8]
}

private struct DERReader {
    private let bytes: [UInt8]
    private var offset = 0

    init(_ bytes: [UInt8]) { self.bytes = bytes }

    /// Read the next tag-length-value element, or nil on truncated/invalid input.
    mutating func next() -> DERTLV? {
        guard offset + 2 <= bytes.count else { return nil }
        let tag = bytes[offset]
        offset += 1
        var length = Int(bytes[offset])
        offset += 1
        if length & 0x80 != 0 {
            let lengthByteCount = length & 0x7F
            guard lengthByteCount >= 1, lengthByteCount <= 4,
                  offset + lengthByteCount <= bytes.count else { return nil }
            length = 0
            for _ in 0..<lengthByteCount {
                length = (length << 8) | Int(bytes[offset])
                offset += 1
            }
        }
        guard offset + length <= bytes.count else { return nil }
        let content = Array(bytes[offset..<(offset + length)])
        offset += length
        return DERTLV(tag: tag, content: content)
    }
}

// MARK: - Issuer name

/// Attribute type OIDs (DER content bytes) to RDN labels, matching the labels
/// Android's X500Principal.getName() emits.
private let attributeLabels: [[UInt8]: String] = [
    [0x55, 0x04, 0x03]: "CN",
    [0x55, 0x04, 0x06]: "C",
    [0x55, 0x04, 0x07]: "L",
    [0x55, 0x04, 0x08]: "ST",
    [0x55, 0x04, 0x0A]: "O",
    [0x55, 0x04, 0x0B]: "OU",
    [0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x01]: "EMAILADDRESS",
]

/// Name ::= SEQUENCE OF RelativeDistinguishedName; RDN ::= SET OF
/// AttributeTypeAndValue ::= SEQUENCE { type OID, value }. Unknown attribute
/// types are skipped rather than failing the whole name.
private func issuerName(_ nameContent: [UInt8]) -> String? {
    var parts: [String] = []
    var rdnReader = DERReader(nameContent)
    while let rdn = rdnReader.next() {
        guard rdn.tag == 0x31 else { continue }
        var atvReader = DERReader(rdn.content)
        while let atv = atvReader.next() {
            guard atv.tag == 0x30 else { continue }
            var fieldReader = DERReader(atv.content)
            guard let oid = fieldReader.next(), oid.tag == 0x06,
                  let label = attributeLabels[oid.content],
                  let value = fieldReader.next(),
                  let str = derString(value) else { continue }
            parts.append("\(label)=\(str)")
        }
    }
    return parts.isEmpty ? nil : parts.joined(separator: ", ")
}

private func derString(_ tlv: DERTLV) -> String? {
    switch tlv.tag {
    case 0x0C, 0x13, 0x14, 0x16: // UTF8String, PrintableString, T61String, IA5String
        return String(bytes: tlv.content, encoding: .utf8)
            ?? String(bytes: tlv.content, encoding: .isoLatin1)
    case 0x1E: // BMPString
        return String(bytes: tlv.content, encoding: .utf16BigEndian)
    default:
        return nil
    }
}

// MARK: - Validity notAfter

private let derDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyyMMddHHmmss'Z'"
    return formatter
}()

private func notAfterString(_ validityContent: [UInt8]) -> String? {
    var reader = DERReader(validityContent)
    guard reader.next() != nil, // notBefore
          let notAfter = reader.next(),
          let date = derDate(notAfter) else { return nil }
    return certExpiryFormatter.string(from: date)
}

private func derDate(_ tlv: DERTLV) -> Date? {
    guard var str = String(bytes: tlv.content, encoding: .ascii) else { return nil }
    if tlv.tag == 0x17 {
        // UTCTime YYMMDDHHMMSSZ; RFC 5280: YY >= 50 means 19YY, else 20YY.
        guard str.count == 13, let yy = Int(str.prefix(2)) else { return nil }
        str = (yy >= 50 ? "19" : "20") + str
    } else if tlv.tag != 0x18 {
        // 0x18 is GeneralizedTime YYYYMMDDHHMMSSZ.
        return nil
    }
    guard str.count == 15 else { return nil }
    return derDateFormatter.date(from: str)
}
