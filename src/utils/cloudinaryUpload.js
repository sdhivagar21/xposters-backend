const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");

// Uploads an in-memory file buffer (from multer) to Cloudinary without ever
// touching disk — important since Render's filesystem is ephemeral.
function uploadBufferToCloudinary(buffer, { folder = "xposters" } = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

function deleteFromCloudinary(publicId) {
  if (!publicId) return Promise.resolve();
  return cloudinary.uploader.destroy(publicId).catch(() => {
    // Non-fatal — an orphaned Cloudinary asset isn't worth failing the request over.
  });
}

module.exports = { uploadBufferToCloudinary, deleteFromCloudinary };
