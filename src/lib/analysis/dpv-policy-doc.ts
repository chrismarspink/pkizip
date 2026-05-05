/**
 * PIPA 제30조 개인정보 처리방침 자동 생성.
 *
 * DPV 통계 (data_categories / applied_measures) 로부터 일부 항목 자동 채움.
 * 회사·DPO 정보는 사용자가 입력 → placeholder 치환.
 *
 * 출력: HTML 문서 (window.print() 로 PDF 변환).
 * 별도 PDF 라이브러리 필요 X — 한국어 폰트는 시스템 폰트 사용.
 */
import type { DpvStats } from './dpv-stats';
import { dpvLabel } from '../policy/standards/dpv-labels';

export interface PolicyDocInput {
  companyName: string;
  dpoName: string;
  dpoEmail: string;
  dpoPhone?: string;
  retentionYears?: number;
  effectiveDate?: string;
}

/** PIPA 제30조 처리방침 HTML 생성 — print-friendly. */
export function buildPolicyDocHtml(stats: DpvStats, inp: PolicyDocInput): string {
  const today = inp.effectiveDate || new Date().toISOString().slice(0, 10);
  const retention = inp.retentionYears ?? 5;

  const dataCategoriesList = stats.dataCategories.length > 0
    ? stats.dataCategories.map(c => `<li>${dpvLabel(c.iri, 'ko')} <span class="iri">(${c.iri})</span> — ${c.count}건</li>`).join('')
    : '<li class="empty">집계된 카테고리 없음</li>';

  const measuresList = stats.appliedMeasures.length > 0
    ? stats.appliedMeasures.map(m => `<li>${dpvLabel(m.iri, 'ko')} <span class="iri">(${m.iri})</span></li>`).join('')
    : '<li class="empty">집계된 조치 없음</li>';

  const totalEnvelopes = stats.totalEnvelopes;
  const dpvCoverage = totalEnvelopes > 0
    ? Math.round((stats.envelopesWithDpv / totalEnvelopes) * 100)
    : 0;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${inp.companyName} 개인정보 처리방침</title>
<style>
  body { font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
         color: #222; max-width: 720px; margin: 30px auto; padding: 0 20px; line-height: 1.7; font-size: 12pt; }
  h1 { font-size: 20pt; border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { font-size: 14pt; margin-top: 28px; color: #1a3c5e; border-left: 4px solid #1a3c5e; padding-left: 10px; }
  h3 { font-size: 12pt; margin-top: 16px; color: #444; }
  ul { padding-left: 24px; }
  li { margin-bottom: 4px; }
  .meta { background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 10pt; color: #666; }
  .iri { font-family: Menlo, monospace; font-size: 9pt; color: #884; }
  .empty { color: #999; font-style: italic; }
  .placeholder { background: #fffbe6; padding: 2px 4px; border: 1px dashed #d4a90b; border-radius: 3px; font-size: 10pt; }
  .small { font-size: 9pt; color: #777; margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; }
  table { border-collapse: collapse; margin: 8px 0; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; font-size: 10pt; }
  th { background: #f0f0f0; }
  @media print {
    body { margin: 0; padding: 20mm; max-width: none; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<div class="no-print" style="background: #e8f5e9; padding: 12px; border-radius: 6px; margin-bottom: 20px; font-size: 10pt;">
  💡 이 페이지는 자동 생성된 PIPA 제30조 개인정보 처리방침 초안입니다.
  <strong>법무 검토 후 사용</strong>하시고, <code style="background:#fff;padding:1px 4px;">[Cmd/Ctrl+P]</code> 로 PDF 저장 가능합니다.
  <br>
  <span class="placeholder">노란 배경</span> 으로 표시된 항목은 회사 상황에 맞게 수정이 필요합니다.
</div>

<h1>${inp.companyName} 개인정보 처리방침</h1>

<div class="meta">
  <strong>적용일자</strong>: ${today}<br>
  <strong>자동 생성 근거</strong>: PKIZIP 봉투 메타 ${stats.envelopesWithDpv}건 (전체 ${totalEnvelopes}건 중 ${dpvCoverage}% 커버리지) ·
  W3C DPV v2 표준 어휘 기반
</div>

<h2>1. 개인정보의 처리 목적</h2>
<p>
  ${inp.companyName}(이하 "회사") 는 다음의 목적을 위하여 개인정보를 처리하고 있으며,
  이 외의 목적으로는 이용하지 않습니다.
</p>
<ul>
  <li>서비스 제공 및 운영 (PKIZIP 봉투 처리)</li>
  <li>법적 의무 이행 (전자문서 보관·감사 대비)</li>
  <li class="placeholder">[ 회사 상황에 맞게 추가 — 예: 마케팅·통계 분석 등 ]</li>
</ul>

<h2>2. 개인정보의 처리 및 보유 기간</h2>
<p>
  회사는 법령에 따른 개인정보 보유·이용 기간 또는 정보주체로부터 개인정보를 수집 시에
  동의 받은 개인정보 보유·이용 기간 내에서 개인정보를 처리·보유합니다.
</p>
<ul>
  <li>일반 봉투: <strong>${retention}년</strong> (전자문서 보관 의무 적용)</li>
  <li class="placeholder">[ 항목별 보유 기간 — 예: 회원가입 정보 탈퇴 시까지, 거래 기록 5년 등 ]</li>
</ul>

<h2>3. 처리하는 개인정보의 항목</h2>
<p>회사는 PKIZIP 봉투 메타 분석 결과 다음의 개인정보 항목을 처리하고 있습니다 (자동 집계):</p>
<ul>
  ${dataCategoriesList}
</ul>
<p style="font-size: 10pt; color: #666;">
  ※ 위 항목은 W3C DPV (Data Privacy Vocabulary) v2 표준 어휘 기반으로 자동 분류됨.
  총 처리 봉투 ${totalEnvelopes}건 중 ${stats.envelopesWithPii}건이 개인정보 포함.
</p>

<h2>4. 개인정보의 제3자 제공</h2>
<p>
  회사는 정보주체의 별도 동의, 법률의 특별한 규정 등 개인정보 보호법 제17조 및 제18조에 해당하는
  경우 외에는 개인정보를 제3자에게 제공하지 않습니다.
</p>
<ul>
  <li class="placeholder">[ 제공받는 자 / 제공 목적 / 제공 항목 / 보유기간 — 회사 상황에 맞게 작성 ]</li>
</ul>

<h2>5. 개인정보 처리의 위탁</h2>
<p>회사는 원활한 개인정보 업무처리를 위하여 다음과 같이 개인정보 처리업무를 위탁하고 있습니다:</p>
<ul>
  <li class="placeholder">[ 위탁 받는 자 (수탁자) / 위탁업무 내용 — 예: 결제대행, 클라우드 인프라 등 ]</li>
</ul>

<h2>6. 정보주체의 권리·의무 및 행사 방법</h2>
<p>정보주체는 회사에 대하여 언제든지 다음과 같은 개인정보 보호 관련 권리를 행사할 수 있습니다:</p>
<ul>
  <li>개인정보 처리현황 통지요구 (열람) — 개인정보 보호법 제35조</li>
  <li>오류 등이 있을 경우 정정·삭제 요구 — 제36조</li>
  <li>처리정지 요구 — 제37조</li>
  <li>손해배상청구 — 제39조</li>
</ul>
<p>
  권리 행사는 회사의 개인정보 보호책임자 (아래 8항) 에게 서면, 전자우편, 모사전송(FAX) 등을
  통하여 하실 수 있으며 회사는 이에 대해 지체 없이 (요청일로부터 10일 이내) 조치하겠습니다.
</p>

<h2>7. 개인정보의 안전성 확보 조치</h2>
<p>회사는 개인정보 보호법 제29조에 따라 다음과 같은 안전성 확보 조치를 취하고 있습니다 (PKIZIP 봉투 메타 자동 집계):</p>
<ul>
  ${measuresList}
</ul>
<p style="font-size: 10pt; color: #666;">
  ※ 모든 조치는 W3C DPV v2 의 dpv:TechnicalMeasure 어휘로 표준 분류됨.
  PKIZIP 봉투 헤더 (CMS 평문 메타) 에 자동 부착되어 위변조 방지 (서명 대상 포함).
</p>
<ul>
  <li class="placeholder">[ 조직적 조치 — 내부 관리계획 수립·시행, 정기 직원 교육 등 추가 가능 ]</li>
</ul>

<h2>8. 개인정보 보호책임자</h2>
<p>회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리와 관련한 정보주체의
불만처리 및 피해구제 등을 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다:</p>
<table>
  <tr><th>구분</th><th>내용</th></tr>
  <tr><td>성명</td><td>${inp.dpoName || '<span class="placeholder">[ DPO 성명 ]</span>'}</td></tr>
  <tr><td>이메일</td><td>${inp.dpoEmail || '<span class="placeholder">[ DPO 이메일 ]</span>'}</td></tr>
  ${inp.dpoPhone ? `<tr><td>연락처</td><td>${inp.dpoPhone}</td></tr>` : ''}
</table>

<h2>9. 처리방침의 변경</h2>
<p>이 개인정보 처리방침은 ${today} 부터 적용되며, 법령 및 방침에 따른 변경내용의 추가, 삭제 및
정정이 있는 경우에는 변경사항의 시행 7일 전부터 공지사항을 통하여 고지할 것입니다.</p>

<div class="small">
  생성: PKIZIP DPV 통계 페이지 자동 생성<br>
  근거 표준: W3C Data Privacy Vocabulary v2 (https://w3id.org/dpv/v2)<br>
  법적 근거: 개인정보 보호법 제30조 (개인정보 처리방침의 수립 및 공개)<br>
  ⚠ 본 문서는 자동 생성된 초안입니다 — 시행 전 반드시 법무 검토 필요.
</div>

</body>
</html>`;
}

/** 새 창에 처리방침 HTML 띄우고 자동 인쇄 다이얼로그 호출. */
export function openPolicyDocPrint(stats: DpvStats, inp: PolicyDocInput): void {
  const html = buildPolicyDocHtml(stats, inp);
  const win = window.open('', '_blank', 'width=900,height=900');
  if (!win) {
    // 팝업 차단 시 fallback — Blob URL
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // 페이지 로드 후 인쇄 다이얼로그 호출
  win.addEventListener('load', () => {
    setTimeout(() => win.print(), 300);
  });
}
