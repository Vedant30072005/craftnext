const sharp = require("sharp");
const fs = require("fs");

/**
 * Post-multer middleware factory: recompress every uploaded image in
 * place — resize down to maxWidth (never upscale) and re-encode as
 * quality-80 JPEG. Multi-MB phone photos become fast-loading assets
 * without changing filenames or URLs. Optimization failure is non-fatal:
 * the original upload is kept and the request continues.
 */
function optimizeImages(maxWidth = 1200) {
  return async (req, res, next) => {
    const files = req.files || (req.file ? [req.file] : []);
    await Promise.all(files.map(async (f) => {
      try {
        // Read via fs and hand sharp a buffer — libvips' own path-based
        // open fails on some Windows setups (locale quirk).
        const input = fs.readFileSync(f.path);
        const buf = await sharp(input)
          .rotate() // respect EXIF orientation
          .resize({ width: maxWidth, withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();
        // Only keep the optimized copy if it's actually smaller.
        if (buf.length < f.size) {
          fs.writeFileSync(f.path, buf);
          f.size = buf.length;
        }
      } catch (err) {
        console.warn(`Image optimize skipped for ${f.filename}: ${err.message}`);
      }
    }));
    next();
  };
}

module.exports = optimizeImages;
