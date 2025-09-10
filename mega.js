const mega = require("megajs");

// Replace these with your REAL MEGA.nz credentials
const MEGA_CREDENTIALS = {
  email: "darkalpha768@gmail.com",    // ← CHANGE THIS
  password: "Charuka55%%",          // ← CHANGE THIS
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

const uploadToMega = (filePath, fileName) => {
  return new Promise((resolve, reject) => {
    const storage = new mega.Storage(MEGA_CREDENTIALS);

    storage.on("ready", () => {
      console.log("MEGA storage ready for upload:", fileName);
      
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
        reject(err);
      });

      readStream.pipe(uploadStream);
    });

    storage.on("error", (err) => {
      reject(err);
    });
  });
};

module.exports = { uploadToMega };

