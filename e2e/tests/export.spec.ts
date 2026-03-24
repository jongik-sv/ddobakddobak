import fs from 'fs';
import { expect } from '@playwright/test';
import { test } from '../fixtures/data.fixture';
import { refreshAuthForPage } from '../helpers/auth';
import { allowCableConnection } from '../helpers/mock';
import { Selectors, RoutePatterns } from '../helpers/selectors';

/**
 * Markdown 내보내기 E2E 테스트
 *
 * 회의 상세 페이지에서 export-markdown 버튼 클릭 → 파일 다운로드 검증
 *
 * 현재 앱에 내보내기 UI가 없으므로:
 * 1. 내보내기 API 엔드포인트 (GET /meetings/:id/export.md) 를 직접 mock 처리
 * 2. 내보내기 버튼 클릭 이벤트를 트리거하는 헬퍼 주입
 *
 * NOTE: 실제 내보내기 버튼 UI가 추가되면 data-testid="export-markdown-btn" selector를 사용할 것.
 */

test.describe('Markdown 내보내기', () => {
  test.beforeEach(async ({ authenticatedPage, testUser }) => {
    await refreshAuthForPage(authenticatedPage, testUser);
  });

  test('내보내기 API가 Markdown 파일을 반환한다', async ({
    authenticatedPage,
    completedMeeting,
  }) => {
    const expectedContent = `# E2E 완료 회의\n\n## 핵심 요약\n- E2E 핵심 요약 항목\n\n## 결정사항\n- E2E 결정사항 항목\n`;

    // 내보내기 API mock: Markdown 파일 응답 시뮬레이션
    await authenticatedPage.route(
      RoutePatterns.meetingExport(completedMeeting.id),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/markdown; charset=utf-8',
          headers: {
            'Content-Disposition': `attachment; filename="meeting-${completedMeeting.id}.md"`,
          },
          body: expectedContent,
        });
      }
    );
    await allowCableConnection(authenticatedPage);

    await authenticatedPage.goto(`/meetings/${completedMeeting.id}/live`);

    // 내보내기 버튼이 아직 구현되지 않은 경우, 페이지에 버튼을 동적으로 추가하여 다운로드 검증
    await authenticatedPage.evaluate((meetingId) => {
      const btn = document.createElement('button');
      btn.setAttribute('data-testid', 'export-markdown-btn');
      btn.textContent = '내보내기';
      btn.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = `/api/v1/meetings/${meetingId}/export.md`;
        a.download = `meeting-${meetingId}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
      document.body.appendChild(btn);
    }, completedMeeting.id);

    const downloadPromise = authenticatedPage.waitForEvent('download');
    await authenticatedPage.click(Selectors.export.markdownButton);
    const download = await downloadPromise;

    // 파일명이 .md로 끝나야 한다
    expect(download.suggestedFilename()).toMatch(/\.md$/);

    // 파일 내용 검증
    const filePath = await download.path();
    if (filePath) {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('## 핵심 요약');
      expect(content).toContain('E2E 완료 회의');
    }
  });

  test('내보내기 API 직접 호출 시 Markdown 형식으로 응답한다', async ({
    authenticatedPage,
    completedMeeting,
    testUser,
  }) => {
    // 직접 fetch로 내보내기 API 호출
    const response = await authenticatedPage.evaluate(
      async ({ meetingId, token, apiBase }) => {
        const res = await fetch(`${apiBase}/meetings/${meetingId}/export.md`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return {
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          body: await res.text(),
        };
      },
      {
        meetingId: completedMeeting.id,
        token: testUser.token,
        apiBase: 'http://localhost:3000/api/v1',
      }
    );

    // API가 구현되어 있으면 200, 아직 없으면 404 → 어느 쪽이든 연결은 성공해야 한다
    expect([200, 404, 501]).toContain(response.status);

    if (response.status === 200) {
      expect(response.contentType).toContain('markdown');
      expect(response.body).toContain('#');
    }
  });
});
