import { type Page } from '@playwright/test';
import { test as authTest, expect } from './auth.fixture';
import {
  createTeamViaApi,
  deleteTeamViaApi,
  deleteMeetingViaApi,
  createCompletedMeetingViaApi,
  type TestTeam,
  type TestMeeting,
} from '../helpers/api';

type DataFixtures = {
  testTeam: TestTeam;
  completedMeeting: TestMeeting;
  authenticatedPageWithData: Page;
};

export const test = authTest.extend<DataFixtures>({
  testTeam: async ({ testUser }, use) => {
    const team = await createTeamViaApi(testUser.token, { name: 'E2E 테스트팀' });
    await use(team);
    try {
      await deleteTeamViaApi(testUser.token, team.id);
    } catch {
      // 무시
    }
  },

  completedMeeting: async ({ testUser, testTeam }, use) => {
    const meeting = await createCompletedMeetingViaApi(testUser.token, testTeam.id);
    await use(meeting);
    try {
      await deleteMeetingViaApi(testUser.token, meeting.id);
    } catch {
      // 무시
    }
  },

  authenticatedPageWithData: async ({ authenticatedPage }, use) => {
    await use(authenticatedPage);
  },
});

export { expect };
