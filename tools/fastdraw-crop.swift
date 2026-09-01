// Render one region of a PDF page to a grayscale PNG.
//
// FastDraw prints its plays as vector line art, so a frame can be rendered at
// whatever resolution is wanted rather than resampled from a picture - and
// because the art is black on white, grayscale is both smaller and sharper than
// colour at the same file size (3.8 MB for 50 courts at 16x, against 5.9 MB for
// colour at 12x).
//
//   swiftc -O tools/fastdraw-crop.swift -o /tmp/fastdraw-crop
//   /tmp/fastdraw-crop book.pdf 1 76 628.87 132.89 682.28 16 out.png

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count == 9,
      let page = Int(a[2]), let x0 = Double(a[3]), let y0 = Double(a[4]),
      let x1 = Double(a[5]), let y1 = Double(a[6]), let scale = Double(a[7]),
      let doc = CGPDFDocument(URL(fileURLWithPath: a[1]) as CFURL),
      let pg = doc.page(at: page) else { exit(2) }

let pad = 1.5
let box = CGRect(x: x0 - pad, y: y0 - pad, width: (x1 - x0) + pad*2, height: (y1 - y0) + pad*2)
let w = Int((box.width  * scale).rounded()), h = Int((box.height * scale).rounded())
guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpaceCreateDeviceGray(),
                          bitmapInfo: CGImageAlphaInfo.none.rawValue) else { exit(3) }
ctx.setFillColor(CGColor(gray: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
ctx.scaleBy(x: scale, y: scale)
ctx.translateBy(x: -box.minX, y: -box.minY)
ctx.setAllowsAntialiasing(true)
ctx.drawPDFPage(pg)
guard let img = ctx.makeImage(),
      let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[8]) as CFURL,
                                                UTType.png.identifier as CFString, 1, nil) else { exit(4) }
CGImageDestinationAddImage(dst, img, nil)
CGImageDestinationFinalize(dst)
print("\(w)x\(h) -> \(a[8])")
