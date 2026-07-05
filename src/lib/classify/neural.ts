/**
 * T3 — 신경망 분류 어댑터 (mDeBERTa zero-shot, 온디바이스).
 *
 * @huggingface/transformers(onnxruntime-web + 토크나이저)로 브라우저에서 mDeBERTa를
 * 실행하는 `ChunkInfer`를 만든다. 대용량 파일은 windowing.classifyWindowed 가 청킹하고,
 * 이 어댑터는 각 윈도우를 zero-shot NLI로 채점한다.
 *
 * 모델은 dynamic import + 지연 로드(메인 번들 미포함, 최초 사용 시 1회 로드).
 * 파이프라인은 주입 가능(opts.pipeline) → 실제 모델 없이 매핑 로직을 테스트한다.
 */
import { type ChunkInfer, type GradeScores, type Grade } from './windowing';

// UECM neural.py:90-103 의 ZS_LABELS 이식 (NLI hypothesis 문구, 로케일별)
export const ZS_LABELS: Record<string, Record<Grade, string>> = {
  ko: {
    OPEN: '공개 가능한 일반 문서',
    SENSITIVE: '이름·전화·이메일 등 개인정보가 포함된 민감 문서',
    CONFIDENTIAL: '주민등록번호·금융 정보·기밀 라벨이 포함된 기밀 문서',
  },
  ja: {
    OPEN: '公開可能な一般文書',
    SENSITIVE: '氏名・電話・メール等の個人情報を含む機微文書',
    CONFIDENTIAL: 'マイナンバー・金融情報・機密ラベルを含む機密文書',
  },
  en: {
    OPEN: 'a public document',
    SENSITIVE: 'a document containing personal information like emails or phones',
    CONFIDENTIAL: 'a confidential document with SSNs or financial credentials',
  },
  'zh-CN': {
    OPEN: '可公开的一般文档',
    SENSITIVE: '包含姓名、电话、邮箱等个人信息的敏感文档',
    CONFIDENTIAL: '包含身份证号、金融信息、机密标签的机密文档',
  },
};

/** transformers.js zero-shot 파이프라인의 최소 호출 시그니처 */
export type ZeroShotFn = (
  text: string,
  candidateLabels: string[],
  options?: { multi_label?: boolean },
) => Promise<{ labels: string[]; scores: number[] }>;

/** zero-shot 결과({labels,scores})를 등급별 점수로 매핑 (순수 함수 — 테스트 가능) */
export function zeroShotToGradeScores(
  result: { labels: string[]; scores: number[] },
  locale = 'ko',
): GradeScores {
  const labels = ZS_LABELS[locale] ?? ZS_LABELS.ko;
  const inv = new Map<string, Grade>();
  (Object.keys(labels) as Grade[]).forEach(g => inv.set(labels[g], g));

  const scores: GradeScores = { OPEN: 0, SENSITIVE: 0, CONFIDENTIAL: 0 };
  for (let i = 0; i < result.labels.length; i++) {
    const g = inv.get(result.labels[i]);
    if (g) scores[g] = result.scores[i] ?? 0;
  }
  return scores;
}

export const DEFAULT_ZS_MODEL = 'Xenova/mDeBERTa-v3-base-mnli-xnli';

export interface ZeroShotInferOptions {
  locale?: string;
  modelId?: string;
  /** 주입 시 모델 로딩 생략 (테스트/재사용) */
  pipeline?: ZeroShotFn;
  device?: 'wasm' | 'webgpu';
  dtype?: 'q8' | 'fp16' | 'fp32';
  onLoad?: () => void;
}

// dynamic import 대상의 최소 타입 (버전 간 안정성 위해 느슨하게)
type TransformersModule = {
  pipeline: (
    task: string, model: string, opts?: Record<string, unknown>,
  ) => Promise<ZeroShotFn>;
};

/**
 * mDeBERTa zero-shot 기반 ChunkInfer 생성.
 * classifyWindowed(text, createZeroShotInfer({locale}), {onProgress}) 형태로 사용.
 */
export function createZeroShotInfer(opts: ZeroShotInferOptions = {}): ChunkInfer {
  const locale = opts.locale ?? 'ko';
  const candidateLabels = Object.values(ZS_LABELS[locale] ?? ZS_LABELS.ko);

  let pipePromise: Promise<ZeroShotFn> | null = null;
  const getPipe = (): Promise<ZeroShotFn> => {
    if (opts.pipeline) return Promise.resolve(opts.pipeline);
    if (!pipePromise) {
      pipePromise = (async () => {
        // 지연 로드 — 메인 번들에 포함되지 않도록 dynamic import (전략 3.2: 모델 아티팩트 분리)
        // 저장소 공용 @xenova/transformers(v2, onnxruntime-web) 사용 — 중복 의존성 회피.
        const mod = (await import('@xenova/transformers')) as unknown as TransformersModule;
        const pipe = await mod.pipeline('zero-shot-classification', opts.modelId ?? DEFAULT_ZS_MODEL, {
          quantized: true,
        });
        opts.onLoad?.();
        return pipe;
      })();
    }
    return pipePromise;
  };

  return async (window: string): Promise<GradeScores> => {
    const pipe = await getPipe();
    const result = await pipe(window, candidateLabels, { multi_label: false });
    return zeroShotToGradeScores(result, locale);
  };
}
