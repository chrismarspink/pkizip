/**
 * Buffer Utilities
 *
 * Node.js 23+에서 Uint8Array.buffer가 ArrayBufferLike로 변경되면서
 * Web Crypto API의 BufferSource 타입과 호환되지 않는 문제를 해결하는
 * 유틸리티 함수들
 */

/**
 * Uint8Array를 Web Crypto API 호환 ArrayBuffer로 변환
 */
export function toBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
