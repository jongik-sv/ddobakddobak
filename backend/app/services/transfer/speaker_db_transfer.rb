require "json"
require "net/http"

module Transfer
  # 화자 DB(SpeakerDB, sidecar 측 파일 — Rails DB 테이블 아님) export/import 공유 헬퍼.
  #
  # MeetingExporter/MeetingImporter(회의 단건) 와 ProjectExporter/ProjectImporter(프로젝트)
  # 양쪽에서 재사용한다. 임베딩·next_num 포함 SpeakerDB 전체를 불투명한 blob 으로 취급해
  # 그대로 왕복시킨다(재구성하지 않음).
  #
  # sidecar 가 죽어있거나 에러를 내도 export/import 전체를 실패시키지 않는다 — 이 모듈
  # 내부에서 예외를 흡수하고 호출자에게 실패만 알린다(설계 제약 §2·§3).
  # 단, 흡수 대상은 ABSORBED_ERRORS 로 **명시**한다. StandardError 를 통째로 삼키면
  # NoMethodError/ArgumentError 같은 진짜 버그가 "사이드카 다운"과 구분되지 않는다.
  module SpeakerDbTransfer
    # 사이드카에 **연결 자체가 되지 않는** 상태. 한 export/import 안에서 한 번 만나면
    # 이후 회의도 실패가 확정적이라 circuit-break 한다(회의 100개 × TIMEOUT 30초 = 50분 방지).
    #
    # 판정 기준은 딱 하나: **다음 호출도 확정적으로 실패하는가?**
    #   yes → 여기(연결 거부·호스트/네트워크 도달 불가·DNS 실패·응답 없음)
    #   no  → TRANSIENT_ERRORS. 응답 **도중** 끊기는 ECONNRESET·EPIPE·EOF 나 본문 파손은
    #         그 회의만의 일시적 실패다. 한 번 끊겼다고 이후 회의를 전부 포기하면 안 된다.
    #
    # ⚠️ SystemCallError·IOError 를 통째로 넣지 말 것 — ECONNRESET/EPIPE(SystemCallError)·
    # EOFError(IOError)·ENOENT(파일 I/O)까지 "도달 불가"로 오분류돼 일시적 끊김 한 번에
    # 이후 모든 회의를 포기한다(3라운드 R2 회귀).
    UNREACHABLE_ERRORS = [
      SidecarClient::TimeoutError,    # with_connection 이 Net::Open/ReadTimeout 을 변환
      SidecarClient::ConnectionError, # with_connection 이 ECONNREFUSED/EHOSTUNREACH/SocketError 를 변환
      SocketError,                    # DNS 실패 — with_connection 밖에서 새는 경우
      Errno::ECONNREFUSED,            # 사이드카 프로세스 없음
      Errno::EHOSTUNREACH,            # 호스트 도달 불가
      Errno::ENETUNREACH,             # 네트워크 도달 불가
      Errno::ENETDOWN,                # 로컬 네트워크 다운
      Timeout::Error                  # Net::OpenTimeout/ReadTimeout 의 부모
    ].freeze

    # 흡수는 하되 circuit 을 열지 **않는** 실패. 요청/회의 단위로만 스킵한다.
    TRANSIENT_ERRORS = [
      SystemCallError,             # ECONNRESET · EPIPE · ENOENT(스테이징 파일 소실) …
      IOError,                     # EOFError = 응답 도중 연결 끊김
      Net::ProtocolError,          # 프로토콜 위반 응답
      Net::HTTPBadResponse,        # 응답 라인 파손 (StandardError 직속이라 별도 등재)
      SidecarClient::SidecarError, # HTTP 4xx/5xx (Timeout/Connection 의 부모이기도 함)
      JSON::JSONError              # ParserError(본문 파손) · GeneratorError(직렬화 실패)
    ].freeze

    # export·import 양쪽이 **같은 집합**으로 흡수한다(두 경로가 갈라지지 않게 한 곳에 정의).
    # 여기에 없는 예외(NoMethodError·ArgumentError·TypeError…)는 진짜 버그이므로 그대로 올린다.
    ABSORBED_ERRORS = (UNREACHABLE_ERRORS + TRANSIENT_ERRORS).freeze

    # 로스터 1건의 크기 상한. 초과분은 raise 하지 않고 **버리고 보고**한다.
    # export·import 양쪽이 같은 상수를 쓴다 — export 에만 상한이 없으면 같은 코드베이스의
    # importer 가 자기가 만든 아카이브를 거부한다(3라운드 R6).
    #
    # 근거(산술): 임베딩 1개는 float32 512차원 = 2048B → base64 2732B + JSON 따옴표/쉼표
    # ≈ 2.8KB. 회의당 화자 100명 × 화자당 임베딩 샘플 50개 = 5000개 ≈ 13.7MB.
    # 64MiB 는 그 4.7배로, 정상 로스터를 막지 않으면서 적대적 아카이브의 무제한 할당을 끊는다.
    MAX_ROSTER_BYTES = 64 * 1024 * 1024

    # tar 엔트리 읽기 청크(다른 스테이징 경로와 동일한 64KB).
    CHUNK_SIZE = 64 * 1024

    # 복원 실패를 사용자에게 보여주는 경고. Transfer::Archive::PUBLIC_UID_CONFLICT_WARNING
    # 과 같은 채널(restorer.warnings / importer.warnings)로 흘려보낸다 —
    # Rails.logger.warn 은 사용자가 볼 수 없다.
    RESTORE_FAILED_WARNING =
      "화자 이름·목소리 정보(화자 DB)를 복원하지 못했습니다 — STT 서버 연결 후 화자 이름을 다시 지정하세요".freeze

    # 아카이브가 **만들어질 때** 이미 로스터가 빠졌음을 알리는 경고(3라운드 R3).
    # import 쪽에서는 손쓸 수 없는 문제라 문구가 다르다 — 원본 기기에서 다시 내보내야 한다.
    EXPORT_DEGRADED_WARNING =
      "화자 이름·목소리 정보(화자 DB)가 내보내기 시점에 누락되었습니다 — 원본 기기의 STT 서버를 켠 뒤 다시 내보내세요".freeze

    # 아카이브 수준 열화 표식이 들어가는 manifest 키.
    # **표식이 없는 구버전 아카이브는 조용히 통과**해야 한다(하위호환) — 키의 부재와
    # false 를 구분하지 않는 이유가 이것이다.
    DEGRADED_MANIFEST_KEY = "speaker_db_degraded".freeze

    module_function

    # tar 엔트리명 스킴: "speakers/<meeting_id>.json" — audio/<meeting_id>.<ext> 와 동일 패턴.
    # @param meeting_id [Integer] 원본(export 시) 또는 신규(import 시) meeting id
    # @return [String]
    def entry_name(meeting_id)
      "speakers/#{meeting_id}.json"
    end

    # 이 예외가 "사이드카에 연결 자체가 안 됨"인가(= 다음 호출도 확정적으로 실패하는가)?
    # circuit-break 판정에만 쓴다. 흡수 여부는 ABSORBED_ERRORS 가 따로 결정한다.
    #
    # ⚠️ "TRANSIENT_ERRORS 에 없으면 도달 불가" 같은 negative 판정을 쓰면 안 된다 —
    # Errno::ECONNREFUSED 는 SystemCallError 의 하위라 TRANSIENT 에도 매칭된다.
    # @param error [Exception]
    # @return [Boolean]
    def unreachable?(error)
      UNREACHABLE_ERRORS.any? { |klass| error.is_a?(klass) }
    end

    # manifest 에 "내보내기 시점에 로스터가 빠졌다" 표식이 있는가?
    # 표식이 없는 구버전 아카이브는 false → 경고 없이 통과(하위호환).
    # @param manifest [Hash, nil]
    # @return [Boolean]
    def degraded_manifest?(manifest)
      return false unless manifest.is_a?(Hash)

      value = manifest[DEGRADED_MANIFEST_KEY]
      value = manifest[DEGRADED_MANIFEST_KEY.to_sym] if value.nil?
      value == true || value.to_s == "true"
    end

    # 로스터가 "아무것도 없는 기본 상태"인지 판정한다.
    # get_speaker_db 는 미등록 meeting 에도 404 가 아니라 기본 페이로드를 주므로
    # ("없음" 신호가 없다) 여기서 판정해 tar 엔트리를 만들지 않는다.
    # Hash 가 아닌 알 수 없는 모양은 **비어있지 않은 것으로** 취급해 그대로 왕복시킨다
    # (스키마가 바뀌었을 때 조용히 버리지 않기 위함).
    # @param payload [Object]
    # @return [Boolean]
    def empty_payload?(payload)
      return true  if payload.nil?
      return false unless payload.is_a?(Hash)

      next_num = payload["next_num"] || payload[:next_num]
      speakers = payload["speakers"] || payload[:speakers]
      names    = payload["names"]    || payload[:names]

      speakers.blank? && names.blank? && (next_num.nil? || next_num.to_i <= 1)
    end

    # meeting_id 의 SpeakerDB 를 sidecar 에서 읽어 tar 엔트리에 쓸 JSON 바이트열을 반환한다.
    # 회의 단건 export 용 얇은 래퍼. 여러 회의를 돌 때는 Exporter 를 직접 써서
    # circuit-break 상태를 공유한다.
    # @param meeting_id [Integer]
    # @return [String, nil] JSON 바이트열(ASCII-8BIT). 로스터가 비었거나 sidecar 실패 시 nil.
    def export_bytes(meeting_id)
      Exporter.new.bytes_for(meeting_id)
    end

    # tar 에서 읽은 화자 DB 바이트열을 새 meeting_id 로 sidecar 에 PUT 한다(전체 교체, 병합 아님).
    # 실패해도 raise 하지 않는다 — 호출자가 반환값(false)을 받아 사용자 경고로 승격한다.
    # 회의 단건 import 용 얇은 래퍼. 여러 회의를 돌 때는 Importer 를 직접 써서
    # circuit-break 상태와 SidecarClient 인스턴스를 공유한다.
    # @param meeting_id [Integer] 새로 생성된(import 대상) meeting id
    # @param bytes [String] JSON 바이트열
    # @return [Boolean] 성공 여부
    def import_bytes(meeting_id, bytes)
      Importer.new.import_bytes(meeting_id, bytes)
    end

    # 스테이징된 파일에서 로스터를 읽어 PUT 한다(ProjectImporter 경로).
    # @param meeting_id [Integer]
    # @param path [String] 스테이징 Tempfile 경로
    # @return [Boolean] 성공 여부
    def import_file(meeting_id, path)
      Importer.new.import_file(meeting_id, path)
    end

    # speakers/*.json tar 엔트리를 상한 아래에서만 메모리로 읽는다.
    #
    # 통째로 `entry.read` 하면 적대적 아카이브가 선언한 거대한 로스터가 상한 검사 **전에**
    # 할당된다. 그래서 (1) 선언 크기(header.size)를 읽기 전에 대조하고, (2) 실제 읽기도
    # 청크 단위로 하며 청크마다 블록(전역 zip-bomb 카운터)을 호출한다.
    # 상한 초과 시 raise 하지 않고 nil — 해당 로스터만 버리고 import 는 완주한다.
    #
    # ⚠️ 건너뛸 때도 **엔트리는 계량하며 끝까지 드레인**해야 한다(3라운드 R1).
    # 읽지 않고 return 하면 Gem::Package::TarReader#each 가 Entry#close 를 부르고,
    # close → seek(0, SEEK_END) 는 Zlib::GzipReader 가 :seek 에 응답하지 않으므로
    # `while pending > 0 { @io.read([pending, 4096].min) }` 드레인 루프로 떨어진다.
    # **그 경로는 계량 블록을 타지 않는다** → 204KB 압축 → 200MB 해제가 2바이트로
    # 계량되고 Transfer::Archive::MAX_DECOMPRESSED_BYTES 가드가 전혀 발화하지 않는다.
    #
    # @param entry [Gem::Package::TarReader::Entry]
    # @param chunk_size [Integer]
    # @yieldparam bytes [Integer] 이번 청크 바이트 수(호출자의 누적 상한 가드에 합산)
    # @return [String, nil] 바이트열. 상한 초과 시 nil.
    def read_entry_capped(entry, chunk_size: CHUNK_SIZE, &accountant)
      declared = entry.respond_to?(:header) && entry.header ? entry.header.size.to_i : nil
      if declared && declared > MAX_ROSTER_BYTES
        Rails.logger.warn(
          "Transfer::SpeakerDbTransfer: roster entry #{entry.full_name} declares #{declared} bytes " \
          "(> #{MAX_ROSTER_BYTES}) — 버퍼링 없이 계량 드레인 후 스킵"
        )
        drain_entry(entry, chunk_size: chunk_size, &accountant)
        return nil
      end

      buffer = +"".b
      while (chunk = entry.read(chunk_size))
        accountant&.call(chunk.bytesize)
        buffer << chunk
        next unless buffer.bytesize > MAX_ROSTER_BYTES

        Rails.logger.warn(
          "Transfer::SpeakerDbTransfer: roster entry #{entry.full_name} exceeded " \
          "#{MAX_ROSTER_BYTES} bytes — 버퍼 폐기 후 계량 드레인"
        )
        buffer = nil # 조기 해제 — 남은 드레인 동안 상한만큼의 메모리를 붙들지 않는다
        drain_entry(entry, chunk_size: chunk_size, &accountant)
        return nil
      end
      buffer
    end

    # 엔트리를 끝까지 읽되 데이터는 **버린다**. 청크마다 블록을 호출해 계량한다.
    #
    # 존재 이유는 read_entry_capped 의 주석과 동일 — 소비하지 않은 엔트리는
    # TarReader::Entry#close 가 계량 없이 대신 읽어버린다(zip-bomb 계량 우회).
    # 블록이 raise 하면(예: 누적 상한 초과) 그대로 올린다 — 가드가 발화해야 하는 지점이다.
    #
    # @param entry [Gem::Package::TarReader::Entry]
    # @param chunk_size [Integer]
    # @yieldparam bytes [Integer] 이번 청크 바이트 수
    # @return [Integer] 드레인한 총 바이트 수
    def drain_entry(entry, chunk_size: CHUNK_SIZE)
      drained = 0
      while (chunk = entry.read(chunk_size))
        size = chunk.bytesize
        drained += size
        yield size if block_given?
      end
      drained
    end

    def log_import_failure(meeting_id, error, degraded: false)
      Rails.logger.warn(
        "Transfer::SpeakerDbTransfer: import failed for meeting##{meeting_id}: " \
        "#{error.class}: #{error.message}#{degraded ? ' (이후 회의는 단축)' : ''}"
      )
    end

    # 한 번의 export 수명 동안 sidecar 상태를 기억하는 로스터 수집기.
    #
    # 붙어는 있는데 응답이 없는 sidecar 면 회의당 최대 TIMEOUT(30초)이라 회의 100개면
    # 50분이 걸린다 — "degrade 하되 완주"의 완주 시간이 무한정이 되지 않도록
    # 연결 불가를 한 번 만나면 이후 회의는 아예 시도하지 않는다(circuit-break).
    # 회의 단위 실패(HTTP 5xx·본문 파손·일시적 끊김)는 그 회의만 건너뛰고 계속 진행한다.
    class Exporter
      def initialize(client: nil)
        @client             = client
        @degraded           = false
        @any_roster_dropped = false
      end

      # sidecar 연결 불가를 만나 이후 호출을 단축 중인가?(circuit open)
      def degraded?
        @degraded
      end

      # 이 export 에서 로스터를 하나라도 놓쳤는가?(사이드카 실패 또는 상한 초과)
      # 로스터가 원래 비어 있던 회의는 "놓친 것"이 아니므로 포함하지 않는다.
      # 아카이브 manifest 의 DEGRADED_MANIFEST_KEY 표식이 이 값을 그대로 쓴다.
      def any_roster_dropped?
        @any_roster_dropped
      end

      # @param meeting_id [Integer]
      # @return [String, nil] JSON 바이트열. 로스터가 비었거나 sidecar 실패 시 nil.
      def bytes_for(meeting_id)
        return nil if @degraded

        payload = client.get_speaker_db(meeting_id)
        return nil if SpeakerDbTransfer.empty_payload?(payload)

        bytes = JSON.generate(payload).b
        return bytes unless bytes.bytesize > MAX_ROSTER_BYTES

        # 여기서 담으면 importer(같은 상한)가 자기 아카이브를 거부한다 → 아예 담지 않고
        # 열화로 기록해 manifest 표식 → import 경고까지 이어지게 한다.
        @any_roster_dropped = true
        Rails.logger.warn(
          "Transfer::SpeakerDbTransfer: roster for meeting##{meeting_id} is #{bytes.bytesize} bytes " \
          "(> #{MAX_ROSTER_BYTES}) — 엔트리를 만들지 않고 열화로 기록"
        )
        nil
      rescue *ABSORBED_ERRORS => e
        @degraded           = true if SpeakerDbTransfer.unreachable?(e)
        @any_roster_dropped = true
        Rails.logger.warn(
          "Transfer::SpeakerDbTransfer: export failed for meeting##{meeting_id}: " \
          "#{e.class}: #{e.message}#{@degraded ? ' (이후 회의는 단축)' : ''}"
        )
        nil
      end

      private

      def client
        @client ||= SidecarClient.new
      end
    end

    # 한 번의 import 수명 동안 sidecar 상태를 기억하는 로스터 복원기(Exporter 와 대칭).
    #
    # export 에서만 circuit-break 를 두면 비대칭이다 — import 도 회의마다
    # SidecarClient 를 새로 만들어 PUT 하면 "붙어는 있는데 응답 없음" 상태에서
    # 회의당 TIMEOUT(30초)를 전부 소모한다(100건이면 50분, 3라운드 R4).
    class Importer
      def initialize(client: nil)
        @client   = client
        @degraded = false
      end

      # sidecar 연결 불가를 만나 이후 PUT 을 단축 중인가?(circuit open)
      def degraded?
        @degraded
      end

      # @param meeting_id [Integer] 새로 생성된(import 대상) meeting id
      # @param bytes [String] JSON 바이트열
      # @return [Boolean] 성공 여부
      def import_bytes(meeting_id, bytes)
        return false if @degraded

        payload = JSON.parse(bytes)
        client.put_speaker_db(meeting_id, payload)
        true
      rescue *ABSORBED_ERRORS => e
        @degraded = true if SpeakerDbTransfer.unreachable?(e)
        SpeakerDbTransfer.log_import_failure(meeting_id, e, degraded: @degraded)
        false
      end

      # 스테이징된 파일에서 로스터를 읽어 PUT 한다(ProjectImporter 경로).
      #
      # 파일 I/O 실패(Errno::* → SystemCallError)도 **여기서** 흡수해야 한다.
      # restore 는 DB 커밋 **후**에 도는데, 여기서 raise 하면 호출자 run! 의
      # `rescue StandardError → cleanup_copied_files` 가 이미 커밋된 import 의
      # 오디오·첨부 복사본을 지운다(롤백 없는 파손).
      #
      # ⚠️ 이 rescue 는 circuit 을 열지 않는다 — 스테이징 파일 소실(ENOENT)은
      # 사이드카와 무관한데 여기서 트립하면 남은 회의 전부를 포기하게 된다.
      # @param meeting_id [Integer]
      # @param path [String] 스테이징 Tempfile 경로
      # @return [Boolean] 성공 여부
      def import_file(meeting_id, path)
        return false if @degraded

        size = File.size(path)
        if size > MAX_ROSTER_BYTES
          Rails.logger.warn(
            "Transfer::SpeakerDbTransfer: roster too large for meeting##{meeting_id} " \
            "(#{size} > #{MAX_ROSTER_BYTES} bytes) — skipped"
          )
          return false
        end

        import_bytes(meeting_id, File.binread(path))
      rescue *ABSORBED_ERRORS => e
        SpeakerDbTransfer.log_import_failure(meeting_id, e)
        false
      end

      private

      def client
        @client ||= SidecarClient.new
      end
    end
  end
end
