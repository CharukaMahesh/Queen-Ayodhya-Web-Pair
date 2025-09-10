const fs = require('fs');
const path = require('path');
const { uploadToMega } = require('./mega');

class SessionManager {
  constructor() {
    this.sessionsDir = './sessions';
    this.ensureSessionsDir();
  }

  ensureSessionsDir() {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  async saveSessionToMega(sessionId, phoneNumber) {
    try {
      const sessionPath = path.join(this.sessionsDir, sessionId);
      const credsFile = path.join(sessionPath, 'creds.json');
      
      if (!fs.existsSync(credsFile)) {
        throw new Error('Session credentials not found');
      }

      // Generate unique filename for MEGA
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const megaFileName = `whatsapp-${phoneNumber}-${timestamp}.json`;
      
      // Upload to MEGA
      const megaUrl = await uploadToMega(credsFile, megaFileName);
      
      console.log('Session saved to MEGA:', megaUrl);
      return megaUrl;
      
    } catch (error) {
      console.error('Failed to save session to MEGA:', error);
      throw error;
    }
  }

  cleanupSession(sessionId) {
    try {
      const sessionPath = path.join(this.sessionsDir, sessionId);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log('Cleaned up session:', sessionId);
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

module.exports = SessionManager;
