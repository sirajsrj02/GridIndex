'use strict';

const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const { combine, timestamp, printf, colorize, errors, json } = format;

const LOG_DIR = path.join(__dirname, '../../logs');

// Human-readable format for console
const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    json()
  ),
  defaultMeta: { service: 'gridindex-api' },
  transports: [
    // Console — colorized for dev, plain for prod
    new transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
      )
    }),
    // Rotating file — all logs
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'gridindex-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'debug'
    }),
    // Separate file for errors only
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'gridindex-errors-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error'
    })
  ],
  // Don't crash the process on unhandled exceptions logged here
  exitOnError: false
});

// Expose child-logger factory so jobs can tag their output
logger.forJob = (jobName) => logger.child({ job: jobName });
logger.forRoute = (route) => logger.child({ route });

module.exports = logger;
