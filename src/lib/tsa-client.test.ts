// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requestTst, isDirectTsaCapable, TSA_PROXY_URL } from './tsa-client';
import type { TsaServer } from './tsa-health';

const server: TsaServer = {
  id: 'test', name: 'Test TSA', url: 'https://tsa.example.org/tsr', priority: 1, enabled: true,
};
const reqDer = new Uint8Array([1, 2, 3, 4]);

// TSA timestamp-reply 응답 스텁
function tsReply() {
  return {
    ok: true,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/timestamp-reply' : null) },
    arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
    text: async () => '',
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async () => tsReply());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('C5 — TSA 전송 경로 선택', () => {
  it('PWA 기본: 직결 불가로 판단하여 프록시만 호출', () => {
    expect(isDirectTsaCapable()).toBe(false);
  });

  it('PWA: requestTst는 TSA에 직접 접속하지 않고 프록시 URL로 POST', async () => {
    await requestTst(server, reqDer, 3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(TSA_PROXY_URL);
    // 실제 TSA URL은 헤더로만 전달 (직접 접속 아님)
    expect((init as RequestInit).headers).toMatchObject({ 'x-tsa-url': server.url });
    // 서버 URL로의 직접 fetch는 없어야 함 (CORS 콘솔 에러 방지)
    expect(fetchMock.mock.calls.some(c => c[0] === server.url)).toBe(false);
  });

  it('옵트인 시 직결 가능으로 전환', () => {
    localStorage.setItem('pkizip-tsa-allow-direct', '1');
    expect(isDirectTsaCapable()).toBe(true);
  });

  it('직결 가능 컨텍스트: requestTst가 TSA URL로 직접 POST (프록시 미사용)', async () => {
    localStorage.setItem('pkizip-tsa-allow-direct', '1');
    await requestTst(server, reqDer, 3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(server.url);
    expect(fetchMock.mock.calls.some(c => c[0] === TSA_PROXY_URL)).toBe(false);
  });

  it('프록시 URL은 C4 백엔드 단일 소스에서 도출된다', () => {
    expect(TSA_PROXY_URL).toContain('/functions/v1/tsa-proxy');
  });
});
