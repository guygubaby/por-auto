import Foundation
import Vision
import ImageIO

do {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let original = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "PorOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法读取手机截图"])
    }
    // WeChat renders profile values in light gray; increase contrast before recognizing them.
    let canvas = CGContext(data: nil, width: original.width, height: original.height, bitsPerComponent: 8,
                           bytesPerRow: original.width*4, space: CGColorSpaceCreateDeviceRGB(),
                           bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    canvas?.draw(original, in: CGRect(x: 0, y: 0, width: original.width, height: original.height))
    if let pixels = canvas?.data?.assumingMemoryBound(to: UInt8.self) {
        for i in stride(from: 0, to: original.width*original.height*4, by: 4) {
            for c in 0..<3 { pixels[i+c] = UInt8(max(0, min(255, Int(pixels[i+c])*4-510))) }
        }
    }
    let image = canvas?.makeImage() ?? original
    var words: [[String: Any]] = []
    func recognize(_ input: CGImage, offset: Int, scale: Double) throws {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: input, options: [:]).perform([request])
        for observation in request.results ?? [] {
            guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.5 else { continue }
            let b = observation.boundingBox
            words.append(["text": candidate.string, "bounds": [
                Int(b.minX * Double(input.width) / scale), offset + Int((1-b.maxY) * Double(input.height) / scale),
                Int(b.maxX * Double(input.width) / scale), offset + Int((1-b.minY) * Double(input.height) / scale)
            ]])
        }
    }
    try recognize(image, offset: 0, scale: 1)
    // A zoomed footer makes isolated Chinese tab labels readable without fixed click coordinates.
    let height = max(1, image.height / 8)
    if let footer = image.cropping(to: CGRect(x: 0, y: image.height-height, width: image.width, height: height)),
       let canvas = CGContext(data: nil, width: footer.width*2, height: footer.height*2, bitsPerComponent: 8,
                              bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
        canvas.interpolationQuality = .high
        canvas.draw(footer, in: CGRect(x: 0, y: 0, width: footer.width*2, height: footer.height*2))
        if let zoomed = canvas.makeImage() { try recognize(zoomed, offset: image.height-height, scale: 2) }
    }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: words))
} catch {
    FileHandle.standardError.write(Data("本机文字识别失败：\(error.localizedDescription)".utf8))
    exit(1)
}
