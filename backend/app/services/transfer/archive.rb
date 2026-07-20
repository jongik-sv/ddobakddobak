require "rubygems/package"
require "zlib"

# Transfer::Archive — 공유 tar.gz IO + 보안 primitive 모듈
#
# MeetingExporter/Importer·FolderExporter/Importer 에서 공통으로 사용하는
# 저수준 유틸리티(module_function). 상태를 가지지 않으며 모든 메서드는
# Transfer::Archive.method_name(…) 으로 호출한다.
#
# 주요 보안 계약:
#   guard_entry_name! — zip-slip 가드(절대경로·".." 세그먼트·Windows 드라이브 거부)
#   account_bytes!    — zip-bomb 가드(누적 압축해제 바이트 상한)
#
# account_bytes! 는 인스턴스 상태 없이 누적 카운터를 관리하기 위해
# counter_ref = [0] (Array 1요소) 를 호출자가 생성해 전달한다.
# 예:
#   counter = [0]
#   Transfer::Archive.account_bytes!(chunk.bytesize, counter)
module Transfer
  module Archive
    # path-traversal(zip-slip) 등 안전하지 않은 tar 엔트리 거부 시 발생.
    class UnsafeEntryError < StandardError; end
    # 압축해제 누적 바이트 상한 초과 또는 매니페스트 불일치 시 발생.
    class InvalidArchiveError < StandardError; end

    # 압축해제 누적 바이트 상한(zip-bomb 가드). 3GB.
    MAX_DECOMPRESSED_BYTES = 3 * 1024**3

    # public_uid unique index 충돌 시 남기는 경고 메시지(§T6/T7, 스펙 §3.4).
    PUBLIC_UID_CONFLICT_WARNING =
      "D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정".freeze

    module_function

    # zip-slip 가드: 절대경로·".." 세그먼트·역슬래시 우회·Windows 드라이브 절대경로·null-byte 를 거부.
    # @param name [String] tar 엔트리 이름
    # @raise [UnsafeEntryError] 안전하지 않은 이름일 때
    def guard_entry_name!(name)
      raw        = name.to_s
      normalized = raw.tr("\\", "/")
      if raw.include?("\x00") ||
         normalized.start_with?("/") ||
         normalized.split("/").include?("..") ||
         normalized.match?(/\A[A-Za-z]:/)
        raise UnsafeEntryError, "unsafe tar entry name: #{name.inspect}"
      end
    end

    # gzip 매직바이트(0x1f 0x8b) 확인. io 는 호출 전후 pos == 0.
    # @param io [IO] read + rewind 가능한 IO
    # @return [Boolean]
    def gzip_magic?(io)
      return false unless io.respond_to?(:read)
      io.rewind if io.respond_to?(:rewind)
      head = io.read(2)
      io.rewind if io.respond_to?(:rewind)
      head.is_a?(String) && head.bytesize == 2 &&
        head.getbyte(0) == 0x1f && head.getbyte(1) == 0x8b
    end

    # 압축해제 누적 바이트 상한 가드. 상한 초과 시 InvalidArchiveError 발생.
    #
    # counter_ref 는 호출자가 생성·보유하는 Array 1요소([count]).
    # 여러 번 호출해 누적하며, 하나의 아카이브 처리 수명 동안 공유한다.
    #
    # @param added [Integer] 이번에 추가되는 바이트 수
    # @param counter_ref [Array<Integer>] 누적 바이트 카운터 ([0] 으로 초기화해 전달)
    # @raise [InvalidArchiveError] 누적 바이트가 MAX_DECOMPRESSED_BYTES 를 초과할 때
    def account_bytes!(added, counter_ref)
      counter_ref[0] += added
      return unless counter_ref[0] > MAX_DECOMPRESSED_BYTES

      raise InvalidArchiveError,
            "압축 해제 크기가 상한(#{MAX_DECOMPRESSED_BYTES} bytes)을 초과했습니다"
    end

    # 디스크 파일을 청크 스트리밍으로 tar 엔트리에 쓴다(메모리 폭발 방지).
    # @param tar [Gem::Package::TarWriter]
    # @param entry_name [String] tar 내 경로
    # @param path [String] 디스크 파일 경로
    # @param chunk [Integer] 청크 크기(기본 64KB)
    def add_file_streamed(tar, entry_name, path, chunk: 65_536)
      size = File.size(path)
      tar.add_file_simple(entry_name, 0o644, size) do |entry|
        File.open(path, "rb") do |file|
          while (data = file.read(chunk))
            entry.write(data)
          end
        end
      end
    end

    # 매니페스트 해시에서 모델의 실제 컬럼만 남긴다(원본 PK·미존재 키 제거).
    # id·created_at·updated_at 도 함께 제거해 mass-assign 안전하게 만든다.
    #
    # attrs 의 키는 **문자열** 이라 가정한다(ActiveRecord#attributes 출력과 동일).
    #
    # @param model_class [Class] ActiveRecord 모델 클래스
    # @param attrs [Hash<String, Object>] 문자열 키 해시
    # @return [Hash<String, Object>]
    def sanitize(model_class, attrs)
      attrs.slice(*model_class.column_names).except("id", "created_at", "updated_at")
    end

    # public_uid unique index 충돌 가드(T6/T7, 스펙 §3.4).
    #
    # 같은 아카이브를 중복 import 하거나 복사 목적으로 import 하면(원본이 로컬에
    # 남아있는 채로 사본을 들여오는 경우) 원본과 동일한 public_uid 가 이미 존재해
    # create! 가 RecordNotUnique 로 실패한다. 예외를 잡는 대신 사전 존재 검사
    # (Meeting.exists?)로 충돌을 감지해, 충돌 시 attrs 의 public_uid·dflow_synced_at·
    # dflow_url 3필드를 직접 null 로 mutate 한다.
    # (서버 이동처럼 로컬에 해당 uid 가 없는 정상 케이스는 3필드 그대로 보존된다.)
    #
    # MeetingRestorer(회의/폴더 import 경로) 와 ProjectImporter 양쪽에서 재사용한다.
    #
    # @param attrs [Hash<String, Object>] 문자열 키의 회의 attrs(직접 mutate 됨)
    # @return [Boolean] 충돌을 감지해 null 처리했으면 true, 아니면 false
    def guard_public_uid_conflict!(attrs)
      uid = attrs["public_uid"]
      return false if uid.blank?
      return false unless Meeting.exists?(public_uid: uid)

      attrs["public_uid"]      = nil
      attrs["dflow_synced_at"] = nil
      attrs["dflow_url"]       = nil
      true
    end
  end
end
