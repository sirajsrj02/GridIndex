'use strict';

module.exports = {
  testEnvironment: 'node',

  // Only run our own tests — not anything inside node_modules
  testMatch: ['<rootDir>/src/tests/**/*.test.js'],

  // Set environment variables before any module is loaded
  setupFiles: ['<rootDir>/src/tests/setup.js'],

  // Per-test timeout (auth bcrypt can be slow)
  testTimeout: 15000,

  // Coverage config (run with --coverage flag)
  collectCoverageFrom: [
    'src/config/**/*.js',
    'src/middleware/**/*.js',
    'src/routes/**/*.js',
    'src/services/**/*.js',
    'src/utils/**/*.js',
    '!src/db/migrate.js',
    '!src/jobs/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov']
};
