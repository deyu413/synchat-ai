// src/utils/logger.js

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4, // Special level to disable all logs
};

// Determine log level from environment variable, default to INFO for production, DEBUG for development
const getCurrentLogLevel = () => {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  if (envLevel && LOG_LEVELS.hasOwnProperty(envLevel)) {
    return LOG_LEVELS[envLevel];
  }
  return process.env.NODE_ENV === 'development' ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;
};

let appLogLevel = getCurrentLogLevel();

const log = (level, ...args) => {
  if (level >= appLogLevel) {
    const timestamp = new Date().toISOString();
    switch (level) {
      case LOG_LEVELS.DEBUG:
        console.debug(`[${timestamp}] [DEBUG]`, ...args);
        break;
      case LOG_LEVELS.INFO:
        console.info(`[${timestamp}] [INFO]`, ...args);
        break;
      case LOG_LEVELS.WARN:
        console.warn(`[${timestamp}] [WARN]`, ...args);
        break;
      case LOG_LEVELS.ERROR:
        console.error(`[${timestamp}] [ERROR]`, ...args);
        break;
      default:
        // Should not happen if used correctly
        console.log(`[${timestamp}]`, ...args);
    }
  }
};

const logger = {
  debug: (...args) => log(LOG_LEVELS.DEBUG, ...args),
  info: (...args) => log(LOG_LEVELS.INFO, ...args),
  warn: (...args) => log(LOG_LEVELS.WARN, ...args),
  error: (...args) => log(LOG_LEVELS.ERROR, ...args),

  // Method to dynamically change log level if needed (e.g., for testing or specific requests)
  setLevel: (newLevelName) => {
    const upperLevelName = newLevelName?.toUpperCase();
    if (upperLevelName && LOG_LEVELS.hasOwnProperty(upperLevelName)) {
      console.info(`[${new Date().toISOString()}] [INFO] Log level changed to: ${upperLevelName}`);
      appLogLevel = LOG_LEVELS[upperLevelName];
    } else {
      console.warn(`[${new Date().toISOString()}] [WARN] Invalid log level: ${newLevelName}. Not changed.`);
    }
  },
  // Method to get current log level name (for debugging the logger itself)
  getLevel: () => {
    return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === appLogLevel);
  }
};

export default logger;
