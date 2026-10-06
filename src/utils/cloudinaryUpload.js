const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");

// The two poster sizes almost every visitor actually hits: the grid card
// (ProductCard, width 380) and the homepage marquee (PosterWallRow, width
// 320). Must stay byte-for-byte identical to what the frontend's
// optimizedImage() util (src/utils/cloudinaryUrl.js) builds at request time
// - Cloudinary only treats a live request as a cache hit on this pre-built
// version when the transformation string matches exactly.
//
// Without this, the very first visitor to ever view a given poster at a
// given size pays for Cloudinary downloading + transcoding + resizing the
// full original on the spot (can take several seconds per image) - that's
// what made new images feel slow to load. Generating them right after
// upload means that cost happens once, in the background, instead of on a
// real visitor's page load.
const EAGER_TRANSFORMS = ["f_auto,q_28,w_380", "f_auto,q_28,w_320"];

// Uploads an in-memory file buffer (from multer) to Cloudinary without ever
// touching disk — important since Render's filesystem is ephemeral.
function uploadBufferToCloudinary(buffer, { folder = "xposters" } = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        eager: EAGER_TRANSFORMS,
        eager_async: true, // don't make the admin's upload wait on this
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// Uploads an image from an external URL by having Cloudinary fetch it
// server-side - used for the "paste an image link" custom-poster flow, so a
// pasted link gets the same hosting + width/height metadata as an uploaded
// file, without this server ever downloading the bytes itself.
function uploadRemoteUrlToCloudinary(url, { folder = "xposters" } = {}) {
  return cloudinary.uploader.upload(url, { folder, resource_type: "image" });
}

function deleteFromCloudinary(publicId) {
  if (!publicId) return Promise.resolve();
  return cloudinary.uploader.destroy(publicId).catch(() => {
    // Non-fatal — an orphaned Cloudinary asset isn't worth failing the request over.
  });
}

module.exports = { uploadBufferToCloudinary, uploadRemoteUrlToCloudinary, deleteFromCloudinary };
