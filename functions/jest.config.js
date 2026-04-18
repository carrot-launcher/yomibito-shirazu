/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // firebase-admin の初期化を伴う index.ts を直接 import するとテスト中にエラーが出るので、
  // 各テストは index.ts からの直接 import を避け、純粋モジュール（validation.ts 等）のみをテストする。
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};
