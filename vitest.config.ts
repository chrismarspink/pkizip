import { defineConfig } from 'vitest/config';
import path from 'path';

// 암호 코어 골든 테스트 전용 설정.
// Node 20+ 전역 Web Crypto(crypto.subtle)를 그대로 사용하므로 jsdom 불필요.
// IndexedDB/localStorage/WebAuthn에 의존하는 모듈(key-manager/biometric/pin 등)은
// 여기서 직접 테스트하지 않고, 순수 암호·직렬화 경로만 검증한다.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
