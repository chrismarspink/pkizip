import { describe, it, expect, vi } from 'vitest';
import {
  zeroShotToGradeScores, createZeroShotInfer, ZS_LABELS, type ZeroShotFn,
} from './neural';

describe('T3 zero-shot 매핑', () => {
  it('zeroShotToGradeScores: 라벨 문자열 → 등급 점수', () => {
    const L = ZS_LABELS.ko;
    const result = {
      labels: [L.CONFIDENTIAL, L.OPEN, L.SENSITIVE],
      scores: [0.7, 0.2, 0.1],
    };
    const s = zeroShotToGradeScores(result, 'ko');
    expect(s.CONFIDENTIAL).toBeCloseTo(0.7);
    expect(s.OPEN).toBeCloseTo(0.2);
    expect(s.SENSITIVE).toBeCloseTo(0.1);
  });

  it('알 수 없는 라벨은 무시 (0 유지)', () => {
    const s = zeroShotToGradeScores({ labels: ['nonsense'], scores: [0.9] }, 'ko');
    expect(s).toEqual({ OPEN: 0, SENSITIVE: 0, CONFIDENTIAL: 0 });
  });

  it('createZeroShotInfer: 주입 파이프라인으로 GradeScores 산출 (모델 로드 없음)', async () => {
    const seen: { text: string; labels: string[] }[] = [];
    const fakePipe: ZeroShotFn = async (text, labels) => {
      seen.push({ text, labels });
      return { labels, scores: [0.1, 0.2, 0.7] }; // labels 순서 = [OPEN, SENSITIVE, CONFIDENTIAL]
    };
    const infer = createZeroShotInfer({ locale: 'ko', pipeline: fakePipe });
    const s = await infer('테스트 윈도우', 0);

    expect(s.CONFIDENTIAL).toBeCloseTo(0.7);
    // 후보 라벨은 ko ZS_LABELS 값
    expect(seen[0].labels).toEqual(Object.values(ZS_LABELS.ko));
  });

  it('locale에 따라 후보 라벨이 달라짐 (en)', async () => {
    const fakePipe = vi.fn<ZeroShotFn>(async (_t, labels) => ({ labels, scores: [1, 0, 0] }));
    const infer = createZeroShotInfer({ locale: 'en', pipeline: fakePipe });
    await infer('doc', 0);
    expect(fakePipe.mock.calls[0][1]).toEqual(Object.values(ZS_LABELS.en));
  });

  it('주입 파이프라인은 윈도우마다 재사용 (로드 1회 계약)', async () => {
    const fakePipe = vi.fn<ZeroShotFn>(async (_t, labels) => ({ labels, scores: [1, 0, 0] }));
    const infer = createZeroShotInfer({ pipeline: fakePipe });
    await infer('w1', 0);
    await infer('w2', 1);
    expect(fakePipe).toHaveBeenCalledTimes(2);
  });
});
