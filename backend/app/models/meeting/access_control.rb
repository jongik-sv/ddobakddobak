# 회의 열람·수정 권한 판정(목록 스코프 + 단건 인가).
module Meeting::AccessControl
  extend ActiveSupport::Concern

  included do
    # 열람 가능한 회의 목록 범위: admin은 전체, 그 외는 본인 소유분 + "공유로 보이는" 회의.
    # 유효 공유 가시성 = meetings.shared AND (폴더 없음 OR 폴더와 모든 조상이 shared). 즉 상위
    # 폴더를 비공개로 두면 그 하위 폴더·회의가 개별 shared 여부와 무관하게 전부 숨는다(상속·폴더 우선).
    # (개별 회의 접근 인가는 MeetingLookup#authorize_meeting_read! — 이 스코프는 목록 쿼리용)
    # Folder.visible_folder_ids가 조상 체인을 in-memory로 평가해 보이는 폴더 id만 IN 으로 넘긴다.
    # Phase 5 컨트롤러 스코핑(index 등)에서 사용 예정.
    scope :accessible_by, ->(user) {
      if user.admin?
        kept
      else
        member_pids = ProjectMembership.where(user_id: user.id).select(:project_id)
        base = kept.where(project_id: member_pids)
        visible_shared = base.where(shared: true).where(
          "meetings.folder_id IS NULL OR meetings.folder_id IN (?)",
          Folder.visible_folder_ids
        )
        base.where(created_by_id: user.id).or(visible_shared)
      end
    }

    # 수정·삭제 가능한 회의 목록 범위: admin은 전체, 그 외는 본인 소유분만.
    scope :editable_by, ->(user) { user.admin? ? all : where(created_by_id: user.id) }
  end

  def owner?(user)
    created_by_id == user.id
  end

  # 유효 공유 가시성(타인 열람 허용 여부): 회의가 공유이고, 폴더가 없거나 폴더와 모든 조상이 공유일 때만.
  # 상위 폴더를 비공개로 두면 하위 회의는 개별 shared 여부와 무관하게 타인에게 안 보인다(상속·폴더 우선).
  # accessible_by 스코프(목록 쿼리)와 동일 규칙을 단건(show 인가)에서 표현한다.
  def shared_visible?
    shared? && (folder_id.nil? || folder&.effectively_shared?)
  end

  # 수정·삭제 권한: admin(god-mode) / 본인 소유 / 직접 지정 협업자 / 소속 폴더(및 조상)의 협업자.
  # idea 44: 폴더 단위 협업자는 Folder#collaborator?(실시간 조상체인 평가, 스냅샷 아님)로 판정.
  #
  # collaborator_meeting_ids/collaborator_folder_ids: 목록 직렬화의 N+1 회피용 선택적 배치 인자.
  # 둘 다 기본 nil이면 기존과 동일하게 회의별 라이브 쿼리(MeetingCollaborator.exists?/
  # Folder#collaborator?)를 그대로 탄다 — 단건 호출(쓰기 인가 등)은 이 인자를 넘기지 않으므로
  # 동작·쿼리 경로 모두 이전과 완전히 동일하다. 넘겨질 때는 각각 "user가 직접 협업자인
  # meeting_id 집합", "user가 (직접 또는 조상 상속으로) 협업자인 folder_id 집합"이어야 하며,
  # 호출부가 그 계약을 지키는 한 반환값은 라이브 쿼리 경로와 항상 동일하다.
  def editable_by?(user, collaborator_meeting_ids: nil, collaborator_folder_ids: nil)
    return false unless user
    return true if (user.respond_to?(:admin?) && user.admin?) || created_by_id == user.id

    direct_collaborator = if collaborator_meeting_ids
      collaborator_meeting_ids.include?(id)
    else
      MeetingCollaborator.exists?(meeting_id: id, user_id: user.id)
    end
    return true if direct_collaborator

    if collaborator_folder_ids
      folder_id.present? && collaborator_folder_ids.include?(folder_id)
    else
      folder&.collaborator?(user) || false
    end
  end
end
