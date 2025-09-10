const mega = require("megajs");
const fs = require("fs");

const auth = {
  email: "drakalpha768@gmail.com",
  password: "Charuka55??",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

const uploadToMega = (filePath, fileName) => {
  return new Promise((resolve, reject) => {
    const storage = new mega.Storage(auth);

    storage.on("ready", () => {
      console.log("MEGA storage ready. Uploading:", fileName);

      const readStream = fs.createReadStream(filePath);
      const uploadStream = storage.upload({ 
        name: fileName, 
        allowUploadBuffering: true 
      });

      uploadStream.on("complete", (file) => {
        file.link((err, url) => {
          if (err) {
            reject(err);
          } else {
            console.log("Upload successful:", url);
            storage.close();
            resolve(url);
          }
        });
      });

      uploadStream.on("error", (err) => {
        console.error("Upload error:", err);
        reject(err);
      });

      readStream.pipe(uploadStream);
    });

    storage.on("error", (err) => {
      console.error("MEGA storage error:", err);
      reject(err);
    });
  });
};

module.exports = { uploadToMega };
