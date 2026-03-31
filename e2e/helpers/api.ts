/**
 * E2E 테스트용 백엔드 API 직접 호출 헬퍼
 * 테스트 setup/teardown에서 사용한다.
 */

const API_BASE = 'http://localhost:13323/api/v1';

export interface TestUser {
  id: number;
  email: string;
  name: string;
  token: string;
  password: string;
}

export interface TestTeam {
  id: number;
  name: string;
  role: 'admin' | 'member';
}

export interface TestMeeting {
  id: number;
  title: string;
  status: string;
  created_at: string;
  team_id: number;
}

async function apiFetch(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  return res;
}

export async function createUser(params: {
  email: string;
  password: string;
  name: string;
}): Promise<TestUser> {
  const res = await apiFetch('/auth/sign_up', {
    method: 'POST',
    body: JSON.stringify({ user: params }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createUser failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return {
    id: data.user.id,
    email: params.email,
    name: params.name,
    token: data.token,
    password: params.password,
  };
}

export async function loginViaApi(params: {
  email: string;
  password: string;
}): Promise<{ token: string; user: { id: number; email: string; name: string } }> {
  const res = await apiFetch('/auth/sign_in', {
    method: 'POST',
    body: JSON.stringify({ user: params }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`loginViaApi failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function deleteUserViaApi(token: string, userId: number): Promise<void> {
  const res = await apiFetch(`/users/${userId}`, { method: 'DELETE' }, token);
  if (!res.ok && res.status !== 404) {
    console.warn(`deleteUser: ${res.status}`);
  }
}

export async function createTeamViaApi(
  token: string,
  params: { name: string }
): Promise<TestTeam> {
  const res = await apiFetch(
    '/teams',
    { method: 'POST', body: JSON.stringify({ team: params }) },
    token
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createTeam failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function deleteTeamViaApi(token: string, teamId: number): Promise<void> {
  const res = await apiFetch(`/teams/${teamId}`, { method: 'DELETE' }, token);
  if (!res.ok && res.status !== 404) {
    console.warn(`deleteTeam: ${res.status}`);
  }
}

export async function createMeetingViaApi(
  token: string,
  params: { title: string; team_id: number }
): Promise<TestMeeting> {
  const res = await apiFetch(
    '/meetings',
    { method: 'POST', body: JSON.stringify({ meeting: params }) },
    token
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createMeeting failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function deleteMeetingViaApi(token: string, meetingId: number): Promise<void> {
  const res = await apiFetch(`/meetings/${meetingId}`, { method: 'DELETE' }, token);
  if (!res.ok && res.status !== 404) {
    console.warn(`deleteMeeting: ${res.status}`);
  }
}

export async function createCompletedMeetingViaApi(
  token: string,
  teamId: number
): Promise<TestMeeting> {
  // 1. 회의 생성
  const meeting = await createMeetingViaApi(token, {
    title: 'E2E 완료 회의',
    team_id: teamId,
  });

  // 2. 트랜스크립트 삽입
  const transcriptRes = await apiFetch(
    `/meetings/${meeting.id}/transcripts`,
    {
      method: 'POST',
      body: JSON.stringify({
        transcript: {
          speaker_label: '화자1',
          content: 'E2E 테스트 발화 내용입니다.',
          started_at_ms: 0,
          ended_at_ms: 3000,
          sequence_number: 1,
        },
      }),
    },
    token
  );
  if (!transcriptRes.ok) {
    console.warn(`transcript insert: ${transcriptRes.status}`);
  }

  // 3. 요약 삽입
  const summaryRes = await apiFetch(
    `/meetings/${meeting.id}/summaries`,
    {
      method: 'POST',
      body: JSON.stringify({
        summary: {
          key_points: 'E2E 핵심 요약 항목',
          decisions: 'E2E 결정사항 항목',
          discussion_details: 'E2E 논의 상세',
          summary_type: 'final',
        },
      }),
    },
    token
  );
  if (!summaryRes.ok) {
    console.warn(`summary insert: ${summaryRes.status}`);
  }

  // 4. 회의 상태 stopped로 변경
  const stopRes = await apiFetch(
    `/meetings/${meeting.id}/stop`,
    { method: 'POST' },
    token
  );
  if (!stopRes.ok) {
    console.warn(`stop meeting: ${stopRes.status}`);
  }

  return meeting;
}
