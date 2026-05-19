#!/usr/bin/env node
/**
 * OCR 테스트 이미지 생성 — 4개 언어 × 3개씩.
 *
 * macOS 시스템 폰트 + ImageMagick 7 사용. 각 이미지에는 PII 가 포함된
 * 짧은 문서 (회원가입 영수증·고객 메모·계약 단편 등) 를 그린다.
 *
 * 출력: test-data/samples-images/{ko,en,ja,zh}/sample_NN.png
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OUT_BASE = 'test-data/samples-images';

const FONTS = {
  ko: '.Apple-SD-Gothic-NeoI-Regular',
  en: 'Helvetica',
  ja: '.Hiragino-Kaku-Gothic-Interface-W3',
  zh: 'Heiti-SC-Light',
};

const SAMPLES = {
  ko: [
    `[회원가입 영수증]
이름: 김민지
주민등록번호: 920304-2345678
이메일: minji.kim@example.co.kr
연락처: 010-2345-6789
주소: 서울특별시 강남구 테헤란로 521, 902호
가입일: 2026-05-12
회원등급: VIP`,
    `[고객 상담 메모]
상담일시: 2026-05-15 14:30
담당자: 박서준 (부장)
고객 정보
  - 성명: 홍길동
  - 휴대전화: 010-1234-5678
  - 카드번호 끝 4자리: 4321
  - 거래은행: 국민은행 110-2345-678901
요청: 카드 분실 신고 및 재발급`,
    `[근로계약서 발췌]
근로자: 이서연
주민번호: 880910-2*****
주소: 부산광역시 해운대구 우동 1234-56
계약기간: 2026.06.01 ~ 2027.05.31
연봉: 4,800만원 (월 400만원, 세전)
계좌이체: 신한은행 110-456-789012`,
  ],
  en: [
    `[Customer Receipt]
Name: John A. Smith
Email: john.smith@example.com
Phone: (415) 555-0142
SSN: 123-45-6789
Address: 1280 Mission St, Apt 4B
         San Francisco, CA 94103
Date: 2026-05-12
Membership: Gold`,
    `[Service Order]
Order #: SO-2026-04881
Customer: Emily Johnson
DOB: 1989-07-22
Card: VISA **** **** **** 4321
Email: emily.j@example.com
Phone: 415-555-0199
Total: USD 1,249.00
Status: Paid`,
    `[Medical Record Excerpt]
Patient: Michael R. Davis
MRN: MR-2026-00781
Date of Visit: 2026-05-08
Provider: Dr. Sarah Lee
Diagnosis: Hypertension (I10)
Insurance: HealthPlus Gold (Member ID: HP-558-204-991)
Phone: 212-555-0177`,
  ],
  ja: [
    `[会員登録控え]
氏名: 山田 太郎
ふりがな: やまだ たろう
住所: 東京都港区六本木 6-10-1
電話: 080-1234-5678
メール: taro.yamada@example.co.jp
マイナンバー: 1234 5678 9012
登録日: 2026年5月12日`,
    `[診療予約票]
予約番号: AB-202605-0481
患者氏名: 佐藤 美咲
生年月日: 1992年3月15日
連絡先: 090-8765-4321
住所: 大阪府大阪市北区梅田 2-4-9
担当医: 鈴木 健一郎
診療科: 内科 ・ 予約日 2026年5月20日 10:00`,
    `[業務委託契約抜粋]
受託者: 田中 一郎
住所: 神奈川県横浜市西区みなとみらい 3-1
口座: みずほ銀行 横浜支店 普通 1234567
連絡先メール: ichiro.tanaka@example.co.jp
契約期間: 2026年6月1日 ~ 2027年5月31日
業務委託料: 月額 60万円(税抜)`,
  ],
  zh: [
    `[会员登记表]
姓名: 张伟
身份证号: 110101199001234567
手机: 13812345678
邮箱: zhang.wei@example.com.cn
住址: 北京市朝阳区建国路 88 号 SOHO 现代城 12-302
登记日期: 2026-05-12
会员等级: 钻石`,
    `[就诊预约单]
预约号: HZ-2026-05-1287
姓名: 李娜
出生日期: 1991-08-04
联系电话: 13900012345
住址: 上海市浦东新区世纪大道 100 号
就诊科室: 内分泌科
就诊日期: 2026-05-22 09:30
主治医师: 王建国`,
    `[劳动合同节选]
劳动者: 陈晓东
身份证: 320105198507238912
银行账号: 中国工商银行 6222 0202 1234 5678
住址: 江苏省南京市鼓楼区中山北路 88 号
合同期: 2026 年 6 月 1 日 至 2028 年 5 月 31 日
月薪: 人民币 18,000 元(税前)`,
  ],
};

for (const [lang, samples] of Object.entries(SAMPLES)) {
  const font = FONTS[lang];
  const dir = path.join(OUT_BASE, lang);
  mkdirSync(dir, { recursive: true });

  samples.forEach((text, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const out = path.join(dir, `sample_${num}.png`);
    // caption: 은 텍스트를 자동 줄바꿈, 폭 지정 시 높이 자동 산정.
    // 텍스트는 임시 파일로 넘겨 따옴표/특수문자 이스케이프 회피.
    const tmpfile = path.join(tmpdir(), `ocr-${lang}-${num}-${Date.now()}.txt`);
    writeFileSync(tmpfile, text, 'utf8');
    try {
      execFileSync('magick', [
        '-background', 'white',
        '-fill', 'black',
        '-font', font,
        '-pointsize', '26',
        '-size', '900x',
        'caption:@' + tmpfile,
        '-bordercolor', 'white',
        '-border', '30x30',
        out,
      ], { stdio: ['ignore', 'inherit', 'inherit'] });
      console.log(`✓ ${out}`);
    } finally {
      try { rmSync(tmpfile); } catch { /* ignore */ }
    }
  });
}

console.log('\nDone.');
