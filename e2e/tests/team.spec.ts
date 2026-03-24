import { expect } from '@playwright/test';
import { test } from '../fixtures/auth.fixture';
import { refreshAuthForPage } from '../helpers/auth';
import { Selectors } from '../helpers/selectors';

/**
 * 팀 생성 / 팀 목록 조회 E2E 테스트
 *
 * 실제 TeamPage (/teams):
 *   - 팀 생성 폼: input[type="text"] + button "팀 생성"
 *   - 팀 목록: ul > li > button (팀 이름 + 역할 표시)
 *   - 팀원 초대 폼 (admin 선택 시): input[type="email"] + button "초대"
 */

test.describe('팀 관리', () => {
  test.beforeEach(async ({ authenticatedPage, testUser }) => {
    // 인증 상태 갱신 후 /teams 이동
    await refreshAuthForPage(authenticatedPage, testUser);
    await authenticatedPage.goto('/teams');
  });

  test('팀을 생성하면 팀 목록에 표시된다', async ({ authenticatedPage }) => {
    const teamName = `E2E팀-${Date.now()}`;

    // 팀 이름 입력 후 생성
    await authenticatedPage.fill(Selectors.team.nameInput, teamName);
    await authenticatedPage.click(Selectors.team.createButton);

    // 팀 목록 li > button에 팀 이름이 표시되어야 한다
    await expect(
      authenticatedPage.locator(Selectors.team.teamListItem).filter({ hasText: teamName })
    ).toBeVisible();
  });

  test('빈 팀 이름으로 생성 시도하면 아무 일도 없다', async ({ authenticatedPage }) => {
    // 팀 이름을 비워두고 제출
    await authenticatedPage.fill(Selectors.team.nameInput, '');
    await authenticatedPage.click(Selectors.team.createButton);

    // 에러 알림이 없어야 하고, 팀 목록이 비어있어야 한다
    const teamButtons = authenticatedPage.locator(Selectors.team.teamListItem);
    await expect(teamButtons).toHaveCount(0);
  });

  test('팀 선택 시 팀 상세(팀원 목록 영역)가 표시된다', async ({ authenticatedPage }) => {
    const teamName = `E2E상세팀-${Date.now()}`;

    await authenticatedPage.fill(Selectors.team.nameInput, teamName);
    await authenticatedPage.click(Selectors.team.createButton);

    // 생성된 팀 클릭
    await authenticatedPage.locator(Selectors.team.teamListItem).filter({ hasText: teamName }).click();

    // 팀 상세 영역: h2에 팀 이름, 팀원 목록 테이블 표시
    await expect(authenticatedPage.locator('h2', { hasText: teamName })).toBeVisible();
    await expect(authenticatedPage.locator(Selectors.team.memberTable)).toBeVisible();
  });

  test('팀원을 초대할 수 있다', async ({ authenticatedPage }) => {
    const teamName = `E2E초대팀-${Date.now()}`;
    const inviteEmail = `invite-${Date.now()}@test.com`;

    // 초대 대상 계정 생성
    const { createUser } = await import('../helpers/api');
    await createUser({ email: inviteEmail, password: 'password123', name: '초대대상' });

    await authenticatedPage.fill(Selectors.team.nameInput, teamName);
    await authenticatedPage.click(Selectors.team.createButton);
    await authenticatedPage.locator(Selectors.team.teamListItem).filter({ hasText: teamName }).click();

    // 초대 폼: admin이므로 표시됨
    await authenticatedPage.fill(Selectors.team.inviteEmailInput, inviteEmail);
    await authenticatedPage.click(Selectors.team.inviteButton);

    // 팀원 테이블에 초대한 이메일이 표시된다
    await expect(
      authenticatedPage.locator('table td', { hasText: inviteEmail })
    ).toBeVisible();
  });
});
