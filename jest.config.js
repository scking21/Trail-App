/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.test.js'],
  // Only .ts files go through ts-jest; existing plain-JS tests (geo.test.js)
  // run untransformed as CommonJS, exactly as before.
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', esModuleInterop: true, strict: false } },
    ],
  },
};
